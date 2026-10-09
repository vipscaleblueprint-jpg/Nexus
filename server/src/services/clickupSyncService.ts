/**
 * clickupSyncService.ts
 *
 * Pulls tasks from every mapped ClickUp list into Nexus: title, status,
 * assignees, subtasks, checklists, comments (with replies) and attachments.
 *
 * Existing Nexus rows are matched by externalId first (bare ClickUp ID, or the
 * ClickUp URL Galaxy stores), so old tasks are updated in place rather than
 * duplicated. Writes go straight to Prisma — not through the task controller —
 * so nothing is pushed back to ClickUp.
 */

import bcrypt from 'bcryptjs';
import { Priority } from '@prisma/client';
import { prisma } from '../config/prisma';
import { redis } from '../config/redis';
import { invalidateCache } from './redisService';
import {
  getClickUpTask,
  getClickUpListTasks,
  getClickUpTaskComments,
  getClickUpCommentReplies,
  resolveClickUpListId,
} from './clickupService';

export interface ClickUpSyncSummary {
  startedAt: string;
  finishedAt?: string;
  lists: number;
  tasksCreated: number;
  tasksUpdated: number;
  subtasks: number;
  checklists: number;
  checklistItems: number;
  comments: number;
  attachments: number;
  statusesCreated: number;
  /** ClickUp users with no Nexus account of the same email. */
  unmatchedUsers: string[];
  /** Failures left after retries. */
  errors: string[];
  /** Lists finished so far, in order (live while the pull runs). */
  listResults: ClickUpListResult[];
  /** The list being pulled right now; absent once finished. */
  currentList?: string;
  /** Newest-last feed of what the pull added or updated (capped). */
  activity: ClickUpSyncActivity[];
  /** true when every task was re-read; false when only changes since the last pull were. */
  full: boolean;
}

export interface ClickUpSyncActivity {
  at: string;
  list: string;
  action: 'added' | 'updated';
  kind: 'task' | 'subtask';
  title: string;
}

export interface ClickUpListResult {
  name: string;
  /** Tasks ClickUp reported for this pull (only changed ones unless full). */
  checked: number;
  created: number;
  updated: number;
  subtasks: number;
  /** Tasks that failed at first but succeeded on a retry. */
  retried: number;
  /** Tasks still failing after every retry. */
  failed: number;
}

/** Socket emitter — the controller passes io; scripts can pass nothing. */
export type SyncEmit = (room: string, event: string, payload: unknown) => void;

export interface ClickUpSyncOptions {
  /** Limit the pull to these Nexus list IDs (default: every mapped list). */
  nexusListIds?: string[];
  /** Pull closed tasks too (default true). */
  includeClosed?: boolean;
  /** Re-read every task instead of only those changed since the list's last clean pull. */
  full?: boolean;
  emit?: SyncEmit;
  /** Receives the live summary object as soon as the pull starts. */
  onProgress?: (summary: ClickUpSyncSummary) => void;
}

interface SyncContext {
  summary: ClickUpSyncSummary;
  emit: SyncEmit;
  includeClosed: boolean;
  /** lower-case email → Nexus user id */
  userIndex: Map<string, string>;
  /** Author for comments/tasks whose ClickUp user has no Nexus account. */
  fallbackUserId: string;
  /** listId → (lower-case status name → stored status name) */
  statusCache: Map<string, Map<string, string>>;
  /** In-flight status creations, so parallel tasks don't create the same status twice. */
  statusCreates: Map<string, Promise<string>>;
  unmatched: Set<string>;
  /** Name of the list being pulled, for the activity feed. */
  listName: string;
}

interface Target {
  taskId: string;
  subtaskId: string | null;
}

const MAX_TASK_PAGES = 50;
const MAX_COMMENT_PAGES = 40;
const CLICKUP_PAGE_SIZE = 100;
const CLICKUP_COMMENT_PAGE_SIZE = 25;
/** Waits before each retry pass over tasks that failed (dropped DB/ClickUp connections). */
const RETRY_DELAYS_MS = [5_000, 20_000];
/** Tasks pulled at once within a list. */
const CONCURRENCY = 4;
const MAX_ACTIVITY = 300;
/** Overlap with the previous pull so edits made while it ran aren't missed. */
const INCREMENTAL_OVERLAP_MS = 5 * 60_000;
const LAST_PULLED_KEY = (listId: string) => `clickup:lastPulled:${listId}`;
const REDIS_TIMEOUT_MS = 3000;
/** What a ClickUp checklist named "Audit" is imported as, so it doesn't feed Nexus's Audit section. */
export const CLICKUP_AUDIT_CHECKLIST = 'ClickUp Audit';

function isReservedChecklistName(name: string | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === 'audit';
}

/**
 * Auditor role for an "--Audit …" subtask, matching the Audit Team roles Galaxy assigns.
 * e.g. "--Audit Design — Landing Page" → "Design Auditor".
 */
export function auditorRoleFromTitle(title: string | undefined): string | null {
  const t = (title ?? '').trim().toLowerCase();
  if (!/^--\s*audit/.test(t)) return null;
  // Only the "--Audit <Kind>" part, so "--Audit Design — Funnel Page" stays Design.
  const head = t.replace(/^--\s*/, '').split(/\s[—–-]\s/)[0];
  if (/ui\s*\/?\s*ux/.test(head)) return 'UI UX Auditor';
  if (/funnel|automation|kajabi/.test(head)) return 'Funnel Auditor';
  if (/design/.test(head)) return 'Design Auditor';
  return null;
}

const PRIORITY_MAP: Record<string, Priority> = {
  urgent: Priority.URGENT,
  high: Priority.HIGH,
  normal: Priority.MEDIUM,
  low: Priority.LOW,
};

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

let running: Promise<void> | null = null;
/** The pull in progress (updated live), else the last finished one. */
let currentSummary: ClickUpSyncSummary | null = null;

export function getClickUpSyncState() {
  return { running: running !== null, summary: currentSummary };
}

/** Starts a sync in the background. Returns false if one is already running. */
export function startClickUpSync(options: ClickUpSyncOptions = {}): boolean {
  if (running) return false;
  running = runClickUpSync({
    ...options,
    onProgress: (summary) => {
      currentSummary = summary;
    },
  })
    .then((summary) => {
      currentSummary = summary;
      console.log('[ClickUp Sync] finished', { ...summary, listResults: undefined });
    })
    .catch((err) => console.error('[ClickUp Sync] crashed:', err))
    .finally(() => {
      running = null;
    });
  return true;
}

export async function runClickUpSync(options: ClickUpSyncOptions = {}): Promise<ClickUpSyncSummary> {
  const summary: ClickUpSyncSummary = {
    startedAt: new Date().toISOString(),
    lists: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    subtasks: 0,
    checklists: 0,
    checklistItems: 0,
    comments: 0,
    attachments: 0,
    statusesCreated: 0,
    unmatchedUsers: [],
    errors: [],
    listResults: [],
    activity: [],
    full: !!options.full,
  };
  options.onProgress?.(summary);

  const lists = await prisma.list.findMany({
    where: {
      OR: [{ clickUpListId: { not: null } }, { externalId: { startsWith: 'cu:' } }],
      ...(options.nexusListIds && { id: { in: options.nexusListIds } }),
    },
    select: { id: true, name: true, clickUpListId: true, externalId: true },
    orderBy: { name: 'asc' },
  });
  summary.lists = lists.length;

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const ctx: SyncContext = {
    summary,
    emit: options.emit ?? (() => {}),
    includeClosed: options.includeClosed ?? true,
    userIndex: new Map(users.map((u) => [u.email.toLowerCase(), u.id])),
    fallbackUserId: (await getOrCreateClickUpUser()).id,
    statusCache: new Map(),
    statusCreates: new Map(),
    unmatched: new Set(),
    listName: '',
  };

  for (const list of lists) {
    const clickUpListId = resolveClickUpListId(list)!;
    summary.currentList = list.name;
    ctx.listName = list.name;
    const listStartedAt = Date.now();
    const before = { created: summary.tasksCreated, updated: summary.tasksUpdated, subtasks: summary.subtasks };
    const result: ClickUpListResult = { name: list.name, checked: 0, created: 0, updated: 0, subtasks: 0, retried: 0, failed: 0 };
    try {
      const lastPulled = options.full ? null : await getLastPulled(list.id);
      const updatedSince = lastPulled ? lastPulled - INCREMENTAL_OVERLAP_MS : undefined;
      Object.assign(result, await syncList(list.id, clickUpListId, ctx, updatedSince));
      // Only a clean pull moves the marker, so failed tasks are fetched again next time.
      if (result.failed === 0) await setLastPulled(list.id, listStartedAt);
    } catch (err: any) {
      result.failed++;
      summary.errors.push(`${list.name}: ${firstLine(err.message)}`);
    }
    result.created = summary.tasksCreated - before.created;
    result.updated = summary.tasksUpdated - before.updated;
    result.subtasks = summary.subtasks - before.subtasks;
    summary.listResults.push(result);
  }

  await invalidateCache('tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');
  summary.unmatchedUsers = Array.from(ctx.unmatched);
  delete summary.currentList;
  summary.finishedAt = new Date().toISOString();
  return summary;
}

/** Redis can hang when it's down (maxRetriesPerRequest: null), so cap every call. */
function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), REDIS_TIMEOUT_MS)),
  ]);
}

/** When this list last pulled cleanly (unix ms), or null → full pull. */
async function getLastPulled(listId: string): Promise<number | null> {
  const value = await withTimeout(redis.get(LAST_PULLED_KEY(listId)), null);
  const ms = Number(value);
  return value && Number.isFinite(ms) ? ms : null;
}

async function setLastPulled(listId: string, ms: number): Promise<void> {
  await withTimeout(redis.set(LAST_PULLED_KEY(listId), String(ms)).then(() => undefined), undefined);
}

function recordActivity(ctx: SyncContext, action: ClickUpSyncActivity['action'], kind: ClickUpSyncActivity['kind'], title: string) {
  const feed = ctx.summary.activity;
  feed.push({ at: new Date().toISOString(), list: ctx.listName, action, kind, title });
  if (feed.length > MAX_ACTIVITY) feed.splice(0, feed.length - MAX_ACTIVITY);
}

/** Runs fn over items with at most `limit` in flight. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Same pattern as the "VIP Scale" system account in webhook.controller.
async function getOrCreateClickUpUser() {
  const email = 'clickup@system.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const password = await bcrypt.hash(Math.random().toString(36), 10);
  return prisma.user.create({ data: { name: 'ClickUp', email, password } });
}

async function syncList(nexusListId: string, clickUpListId: string, ctx: SyncContext, updatedSince?: number) {
  const cuTasks: any[] = [];
  for (let page = 0; page < MAX_TASK_PAGES; page++) {
    const data = await getClickUpListTasks(clickUpListId, page, ctx.includeClosed, updatedSince);
    const tasks: any[] = data?.tasks ?? [];
    cuTasks.push(...tasks);
    if (data?.last_page === true || tasks.length < CLICKUP_PAGE_SIZE) break;
  }
  const checked = cuTasks.length;
  // Nothing changed in ClickUp since the last pull.
  if (checked === 0) return { checked, retried: 0, failed: 0 };

  // Nexus has one subtask level, so nested ClickUp subtasks hang off their root task.
  const byId = new Map(cuTasks.map((t) => [t.id, t]));

  // An open subtask under a closed parent: the active-only page leaves the parent
  // out, so fetch it (it imports as CLOSED) to give the subtask somewhere to live.
  for (let depth = 0; depth < 10; depth++) {
    const missingParents = new Set(
      cuTasks.filter((t) => t.parent && !byId.has(t.parent)).map((t) => t.parent as string)
    );
    if (missingParents.size === 0) break;
    for (const parentId of missingParents) {
      try {
        const parent = await getClickUpTask(parentId);
        cuTasks.push(parent);
        byId.set(parent.id, parent);
      } catch (err: any) {
        ctx.summary.errors.push(`parent task ${parentId}: ${firstLine(err.message)}`);
        byId.set(parentId, { id: parentId, parent: '__unavailable__' }); // stop retrying it
      }
    }
  }
  const rootIdOf = (t: any): string | null => {
    let cur = t;
    for (let depth = 0; cur?.parent && depth < 10; depth++) cur = byId.get(cur.parent);
    return cur && !cur.parent ? cur.id : null;
  };
  const subtasksByRoot = new Map<string, any[]>();
  for (const t of cuTasks) {
    if (!t.parent) continue;
    const rootId = rootIdOf(t);
    if (!rootId) continue;
    subtasksByRoot.set(rootId, [...(subtasksByRoot.get(rootId) ?? []), t]);
  }

  // A task and its subtasks are pulled together; any failure retries the whole
  // group, which is safe because every write matches existing rows first.
  const syncGroup = async (t: any): Promise<string | null> => {
    try {
      const { taskId, listId, created } = await syncTask(nexusListId, t.id, ctx);
      const subErrors: string[] = [];
      for (const sub of subtasksByRoot.get(t.id) ?? []) {
        try {
          await syncSubtask(taskId, sub.id, ctx);
        } catch (err: any) {
          subErrors.push(`subtask "${sub.name}": ${err.message}`);
        }
      }
      await invalidateCache(`task:${taskId}`);
      if (created) await emitCreatedTask(taskId, listId, ctx);
      return subErrors.length ? subErrors.join('; ') : null;
    } catch (err: any) {
      return err.message;
    }
  };

  let pending = cuTasks.filter((t) => !t.parent);
  let lastErrors = new Map<string, string>();
  const firstFailures = new Set<string>();
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length && pending.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
    const errors = new Map<string, string>();
    await mapPool(pending, CONCURRENCY, async (t) => {
      const error = await syncGroup(t);
      if (error) errors.set(t.id, error);
    });
    if (attempt === 0) errors.forEach((_e, id) => firstFailures.add(id));
    pending = pending.filter((t) => errors.has(t.id));
    lastErrors = errors;
  }

  for (const t of pending) {
    ctx.summary.errors.push(`"${t.name}" (${t.id}): ${firstLine(lastErrors.get(t.id))}`);
  }
  return { checked, retried: firstFailures.size - pending.length, failed: pending.length };
}

/** Prisma errors span many lines; the last non-empty line is the readable cause. */
function firstLine(message: string | undefined): string {
  const lines = (message ?? 'unknown error').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? 'unknown error';
}

async function syncTask(nexusListId: string, cuTaskId: string, ctx: SyncContext) {
  const cu = await getClickUpTask(cuTaskId);
  const listName = (await prisma.list.findUnique({ where: { id: nexusListId }, select: { name: true } }))?.name;
  const existing =
    (await prisma.task.findFirst({
      where: { OR: [{ externalId: cuTaskId }, { externalId: { endsWith: `/${cuTaskId}` } }] },
      select: { id: true, listId: true, externalId: true },
    })) ??
    // Unlinked Nexus task with the same title (Galaxy appends " - <Client>").
    (await prisma.task.findFirst({
      where: {
        listId: nexusListId,
        externalId: null,
        OR: [
          { title: { equals: cu.name, mode: 'insensitive' } },
          ...(listName ? [{ title: { equals: `${cu.name} - ${listName}`, mode: 'insensitive' as const } }] : []),
        ],
      },
      select: { id: true, listId: true, externalId: true },
    }));
  // A task already in Nexus stays in its current list.
  const listId = existing?.listId ?? nexusListId;
  const status = await resolveStatus(listId, cu.status, ctx);
  const assigneeIds = mapUsers(cu.assignees, ctx);

  let taskId: string;
  if (existing) {
    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: {
        // Keep Nexus titles (Galaxy adds the client suffix); just link the task.
        externalId: existing.externalId ?? cuTaskId,
        ...(status && { status }),
        // Only overwrite assignees when ClickUp's resolve to Nexus users,
        // so unmatched emails don't wipe assignments made in Nexus.
        ...(assigneeIds.length > 0 && {
          assigneeId: assigneeIds[0],
          assignees: { set: assigneeIds.map((id) => ({ id })) },
        }),
      },
      select: { id: true, title: true, status: true, assigneeId: true, listId: true, updatedAt: true },
    });
    ctx.emit(`list:${listId}`, 'task:updated', updated);
    taskId = existing.id;
    ctx.summary.tasksUpdated++;
    recordActivity(ctx, 'updated', 'task', updated.title);
  } else {
    const created = await prisma.task.create({
      data: {
        title: cu.name,
        description: cu.text_content || null,
        listId,
        creatorId: userIdFor(cu.creator, ctx) ?? ctx.fallbackUserId,
        status: status ?? 'PENDING',
        priority: PRIORITY_MAP[cu.priority?.priority] ?? Priority.MEDIUM,
        externalId: cuTaskId,
        dueDate: toDate(cu.due_date),
        startDate: toDate(cu.start_date),
        createdAt: toDate(cu.date_created) ?? undefined,
        ...(assigneeIds.length > 0 && {
          assigneeId: assigneeIds[0],
          assignees: { connect: assigneeIds.map((id) => ({ id })) },
        }),
      },
      select: { id: true },
    });
    taskId = created.id;
    ctx.summary.tasksCreated++;
    recordActivity(ctx, 'added', 'task', cu.name);
  }

  const target: Target = { taskId, subtaskId: null };
  await syncChecklists(cu.checklists, target, ctx);
  await syncAttachments(cu.attachments, { taskId }, ctx);
  await syncComments(cuTaskId, target, ctx);
  return { taskId, listId, created: !existing };
}

async function syncSubtask(nexusTaskId: string, cuSubtaskId: string, ctx: SyncContext) {
  const cu = await getClickUpTask(cuSubtaskId);
  const existing =
    (await prisma.subtask.findFirst({
      where: { OR: [{ externalId: cuSubtaskId }, { externalId: { endsWith: `/${cuSubtaskId}` } }] },
      select: { id: true, externalId: true, assigneeRoleRestrictions: true },
    })) ??
    // Subtasks created in Nexus before their ClickUp ID was stored.
    (await prisma.subtask.findFirst({
      where: { taskId: nexusTaskId, externalId: null, title: { equals: cu.name, mode: 'insensitive' } },
      select: { id: true, externalId: true, assigneeRoleRestrictions: true },
    }));

  // The auditor role drives which audits (Design / UI UX / Funnel) the task requires,
  // the way Galaxy sets it. Never replaces a role already set in Nexus.
  const auditorRole = auditorRoleFromTitle(cu.name);

  // Nexus subtask statuses are upper-case (e.g. "CLOSED").
  const completed = ['closed', 'done'].includes(cu.status?.type);
  const status = completed ? 'CLOSED' : cu.status?.status ? String(cu.status.status).toUpperCase() : null;
  const assigneeIds = mapUsers(cu.assignees, ctx);

  let subtaskId: string;
  if (existing) {
    await prisma.subtask.update({
      where: { id: existing.id },
      data: {
        title: cu.name,
        externalId: existing.externalId ?? cuSubtaskId,
        ...(status && { status, completed }),
        ...(auditorRole && existing.assigneeRoleRestrictions.length === 0 && { assigneeRoleRestrictions: [auditorRole] }),
        ...(assigneeIds.length > 0 && {
          assigneeId: assigneeIds[0],
          assignees: { set: assigneeIds.map((id) => ({ id })) },
        }),
      },
    });
    subtaskId = existing.id;
  } else {
    const created = await prisma.subtask.create({
      data: {
        taskId: nexusTaskId,
        title: cu.name,
        description: cu.text_content || null,
        status: status ?? 'PENDING',
        completed,
        priority: PRIORITY_MAP[cu.priority?.priority] ?? Priority.MEDIUM,
        dueDate: toDate(cu.due_date),
        externalId: cuSubtaskId,
        createdAt: toDate(cu.date_created) ?? undefined,
        ...(auditorRole && { assigneeRoleRestrictions: [auditorRole] }),
        ...(assigneeIds.length > 0 && {
          assigneeId: assigneeIds[0],
          assignees: { connect: assigneeIds.map((id) => ({ id })) },
        }),
      },
      select: { id: true },
    });
    subtaskId = created.id;
  }
  ctx.summary.subtasks++;
  recordActivity(ctx, existing ? 'updated' : 'added', 'subtask', cu.name);

  const target: Target = { taskId: nexusTaskId, subtaskId };
  await syncChecklists(cu.checklists, target, ctx);
  // Attachment has no subtask relation, so subtask files land on the parent task.
  await syncAttachments(cu.attachments, { taskId: nexusTaskId }, ctx);
  await syncComments(cuSubtaskId, target, ctx);
}

async function syncChecklists(checklists: any[] | undefined, target: Target, ctx: SyncContext) {
  for (const cl of checklists ?? []) {
    // "Audit" is Nexus's own audit checklist (Design / UI UX / Funnel / Instructions).
    // A ClickUp checklist of that name gets its own checklist instead of merging in.
    const reserved = isReservedChecklistName(cl.name);
    const existing =
      (await prisma.checklist.findUnique({ where: { externalId: cl.id }, select: { id: true } })) ??
      (reserved
        ? null
        : await prisma.checklist.findFirst({
            where: { ...target, externalId: null, name: { equals: cl.name, mode: 'insensitive' } },
            select: { id: true },
          }));
    const checklist = existing
      ? await prisma.checklist.update({
          where: { id: existing.id },
          // Keep the Nexus name on a linked reserved checklist (it may be Nexus's own Audit).
          data: reserved ? { externalId: cl.id } : { name: cl.name, externalId: cl.id },
          select: { id: true },
        })
      : await prisma.checklist.create({
          data: { ...target, name: reserved ? CLICKUP_AUDIT_CHECKLIST : cl.name, externalId: cl.id },
          select: { id: true },
        });
    ctx.summary.checklists++;

    for (const item of cl.items ?? []) {
      const assigneeId = userIdFor(item.assignee, ctx);
      const data = {
        text: item.name,
        completed: !!item.resolved,
        ...(assigneeId && { assigneeId }),
      };
      const existingItem =
        (await prisma.checklistItem.findUnique({ where: { externalId: item.id }, select: { id: true } })) ??
        (await prisma.checklistItem.findFirst({
          where: { checklistId: checklist.id, externalId: null, text: { equals: item.name, mode: 'insensitive' } },
          select: { id: true },
        }));
      if (existingItem) {
        await prisma.checklistItem.update({
          where: { id: existingItem.id },
          data: { ...data, externalId: item.id },
        });
      } else {
        await prisma.checklistItem.create({
          data: { ...data, checklistId: checklist.id, externalId: item.id },
        });
      }
      ctx.summary.checklistItems++;
    }
  }
}

async function syncComments(cuTaskId: string, target: Target, ctx: SyncContext) {
  const seen = new Set<string>();
  const comments: any[] = [];
  let start: { date: string; id: string } | undefined;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const batch: any[] = (await getClickUpTaskComments(cuTaskId, start))?.comments ?? [];
    const fresh = batch.filter((c) => !seen.has(c.id));
    fresh.forEach((c) => seen.add(c.id));
    comments.push(...fresh);
    if (batch.length < CLICKUP_COMMENT_PAGE_SIZE || fresh.length === 0) break;
    const oldest = batch[batch.length - 1];
    start = { date: oldest.date, id: oldest.id };
  }

  for (const c of comments) {
    const commentId = await upsertComment(c, target, null, ctx);
    if (Number(c.reply_count) > 0) {
      const replies: any[] = (await getClickUpCommentReplies(c.id))?.comments ?? [];
      for (const r of replies) await upsertComment(r, target, commentId, ctx);
      await prisma.taskComment.update({ where: { id: commentId }, data: { replyCount: replies.length } });
    }
  }
}

/** Creates the comment once; existing rows (including ones Nexus pushed to ClickUp) are left as-is. */
async function upsertComment(c: any, target: Target, parentCommentId: string | null, ctx: SyncContext) {
  const userId = userIdFor(c.user, ctx);
  const text = String(c.comment_text ?? '').trim();
  // No Nexus account means the person has left — label them so it reads clearly.
  const content = userId ? text : `${c.user?.username || 'ClickUp user'} (Deactivated): ${text}`;

  const existing = await prisma.taskComment.findUnique({ where: { externalId: String(c.id) }, select: { id: true } });
  if (existing) return existing.id;

  const created = await prisma.taskComment.create({
    data: {
      ...target,
      parentCommentId,
      content,
      userId: userId ?? ctx.fallbackUserId,
      externalId: String(c.id),
      createdAt: toDate(c.date) ?? undefined,
    },
    select: { id: true },
  });
  ctx.summary.comments++;

  // Inline images/files are segments of the rich comment array.
  const files = (c.comment ?? [])
    .map((seg: any) => (seg?.type === 'image' ? seg.image : seg?.type === 'attachment' ? seg.attachment : null))
    .filter((f: any) => f?.url);
  await syncAttachments(files, { taskCommentId: created.id }, ctx);
  return created.id;
}

async function syncAttachments(
  files: any[] | undefined,
  target: { taskId?: string; taskCommentId?: string },
  ctx: SyncContext
) {
  for (const file of files ?? []) {
    if (!file?.url) continue;
    const fileKey = `clickup:${file.id ?? file.url}`;
    const exists = await prisma.attachment.findFirst({ where: { fileKey }, select: { id: true } });
    if (exists) continue;
    const extension = String(file.extension ?? '').toLowerCase();
    await prisma.attachment.create({
      data: {
        ...target,
        fileName: file.title || file.name || 'attachment',
        // Linked, not copied: the file stays hosted by ClickUp.
        fileUrl: file.url,
        fileKey,
        fileSize: Number(file.size) || 0,
        mimeType: file.mimetype || MIME_BY_EXTENSION[extension] || 'application/octet-stream',
        uploadedById: userIdFor(file.user, ctx) ?? ctx.fallbackUserId,
      },
    });
    ctx.summary.attachments++;
  }
}

/**
 * Matches a ClickUp status to the list's status by name, creating it if the list doesn't have it.
 * Any ClickUp closed-type status ("complete", "done", ...) becomes the list's CLOSED status,
 * which the daily rollover skips.
 */
async function resolveStatus(listId: string, cuStatus: any, ctx: SyncContext): Promise<string | null> {
  const isClosed = ['closed', 'done'].includes(cuStatus?.type);
  const name = isClosed ? 'Closed' : typeof cuStatus?.status === 'string' ? cuStatus.status.trim() : '';
  if (!name) return null;

  let statuses = ctx.statusCache.get(listId);
  if (!statuses) {
    const rows = await prisma.listStatus.findMany({ where: { listId }, select: { name: true } });
    statuses = new Map(rows.map((r) => [r.name.toLowerCase(), r.name]));
    ctx.statusCache.set(listId, statuses);
  }
  const match = statuses.get(name.toLowerCase());
  if (match) return match;

  // Tasks run in parallel, so share one create per list+status.
  const key = `${listId}:${name.toLowerCase()}`;
  let pending = ctx.statusCreates.get(key);
  if (!pending) {
    const stored = name.toUpperCase();
    const known = statuses;
    pending = prisma.listStatus
      .create({ data: { listId, name: stored, color: cuStatus.color || 'zinc', order: known.size } })
      .then(() => {
        known.set(name.toLowerCase(), stored);
        ctx.summary.statusesCreated++;
        return stored;
      });
    ctx.statusCreates.set(key, pending);
    pending.catch(() => ctx.statusCreates.delete(key)); // let a retry try again
  }
  return pending;
}

function userIdFor(cuUser: any, ctx: SyncContext): string | null {
  const email = typeof cuUser?.email === 'string' ? cuUser.email.toLowerCase() : '';
  if (!email) return null;
  const id = ctx.userIndex.get(email);
  if (!id) ctx.unmatched.add(email);
  return id ?? null;
}

function mapUsers(cuUsers: any[] | undefined, ctx: SyncContext): string[] {
  const ids = (cuUsers ?? []).map((u) => userIdFor(u, ctx)).filter((id): id is string => !!id);
  return Array.from(new Set(ids));
}

/** ClickUp dates are unix-ms strings. */
function toDate(value: unknown): Date | null {
  const ms = Number(value);
  return value && Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

// Same shape the Galaxy webhook emits, so list pages can render the new card.
async function emitCreatedTask(taskId: string, listId: string, ctx: SyncContext) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      creator: { select: { id: true, name: true, avatarUrl: true } },
      assignees: { select: { id: true, name: true, avatarUrl: true } },
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      subtasks: {
        include: {
          User: { select: { id: true, name: true, avatarUrl: true } },
          assignees: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  });
  if (task) ctx.emit(`list:${listId}`, 'task:created', task);
}
