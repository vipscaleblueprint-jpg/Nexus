/**
 * sheets.controller.ts
 *
 * Nexus endpoints for the MA Daily Schedule sheets. The sheets' Apps Script
 * calls n8n, and n8n forwards each action here:
 *
 *   POST /api/webhooks/sheets/update
 *     { task_link, what_to_update: 'status', new_status }
 *     { task_link, what_to_update: 'add_assignee' | 'remove_assignee', assignee }
 *
 *   POST /api/webhooks/sheets/comment
 *     { name, task_link, message, action: create|update|delete, comment_id, date_posted }
 *     → { id } (the Nexus comment id the sheet stores in column AF)
 *
 * task_link is a Nexus task URL (…/lists/<listId>?task=<taskId>[&subtask=<id>])
 * or a bare task id. The sheet's current field names (clickup_link, clickup_id)
 * are accepted too.
 *
 * While ClickUp still runs alongside, n8n keeps ClickUp updated too. Responses
 * carry what it needs for that:
 *   clickup_link        the task's ClickUp link (from its externalId), or null
 *   clickup_comment_id  the ClickUp copy of the comment, once n8n has linked it
 * n8n links a new ClickUp comment by sending clickup_comment_id on a create/update.
 */

import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';
import { requireApiKey, getOrCreateVipScaleUser } from './webhook.controller';

interface LinkedTarget {
  taskId: string;
  subtaskId: string | null;
  listId: string;
  /** The ClickUp copy of this task/subtask, while ClickUp still runs alongside. */
  clickUpLink: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Galaxy stores the full ClickUp URL, the ClickUp pull the bare id. */
function clickUpLinkOf(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  return externalId.startsWith('http') ? externalId : `https://app.clickup.com/t/${externalId}`;
}

/** The task (and subtask) a Nexus task link or bare task id points to. */
async function findByNexusLink(link: unknown): Promise<LinkedTarget | null> {
  if (typeof link !== 'string' || !link.trim()) return null;
  const value = link.trim();

  let taskId: string | null = null;
  let subtaskId: string | null = null;
  if (UUID.test(value)) {
    taskId = value;
  } else {
    try {
      const url = new URL(value);
      taskId = url.searchParams.get('task');
      subtaskId = url.searchParams.get('subtask');
    } catch {
      return null;
    }
  }
  if (!taskId || !UUID.test(taskId)) return null;

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, listId: true, externalId: true } });
  if (!task) return null;

  if (subtaskId && UUID.test(subtaskId)) {
    const subtask = await prisma.subtask.findFirst({ where: { id: subtaskId, taskId }, select: { id: true, externalId: true } });
    if (subtask) return { taskId, subtaskId: subtask.id, listId: task.listId, clickUpLink: clickUpLinkOf(subtask.externalId) };
  }
  return { taskId, subtaskId: null, listId: task.listId, clickUpLink: clickUpLinkOf(task.externalId) };
}

/**
 * The Nexus user a sheet refers to: "Leo" from the file name "Leo - MA Daily Schedule".
 * Exact name first, then a unique first-name match ("Leo" → "Leo Feulatriz").
 */
async function findUserByName(raw: unknown): Promise<{ id: string; name: string } | null> {
  const name = typeof raw === 'string' ? raw.split(/\s+-\s+|\s+MA Daily Schedule/i)[0].trim() : '';
  if (!name) return null;
  const exact = await prisma.user.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (exact) return exact;
  const byFirstName = await prisma.user.findMany({
    where: { name: { startsWith: `${name} `, mode: 'insensitive' } },
    select: { id: true, name: true },
    take: 2,
  });
  return byFirstName.length === 1 ? byFirstName[0] : null;
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

export const handleSheetUpdate = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  try {
    const { task_link, what_to_update } = req.body || {};
    const target = await findByNexusLink(task_link);
    if (!target) return res.status(404).json({ error: 'Task not found in Nexus' });

    if (what_to_update === 'status') return await applyStatus(target, req.body.new_status, res);
    const assignee = req.body.assignee ?? req.body.assignee_name;
    if (what_to_update === 'add_assignee') return await addAssignee(target, assignee, res);
    if (what_to_update === 'remove_assignee') return await removeAssignee(target, assignee, res);
    return res.status(400).json({ error: `Unknown what_to_update: ${what_to_update}` });
  } catch (error: any) {
    console.error('[Sheets] update failed:', error);
    return res.status(500).json({ error: error.message });
  }
};

async function applyStatus(target: LinkedTarget, newStatus: unknown, res: Response) {
  const wanted = str(newStatus);
  if (!wanted) return res.status(400).json({ error: 'new_status is required' });

  if (target.subtaskId) {
    // Subtask statuses are stored upper-case.
    const status = wanted.toUpperCase();
    await prisma.subtask.update({ where: { id: target.subtaskId }, data: { status, completed: status === 'CLOSED' } });
  } else {
    const listStatus = await prisma.listStatus.findFirst({
      where: { listId: target.listId, name: { equals: wanted, mode: 'insensitive' } },
      select: { name: true },
    });
    const before = await prisma.task.findUnique({ where: { id: target.taskId }, select: { status: true } });
    const updated = await prisma.task.update({
      where: { id: target.taskId },
      data: { status: listStatus?.name ?? wanted },
      select: { id: true, title: true, status: true, assigneeId: true, listId: true, updatedAt: true },
    });
    if (before?.status !== updated.status) {
      const actor = await getOrCreateVipScaleUser();
      await prisma.auditLog.create({
        data: {
          action: 'STATUS_CHANGE',
          entity: 'TASK',
          entityId: target.taskId,
          userId: actor.id,
          details: { oldStatus: before?.status, newStatus: updated.status, source: 'sheet' },
        },
      });
    }
    io.to(`list:${target.listId}`).emit('task:updated', updated);
  }

  await invalidateCache(`task:${target.taskId}`, 'tasks:all', 'dashboard:all');
  return res.status(200).json({ success: true, clickup_link: target.clickUpLink });
}

async function addAssignee(target: LinkedTarget, assignee: unknown, res: Response) {
  const user = await findUserByName(assignee);
  if (!user) return res.status(404).json({ error: `No Nexus user named "${assignee}"` });

  if (target.subtaskId) {
    const subtask = await prisma.subtask.findUnique({ where: { id: target.subtaskId }, select: { assigneeId: true } });
    await prisma.subtask.update({
      where: { id: target.subtaskId },
      data: {
        assignees: { connect: { id: user.id } },
        ...(!subtask?.assigneeId && { assigneeId: user.id }),
      },
    });
  } else {
    const task = await prisma.task.findUnique({ where: { id: target.taskId }, select: { assigneeId: true } });
    const updated = await prisma.task.update({
      where: { id: target.taskId },
      data: {
        assignees: { connect: { id: user.id } },
        ...(!task?.assigneeId && { assigneeId: user.id }),
      },
      select: {
        id: true, listId: true, assigneeId: true, updatedAt: true,
        assignees: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    io.to(`list:${target.listId}`).emit('task:updated', updated);
  }

  await invalidateCache(`task:${target.taskId}`, 'tasks:all', 'dashboard:all');
  return res.status(200).json({ success: true, assignee: user.name, clickup_link: target.clickUpLink });
}

async function removeAssignee(target: LinkedTarget, assignee: unknown, res: Response) {
  const user = await findUserByName(assignee);
  if (!user) return res.status(404).json({ error: `No Nexus user named "${assignee}"` });

  const where = target.subtaskId ? { id: target.subtaskId } : { id: target.taskId };
  const select = { assigneeId: true, assignees: { select: { id: true } } };
  const current = target.subtaskId
    ? await prisma.subtask.findUnique({ where, select })
    : await prisma.task.findUnique({ where, select });
  // The primary assignee falls back to whoever else is still assigned.
  const remaining = (current?.assignees ?? []).map((a) => a.id).filter((id) => id !== user.id);
  const data = {
    assignees: { disconnect: { id: user.id } },
    ...(current?.assigneeId === user.id && { assigneeId: remaining[0] ?? null }),
  };

  if (target.subtaskId) {
    await prisma.subtask.update({ where, data });
  } else {
    const updated = await prisma.task.update({
      where,
      data,
      select: {
        id: true, listId: true, assigneeId: true, updatedAt: true,
        assignees: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    io.to(`list:${target.listId}`).emit('task:updated', updated);
  }

  await invalidateCache(`task:${target.taskId}`, 'tasks:all', 'dashboard:all');
  return res.status(200).json({ success: true, assignee: user.name, clickup_link: target.clickUpLink });
}

const NEXUS_APP_URL = (process.env.FRONTEND_URL || 'https://nexus.vipscaleph.com').replace(/\/+$/, '');
const MAX_RESOLVE_LINKS = 500;

/** ClickUp's task id from a link like https://app.clickup.com/t/abc123 or …/t/<team>/abc123. */
function clickUpIdOf(link: string): string | null {
  const id = link.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  return id && /^[a-z0-9]+$/i.test(id) ? id : null;
}

/**
 * POST /api/webhooks/sheets/nexus-links  { clickup_links: string[] }
 * → { links: { [clickupLink]: nexusLink | null } }
 *
 * Lets "Notes for Today" fill its Nexus Task Link column from the ClickUp links it
 * already has. null means the task isn't in Nexus yet; the sheet asks again later.
 */
export const resolveNexusLinks = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  try {
    const input: unknown[] = Array.isArray(req.body?.clickup_links) ? req.body.clickup_links : [];
    if (input.length > MAX_RESOLVE_LINKS) {
      return res.status(400).json({ error: `At most ${MAX_RESOLVE_LINKS} links per request` });
    }
    const links = Array.from(new Set(input.map(str).filter(Boolean)));
    const idByLink = new Map(links.map((l) => [l, clickUpIdOf(l)]));
    const ids = Array.from(new Set(Array.from(idByLink.values()).filter((id): id is string => !!id)));

    // Galaxy stores the full ClickUp URL, the ClickUp pull the bare id.
    const match = { OR: ids.flatMap((id) => [{ externalId: id }, { externalId: { endsWith: `/${id}` } }]) };
    const [tasks, subtasks] = ids.length
      ? await Promise.all([
          prisma.task.findMany({ where: match, select: { id: true, listId: true, externalId: true } }),
          prisma.subtask.findMany({
            where: match,
            select: { id: true, taskId: true, externalId: true, task: { select: { listId: true } } },
          }),
        ])
      : [[], []];

    const nexusLinkById = new Map<string, string>();
    for (const s of subtasks) {
      const id = s.externalId && clickUpIdOf(s.externalId);
      if (id) nexusLinkById.set(id, `${NEXUS_APP_URL}/lists/${s.task.listId}?task=${s.taskId}&subtask=${s.id}`);
    }
    for (const t of tasks) {
      const id = t.externalId && clickUpIdOf(t.externalId);
      if (id) nexusLinkById.set(id, `${NEXUS_APP_URL}/lists/${t.listId}?task=${t.id}`);
    }

    const result: Record<string, string | null> = {};
    for (const [link, id] of idByLink) result[link] = (id && nexusLinkById.get(id)) || null;
    return res.status(200).json({ links: result });
  } catch (error: any) {
    console.error('[Sheets] resolve links failed:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Same layout n8n posts to ClickUp: "👤 Leo | 📅  Oct 9, 2026, 06:47 PM | ✏️ Oct 9, 2026 06:52 PM"
 * then the message. ✏️ is when it was last written, in the sheets' Manila time.
 */
function formatSheetComment(fileName: unknown, datePosted: unknown, message: string): string {
  const who = str(fileName).split('-')[0].trim();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(new Date());
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
  const edited = `${p('month')} ${p('day')}, ${p('year')} ${p('hour')}:${p('minute')} ${p('dayPeriod')}`;
  return `👤 ${who} | 📅  ${str(datePosted)} | ✏️ ${edited}\n\n${message}`;
}

const commentInclude = { user: { select: { id: true, name: true, avatarUrl: true, email: true } } };

export const handleSheetComment = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  try {
    const body = req.body || {};
    const action = str(body.action);
    const link = body.task_link ?? body.clickup_link;
    const commentId = str(body.comment_id ?? body.clickup_id);
    // Rows posted before the switch still hold a ClickUp comment id (all digits) in column AF.
    const legacyClickUpId = /^\d+$/.test(commentId) ? commentId : '';
    const clickUpCommentId = str(body.clickup_comment_id) || legacyClickUpId;
    const select = { id: true, taskId: true, subtaskId: true, externalId: true, task: { select: { listId: true } } };
    const existing = UUID.test(commentId)
      ? await prisma.taskComment.findUnique({ where: { id: commentId }, select })
      : legacyClickUpId
        ? await prisma.taskComment.findUnique({ where: { externalId: legacyClickUpId }, select })
        : null;

    if (action === 'delete') {
      // Not in Nexus, but n8n can still delete the old ClickUp comment.
      if (!existing) {
        return res.status(200).json({ success: true, id: commentId, clickup_comment_id: legacyClickUpId || null, skipped: 'comment not found' });
      }
      await prisma.taskComment.delete({ where: { id: existing.id } });
      io.to(`list:${existing.task.listId}`).emit('task:comment_deleted', { taskId: existing.taskId, commentId: existing.id });
      await invalidateCache(`task:${existing.taskId}`);
      // n8n deletes the ClickUp copy with this.
      return res.status(200).json({ success: true, id: existing.id, clickup_comment_id: existing.externalId });
    }

    if (action !== 'create' && action !== 'update') {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const text = str(body.message);
    if (!text) return res.status(400).json({ error: 'message is required' });
    const content = formatSheetComment(body.name, body.date_posted, text);

    const target = await findByNexusLink(link);

    // n8n linking the ClickUp copy it just posted. If the ClickUp pull already
    // imported that comment as its own row, drop that duplicate first.
    if (clickUpCommentId) {
      await prisma.taskComment.deleteMany({
        where: { externalId: clickUpCommentId, ...(existing && { id: { not: existing.id } }) },
      });
    }

    // The row already has a comment: edit it, moving it if the row now points at another task.
    if (existing) {
      const moved = !!target && (target.taskId !== existing.taskId || target.subtaskId !== existing.subtaskId);
      const comment = await prisma.taskComment.update({
        where: { id: existing.id },
        data: {
          content,
          ...(moved && { taskId: target!.taskId, subtaskId: target!.subtaskId }),
          // A moved comment's ClickUp copy stays on the old task, so it's unlinked until n8n reposts it.
          ...(clickUpCommentId ? { externalId: clickUpCommentId } : moved ? { externalId: null } : {}),
        },
        include: commentInclude,
      });
      if (moved) {
        io.to(`list:${existing.task.listId}`).emit('task:comment_deleted', { taskId: existing.taskId, commentId: existing.id });
        io.to(`list:${target!.listId}`).emit('task:comment_added', { taskId: target!.taskId, subtaskId: target!.subtaskId, comment });
        await invalidateCache(`task:${existing.taskId}`, `task:${target!.taskId}`);
      } else {
        io.to(`list:${existing.task.listId}`).emit('task:comment_updated', { taskId: existing.taskId, comment });
        await invalidateCache(`task:${existing.taskId}`);
      }
      const current = target ?? (await findByNexusLink(existing.taskId));
      return res.status(200).json({
        success: true,
        id: comment.id,
        moved,
        clickup_link: current?.clickUpLink ?? null,
        clickup_comment_id: comment.externalId,
        // On a move, n8n deletes this ClickUp comment and posts a new one on clickup_link.
        ...(moved && { previous_clickup_comment_id: existing.externalId }),
      });
    }

    if (!target) return res.status(404).json({ error: 'Task not found in Nexus' });

    const author = (await findUserByName(body.name)) ?? (await getOrCreateVipScaleUser());
    const comment = await prisma.taskComment.create({
      data: {
        taskId: target.taskId,
        subtaskId: target.subtaskId,
        userId: author.id,
        content,
        ...(clickUpCommentId && { externalId: clickUpCommentId }),
      },
      include: commentInclude,
    });
    io.to(`list:${target.listId}`).emit('task:comment_added', { taskId: target.taskId, subtaskId: target.subtaskId, comment });
    await invalidateCache(`task:${target.taskId}`);
    return res.status(200).json({
      success: true,
      id: comment.id,
      moved: false,
      clickup_link: target.clickUpLink,
      clickup_comment_id: comment.externalId,
    });
  } catch (error: any) {
    console.error('[Sheets] comment failed:', error);
    return res.status(500).json({ error: error.message });
  }
};
