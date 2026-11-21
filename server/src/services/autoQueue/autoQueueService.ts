/**
 * Task Map auto-queue: moves tasks from Available tasks into on-shift MAs' To Do columns.
 *
 *   AUTO_QUEUE_MODE=off      (default) does nothing
 *   AUTO_QUEUE_MODE=dry_run  decides and logs what it would assign, changes nothing
 *   AUTO_QUEUE_MODE=on       assigns, as the "Nexus AI" system user
 *
 * Code picks who CAN take a task; the Ollama model (if OLLAMA_URL is set) picks who SHOULD,
 * falling back to "fewest open tasks" whenever the model is off, slow, or answers badly.
 */
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../../config/prisma';
import { logger, errMsg } from '../../config/logger';
import { getManilaHourAndMinute } from '../auditAutoAssign';
import { resolveEffectiveTaskMapOwnerId } from '../../utils/taskMapPermissions';
import { invokeHandler } from './invokeHandler';
import { planAssignments, type Decision } from './planner';
import { pickWithOllama, type OllamaConfig } from './ollamaPicker';
import type { BoardItem, QueueUser, ShiftWindow } from './rules';

export type AutoQueueMode = 'off' | 'dry_run' | 'on';

export interface AutoQueueConfig {
  mode: AutoQueueMode;
  maxQueuedPerMa: number;
  maxAssignmentsPerRun: number;
  ollama: OllamaConfig | null;
}

const intEnv = (name: string, fallback: number, min: number) => {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export function getAutoQueueConfig(): AutoQueueConfig {
  const rawMode = (process.env.AUTO_QUEUE_MODE || 'off').trim().toLowerCase();
  const mode: AutoQueueMode = rawMode === 'on' || rawMode === 'dry_run' ? rawMode : 'off';
  const url = (process.env.OLLAMA_URL || '').trim();
  return {
    mode,
    maxQueuedPerMa: intEnv('AUTO_QUEUE_MAX_QUEUED_PER_MA', 2, 1),
    maxAssignmentsPerRun: intEnv('AUTO_QUEUE_MAX_PER_RUN', 5, 1),
    ollama: url
      ? {
          url,
          model: (process.env.OLLAMA_MODEL || 'qwen2.5:3b').trim(),
          username: process.env.OLLAMA_USERNAME || undefined,
          password: process.env.OLLAMA_PASSWORD || undefined,
          timeoutMs: intEnv('OLLAMA_TIMEOUT_MS', 60_000, 1000),
        }
      : null,
  };
}

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

/** True if a PM (or anyone) gave the task an owner since the board snapshot was taken. */
async function isStillUnowned(item: BoardItem): Promise<boolean> {
  if (item.isSubtask && item.subtaskId) {
    const sub = await prisma.subtask.findUnique({
      where: { id: item.subtaskId },
      select: { assigneeId: true, assignees: { select: { id: true } }, taskId: true },
    });
    if (!sub) return false;
    const record = await prisma.taskMapRecord.findUnique({ where: { taskId: sub.taskId } });
    const reviews = Array.isArray(record?.pmReviews) ? (record!.pmReviews as any[]) : [];
    const subState = reviews.find((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === item.subtaskId);
    return !resolveEffectiveTaskMapOwnerId({
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
  if (!task) return false;
  return !resolveEffectiveTaskMapOwnerId({
    pmReviews: task.taskMapRecord?.pmReviews,
    handedOver: Boolean(task.taskMapRecord?.handedOver),
    statuses: task.taskMapRecord?.statuses || [],
    assigneeId: task.assigneeId,
    assignees: task.assignees,
  });
}

export interface AutoQueueResult {
  mode: AutoQueueMode;
  skipped?: string;
  onShiftMaCount?: number;
  unassignedCount?: number;
  decisions: Array<Decision & { applied: boolean; error?: string }>;
}

let running = false;

export async function runAutoQueue(opts: { modeOverride?: AutoQueueMode } = {}): Promise<AutoQueueResult> {
  const config = getAutoQueueConfig();
  const mode = opts.modeOverride || config.mode;
  if (mode === 'off') return { mode, skipped: 'AUTO_QUEUE_MODE is off', decisions: [] };
  if (running) return { mode, skipped: 'A run is already in progress', decisions: [] };
  running = true;

  try {
    const bot = await getOrCreateAutoQueueUser();
    const botUser = { id: bot.id, name: bot.name, email: bot.email };

    // Lazy import: the controller pulls in the server module (socket.io), which imports the workers.
    const { getTaskMapData, assignTaskMapTask } = await import('../../controllers/taskMap.controller');

    const board = await invokeHandler(getTaskMapData, { query: { shift: 'ALL' }, user: botUser });
    if (board.status !== 200 || !board.body?.success) {
      throw new Error(`Task Map data request failed (HTTP ${board.status})`);
    }

    const [users, shifts] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true, roles: true, systemRole: true, isActive: true, starRating: true },
      }),
      prisma.auditShiftConfig.findMany({ where: { isActive: true } }),
    ]);

    const { hour, minute } = getManilaHourAndMinute();
    const ollama = config.ollama;
    const plan = await planAssignments({
      pool: (board.body.availablePool || []) as BoardItem[],
      boardItems: (board.body.tasks || []) as BoardItem[],
      users: users as QueueUser[],
      shifts: shifts as ShiftWindow[],
      minuteOfDay: hour * 60 + minute,
      maxQueuedPerMa: config.maxQueuedPerMa,
      maxAssignmentsPerRun: config.maxAssignmentsPerRun,
      pick: ollama ? (task, candidates) => pickWithOllama(task, candidates, ollama) : async () => null,
    });

    const poolById = new Map<string, BoardItem>(
      ((board.body.availablePool || []) as BoardItem[]).map((t) => [t.id, t])
    );
    const results: AutoQueueResult['decisions'] = [];

    for (const d of plan.decisions) {
      if (mode === 'dry_run') {
        logger.info(`[AutoQueue][dry-run] would queue "${d.taskTitle}" -> ${d.userName} (${d.method}: ${d.reason})`);
        results.push({ ...d, applied: false });
        continue;
      }

      const item = poolById.get(d.taskId)!;
      try {
        if (!(await isStillUnowned(item))) {
          results.push({ ...d, applied: false, error: 'Assigned by someone else meanwhile' });
          continue;
        }
        const res = await invokeHandler(assignTaskMapTask, {
          params: { id: d.taskId },
          body: { assigneeId: d.userId, mode: 'QUEUE' },
          user: botUser,
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
              userId: bot.id,
              details: {
                assigneeId: d.userId,
                assigneeName: d.userName,
                method: d.method,
                reason: d.reason,
                ...(item.isSubtask ? { subtaskId: item.subtaskId } : {}),
              },
            },
          })
          .catch(() => null);
        logger.info(`[AutoQueue] queued "${d.taskTitle}" -> ${d.userName} (${d.method}: ${d.reason})`);
        results.push({ ...d, applied: true });
      } catch (err) {
        results.push({ ...d, applied: false, error: errMsg(err) });
      }
    }

    return {
      mode,
      onShiftMaCount: plan.onShiftMaCount,
      unassignedCount: plan.unassignedCount,
      decisions: results,
    };
  } finally {
    running = false;
  }
}
