/**
 * Decides auto-queue assignments from a Task Map snapshot. No DB writes here;
 * autoQueueService applies (or, in dry-run, only logs) the decisions.
 *
 *  - planAssignments:        every-few-minutes top-up for MAs on shift right now (queue cap)
 *  - planDailyDistribution:  the 5 AM run and the Distribute button: hands out the whole pool to
 *                            everyone scheduled today, balanced by estimated hours vs shift hours
 */
import {
  canUserTakeTask,
  computeMaLoads,
  DEFAULT_ESTIMATED_HOURS,
  getBoardItemOwnerId,
  isAutoQueueEligibleUser,
  isMaWorkItem,
  isUserOnShiftNow,
  itemHours,
  orderPoolForQueue,
  rankCandidatesByLoad,
  scheduledShiftHours,
  type BoardItem,
  type MaLoad,
  type QueueUser,
  type ShiftWindow,
} from './rules';
import type { AiPick, PickCandidate, PickTask } from './ollamaPicker';

/** Keep the prompt small for a 3B model: show the AI a few candidates (plus the original MA). */
const MAX_AI_CANDIDATES = 6;

export type PickFn = (task: PickTask, candidates: PickCandidate[]) => Promise<AiPick | null>;

export interface Decision {
  taskId: string;
  taskTitle: string;
  userId: string;
  userName: string;
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
    if (withRoom.length === 0) break;
    const eligible = withRoom.filter((c) => canUserTakeTask(c.user, task));
    if (eligible.length === 0) continue; // nobody with this task's role has room: leave it in the pool

    const ai = await askAi(input.pick, task, shortlist(eligible, eligible, task), clients);
    const chosen = ai?.candidate || eligible[0];
    decisions.push({
      taskId: task.id,
      taskTitle: task.title,
      userId: chosen.user.id,
      userName: chosen.user.name,
      method: ai ? 'ai' : 'rules',
      reason: ai ? ai.reason : 'Fewest open tasks among on-shift MAs with the right role',
    });

    chosen.load.active++;
    chosen.load.queued++;
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
  const scheduled = input.users
    .filter(isAutoQueueEligibleUser)
    .map((user) => ({ user, shiftHours: scheduledShiftHours(user, input.shifts) }))
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

  for (const task of orderPoolForQueue(input.pool)) {
    const hours = itemHours(task, defaultHours);
    const eligible = candidates.filter((c) => canUserTakeTask(c.user, task));
    if (eligible.length === 0) {
      skipped.push({
        taskId: task.id,
        taskTitle: task.title,
        reason: (task.assigneeRoleRestrictions || []).length
          ? `No one scheduled today has the role ${task.assigneeRoleRestrictions!.join(' / ')}`
          : 'No MAs scheduled today',
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
    // (or the three with the most room when it fits no one).
    const fits = ranked.filter((c) => c.freeHours! >= hours);
    const pickable = fits.length > 0 ? fits : ranked.slice(0, 3);

    const ai = await askAi(input.pick, task, shortlist(pickable, pickable, task), clients);
    const chosen = ai?.candidate || ranked[0];
    decisions.push({
      taskId: task.id,
      taskTitle: task.title,
      userId: chosen.user.id,
      userName: chosen.user.name,
      method: ai ? 'ai' : 'rules',
      reason: ai
        ? ai.reason
        : `Lightest day relative to shift (${chosen.load.hours.toFixed(1)}h of ${(shiftHours.get(chosen.user.id) || 0).toFixed(1)}h before this)`,
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
