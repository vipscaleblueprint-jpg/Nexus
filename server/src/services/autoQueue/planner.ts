/**
 * Decides one auto-queue run's assignments from a Task Map snapshot. No DB writes here;
 * autoQueueService applies (or, in dry-run, only logs) the decisions.
 */
import {
  computeMaLoads,
  getBoardItemOwnerId,
  isAutoQueueEligibleUser,
  isMaWorkItem,
  isUserOnShiftNow,
  orderPoolForQueue,
  rankCandidatesByLoad,
  type BoardItem,
  type MaLoad,
  type QueueUser,
  type ShiftWindow,
} from './rules';
import type { AiPick, PickCandidate, PickTask } from './ollamaPicker';

/** Keep the prompt small for a 3B model: show the AI the least-loaded few (plus the original MA). */
const MAX_AI_CANDIDATES = 6;

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
  pick: (task: PickTask, candidates: PickCandidate[]) => Promise<AiPick | null>;
}

export interface Decision {
  taskId: string;
  taskTitle: string;
  userId: string;
  userName: string;
  method: 'ai' | 'rules';
  reason: string;
}

export interface Plan {
  decisions: Decision[];
  /** Pool tasks left because no on-shift MA had room. */
  unassignedCount: number;
  onShiftMaCount: number;
}

const clientOf = (it: BoardItem) => (it.list?.name || '').trim();

function originalMaId(task: BoardItem): string | null {
  const reviews = Array.isArray(task.taskMap?.pmReviews) ? task.taskMap!.pmReviews : [];
  const entry = reviews.find(
    (r: any) => r?.type === 'ORIGINAL_MA' && (task.isSubtask ? r?.subtaskId === task.subtaskId : !r?.subtaskId)
  );
  return entry?.userId || null;
}

export async function planAssignments(input: PlanInput): Promise<Plan> {
  const onShift = input.users
    .filter(isAutoQueueEligibleUser)
    .filter((u) => isUserOnShiftNow(u, input.shifts, input.minuteOfDay));

  const loads = computeMaLoads(input.boardItems, onShift.map((u) => u.id));
  const clients = new Map<string, Set<string>>(onShift.map((u) => [u.id, new Set<string>()]));
  for (const it of input.boardItems) {
    if (!isMaWorkItem(it)) continue;
    const owner = getBoardItemOwnerId(it);
    if (owner && clients.has(owner) && clientOf(it)) clients.get(owner)!.add(clientOf(it));
  }

  const ordered = orderPoolForQueue(input.pool);
  const decisions: Decision[] = [];
  let index = 0;

  for (; index < ordered.length; index++) {
    if (decisions.length >= input.maxAssignmentsPerRun) break;
    const task = ordered[index];

    const withRoom = rankCandidatesByLoad(
      onShift
        .map((user) => ({ user, load: loads.get(user.id) as MaLoad }))
        .filter((c) => c.load.queued < input.maxQueuedPerMa)
    );
    if (withRoom.length === 0) break;

    const original = originalMaId(task);
    const shown = withRoom.slice(0, MAX_AI_CANDIDATES);
    const originalCandidate = withRoom.find((c) => c.user.id === original);
    if (originalCandidate && !shown.includes(originalCandidate)) shown.push(originalCandidate);

    const pickCandidates: PickCandidate[] = shown.map((c) => ({
      id: c.user.id,
      name: c.user.name,
      active: c.load.active,
      queued: c.load.queued,
      starRating: c.user.starRating ?? null,
      currentClients: Array.from(clients.get(c.user.id) || []).sort(),
      workedOnThisBefore: c.user.id === original,
    }));

    let aiPick: AiPick | null = null;
    try {
      aiPick = await input.pick(
        {
          title: task.title,
          client: clientOf(task) || null,
          parentTaskTitle: task.parentTaskTitle || null,
          priority: task.priority || null,
          dueDate: task.dueDate || null,
          description: task.description || null,
        },
        pickCandidates
      );
    } catch {
      aiPick = null;
    }

    const aiChoice = aiPick ? withRoom.find((c) => c.user.id === aiPick!.userId) : undefined;
    const chosen = aiChoice || withRoom[0];
    decisions.push({
      taskId: task.id,
      taskTitle: task.title,
      userId: chosen.user.id,
      userName: chosen.user.name,
      method: aiChoice ? 'ai' : 'rules',
      reason: aiChoice ? aiPick!.reason : 'Fewest open tasks among on-shift MAs',
    });

    const load = loads.get(chosen.user.id)!;
    load.active++;
    load.queued++;
    if (clientOf(task)) clients.get(chosen.user.id)!.add(clientOf(task));
  }

  return {
    decisions,
    unassignedCount: ordered.length - decisions.length,
    onShiftMaCount: onShift.length,
  };
}
