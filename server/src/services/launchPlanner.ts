import { prisma } from '../config/prisma';
import { isClosedStatus } from './taskMapService';
import { launchWorkDeadline, scheduleLaunchItems, manilaNoon, guessLaunchPhase, type LaunchPhase } from '../utils/launchDate';
import { getToolsBaseUrl, getToolsHeaders } from '../utils/vipscaleTools';
import { DEFAULT_ESTIMATED_HOURS } from './autoQueue/rules';

/**
 * Launch scheduling: when a task has a launch date, its open subtasks and the client's other
 * open tasks that the launch depends on get due dates that finish 2 working days (Sundays not
 * counted) before launch. VIPScale's AI picks the related tasks and labels mockups and
 * migrations. Work runs in parallel, so everything is due on that deadline, except mockups,
 * which must finish before migration starts. Audits are never scheduled.
 */

const MAX_OTHER_TASKS = 40;
const DEBOUNCE_MS = 15_000;

const isAuditTitle = (title: string) => /^[\s-]*audit\b/i.test(title || '');
const isAuditRole = (roles: string[] = []) => roles.some((r) => /audit/i.test(r));

interface Candidate {
  id: string;
  kind: 'subtask' | 'task';
  title: string;
  description?: string;
  hours: number;
  dueDate: Date | null;
}

interface LaunchPlan {
  related: string[];
  phases: Record<string, LaunchPhase>;
}

async function fetchLaunchPlan(
  launch: { title: string; description: string | null; launchDate: Date },
  items: Candidate[],
): Promise<LaunchPlan | null> {
  if (!process.env.VIPSCALE_API_KEY?.trim()) return null;
  try {
    const res = await fetch(`${getToolsBaseUrl()}/api/galaxy-task/launch-plan`, {
      method: 'POST',
      headers: getToolsHeaders(),
      body: JSON.stringify({
        launch: {
          title: launch.title,
          description: launch.description || undefined,
          launch_date: launch.launchDate.toISOString().slice(0, 10),
        },
        items: items.map(({ id, kind, title, description, hours }) => ({ id, kind, title, description, hours })),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.error(`[launchPlanner] launch-plan request failed: ${res.status}`);
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as { related?: unknown; phases?: unknown };
    if (!Array.isArray(data.related)) return null;
    const phases: Record<string, LaunchPhase> = {};
    if (data.phases && typeof data.phases === 'object') {
      for (const [id, phase] of Object.entries(data.phases as Record<string, unknown>)) {
        if (phase === 'mockup' || phase === 'migration' || phase === 'other') phases[id] = phase;
      }
    }
    return { related: data.related.map(String), phases };
  } catch (err) {
    console.error('[launchPlanner] launch-plan request error:', err);
    return null;
  }
}

/** Recomputes due dates for everything a launch task depends on. Safe to call repeatedly. */
export async function planLaunch(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      listId: true,
      status: true,
      launchDate: true,
      subtasks: {
        where: { completed: false },
        select: { id: true, title: true, description: true, status: true, estimatedHours: true, dueDate: true, assigneeRoleRestrictions: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!task?.launchDate || isClosedStatus(task.status)) return;

  const subtasks: Candidate[] = task.subtasks
    .filter((s) => !isClosedStatus(s.status) && !isAuditTitle(s.title) && !isAuditRole(s.assigneeRoleRestrictions))
    .map((s) => ({
      id: s.id,
      kind: 'subtask',
      title: s.title,
      description: s.description || undefined,
      hours: s.estimatedHours ?? DEFAULT_ESTIMATED_HOURS,
      dueDate: s.dueDate,
    }));

  const others = await prisma.task.findMany({
    where: { listId: task.listId, id: { not: task.id }, launchDate: null },
    select: { id: true, title: true, description: true, status: true, estimatedHours: true, dueDate: true, assigneeRoleRestrictions: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_OTHER_TASKS * 3,
  });
  const otherTasks: Candidate[] = others
    .filter((t) => !isClosedStatus(t.status) && !isAuditTitle(t.title) && !isAuditRole(t.assigneeRoleRestrictions))
    .slice(0, MAX_OTHER_TASKS)
    .map((t) => ({
      id: t.id,
      kind: 'task',
      title: t.title,
      description: t.description || undefined,
      hours: t.estimatedHours ?? DEFAULT_ESTIMATED_HOURS,
      dueDate: t.dueDate,
    }));

  const all = [...subtasks, ...otherTasks];
  if (all.length === 0) return;

  const byId = new Map(all.map((c) => [c.id, c]));
  // No AI answer: schedule just the subtasks.
  const plan = await fetchLaunchPlan({ ...task, launchDate: task.launchDate }, all);
  const related = (plan?.related ?? []).map((id) => byId.get(id)).filter((c): c is Candidate => Boolean(c));
  const items = [...new Set([...subtasks, ...related])];

  const dueDates = scheduleLaunchItems(
    items.map((c) => ({ id: c.id, hours: c.hours, phase: plan?.phases[c.id] ?? guessLaunchPhase(c.title) })),
    launchWorkDeadline(task.launchDate),
  );

  const updates = [];
  for (const item of items) {
    const due = dueDates.get(item.id);
    if (!due) continue;
    if (item.kind === 'subtask') {
      if (item.dueDate && manilaNoon(item.dueDate).getTime() === due.getTime()) continue;
      updates.push(prisma.subtask.update({ where: { id: item.id }, data: { dueDate: due } }));
    } else if (!item.dueDate || item.dueDate > due) {
      // Other tasks may serve more than one launch: only ever pull their due date earlier.
      updates.push(prisma.task.update({ where: { id: item.id }, data: { dueDate: due } }));
    }
  }
  if (updates.length) await prisma.$transaction(updates);
  console.log(`[launchPlanner] ${task.title}: scheduled ${items.length} item(s), updated ${updates.length}.`);
}

const pending = new Map<string, NodeJS.Timeout>();

/**
 * Queues a re-plan for a launch task. Calls within a few seconds are merged, since Galaxy
 * often adds several subtasks in a row. Pass a subtask's parent id when a subtask changes.
 */
export function scheduleLaunchPlan(taskId: string | null | undefined): void {
  if (!taskId) return;
  const existing = pending.get(taskId);
  if (existing) clearTimeout(existing);
  pending.set(
    taskId,
    setTimeout(() => {
      pending.delete(taskId);
      planLaunch(taskId).catch((err) => console.error('[launchPlanner] planLaunch failed:', err));
    }, DEBOUNCE_MS),
  );
}
