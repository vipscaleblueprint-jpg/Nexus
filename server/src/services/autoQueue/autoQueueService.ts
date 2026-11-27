/**
 * Task Map auto-queue: moves tasks from Available tasks into MAs' To Do columns.
 *
 *   runDailyAutoQueue    5 AM Manila: hands out the whole pool to everyone scheduled today,
 *                        balanced by estimated hours against shift length (AI picks among fits)
 *   runAutoQueue         every 5 minutes: tops up MAs on shift right now (queued-task cap)
 *   resetAutoQueue       PM button: returns every unstarted task the auto-queue placed to the pool
 *   distributeAutoQueue  PM button: re-balances unstarted auto-queued tasks + the pool (no AI)
 *
 * Code decides who CAN take a task (MA, scheduled/on shift, has the task's role); the Ollama model
 * (if OLLAMA_URL is set) only chooses who SHOULD, falling back to the rules when it's off or wrong.
 * Assignments go through the Task Map's own assign handler, so notifications, logs and live
 * updates match a PM's drag-and-drop. AUTO_QUEUE_MODE gates the scheduled runs (see config.ts).
 */
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../../config/prisma';
import { logger, errMsg } from '../../config/logger';
import { getManilaHourAndMinute } from '../auditAutoAssign';
import { resolveEffectiveTaskMapOwnerId } from '../../utils/taskMapPermissions';
import { invokeHandler } from './invokeHandler';
import {
  planAssignments,
  planCheckpoint,
  planDailyDistribution,
  type CheckpointPlan,
  type ClientHistory,
  taskHistoryKey,
  type Decision,
  type DailyPlan,
  type PickFn,
} from './planner';
import { pickWithOllama } from './ollamaPicker';
import { judgeWithOllama } from './ollamaDoable';
import { type JudgeFn } from './doable';
import { getAutoQueueConfig, type AutoQueueMode } from './config';
import {
  autoQueuedTo,
  getBoardItemOwnerId,
  isBoardItemStarted,
  isMaWorkItem,
  isStillMovable,
  queueTier,
  compareQueuePriority,
  remainingShiftHours,
  resolveTaskRoles,
  usersInGroup,
  type BoardItem,
  type QueueUser,
  type ShiftGroup,
  type ShiftWindow,
} from './rules';

export { getAutoQueueConfig, type AutoQueueMode } from './config';

const AUTO_QUEUE_EMAIL = 'nexus-ai@system.local';

/** Same pattern as the "VIP Scale" system account: an Admin so it may assign like a PM. */
export async function getOrCreateAutoQueueUser() {
  const existing = await prisma.user.findUnique({ where: { email: AUTO_QUEUE_EMAIL } });
  if (existing) return existing;
  const password = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  return prisma.user.create({
    data: { name: 'Nexus AI', email: AUTO_QUEUE_EMAIL, password, systemRole: 'ADMIN' },
  });
}

interface ActorUser {
  id: string;
  name?: string | null;
  email?: string | null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function taskMapHandlers() {
  // Lazy import: the controller pulls in the server module (socket.io), which imports the workers.
  const { getTaskMapData, assignTaskMapTask, updateTaskStatuses } = await import('../../controllers/taskMap.controller');
  return { getTaskMapData, assignTaskMapTask, updateTaskStatuses };
}

async function loadBoard(actor: ActorUser): Promise<{ pool: BoardItem[]; items: BoardItem[] }> {
  const { getTaskMapData } = await taskMapHandlers();
  const board = await invokeHandler(getTaskMapData, { query: { shift: 'ALL' }, user: actor });
  if (board.status !== 200 || !board.body?.success) {
    throw new Error(`Task Map data request failed (HTTP ${board.status})`);
  }
  const pool: BoardItem[] = board.body.availablePool || [];
  const items: BoardItem[] = board.body.tasks || [];
  const parents = await loadParentInfo([...pool, ...items]);
  const resolve = (it: BoardItem) => {
    const parent = it.isSubtask && it.parentTaskId ? parents.get(it.parentTaskId) : undefined;
    const resolved = resolveTaskRoles(it, parent?.roles);
    return parent?.waiting ? { ...resolved, parentWaiting: true } : resolved;
  };
  const resolvedPool = pool.map(resolve);
  const resolvedItems = items.map(resolve);
  await attachTrackerCollaborators([...resolvedPool, ...resolvedItems.filter(isMaWorkItem)]);
  return { pool: resolvedPool, items: resolvedItems };
}

/**
 * Sets trackerCollaboratorIds on each item: everyone tagged IsRole = "Collaborator" in the MA daily
 * tracker on the item's task family (the parent task or any of its subtasks).
 *
 * One query for the whole board (AuditLog is indexed on entity + entityId). Per person and per
 * scope (parent task / each subtask) only their latest IsRole counts, so a row switched to
 * "Auditor" drops them for that scope. Unlike the audit block, Revisions do not reset this: whoever
 * worked the task before is still the best person to pick it back up.
 */
async function attachTrackerCollaborators(items: BoardItem[]): Promise<void> {
  const familyOf = (it: BoardItem) => (it.isSubtask ? it.parentTaskId : it.id) || null;
  const familyIds = [...new Set(items.map(familyOf).filter((id): id is string => Boolean(id)))];
  if (!familyIds.length) return;

  const [logs, users] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        entity: 'TASK',
        entityId: { in: familyIds },
        action: { in: ['STATUS_CHANGE', 'MA_UPDATE'] },
        OR: [
          { details: { path: ['isCollaborated'], equals: true } },
          { details: { path: ['isAuditRole'], equals: true } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, userId: true, details: true, user: { select: { name: true } } },
    }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const idByName = new Map(users.map((u) => [(u.name || '').trim().toLowerCase(), u.id]));
  const byNameToId = (n: unknown) => (typeof n === 'string' ? idByName.get(n.trim().toLowerCase()) : undefined);

  // family -> person -> scope -> latest role is Collaborator (logs are newest first)
  const latest = new Map<string, Map<string, Map<string, boolean>>>();
  for (const log of logs) {
    const d = (log.details as any) || {};
    const people = new Set<string>();
    if (d.movedById) people.add(d.movedById);
    const named = byNameToId(d.movedByName);
    if (named) people.add(named);
    if (Array.isArray(d.maUpdaterIds)) d.maUpdaterIds.forEach((id: string) => id && people.add(id));
    if (Array.isArray(d.maUpdaterNames)) d.maUpdaterNames.forEach((n: string) => { const id = byNameToId(n); if (id) people.add(id); });
    if (d.movedByName && log.user?.name && !log.user.name.toUpperCase().includes('VIPSCALE')) people.add(log.userId);
    if (!people.size) continue;

    const scope = d.subtaskId || '';
    const isCollab = d.isCollaborated === true;
    let fam = latest.get(log.entityId);
    if (!fam) latest.set(log.entityId, (fam = new Map()));
    for (const person of people) {
      let scopes = fam.get(person);
      if (!scopes) fam.set(person, (scopes = new Map()));
      if (!scopes.has(scope)) scopes.set(scope, isCollab);
    }
  }

  const collaboratorsByFamily = new Map<string, string[]>();
  for (const [familyId, fam] of latest) {
    const ids = [...fam].filter(([, scopes]) => [...scopes.values()].some(Boolean)).map(([id]) => id);
    if (ids.length) collaboratorsByFamily.set(familyId, ids);
  }
  for (const it of items) {
    const ids = collaboratorsByFamily.get(familyOf(it) || '');
    if (ids) it.trackerCollaboratorIds = ids;
  }
}

/**
 * Parent-task info for subtasks: roles (a subtask with no role inherits its parent's) and whether
 * the parent is waiting (task status or any Task Map status contains WAITING). Subtasks of a waiting
 * parent are never auto-assigned, whatever their own status (even In Review).
 */
async function loadParentInfo(items: BoardItem[]): Promise<Map<string, { roles: string[]; waiting: boolean }>> {
  const ids = [...new Set(items.filter((it) => it.isSubtask && it.parentTaskId).map((it) => it.parentTaskId!))];
  if (!ids.length) return new Map();
  const [parents, records] = await Promise.all([
    prisma.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, assigneeRoleRestrictions: true },
    }),
    prisma.taskMapRecord.findMany({
      where: { taskId: { in: ids } },
      select: { taskId: true, statuses: true },
    }),
  ]);
  const isWaiting = (v?: string | null) => (v || '').toUpperCase().replace(/[^A-Z]/g, '').includes('WAITING');
  const recordStatuses = new Map(records.map((r) => [r.taskId, r.statuses || []]));
  return new Map(
    parents.map((p) => [
      p.id,
      {
        roles: p.assigneeRoleRestrictions || [],
        waiting: isWaiting(p.status as any) || (recordStatuses.get(p.id) || []).some(isWaiting),
      },
    ])
  );
}

async function loadPeople(): Promise<{ users: QueueUser[]; shifts: ShiftWindow[] }> {
  const [users, shifts] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, autoQueueExcluded: false },
      select: {
        id: true, name: true, email: true, roles: true, systemRole: true, isActive: true, starRating: true, teamId: true,
      },
    }),
    prisma.auditShiftConfig.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
  ]);
  return { users: users as QueueUser[], shifts: shifts as ShiftWindow[] };
}

const HISTORY_DAYS = 180;

/**
 * Who has worked a client before: the client's (list's) tasks each person has commented on in the
 * last HISTORY_DAYS (task or subtask comments; one task counts once however many comments).
 */
async function loadClientHistory(botId: string): Promise<ClientHistory> {
  const rows = await prisma.taskComment.findMany({
    where: { createdAt: { gte: new Date(Date.now() - HISTORY_DAYS * 864e5) }, userId: { not: botId } },
    select: { userId: true, taskId: true, task: { select: { listId: true } } },
  });
  const seen = new Set<string>();
  const history: ClientHistory = new Map();
  for (const r of rows) {
    const listId = r.task?.listId;
    const key = `${r.userId}|${r.taskId}`;
    if (!listId || seen.has(key)) continue;
    seen.add(key);
    const byClient = history.get(r.userId) || new Map<string, number>();
    byClient.set(listId, (byClient.get(listId) || 0) + 1);
    byClient.set(taskHistoryKey(r.taskId), 1); // worked on this exact task (or its subtasks) before
    history.set(r.userId, byClient);
  }
  return history;
}

function aiPicker(): PickFn | undefined {
  const ollama = getAutoQueueConfig().ollama;
  return ollama ? (task, candidates) => pickWithOllama(task, candidates, ollama) : undefined;
}

function aiJudge(): JudgeFn | undefined {
  const ollama = getAutoQueueConfig().ollama;
  return ollama ? (remainingHours, items) => judgeWithOllama(remainingHours, items, ollama) : undefined;
}

interface FreshItemState {
  ownerId: string | null;
  status: string | null;
}

function hasLiveSheetProgress(reviews: any[], subtaskId?: string | null): boolean {
  return reviews.some(
    (r: any) =>
      r?.type === 'SHEET_PROGRESS' &&
      (subtaskId ? r?.subtaskId === subtaskId : !r?.subtaskId) &&
      Boolean(r?.timeIn) &&
      !r?.timeOut
  );
}

/** Owner and started state read fresh from the DB (the board snapshot may be minutes old). */
async function getCurrentState(item: BoardItem): Promise<FreshItemState | null> {
  if (item.isSubtask && item.subtaskId) {
    const sub = await prisma.subtask.findUnique({
      where: { id: item.subtaskId },
      select: { status: true, assigneeId: true, assignees: { select: { id: true } }, taskId: true },
    });
    if (!sub) return null;
    const record = await prisma.taskMapRecord.findUnique({ where: { taskId: sub.taskId } });
    const reviews = Array.isArray(record?.pmReviews) ? (record!.pmReviews as any[]) : [];
    const subState = reviews.find((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === item.subtaskId);
    const ownerId = resolveEffectiveTaskMapOwnerId({
      pmReviews: reviews.filter((r: any) => r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === item.subtaskId),
      handedOver: Boolean(subState?.handedOver),
      statuses: subState?.statuses || [],
      assigneeId: sub.assigneeId,
      assignees: sub.assignees,
      subtaskId: item.subtaskId,
    });
    return {
      ownerId,
      status: hasLiveSheetProgress(reviews, item.subtaskId) ? 'IN PROGRESS' : sub.status,
    };
  }
  const task = await prisma.task.findUnique({
    where: { id: item.id },
    select: { status: true, assigneeId: true, assignees: { select: { id: true } }, taskMapRecord: true },
  });
  if (!task) return null;
  const reviews = Array.isArray(task.taskMapRecord?.pmReviews) ? (task.taskMapRecord!.pmReviews as any[]) : [];
  const ownerId = resolveEffectiveTaskMapOwnerId({
    pmReviews: task.taskMapRecord?.pmReviews,
    handedOver: Boolean(task.taskMapRecord?.handedOver),
    statuses: task.taskMapRecord?.statuses || [],
    assigneeId: task.assigneeId,
    assignees: task.assignees,
  });
  return {
    ownerId,
    status: hasLiveSheetProgress(reviews) ? 'IN PROGRESS' : task.status,
  };
}

/** Who owns the item right now, read fresh from the DB (the board snapshot may be minutes old). */
async function getCurrentOwnerId(item: BoardItem): Promise<string | null | undefined> {
  const state = await getCurrentState(item);
  return state ? state.ownerId : undefined;
}

/** Unstarted MA work that the auto-queue placed and nobody has moved since: what Reset/Distribute may move. */
function movableAutoQueued(items: BoardItem[], botId: string): BoardItem[] {
  return items.filter((it) => isMaWorkItem(it) && !isBoardItemStarted(it) && autoQueuedTo(it, botId));
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export type AppliedDecision = Decision & { applied: boolean; error?: string };

async function addCheckpointComment(
  item: BoardItem,
  botId: string,
  kind: '1pm' | '5pm',
  toName: string | null,
  reason: string
) {
  await prisma.taskComment
    .create({
      data: {
        taskId: item.isSubtask && item.parentTaskId ? item.parentTaskId : item.id,
        userId: botId,
        content: `**AI PM** (${kind}): moved to ${toName || 'Available tasks'} — ${reason}`,
        ...(item.isSubtask && item.subtaskId ? { subtaskId: item.subtaskId } : {}),
      },
    })
    .catch(() => null);
}

async function applyDecisions(opts: {
  decisions: Decision[];
  itemsById: Map<string, BoardItem>;
  /** Owner each item must still have before it's moved (null = still in Available tasks). */
  expectedOwner: (item: BoardItem) => string | null;
  bot: ActorUser;
  dryRun: boolean;
  /** The PM who pressed Distribute, for the timeline. */
  triggeredBy?: string;
  label: string;
}): Promise<AppliedDecision[]> {
  const results: AppliedDecision[] = [];
  const { assignTaskMapTask } = await taskMapHandlers();

  for (const d of opts.decisions) {
    const verbDry = d.fromUserId ? 'hand over' : 'queue';
    const verbDone = d.fromUserId ? 'handed over' : 'queued';
    if (opts.dryRun) {
      logger.info(`[AutoQueue][${opts.label}][dry-run] would ${verbDry} "${d.taskTitle}" -> ${d.userName} (${d.method}: ${d.reason})`);
      results.push({ ...d, applied: false });
      continue;
    }
    const item = opts.itemsById.get(d.taskId)!;
    try {
      const expected = opts.expectedOwner(item);
      const fresh = await getCurrentState(item);
      const stillValid =
        fresh !== null &&
        (expected === null ? (fresh.ownerId ?? null) === null : isStillMovable(fresh, expected));
      if (!stillValid) {
        results.push({
          ...d,
          applied: false,
          error: expected === null ? 'Changed by someone else meanwhile' : 'Changed or started meanwhile',
        });
        continue;
      }
      const res = await invokeHandler(assignTaskMapTask, {
        params: { id: d.taskId },
        // Pass the task's roles as they are: otherwise the assign handler adds the assignee's first
        // role (e.g. Leo's "Harmony") to the task, and later runs would only match that role.
        body: { assigneeId: d.userId, mode: 'QUEUE', assigneeRoleRestrictions: item.assigneeRoleRestrictions || [] },
        user: opts.bot,
      });
      if (res.status !== 200 || !res.body?.success) {
        results.push({ ...d, applied: false, error: res.body?.error || `HTTP ${res.status}` });
        continue;
      }
      await prisma.auditLog
        .create({
          data: {
            action: 'AUTO_QUEUE',
            entity: 'TASK',
            entityId: item.isSubtask && item.parentTaskId ? item.parentTaskId : d.taskId,
            userId: opts.bot.id,
            details: {
              assigneeId: d.userId,
              assigneeName: d.userName,
              method: d.method,
              reason: d.reason,
              run: opts.label,
              action: d.fromUserId ? 'handover' : 'assign',
              ...(d.fromUserId ? { fromUserId: d.fromUserId } : {}),
              ...(d.hours !== undefined ? { hours: d.hours } : {}),
              ...(opts.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
              ...(item.isSubtask ? { subtaskId: item.subtaskId } : {}),
            },
          },
        })
        .catch(() => null);
      logger.info(`[AutoQueue][${opts.label}] ${verbDone} "${d.taskTitle}" -> ${d.userName} (${d.method}: ${d.reason})`);
      results.push({ ...d, applied: true });
    } catch (err) {
      results.push({ ...d, applied: false, error: errMsg(err) });
    }
  }
  return results;
}

// One run at a time: scheduled runs and PM buttons all move the same cards.
let running: string | null = null;

export class AutoQueueBusyError extends Error {
  constructor(public readonly runningJob: string) {
    super(`Auto-queue is busy (${runningJob}). Try again in a minute.`);
  }
}

async function exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (running) throw new AutoQueueBusyError(running);
  running = label;
  try {
    return await fn();
  } finally {
    running = null;
  }
}

// ---------------------------------------------------------------------------
// Every-5-minutes top-up
// ---------------------------------------------------------------------------

export interface AutoQueueResult {
  mode: AutoQueueMode;
  skipped?: string;
  onShiftMaCount?: number;
  unassignedCount?: number;
  decisions: AppliedDecision[];
}

export async function runAutoQueue(opts: { modeOverride?: AutoQueueMode } = {}): Promise<AutoQueueResult> {
  const config = getAutoQueueConfig();
  const mode = opts.modeOverride || config.mode;
  if (mode === 'off') return { mode, skipped: 'AUTO_QUEUE_MODE is off', decisions: [] };
  if (running) return { mode, skipped: `A run is already in progress (${running})`, decisions: [] };

  return exclusive('top-up', async () => {
    const bot = await getOrCreateAutoQueueUser();
    const [{ pool, items }, { users, shifts }] = await Promise.all([loadBoard(bot), loadPeople()]);
    const { hour, minute } = getManilaHourAndMinute();
    const plan = await planAssignments({
      pool,
      boardItems: items,
      users,
      shifts,
      minuteOfDay: hour * 60 + minute,
      maxQueuedPerMa: config.maxQueuedPerMa,
      maxAssignmentsPerRun: config.maxAssignmentsPerRun,
      pick: aiPicker(),
    });
    const decisions = await applyDecisions({
      decisions: plan.decisions,
      itemsById: new Map(pool.map((t) => [t.id, t])),
      expectedOwner: () => null,
      bot,
      dryRun: mode === 'dry_run',
      label: 'top-up',
    });
    return { mode, onShiftMaCount: plan.onShiftMaCount, unassignedCount: plan.unassignedCount, decisions };
  });
}

// ---------------------------------------------------------------------------
// 5 AM daily distribution
// ---------------------------------------------------------------------------

export interface DailyResult {
  mode: AutoQueueMode;
  skipped?: string;
  decisions: AppliedDecision[];
  skippedTasks: DailyPlan['skipped'];
  scheduledMaCount: number;
  summary: DailyPlan['summary'];
}

async function runGroupDistribution(
  group: ShiftGroup | ShiftGroup[],
  label: string,
  opts: { modeOverride?: AutoQueueMode; requireInProgress?: boolean } = {}
): Promise<DailyResult> {
  const config = getAutoQueueConfig();
  const mode = opts.modeOverride || config.mode;
  const empty = { decisions: [], skippedTasks: [], scheduledMaCount: 0, summary: [] };
  if (mode === 'off') return { mode, skipped: 'AUTO_QUEUE_MODE is off', ...empty };

  const bot = await getOrCreateAutoQueueUser();
  const [{ pool, items }, { users, shifts }, clientHistory] = await Promise.all([
    loadBoard(bot),
    loadPeople(),
    loadClientHistory(bot.id),
  ]);
  const plan = await planDailyDistribution({
    pool,
    boardItems: items,
    users: usersInGroup(users, shifts, group),
    shifts,
    defaultHours: config.defaultHours,
    pick: aiPicker(),
    clientHistory,
    requireInProgress: opts.requireInProgress ?? false,
  });
  const decisions = await applyDecisions({
    decisions: plan.decisions,
    itemsById: new Map(pool.map((t) => [t.id, t])),
    expectedOwner: () => null,
    bot,
    dryRun: mode === 'dry_run',
    label,
  });
  logger.info(
    `[AutoQueue][${label}] ${decisions.filter((d) => d.applied).length}/${plan.decisions.length} queued to ${plan.scheduledMaCount} ${Array.isArray(group) ? group.join('/') : group} MAs; ${plan.skipped.length} left in pool`
  );
  return { mode, decisions, skippedTasks: plan.skipped, scheduledMaCount: plan.scheduledMaCount, summary: plan.summary };
}

export async function runDailyAutoQueue(opts: { modeOverride?: AutoQueueMode; requireInProgress?: boolean } = {}): Promise<DailyResult> {
  const config = getAutoQueueConfig();
  const mode = opts.modeOverride || config.mode;
  if (mode === 'off') {
    return { mode, skipped: 'AUTO_QUEUE_MODE is off', decisions: [], skippedTasks: [], scheduledMaCount: 0, summary: [] };
  }
  return exclusive('5 AM plan', () => runGroupDistribution('morning', '5am', { ...opts, requireInProgress: opts.requireInProgress ?? false }));
}

/** Active shift triggers (10am, 3pm, 8pm) in case there are late or newly clocked-in workers. */
export async function runActiveShiftQueue(
  group: ShiftGroup | ShiftGroup[],
  label: '10am' | '3pm' | '8pm' | '10pm'
): Promise<DailyResult> {
  const config = getAutoQueueConfig();
  if (config.mode === 'off') {
    return { mode: 'off', skipped: 'AUTO_QUEUE_MODE is off', decisions: [], skippedTasks: [], scheduledMaCount: 0, summary: [] };
  }
  return exclusive(`${label} queue`, () => runGroupDistribution(group, label, { requireInProgress: true }));
}

// ---------------------------------------------------------------------------
// 1 PM and 5 PM checkpoints (doable check -> handover / return, then 5 PM night fill)
// ---------------------------------------------------------------------------

export interface CheckpointResult {
  mode: AutoQueueMode;
  skipped?: string;
  verdicts: CheckpointPlan['verdicts'];
  handovers: AppliedDecision[];
  returned: Array<CheckpointPlan['returned'][number] & { applied: boolean; error?: string }>;
  atRisk: CheckpointPlan['atRisk'];
  nightFill?: DailyResult; // 5 PM only
}

export async function runCheckpoint(
  kind: '1pm' | '5pm',
  opts: { modeOverride?: AutoQueueMode } = {}
): Promise<CheckpointResult> {
  const config = getAutoQueueConfig();
  const mode = opts.modeOverride || config.mode;
  const empty: CheckpointResult = { mode, verdicts: [], handovers: [], returned: [], atRisk: [] };
  if (mode === 'off') return { ...empty, skipped: 'AUTO_QUEUE_MODE is off' };

  return exclusive(`${kind} checkpoint`, async () => {
    const bot = await getOrCreateAutoQueueUser();
    const [{ items }, { users, shifts }, clientHistory] = await Promise.all([
      loadBoard(bot),
      loadPeople(),
      loadClientHistory(bot.id),
    ]);
    const { hour, minute } = getManilaHourAndMinute();
    const from: ShiftGroup | ShiftGroup[] = kind === '1pm' ? 'morning' : ['morning', 'noon'];
    const to: ShiftGroup | ShiftGroup[] = kind === '1pm' ? 'noon' : ['noon', 'night'];

    const plan = await planCheckpoint({
      boardItems: items,
      users,
      shifts,
      minuteOfDay: hour * 60 + minute,
      from,
      to,
      botId: bot.id,
      defaultHours: config.defaultHours,
      judge: aiJudge(),
      pick: aiPicker(),
      clientHistory,
      morningSigningOut: kind === '5pm',
      requireInProgress: true,
    });

    const dryRun = mode === 'dry_run';
    const logPrefix = dryRun ? `[AutoQueue][${kind}][dry-run]` : `[AutoQueue][${kind}]`;
    for (const v of plan.verdicts) {
      logger.info(
        `${logPrefix} verdict ${v.userName} (${v.remainingHours.toFixed(1)}h left, ${v.method}): ${v.cannotFinishIds.length} cannot finish — ${v.reason}`
      );
    }
    for (const r of plan.atRisk) {
      logger.info(`${logPrefix} at-risk "${r.taskTitle}" (PM-placed, staying put): ${r.reason}`);
    }

    const itemsById = new Map(items.map((it) => [it.id, it]));
    const handovers = await applyDecisions({
      decisions: plan.handovers,
      itemsById,
      expectedOwner: (item) => plan.handovers.find((d) => d.taskId === item.id)?.fromUserId ?? null,
      bot,
      dryRun,
      label: kind,
    });

    for (const h of handovers) {
      if (!h.applied) continue;
      const item = itemsById.get(h.taskId)!;
      await addCheckpointComment(item, bot.id, kind, h.userName, h.reason);
    }

    const { updateTaskStatuses, assignTaskMapTask } = await taskMapHandlers();
    const returned: CheckpointResult['returned'] = [];
    for (const r of plan.returned) {
      if (dryRun) {
        logger.info(`[AutoQueue][${kind}][dry-run] would return "${r.taskTitle}" -> Available tasks (${r.reason})`);
        returned.push({ ...r, applied: false });
        continue;
      }
      const item = itemsById.get(r.taskId)!;
      try {
        const fresh = await getCurrentState(item);
        if (!fresh || !isStillMovable(fresh, r.fromUserId)) {
          returned.push({ ...r, applied: false, error: 'Changed or started meanwhile' });
          continue;
        }
        // First unassign from the signing-out MA so it leaves their Task Map column and returns to Available tasks
        const assignRes = await invokeHandler(assignTaskMapTask, {
          params: { id: r.taskId },
          body: { assigneeId: null, mode: 'QUEUE' },
          user: bot,
        });
        if (assignRes.status !== 200 || !assignRes.body?.success) {
          logger.warn(`[AutoQueue][${kind}] failed unassigning returned task "${r.taskTitle}": ${assignRes.body?.error || `HTTP ${assignRes.status}`}`);
        }
        // Then set Hand-over status tag
        const res = await invokeHandler(updateTaskStatuses, {
          params: { id: r.taskId },
          body: { statuses: ['Hand-over'] },
          user: bot,
        });
        if (res.status !== 200 || !res.body?.success) {
          returned.push({ ...r, applied: false, error: res.body?.error || `HTTP ${res.status}` });
          continue;
        }
        await prisma.auditLog
          .create({
            data: {
              action: 'AUTO_QUEUE',
              entity: 'TASK',
              entityId: item.isSubtask && item.parentTaskId ? item.parentTaskId : r.taskId,
              userId: bot.id,
              details: {
                action: 'returned',
                fromUserId: r.fromUserId,
                reason: r.reason,
                run: kind,
                ...(item.isSubtask ? { subtaskId: item.subtaskId } : {}),
              },
            },
          })
          .catch(() => null);
        await addCheckpointComment(item, bot.id, kind, null, r.reason);
        logger.info(`[AutoQueue][${kind}] returned "${r.taskTitle}" -> Available tasks (${r.reason})`);
        returned.push({ ...r, applied: true });
      } catch (err) {
        returned.push({ ...r, applied: false, error: errMsg(err) });
      }
    }

    let nightFill: DailyResult | undefined;
    if (kind === '5pm') {
      nightFill = await runGroupDistribution(['noon', 'night'], '5pm', { modeOverride: mode, requireInProgress: false });
    }

    logger.info(
      `[AutoQueue][${kind}] ${handovers.filter((h) => h.applied).length}/${plan.handovers.length} handed over, ` +
        `${returned.filter((r) => r.applied).length}/${plan.returned.length} returned, ${plan.atRisk.length} at-risk`
    );

    return { mode, verdicts: plan.verdicts, handovers, returned, atRisk: plan.atRisk, ...(nightFill ? { nightFill } : {}) };
  });
}

// ---------------------------------------------------------------------------
// PM buttons
// ---------------------------------------------------------------------------

export interface ResetResult {
  returned: number;
  failed: Array<{ taskId: string; taskTitle: string; error: string }>;
}

/** Returns every unstarted task the auto-queue placed (and nobody moved since) to Available tasks. */
export async function resetAutoQueue(actor: ActorUser): Promise<ResetResult> {
  return exclusive('reset', async () => {
    const bot = await getOrCreateAutoQueueUser();
    const { items } = await loadBoard(bot);
    const { assignTaskMapTask } = await taskMapHandlers();
    const result: ResetResult = { returned: 0, failed: [] };

    for (const item of movableAutoQueued(items, bot.id)) {
      const expected = autoQueuedTo(item, bot.id);
      try {
        if ((await getCurrentOwnerId(item)) !== expected) continue; // moved by someone since
        const res = await invokeHandler(assignTaskMapTask, {
          params: { id: item.id },
          body: { assigneeId: null, mode: 'QUEUE' },
          user: actor, // the PM who pressed Reset shows in the activity log
        });
        if (res.status === 200 && res.body?.success) result.returned++;
        else result.failed.push({ taskId: item.id, taskTitle: item.title, error: res.body?.error || `HTTP ${res.status}` });
      } catch (err) {
        result.failed.push({ taskId: item.id, taskTitle: item.title, error: errMsg(err) });
      }
    }
    logger.info(`[AutoQueue][reset] by ${actor.name || actor.id}: ${result.returned} returned to Available tasks`);
    return result;
  });
}

export interface DistributeResult {
  moved: number;
  newlyQueued: number;
  unchanged: number;
  failed: Array<{ taskId: string; taskTitle: string; error: string }>;
  skippedTasks: DailyPlan['skipped'];
  summary: DailyPlan['summary'];
  decisions?: Array<Decision & { isMove?: boolean }>;
}

/**
 * Evens out the day: unstarted auto-queued tasks plus everything in Available tasks are re-planned
 * by the working time each person still has today from the moment it runs (later shifts included).
 * A task only goes to someone with enough free time left to finish it, so a 3h task at 4 PM skips a
 * morning person who is out at 5 PM and goes to the noon/night shift. Same rules as 5 AM otherwise,
 * no AI so the button is quick. Only cards whose
 * owner changes are moved; started tasks and anything a PM placed by hand stay where they are.
 */
export async function distributeAutoQueue(actor: ActorUser, opts: { preview?: boolean } = {}): Promise<DistributeResult> {
  return exclusive(opts.preview ? 'distribute preview' : 'distribute', async () => {
    const config = getAutoQueueConfig();
    const bot = await getOrCreateAutoQueueUser();
    const [{ pool, items }, { users, shifts }, clientHistory] = await Promise.all([
      loadBoard(bot),
      loadPeople(),
      loadClientHistory(bot.id),
    ]);

    const { hour, minute } = getManilaHourAndMinute();
    const nowMinute = hour * 60 + minute;

    const movable = movableAutoQueued(items, bot.id);
    const movableIds = new Set(movable.map((m) => m.id));
    const ownerBefore = new Map<string, string | null>(movable.map((m) => [m.id, autoQueuedTo(m, bot.id)]));

    const plan = await planDailyDistribution({
      pool: [...pool, ...movable],
      boardItems: items.filter((it) => !movableIds.has(it.id)),
      users,
      shifts,
      defaultHours: config.defaultHours,
      // Working time each person still has today from the moment of the click, including shifts
      // that haven't started yet (night/noon). A task only goes to someone with enough of it left
      // after their current work; otherwise it stays in Available tasks for a later shift.
      capacityHours: (user) => remainingShiftHours(user, shifts, nowMinute),
      requireRoom: true,
      roomLabel: 'working the rest of today',
      clientHistory,
    });

    const changes = plan.decisions.filter((d) => (ownerBefore.get(d.taskId) ?? null) !== d.userId);
    const applied = await applyDecisions({
      decisions: changes,
      itemsById: new Map([...pool, ...movable].map((t) => [t.id, t])),
      expectedOwner: (item) => ownerBefore.get(item.id) ?? null,
      bot,
      dryRun: Boolean(opts.preview),
      triggeredBy: actor.name || actor.email || actor.id,
      label: 'distribute',
    });

    const ok = applied.filter((d) => d.applied || opts.preview);
    return {
      moved: ok.filter((d) => ownerBefore.has(d.taskId)).length,
      newlyQueued: ok.filter((d) => !ownerBefore.has(d.taskId)).length,
      unchanged: plan.decisions.length - changes.length,
      failed: applied
        .filter((d) => !d.applied && !opts.preview)
        .map((d) => ({ taskId: d.taskId, taskTitle: d.taskTitle, error: d.error || 'Not applied' })),
      skippedTasks: plan.skipped,
      summary: plan.summary,
      ...(opts.preview
        ? {
            decisions: changes.map((d) => ({
              ...d,
              isMove: ownerBefore.has(d.taskId),
            })),
          }
        : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// People left out of the auto-queue (set by PMs/Admins from the Distribute dialog)
// ---------------------------------------------------------------------------

export async function listAutoQueueExcluded(): Promise<Array<{ id: string; name: string }>> {
  return prisma.user.findMany({
    where: { isActive: true, autoQueueExcluded: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function setAutoQueueExcluded(userId: string, excluded: boolean, actor: ActorUser): Promise<void> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { autoQueueExcluded: excluded },
    select: { name: true },
  });
  logger.info(
    `[AutoQueue] ${user.name} ${excluded ? 'excluded from' : 'included in'} the auto-queue by ${actor.name || actor.email || actor.id}`
  );
}

// ---------------------------------------------------------------------------
// Work order: MAs start their To Do in hierarchy order
// ---------------------------------------------------------------------------

let workOrderActor: ActorUser | null = null;

const TIER_LABEL = ['Hand-over Urgent', 'Urgent', 'Hand-over High', 'High', 'Hand-over', 'Normal'];

/**
 * The higher-priority task an MA must start before `targetId`, or null when `targetId` is next in line.
 * Order: hand-over urgent, urgent, hand-over high, high, hand-over, the rest. Fails open (returns null)
 * if the board can't be read, so a Task Map hiccup never blocks work.
 */
export async function findHigherPriorityQueued(
  userId: string,
  targetId: string
): Promise<{ id: string; title: string; tier: string } | null> {
  try {
    // Hot path on every MA start: reuse the bot id and skip role resolution (tier/owner don't need it).
    // getTaskMapData serves from its Redis cache, which every Task Map change invalidates.
    if (!workOrderActor) {
      const bot = await getOrCreateAutoQueueUser();
      workOrderActor = { id: bot.id, name: bot.name, email: bot.email };
    }
    const { getTaskMapData } = await taskMapHandlers();
    const board = await invokeHandler(getTaskMapData, { query: { shift: 'ALL' }, user: workOrderActor });
    if (board.status !== 200 || !board.body?.success) return null;
    const items: BoardItem[] = board.body.tasks || [];
    const mine = items.filter(
      (it) => isMaWorkItem(it) && !isBoardItemStarted(it) && getBoardItemOwnerId(it) === userId
    );
    const target = mine.find((it) => it.id === targetId);
    if (!target) return null;
    // Same tier (e.g. all Urgent): the one due soonest goes first.
    const blocker = mine
      .filter((it) => it.id !== targetId && compareQueuePriority(it, target) < 0)
      .sort(compareQueuePriority)[0];
    if (!blocker) return null;
    const label = TIER_LABEL[queueTier(blocker)];
    return {
      id: blocker.id,
      title: blocker.title,
      tier: queueTier(blocker) === queueTier(target) ? `${label}, due sooner` : label,
    };
  } catch (err) {
    logger.warn(`[AutoQueue] Work-order check skipped: ${errMsg(err)}`);
    return null;
  }
}
