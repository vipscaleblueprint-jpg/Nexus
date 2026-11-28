/**
 * Decides auto-queue assignments from a Task Map snapshot. No DB writes here;
 * autoQueueService applies (or, in dry-run, only logs) the decisions.
 *
 *  - planAssignments:        every-few-minutes top-up for MAs on shift right now (queue cap)
 *  - planDailyDistribution:  the 5 AM run and the Distribute button: hands out the whole pool to
 *                            everyone scheduled today, balanced by estimated hours vs shift hours
 */
import {
  autoQueuedTo,
  canUserTakeTask,
  computeMaLoads,
  DEFAULT_ESTIMATED_HOURS,
  getBoardItemOwnerId,
  hasTaskInProgress,
  isAutoQueueEligibleUser,
  isBoardItemStarted,
  isHandedOver,
  isMaWorkItem,
  isUserOnShiftNow,
  itemHours,
  orderPoolForQueue,
  rankCandidatesByLoad,
  remainingShiftHours,
  scheduledShiftHours,
  shiftGroupOf,
  usersInGroup,
  type BoardItem,
  type MaLoad,
  type QueueUser,
  type ShiftGroup,
  type ShiftWindow,
} from './rules';
import { decideDoable, type JudgeFn } from './doable';
import type { AiPick, PickCandidate, PickTask } from './ollamaPicker';

/** Keep the prompt small for a 3B model: show the AI a few candidates (plus the original MA). */
const MAX_AI_CANDIDATES = 6;

export type PickFn = (task: PickTask, candidates: PickCandidate[]) => Promise<AiPick | null>;

export interface Decision {
  taskId: string;
  taskTitle: string;
  userId: string;
  userName: string;
  fromUserId?: string;
  method: 'ai' | 'rules';
  reason: string;
  /** Hours the task counted for (its estimate, or the default). Daily plan only. */
  hours?: number;
}

interface Candidate {
  user: QueueUser;
  load: MaLoad;
  /** Daily plan only: shift hours today minus hours of work already held. */
  freeHours?: number;
}

const clientOf = (it: BoardItem) => (it.list?.name || '').trim();
const clientIdOf = (it: BoardItem) => it.listId || it.list?.id || '';

/** userId -> client (list id) -> how many of that client's tasks the person has commented on before. */
/** Also holds `taskHistoryKey(taskId)` entries: tasks the person has commented on (worked on) before. */
export type ClientHistory = Map<string, Map<string, number>>;

export const taskHistoryKey = (taskId: string) => `task:${taskId}`;

/** The Task row a board item belongs to (a subtask's parent task). */
const taskRowIdOf = (it: BoardItem) => (it.isSubtask ? it.parentTaskId || '' : it.id);

/** Worked on this task before: its original MA, or commented on it (or its parent task). */
/** Tagged IsRole = "Collaborator" on this task in the MA daily tracker. Always tried first. */
const isTaggedCollaborator = (userId: string, task: BoardItem) =>
  Boolean(task.trackerCollaboratorIds?.includes(userId));

function isCollaborator(userId: string, task: BoardItem, history?: ClientHistory): boolean {
  if (isTaggedCollaborator(userId, task)) return true;
  if (userId === originalMaId(task)) return true;
  const rowId = taskRowIdOf(task);
  return Boolean(rowId && history?.get(userId)?.has(taskHistoryKey(rowId)));
}

function originalMaId(task: BoardItem): string | null {
  const reviews = Array.isArray(task.taskMap?.pmReviews) ? task.taskMap!.pmReviews : [];
  const entry = reviews.find(
    (r: any) => r?.type === 'ORIGINAL_MA' && (task.isSubtask ? r?.subtaskId === task.subtaskId : !r?.subtaskId)
  );
  return entry?.userId || null;
}

function clientsByUser(boardItems: BoardItem[], userIds: string[]): Map<string, Set<string>> {
  const clients = new Map<string, Set<string>>(userIds.map((id) => [id, new Set<string>()]));
  for (const it of boardItems) {
    if (!isMaWorkItem(it)) continue;
    const owner = getBoardItemOwnerId(it);
    if (owner && clients.has(owner) && clientOf(it)) clients.get(owner)!.add(clientOf(it));
  }
  return clients;
}

/** Asks the AI to choose among `shown`; returns the chosen candidate or null (caller falls back). */
async function askAi(
  pick: PickFn | undefined,
  task: BoardItem,
  shown: Candidate[],
  clients: Map<string, Set<string>>
): Promise<{ candidate: Candidate; reason: string } | null> {
  if (!pick || shown.length === 0) return null;
  const original = originalMaId(task);
  const pickCandidates: PickCandidate[] = shown.map((c) => ({
    id: c.user.id,
    name: c.user.name,
    active: c.load.active,
    queued: c.load.queued,
    freeHours: c.freeHours,
    starRating: c.user.starRating ?? null,
    currentClients: Array.from(clients.get(c.user.id) || []).sort(),
    workedOnThisBefore: c.user.id === original,
  }));
  let aiPick: AiPick | null = null;
  try {
    aiPick = await pick(
      {
        title: task.title,
        client: clientOf(task) || null,
        parentTaskTitle: task.parentTaskTitle || null,
        priority: task.priority || null,
        dueDate: task.dueDate || null,
        description: task.description || null,
        estimatedHours: task.estimatedHours ?? null,
      },
      pickCandidates
    );
  } catch {
    return null;
  }
  const candidate = aiPick ? shown.find((c) => c.user.id === aiPick!.userId) : undefined;
  return candidate ? { candidate, reason: aiPick!.reason } : null;
}

/** Shown to the AI: the first few by the caller's ranking, plus the original MA if eligible. */
function shortlist(ranked: Candidate[], eligible: Candidate[], task: BoardItem): Candidate[] {
  const shown = ranked.slice(0, MAX_AI_CANDIDATES);
  const original = eligible.find((c) => c.user.id === originalMaId(task));
  if (original && !shown.includes(original)) shown.push(original);
  return shown;
}

// ---------------------------------------------------------------------------
// Every-few-minutes top-up
// ---------------------------------------------------------------------------

export interface PlanInput {
  /** The Task Map's Available tasks pool. */
  pool: BoardItem[];
  /** Every open item on the board, used to count each MA's current work. */
  boardItems: BoardItem[];
  users: QueueUser[];
  shifts: ShiftWindow[];
  /** Minutes since midnight, Manila time. */
  minuteOfDay: number;
  maxQueuedPerMa: number;
  maxAssignmentsPerRun: number;
  pick?: PickFn;
}

export interface Plan {
  decisions: Decision[];
  /** Pool tasks left (no MA with room, or none with the task's role on shift). */
  unassignedCount: number;
  onShiftMaCount: number;
}

export async function planAssignments(input: PlanInput): Promise<Plan> {
  const onShift = input.users
    .filter(isAutoQueueEligibleUser)
    .filter((u) => isUserOnShiftNow(u, input.shifts, input.minuteOfDay));

  const loads = computeMaLoads(input.boardItems, onShift.map((u) => u.id));
  const clients = clientsByUser(input.boardItems, onShift.map((u) => u.id));
  const ordered = orderPoolForQueue(input.pool);
  const decisions: Decision[] = [];

  for (const task of ordered) {
    if (decisions.length >= input.maxAssignmentsPerRun) break;

    const withRoom: Candidate[] = rankCandidatesByLoad(
      onShift
        .map((user) => ({ user, load: loads.get(user.id) as MaLoad }))
        .filter((c) => c.load.queued < input.maxQueuedPerMa)
    );
    const eligible = withRoom.filter((c) => canUserTakeTask(c.user, task));
    if (eligible.length === 0) continue; // nobody with this task's role has room: leave it in the pool

    // Collaborators on this task (parent or any subtask) come first, if the estimate fits the time
    // left in their shift. Lightest load among them (no AI), so shared collaborators split evenly.
    const hours = itemHours(task);
    const tagged = eligible.filter(
      (c) =>
        isTaggedCollaborator(c.user.id, task) &&
        remainingShiftHours(c.user, input.shifts, input.minuteOfDay) - c.load.hours >= hours
    );
    const ai = tagged.length > 0 ? null : await askAi(input.pick, task, shortlist(eligible, eligible, task), clients);
    const chosen = tagged[0] || ai?.candidate || eligible[0];
    decisions.push({
      taskId: task.id,
      taskTitle: task.title,
      userId: chosen.user.id,
      userName: chosen.user.name,
      method: ai ? 'ai' : 'rules',
      reason: ai
        ? ai.reason
        : tagged.length > 0
          ? 'Collaborator on this task (MA daily tracker); fewest open tasks among them'
          : 'Fewest open tasks among on-shift MAs with the right role',
    });

    chosen.load.active++;
    chosen.load.queued++;
    chosen.load.hours += hours;
    if (clientOf(task)) clients.get(chosen.user.id)!.add(clientOf(task));
  }

  return {
    decisions,
    unassignedCount: ordered.length - decisions.length,
    onShiftMaCount: onShift.length,
  };
}

// ---------------------------------------------------------------------------
// 5 AM daily distribution (also used by the Distribute button)
// ---------------------------------------------------------------------------

export interface DailyPlanInput {
  pool: BoardItem[];
  boardItems: BoardItem[];
  users: QueueUser[];
  shifts: ShiftWindow[];
  /** Hours a task without an estimate counts for. */
  defaultHours?: number;
  pick?: PickFn;
  /** When true, a task that fits no one's free hours goes to `skipped` instead of overloading someone. */
  requireRoom?: boolean;
  /** Overrides `scheduledShiftHours` for each person's available capacity (users with <= 0 are skipped). */
  capacityHours?: (user: QueueUser) => number;
  /** How skipped-task reasons name the people considered, e.g. "on shift for the rest of today". */
  roomLabel?: string;
  /** Past work per client (from comments): people who worked the client before are preferred. */
  clientHistory?: ClientHistory;
  /** When true, only workers who currently have at least one task In Progress receive work. */
  requireInProgress?: boolean;
  /**
   * Handovers: prefer collaborators (people who worked on this task before) over people who only
   * worked the client before. Role match still applies (canUserTakeTask) and the task must fit their time.
   */
  preferCollaborators?: boolean;
}

export interface MaDaySummary {
  userId: string;
  userName: string;
  shiftHours: number;
  /** Estimated hours of open work after this plan (held before + newly assigned). */
  plannedHours: number;
  newTasks: number;
}

export interface DailyPlan {
  decisions: Decision[];
  /** Pool tasks nobody scheduled today can take (no one with the task's role). */
  skipped: Array<{ taskId: string; taskTitle: string; reason: string }>;
  scheduledMaCount: number;
  summary: MaDaySummary[];
}

export async function planDailyDistribution(input: DailyPlanInput): Promise<DailyPlan> {
  const defaultHours = input.defaultHours ?? DEFAULT_ESTIMATED_HOURS;
  const getCapacity = input.capacityHours ?? ((user: QueueUser) => scheduledShiftHours(user, input.shifts));
  const scheduled = input.users
    .filter(isAutoQueueEligibleUser)
    .filter((user) => !input.requireInProgress || hasTaskInProgress(user, input.boardItems))
    .map((user) => ({ user, shiftHours: getCapacity(user) }))
    .filter((s) => s.shiftHours > 0);

  const ids = scheduled.map((s) => s.user.id);
  const loads = computeMaLoads(input.boardItems, ids, defaultHours);
  const clients = clientsByUser(input.boardItems, ids);
  const shiftHours = new Map(scheduled.map((s) => [s.user.id, s.shiftHours]));
  const newTasks = new Map<string, number>(ids.map((id) => [id, 0]));

  const candidates: Candidate[] = scheduled.map((s) => ({ user: s.user, load: loads.get(s.user.id)! }));
  const freeHours = (c: Candidate) => (shiftHours.get(c.user.id) || 0) - c.load.hours;

  const decisions: Decision[] = [];
  const skipped: DailyPlan['skipped'] = [];
  const targetLabel = input.roomLabel || (input.requireRoom ? 'on the next shift' : 'scheduled today');

  for (const task of orderPoolForQueue(input.pool)) {
    const hours = itemHours(task, defaultHours);
    const eligible = candidates.filter((c) => canUserTakeTask(c.user, task));
    if (eligible.length === 0) {
      skipped.push({
        taskId: task.id,
        taskTitle: task.title,
        reason: task.effectiveRolesSource === 'none'
          ? 'No role set and none could be guessed from the title; tag a role so it can be auto-queued'
          : (task.effectiveRoles ?? task.assigneeRoleRestrictions ?? []).length
          ? `No one ${targetLabel} has the role ${(task.effectiveRoles ?? task.assigneeRoleRestrictions)!.join(' / ')}${
              task.effectiveRolesSource === 'parent'
                ? ' (from the parent task)'
                : task.effectiveRolesSource === 'title'
                  ? ' (guessed from the title)'
                  : ''
            }`
          : `No MAs ${targetLabel}`,
      });
      continue;
    }

    for (const c of eligible) c.freeHours = freeHours(c);
    // Fullest-day-last: how full each person's day would be with this task, relative to their
    // shift length. Keeps a 4h shift from being loaded like an 8h one, even on overloaded days.
    const fullness = (c: Candidate) => (c.load.hours + hours) / (shiftHours.get(c.user.id) || 1);
    const ranked = eligible
      .slice()
      .sort(
        (a, b) =>
          fullness(a) - fullness(b) ||
          a.load.active - b.load.active ||
          (a.user.name || '').localeCompare(b.user.name || '')
      );
    // Keep it balanced: the AI only chooses among people the task fits into today
    // (or the three with the most room when it fits no one, unless requireRoom is set).
    const fits = ranked.filter((c) => c.freeHours! >= hours);
    // Collaborators on this task (parent or any subtask) come first, but only if it fits their
    // remaining hours. Lightest day first among them (no AI), so shared collaborators split evenly.
    const tagged = fits.filter((c) => isTaggedCollaborator(c.user.id, task));
    if (input.requireRoom && fits.length === 0) {
      skipped.push({
        taskId: task.id,
        taskTitle: task.title,
        reason: `No one ${targetLabel} has ${hours}h free for it`,
      });
      continue;
    }
    // Prefer people who have worked this client before (commented on its tasks) (still lightest-first among them),
    // as long as it fits their day; only fall back to everyone else when none of them has room.
    const doneBefore = (c: Candidate) => input.clientHistory?.get(c.user.id)?.get(clientIdOf(task)) || 0;
    const familiar = fits.filter((c) => doneBefore(c) > 0);
    const collaborators = tagged.length > 0
      ? tagged
      : input.preferCollaborators
        ? fits.filter((c) => isCollaborator(c.user.id, task, input.clientHistory))
        : [];
    const pickable =
      collaborators.length > 0 ? collaborators : familiar.length > 0 ? familiar : fits.length > 0 ? fits : ranked.slice(0, 3);
    const chosenIsCollaborator = (c: Candidate) => collaborators.includes(c);

    const ai = tagged.length > 0 ? null : await askAi(input.pick, task, shortlist(pickable, pickable, task), clients);
    const chosen = ai?.candidate || pickable[0];
    const lightest = `lightest day relative to shift (${chosen.load.hours.toFixed(1)}h of ${(shiftHours.get(chosen.user.id) || 0).toFixed(1)}h before this)`;
    decisions.push({
      taskId: task.id,
      taskTitle: task.title,
      userId: chosen.user.id,
      userName: chosen.user.name,
      method: ai ? 'ai' : 'rules',
      reason: ai
        ? ai.reason
        : chosenIsCollaborator(chosen)
          ? `Collaborator: ${isTaggedCollaborator(chosen.user.id, task) ? 'tagged Collaborator on this task (MA daily tracker)' : 'worked on this task before'}; ${lightest}`
          : doneBefore(chosen) > 0
          ? `Worked ${clientOf(task) || 'this client'} before (commented on ${doneBefore(chosen)} task${doneBefore(chosen) === 1 ? '' : 's'}); ${lightest}`
          : `${familiar.length === 0 && fits.length > 0 && input.clientHistory ? 'No one free has worked this client before; ' : ''}${lightest[0].toUpperCase()}${lightest.slice(1)}`,
      hours,
    });

    chosen.load.active++;
    chosen.load.queued++;
    chosen.load.hours += hours;
    newTasks.set(chosen.user.id, (newTasks.get(chosen.user.id) || 0) + 1);
    if (clientOf(task)) clients.get(chosen.user.id)!.add(clientOf(task));
  }

  return {
    decisions,
    skipped,
    scheduledMaCount: scheduled.length,
    summary: candidates
      .map((c) => ({
        userId: c.user.id,
        userName: c.user.name,
        shiftHours: shiftHours.get(c.user.id) || 0,
        plannedHours: Math.round(c.load.hours * 4) / 4,
        newTasks: newTasks.get(c.user.id) || 0,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName)),
  };
}

// ---------------------------------------------------------------------------
// 1 PM and 5 PM shift checkpoints (doable check -> handover / return to pool)
// ---------------------------------------------------------------------------

export interface CheckpointPlanInput {
  boardItems: BoardItem[];
  users: QueueUser[];
  shifts: ShiftWindow[];
  minuteOfDay: number;
  from: ShiftGroup | ShiftGroup[]; // group(s) being checked
  to: ShiftGroup | ShiftGroup[]; // group(s) receiving handovers
  botId: string;
  defaultHours?: number;
  judge?: JudgeFn;
  pick?: PickFn;
  clientHistory?: ClientHistory;
  /** When true (e.g. 5pm checkpoint), morning shift workers (8-5) are treated as signing out (0 remaining hours). */
  morningSigningOut?: boolean;
  /** When true, handovers only go to workers with at least one task already In Progress. */
  requireInProgress?: boolean;
}

export interface CheckpointPlan {
  verdicts: Array<{
    userId: string;
    userName: string;
    remainingHours: number;
    method: 'ai' | 'rules';
    reason: string;
    cannotFinishIds: string[];
  }>;
  handovers: Decision[]; // fromUserId set
  returned: Array<{ taskId: string; taskTitle: string; fromUserId: string; reason: string }>;
  atRisk: Array<{ taskId: string; taskTitle: string; userId: string; reason: string }>; // PM-placed, not moved
}

export async function planCheckpoint(input: CheckpointPlanInput): Promise<CheckpointPlan> {
  const defaultHours = input.defaultHours ?? DEFAULT_ESTIMATED_HOURS;
  const fromUsers = usersInGroup(input.users, input.shifts, input.from);

  const verdicts: CheckpointPlan['verdicts'] = [];
  const candidates: BoardItem[] = [];
  const candidateFrom = new Map<string, string>();
  const atRisk: CheckpointPlan['atRisk'] = [];

  for (const user of fromUsers) {
    const userGroup = shiftGroupOf(user, input.shifts);
    const userItems = input.boardItems.filter(
      (it) => isMaWorkItem(it) && getBoardItemOwnerId(it) === user.id
    );
    // At 5 PM, morning shift workers (8-5) are signing out, so remaining hours is 0
    const remHours =
      input.morningSigningOut && userGroup === 'morning'
        ? 0
        : remainingShiftHours(user, input.shifts, input.minuteOfDay);
    const verdict = await decideDoable(userItems, remHours, {
      judge: input.judge,
      defaultHours,
    });
    verdicts.push({
      userId: user.id,
      userName: user.name,
      remainingHours: remHours,
      method: verdict.method,
      reason: verdict.reason,
      cannotFinishIds: verdict.cannotFinishIds,
    });

    const byId = new Map(userItems.map((it) => [it.id, it]));
    for (const id of verdict.cannotFinishIds) {
      const item = byId.get(id);
      if (!item || isBoardItemStarted(item)) continue;
      const isAuto = autoQueuedTo(item, input.botId) === user.id;
      const isHo = isHandedOver(item);
      const isSigningOut = Boolean(input.morningSigningOut) && (userGroup === 'morning' || remHours === 0);
      if (isSigningOut || isAuto || isHo) {
        candidates.push(item);
        candidateFrom.set(item.id, user.id);
      } else {
        atRisk.push({
          taskId: item.id,
          taskTitle: item.title,
          userId: user.id,
          reason: verdict.reason,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { verdicts, handovers: [], returned: [], atRisk };
  }

  const toCandidates = usersInGroup(input.users, input.shifts, input.to);
  const toUsers = input.requireInProgress
    ? toCandidates.filter((u) => {
        // At 5 PM turnover, incoming night workers are just starting their shift, so
        // they may not have an in-progress task yet; noon workers (midway) must be active.
        if (input.morningSigningOut && shiftGroupOf(u, input.shifts) === 'night') return true;
        return hasTaskInProgress(u, input.boardItems);
      })
    : toCandidates;
  const candidateIds = new Set(candidates.map((c) => c.id));
  const dist = await planDailyDistribution({
    pool: candidates,
    boardItems: input.boardItems.filter((it) => !candidateIds.has(it.id)),
    users: toUsers,
    shifts: input.shifts,
    defaultHours,
    pick: input.pick,
    requireRoom: true,
    capacityHours: (u) => remainingShiftHours(u, input.shifts, input.minuteOfDay),
    clientHistory: input.clientHistory,
    requireInProgress: false,
    preferCollaborators: true,
  });

  const handovers: Decision[] = dist.decisions.map((d) => ({
    ...d,
    fromUserId: candidateFrom.get(d.taskId),
    reason:
      d.method === 'rules' ? `Can't finish by end of shift; ${d.reason[0].toLowerCase()}${d.reason.slice(1)}` : d.reason,
  }));

  const returned: CheckpointPlan['returned'] = dist.skipped.map((s) => ({
    taskId: s.taskId,
    taskTitle: s.taskTitle,
    fromUserId: candidateFrom.get(s.taskId)!,
    reason: s.reason,
  }));

  return { verdicts, handovers, returned, atRisk };
}
