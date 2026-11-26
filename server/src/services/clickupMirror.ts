import { AsyncLocalStorage } from 'async_hooks';
import { prisma } from '../config/prisma';
import {
  safeUpdateClickUpTask,
  safeCreateClickUpTask,
  moveClickUpTaskToList,
  resolveClickUpListId,
  resolveClickUpAssigneeIds,
  mapNexusStatusToClickUp,
  mapNexusPriorityToClickUp,
} from './clickupService';

/**
 * ClickUp is a backup of Nexus. The task screens push their own edits to ClickUp, but many other
 * paths (Task Map, audit automation, sheets/trackers, launch planner, CRM follow-ups...) change
 * tasks without doing so. This hook catches every Task/Subtask write that touches status, title,
 * due date, priority or list and, a few seconds later, sends the row's current values to ClickUp.
 *
 * Writes that come FROM ClickUp (the pull/sync) run inside `fromClickUp()` and are not echoed.
 * Pushing a value ClickUp already has is a no-op there, so a double push from the task screens
 * is harmless.
 */

const MIRRORED_FIELDS = ['status', 'title', 'dueDate', 'priority', 'listId'] as const;
type Field = (typeof MIRRORED_FIELDS)[number];
type Model = 'Task' | 'Subtask';

const DEBOUNCE_MS = 3000;
const inbound = new AsyncLocalStorage<boolean>();
const pending = new Map<string, { model: Model; id: string; fields: Set<Field>; timer: NodeJS.Timeout }>();

/** Runs `fn` as a ClickUp → Nexus write, so its changes are not sent back to ClickUp. */
export function fromClickUp<T>(fn: () => T): T {
  return inbound.run(true, fn);
}

function idsOf(where: any): string[] {
  const id = where?.id;
  if (typeof id === 'string') return [id];
  if (id && Array.isArray(id.in)) return id.in.filter((x: unknown): x is string => typeof x === 'string');
  return [];
}

function queue(model: Model, id: string, fields: Field[]) {
  const key = `${model}:${id}`;
  const entry = pending.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    fields.forEach((f) => entry.fields.add(f));
  }
  const next = entry ?? { model, id, fields: new Set(fields), timer: undefined as unknown as NodeJS.Timeout };
  next.timer = setTimeout(() => {
    pending.delete(key);
    flush(next.model, next.id, Array.from(next.fields)).catch((err) =>
      console.error(`[ClickUp mirror] ${key} failed:`, err)
    );
  }, DEBOUNCE_MS);
  pending.set(key, next);
}

async function flush(model: Model, id: string, fields: Field[]) {
  const select = { externalId: true, status: true, title: true, dueDate: true, priority: true };
  const row =
    model === 'Task'
      ? await prisma.task.findUnique({
          where: { id },
          select: { ...select, list: { select: { externalId: true, clickUpListId: true } } },
        })
      : await prisma.subtask.findUnique({ where: { id }, select });
  if (!row?.externalId) return;

  // A task moved to another list in Nexus moves to that list's ClickUp copy, if it has one.
  if (fields.includes('listId') && 'list' in row && row.list) {
    const clickUpListId = resolveClickUpListId(row.list);
    if (clickUpListId) {
      await moveClickUpTaskToList(row.externalId, clickUpListId).catch((err) =>
        console.error('[ClickUp mirror] list move failed:', err)
      );
    }
  }

  const payload: Parameters<typeof safeUpdateClickUpTask>[1] = {};
  if (fields.includes('status') && row.status) payload.status = mapNexusStatusToClickUp(row.status);
  if (fields.includes('title') && row.title) payload.name = row.title;
  if (fields.includes('dueDate')) payload.due_date = row.dueDate ? row.dueDate.getTime() : null;
  if (fields.includes('priority')) payload.priority = mapNexusPriorityToClickUp(row.priority);
  if (Object.keys(payload).length === 0) return;
  await safeUpdateClickUpTask(row.externalId, payload);
}

let registered = false;

/** Call once at startup. */
export function registerClickUpMirror(): void {
  if (registered) return;
  registered = true;
  prisma.$use(async (params, next) => {
    const result = await next(params);
    try {
      if (inbound.getStore()) return result;
      if (params.model !== 'Task' && params.model !== 'Subtask') return result;
      if (!['update', 'updateMany', 'upsert'].includes(params.action)) return result;
      const data = params.action === 'upsert' ? params.args?.update : params.args?.data;
      if (!data || typeof data !== 'object') return result;
      const fields = MIRRORED_FIELDS.filter((f) => data[f] !== undefined);
      if (fields.length === 0) return result;
      const ids = idsOf(params.args?.where);
      if (ids.length === 0 && result && typeof result === 'object' && typeof (result as any).id === 'string') {
        ids.push((result as any).id); // update by another unique key (e.g. externalId)
      }
      ids.forEach((id) => queue(params.model as Model, id, fields));
    } catch (err) {
      console.error('[ClickUp mirror] hook error:', err);
    }
    return result;
  });
}

/**
 * Creates a ClickUp copy of a Nexus task made outside the task screens (e.g. recurring
 * duplicates) and stores its id. Does nothing if the task already has one or its list isn't
 * mapped to ClickUp.
 */
export async function mirrorNewTaskToClickUp(taskId: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true, title: true, description: true, status: true, priority: true, dueDate: true, startDate: true,
        externalId: true, assignees: { select: { email: true } },
        list: { select: { externalId: true, clickUpListId: true } },
      },
    });
    if (!task || task.externalId || !task.list) return;
    const clickUpListId = resolveClickUpListId(task.list);
    if (!clickUpListId) return;
    const assignees = await resolveClickUpAssigneeIds(task.assignees.map((a) => a.email));
    const clickUpTaskId = await safeCreateClickUpTask(clickUpListId, {
      name: task.title,
      description: task.description ?? undefined,
      status: mapNexusStatusToClickUp(task.status),
      priority: mapNexusPriorityToClickUp(task.priority),
      ...(task.dueDate ? { due_date: task.dueDate.getTime() } : {}),
      ...(task.startDate ? { start_date: task.startDate.getTime() } : {}),
      ...(assignees.length ? { assignees } : {}),
    });
    if (clickUpTaskId) await prisma.task.update({ where: { id: task.id }, data: { externalId: clickUpTaskId } });
  } catch (err) {
    console.error('[ClickUp mirror] create failed:', err);
  }
}
