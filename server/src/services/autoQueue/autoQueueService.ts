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
  planDailyDistribution,
  type Decision,
  type DailyPlan,
  type PickFn,
} from './planner';
import { pickWithOllama } from './ollamaPicker';
import { getAutoQueueConfig, type AutoQueueMode } from './config';
import {
  getBoardItemOwnerId,
  isBoardItemStarted,
  isMaWorkItem,
  type BoardItem,
  type QueueUser,
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
  const { getTaskMapData, assignTaskMapTask } = await import('../../controllers/taskMap.controller');
  return { getTaskMapData, assignTaskMapTask };
}

async function loadBoard(actor: ActorUser): Promise<{ pool: BoardItem[]; items: BoardItem[] }> {
  const { getTaskMapData } = await taskMapHandlers();
  const board = await invokeHandler(getTaskMapData, { query: { shift: 'ALL' }, user: actor });
  if (board.status !== 200 || !board.body?.success) {
    throw new Error(`Task Map data request failed (HTTP ${board.status})`);
  }
  return { pool: board.body.availablePool || [], items: board.body.tasks || [] };
}

async function loadPeople(): Promise<{ users: QueueUser[]; shifts: ShiftWindow[] }> {
  const [users, shifts] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, roles: true, systemRole: true, isActive: true, starRating: true, teamId: true,
      },
    }),
    prisma.auditShiftConfig.findMany({ where: { isActive: true } }),
  ]);
  return { users: users as QueueUser[], shifts: shifts as ShiftWindow[] };
}

function aiPicker(): PickFn | undefined {
  const ollama = getAutoQueueConfig().ollama;
  return ollama ? (task, candidates) => pickWithOllama(task, candidates, ollama) : undefined;
}

/** Who owns the item right now, read fresh from the DB (the board snapshot may be minutes old). */
async function getCurrentOwnerId(item: BoardItem): Promise<string | null | undefined> {
  if (item.isSubtask && item.subtaskId) {
    const sub = await prisma.subtask.findUnique({
      where: { id: item.subtaskId },
      select: { assigneeId: true, assignees: { select: { id: true } }, taskId: true },
    });
    if (!sub) return undefined;
    const record = await prisma.taskMapRecord.findUnique({ where: { taskId: sub.taskId } });
    const reviews = Array.isArray(record?.pmReviews) ? (record!.pmReviews as any[]) : [];
    const subState = reviews.find((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === item.subtaskId);
    return resolveEffectiveTaskMapOwnerId({
      pmReviews: reviews.filter((r: any) => r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === item.subtaskId),
      handedOver: Boolean(subState?.handedOver),
      statuses: subState?.statuses || [],
      assigneeId: sub.assigneeId,
      assignees: sub.assignees,
      subtaskId: item.subtaskId,
    });
  }
  const task = await prisma.task.findUnique({
    where: { id: item.id },
    select: { assigneeId: true, assignees: { select: { id: true } }, taskMapRecord: true },
  });
  if (!task) return undefined;
  return resolveEffectiveTaskMapOwnerId({
    pmReviews: task.taskMapRecord?.pmReviews,
    handedOver: Boolean(task.taskMapRecord?.handedOver),
    statuses: task.taskMapRecord?.statuses || [],
    assigneeId: task.assigneeId,
    assignees: task.assignees,
  });
}

/** The MA the auto-queue put this item with, if its current Task Map assignment is the auto-queue's. */
function autoQueuedTo(item: BoardItem, botId: string): string | null {
  const reviews = Array.isArray(item.taskMap?.pmReviews) ? item.taskMap!.pmReviews : [];
  const entry = reviews.find(
    (r: any) =>
      r?.type === 'PM_ASSIGNMENT' &&
      r?.assignedTo &&
      (item.isSubtask ? r?.subtaskId === item.subtaskId : !r?.subtaskId)
  );
  return entry && entry.assignedBy === botId && getBoardItemOwnerId(item) === entry.assignedTo ? entry.assignedTo : null;
}

/** Unstarted MA work that the auto-queue placed and nobody has moved since: what Reset/Distribute may move. */
function movableAutoQueued(items: BoardItem[], botId: string): BoardItem[] {
  return items.filter((it) => isMaWorkItem(it) && !isBoardItemStarted(it) && autoQueuedTo(it, botId));
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export type AppliedDecision = Decision & { applied: boolean; error?: string };

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
    if (opts.dryRun) {
      logger.info(`[AutoQueue][${opts.label}][dry-run] would queue "${d.taskTitle}" -> ${d.userName} (${d.method}: ${d.reason})`);
      results.push({ ...d, applied: false });
      continue;
    }
    const item = opts.itemsById.get(d.taskId)!;
    try {
      const current = await getCurrentOwnerId(item);
      if (current === undefined || (current ?? null) !== opts.expectedOwner(item)) {
        results.push({ ...d, applied: false, error: 'Changed by someone else meanwhile' });
        continue;
      }
      const res = await invokeHandler(assignTaskMapTask, {
        params: { id: d.taskId },
        body: { assigneeId: d.userId, mode: 'QUEUE' },
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
              ...(d.hours !== undefined ? { hours: d.hours } : {}),
              ...(opts.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
              ...(item.isSubtask ? { subtaskId: item.subtaskId } : {}),
            },
          },
        })
        .catch(() => null);
      logger.info(`[AutoQueue][${opts.label}] queued "${d.taskTitle}" -> ${d.userName} (${d.method}: ${d.reason})`);
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

export async function runDailyAutoQueue(opts: { modeOverride?: AutoQueueMode } = {}): Promise<DailyResult> {
  const config = getAutoQueueConfig();
  const mode = opts.modeOverride || config.mode;
  const empty = { decisions: [], skippedTasks: [], scheduledMaCount: 0, summary: [] };
  if (mode === 'off') return { mode, skipped: 'AUTO_QUEUE_MODE is off', ...empty };

  return exclusive('5 AM plan', async () => {
    const bot = await getOrCreateAutoQueueUser();
    const [{ pool, items }, { users, shifts }] = await Promise.all([loadBoard(bot), loadPeople()]);
    const plan = await planDailyDistribution({
      pool,
      boardItems: items,
      users,
      shifts,
      defaultHours: config.defaultHours,
      pick: aiPicker(),
    });
    const decisions = await applyDecisions({
      decisions: plan.decisions,
      itemsById: new Map(pool.map((t) => [t.id, t])),
      expectedOwner: () => null,
      bot,
      dryRun: mode === 'dry_run',
      label: '5am',
    });
    logger.info(
      `[AutoQueue][5am] ${decisions.filter((d) => d.applied).length}/${plan.decisions.length} queued to ${plan.scheduledMaCount} MAs; ${plan.skipped.length} left in pool`
    );
    return { mode, decisions, skippedTasks: plan.skipped, scheduledMaCount: plan.scheduledMaCount, summary: plan.summary };
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
}

/**
 * Evens out the day: unstarted auto-queued tasks plus everything in Available tasks are re-planned
 * across everyone scheduled today (same rules as 5 AM, no AI so the button is quick). Only cards whose
 * owner changes are moved; started tasks and anything a PM placed by hand stay where they are.
 */
export async function distributeAutoQueue(actor: ActorUser, opts: { preview?: boolean } = {}): Promise<DistributeResult> {
  return exclusive(opts.preview ? 'distribute preview' : 'distribute', async () => {
    const config = getAutoQueueConfig();
    const bot = await getOrCreateAutoQueueUser();
    const [{ pool, items }, { users, shifts }] = await Promise.all([loadBoard(bot), loadPeople()]);

    const movable = movableAutoQueued(items, bot.id);
    const movableIds = new Set(movable.map((m) => m.id));
    const ownerBefore = new Map<string, string | null>(movable.map((m) => [m.id, autoQueuedTo(m, bot.id)]));

    const plan = await planDailyDistribution({
      pool: [...pool, ...movable],
      boardItems: items.filter((it) => !movableIds.has(it.id)),
      users,
      shifts,
      defaultHours: config.defaultHours,
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
    };
  });
}
