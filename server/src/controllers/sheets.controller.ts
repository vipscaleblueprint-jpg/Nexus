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
import { invalidateCache, redis, isRedisReady } from '../services/redisService';
import { requireApiKey, getOrCreateVipScaleUser } from './webhook.controller';
import { plainTextToCommentHtml } from '../utils/commentHtml';
import { getStatusChangeRecipients } from '../utils/roleNotification';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';
import { toNotificationPreview } from '../utils/mentionNotification';
import { getOrCreateTaskMapRecord, updateTaskMapRecord, getUpworkClients } from '../services/taskMapService';

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

/** ClickUp's task id from a link like https://app.clickup.com/t/abc123 or …/t/<team>/abc123. */
function clickUpIdOf(link: string): string | null {
  const id = link.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  return id && /^[a-z0-9]+$/i.test(id) ? id : null;
}

/** The task (and subtask) a Nexus task link, bare task id, or ClickUp link points to. */
async function findByNexusLink(link: unknown, explicitSubtaskId?: string): Promise<LinkedTarget | null> {
  if (typeof link !== 'string' || !link.trim()) return null;
  const value = link.trim();

  let taskId: string | null = null;
  let subtaskId: string | null = explicitSubtaskId?.trim() || null;

  if (UUID.test(value)) {
    // Check if the UUID is a main task
    const task = await prisma.task.findUnique({
      where: { id: value },
      select: { id: true, listId: true, externalId: true },
    });
    if (task) {
      if (subtaskId && UUID.test(subtaskId)) {
        const subtask = await prisma.subtask.findFirst({
          where: { id: subtaskId, taskId: task.id },
          select: { id: true, externalId: true },
        });
        if (subtask) {
          return { taskId: task.id, subtaskId: subtask.id, listId: task.listId, clickUpLink: clickUpLinkOf(subtask.externalId) };
        }
      }
      return { taskId: task.id, subtaskId: null, listId: task.listId, clickUpLink: clickUpLinkOf(task.externalId) };
    }

    // Check if the UUID is a subtask directly
    const subtask = await prisma.subtask.findUnique({
      where: { id: value },
      select: { id: true, taskId: true, externalId: true, task: { select: { listId: true } } },
    });
    if (subtask) {
      return {
        taskId: subtask.taskId,
        subtaskId: subtask.id,
        listId: subtask.task.listId,
        clickUpLink: clickUpLinkOf(subtask.externalId),
      };
    }
  } else {
    try {
      const url = new URL(value);
      const qTask = url.searchParams.get('task');
      const qSubtask = url.searchParams.get('subtask');
      if (qTask) taskId = qTask;
      if (qSubtask) subtaskId = qSubtask;

      // Also check pathname format e.g. /tasks/:id or /subtasks/:id
      const pathMatch = url.pathname.match(/\/(tasks|subtasks)\/([0-9a-f-]{36})/i);
      if (pathMatch) {
        if (pathMatch[1].toLowerCase() === 'subtasks') {
          subtaskId = pathMatch[2];
        } else if (!taskId) {
          taskId = pathMatch[2];
        }
      }
    } catch {
      // Not a standard URL
    }
  }

  // If subtaskId is present without a valid taskId, lookup parent task from subtask
  if (subtaskId && UUID.test(subtaskId) && (!taskId || !UUID.test(taskId))) {
    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      select: { id: true, taskId: true, externalId: true, task: { select: { listId: true } } },
    });
    if (subtask) {
      return {
        taskId: subtask.taskId,
        subtaskId: subtask.id,
        listId: subtask.task.listId,
        clickUpLink: clickUpLinkOf(subtask.externalId),
      };
    }
  }

  if (taskId && UUID.test(taskId)) {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, listId: true, externalId: true } });
    if (task) {
      if (subtaskId && UUID.test(subtaskId)) {
        const subtask = await prisma.subtask.findFirst({ where: { id: subtaskId, taskId }, select: { id: true, externalId: true } });
        if (subtask) return { taskId, subtaskId: subtask.id, listId: task.listId, clickUpLink: clickUpLinkOf(subtask.externalId) };
      }
      return { taskId, subtaskId: null, listId: task.listId, clickUpLink: clickUpLinkOf(task.externalId) };
    }

    // In case taskId was actually a subtask UUID
    const subtask = await prisma.subtask.findUnique({
      where: { id: taskId },
      select: { id: true, taskId: true, externalId: true, task: { select: { listId: true } } },
    });
    if (subtask) {
      return {
        taskId: subtask.taskId,
        subtaskId: subtask.id,
        listId: subtask.task.listId,
        clickUpLink: clickUpLinkOf(subtask.externalId),
      };
    }
  }

  // Fallback: check if the input is a ClickUp link or ClickUp task ID
  const cuId = clickUpIdOf(value);
  if (cuId) {
    const match = { OR: [{ externalId: cuId }, { externalId: { endsWith: `/${cuId}` } }] };
    const [subtask, task] = await Promise.all([
      prisma.subtask.findFirst({
        where: match,
        select: { id: true, taskId: true, externalId: true, task: { select: { listId: true } } },
      }),
      prisma.task.findFirst({
        where: match,
        select: { id: true, listId: true, externalId: true },
      }),
    ]);

    if (subtask) {
      return { taskId: subtask.taskId, subtaskId: subtask.id, listId: subtask.task.listId, clickUpLink: clickUpLinkOf(subtask.externalId) };
    }
    if (task) {
      return { taskId: task.id, subtaskId: null, listId: task.listId, clickUpLink: clickUpLinkOf(task.externalId) };
    }
  }

  return null;
}

/**
 * The Nexus user a sheet refers to: "Leo" from the file name "Leo - MA Daily Schedule".
 * Exact name first, then a unique first-name match ("Leo" → "Leo Feulatriz").
 */
export async function findUserByName(raw: unknown): Promise<{ id: string; name: string } | null> {
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
    const { task_link, what_to_update, subtaskId, subtask_id } = req.body || {};
    const explicitSubtaskId =
      (typeof subtaskId === 'string' && subtaskId) ||
      (typeof subtask_id === 'string' && subtask_id) ||
      undefined;
    const target = await findByNexusLink(task_link, explicitSubtaskId);
    if (!target) {
      console.warn('[Sheets] handleSheetUpdate: task not found for link:', task_link);
      return res.status(404).json({
        error: 'Task not found in Nexus',
        receivedLink: task_link,
        what_to_update,
        hint: 'Ensure task_link is a valid Nexus task URL, Nexus UUID, or ClickUp task link/ID linked to a task in Nexus.',
      });
    }

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

function isClosedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase().replace(/[^A-Z]/g, '');
  const closedStatuses = ['CLOSED', 'COMPLETE', 'DONE', 'COMPLETED', 'RESOLVED', 'CANCELLED'];
  return closedStatuses.includes(s);
}

function isProtectedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.includes('REVIEW')) return true;
  const protectedStatuses = [
    'INPROGRESS',
    'CLOSED', 'COMPLETE', 'DONE',
    'WAITING',
    'CRM',
    'CHECKING', 'INCHECKING',
    'DAILY', 'WEEKLY', 'MONTHLY',
    'KYC', 'PINBOARD'
  ];
  return protectedStatuses.includes(s);
}

async function applyStatus(target: LinkedTarget, newStatus: unknown, res: Response) {
  const wanted = str(newStatus);
  if (!wanted) return res.status(400).json({ error: 'new_status is required' });

  if (target.subtaskId) {
    // Subtask statuses are stored upper-case.
    const status = wanted.toUpperCase();
    const beforeSub = await prisma.subtask.findUnique({
      where: { id: target.subtaskId },
      select: { id: true, status: true, title: true },
    });
    if (!beforeSub) return res.status(404).json({ error: 'Subtask not found' });

    // Guard 1: never reopen a completed/closed subtask back to IN REVIEW or IN PROGRESS
    if (isClosedStatus(beforeSub.status) && (status === 'IN PROGRESS' || status.includes('REVIEW'))) {
      return res.status(200).json({
        success: true,
        updated: false,
        reason: `Subtask is already ${beforeSub.status}; skipped auto-update to ${status}`,
        subtask: beforeSub,
        clickup_link: null,
      });
    }

    // Guard 2: never downgrade a subtask that is in review, waiting, closed, etc. back to IN PROGRESS
    if (status === 'IN PROGRESS' && isProtectedStatus(beforeSub.status)) {
      return res.status(200).json({
        success: true,
        updated: false,
        reason: `Subtask is already ${beforeSub.status}; skipped auto-start to IN PROGRESS`,
        subtask: beforeSub,
        clickup_link: null,
      });
    }

    const updatedSub = await prisma.subtask.update({
      where: { id: target.subtaskId },
      data: { status, completed: status === 'CLOSED' },
    });
    if (beforeSub?.status !== updatedSub.status) {
      const actor = await getOrCreateVipScaleUser();
      const authorName = 'VIPScale';
      const log = await prisma.auditLog.create({
        data: {
          action: 'STATUS_CHANGE',
          entity: 'TASK',
          entityId: target.taskId,
          userId: actor.id,
          details: { oldStatus: beforeSub?.status, newStatus: updatedSub.status, subtaskTitle: updatedSub.title, source: 'sheet' },
        },
      });
      const activity = {
        id: log.id,
        type: 'status_change',
        author: authorName,
        oldStatus: beforeSub?.status,
        newStatus: updatedSub.status,
        subtaskTitle: updatedSub.title,
        subtaskId: target.subtaskId,
        date: log.createdAt,
        user: { ...actor, name: authorName },
      };
      io.emit('task_activity', { listId: target.listId, taskId: target.taskId, activity });
      if (target.listId) {
        io.to(`list:${target.listId}`).emit('task_activity', { listId: target.listId, taskId: target.taskId, activity });
      }
    }
    const fullParent = await prisma.task.findUnique({
      where: { id: target.taskId },
      select: {
        id: true, listId: true, updatedAt: true,
        subtasks: {
          include: {
            User: { select: { id: true, name: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });
    if (fullParent) {
      io.emit('task:updated', fullParent);
      io.to(`list:${target.listId}`).emit('task:updated', fullParent);
    }
    io.emit('subtask_updated', { taskId: target.taskId, subtask: updatedSub });
  } else {
    const listStatus = await prisma.listStatus.findFirst({
      where: { listId: target.listId, name: { equals: wanted, mode: 'insensitive' } },
      select: { name: true },
    });
    const before = await prisma.task.findUnique({ where: { id: target.taskId }, select: { id: true, status: true, title: true, teamId: true, assigneeId: true } });
    if (!before) return res.status(404).json({ error: 'Task not found' });

    const normWanted = wanted.toUpperCase().replace(/[^A-Z]/g, '');

    // Guard 1: never reopen a completed/closed task back to IN REVIEW or IN PROGRESS
    if (isClosedStatus(before.status) && (normWanted === 'INPROGRESS' || normWanted.includes('REVIEW'))) {
      return res.status(200).json({
        success: true,
        updated: false,
        reason: `Task is already ${before.status}; skipped auto-update to ${wanted}`,
        task: before,
        clickup_link: null,
      });
    }

    // Guard 2: never downgrade a task that is in review, waiting, closed, etc. back to IN PROGRESS
    if (normWanted === 'INPROGRESS' && isProtectedStatus(before.status)) {
      return res.status(200).json({
        success: true,
        updated: false,
        reason: `Task is already ${before.status}; skipped auto-start to IN PROGRESS`,
        task: before,
        clickup_link: null,
      });
    }

    const updated = await prisma.task.update({
      where: { id: target.taskId },
      data: { status: listStatus?.name ?? wanted },
      select: { id: true, title: true, status: true, assigneeId: true, listId: true, updatedAt: true },
    });

    if (before?.status !== updated.status) {
      const actor = await getOrCreateVipScaleUser();
      const authorName = 'VIPScale';
      const log = await prisma.auditLog.create({
        data: {
          action: 'STATUS_CHANGE',
          entity: 'TASK',
          entityId: target.taskId,
          userId: actor.id,
          details: { oldStatus: before?.status, newStatus: updated.status, source: 'sheet' },
        },
      });
      const activity = {
        id: log.id,
        type: 'status_change',
        author: authorName,
        oldStatus: before?.status,
        newStatus: updated.status,
        date: log.createdAt,
        user: { ...actor, name: authorName },
      };
      io.emit('task_activity', { listId: target.listId, taskId: target.taskId, activity });
      if (target.listId) {
        io.to(`list:${target.listId}`).emit('task_activity', { listId: target.listId, taskId: target.taskId, activity });
      }

      try {
        const rawUsersToNotify = await getStatusChangeRecipients(
          updated.status,
          { id: updated.id, teamId: (before as any).teamId, assigneeId: updated.assigneeId },
          actor.id
        );
        const usersToNotify = await filterUsersByNotificationPreference(rawUsersToNotify, 'status');
        if (usersToNotify.length > 0) {
          await prisma.taskNotification.createMany({
            data: usersToNotify.map((id: any) => ({
              userId: id,
              actorId: actor.id,
              taskId: target.taskId,
              type: 'STATUS_CHANGE',
              title: `${authorName} changed status from ${before?.status} to ${updated.status} on task ${updated.title}`,
            })),
          });
          usersToNotify.forEach((id: any) => {
            io.to(`user:${id}`).emit('notification_received');
          });
        }
      } catch (notifErr) {
        console.error('[sheets.applyStatus] notification error:', notifErr);
      }
    }

    const fullParent = await prisma.task.findUnique({
      where: { id: target.taskId },
      include: {
        subtasks: {
          include: {
            User: { select: { id: true, name: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });
    if (fullParent) {
      io.emit('task:updated', fullParent);
      io.to(`list:${target.listId}`).emit('task:updated', fullParent);
    } else {
      io.emit('task:updated', updated);
      io.to(`list:${target.listId}`).emit('task:updated', updated);
    }
  }

  await invalidateCache(`task:${target.taskId}`, `task:activities:${target.taskId}`, 'tasks:all', 'lists:all', 'spaces:all', 'dashboard:all');
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
    io.emit('task:updated', updated);
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
    io.emit('task:updated', updated);
    io.to(`list:${target.listId}`).emit('task:updated', updated);
  }

  await invalidateCache(`task:${target.taskId}`, 'tasks:all', 'dashboard:all');
  return res.status(200).json({ success: true, assignee: user.name, clickup_link: target.clickUpLink });
}

const NEXUS_APP_URL = (process.env.FRONTEND_URL || 'https://nexus.vipscaleph.com').replace(/\/+$/, '');
const MAX_RESOLVE_LINKS = 500;



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
  return plainTextToCommentHtml(`👤 ${who} | 📅  ${str(datePosted)} | ✏️ ${edited}\n\n${message}`);
}

const commentInclude = { user: { select: { id: true, name: true, avatarUrl: true, email: true } } };

/**
 * getTaskComments serves comments from its own Redis list (comments:list:<task>[:sub:<subtask>]),
 * which invalidateCache(`task:…`) doesn't touch. Without this, a reload kept showing the list
 * from before the sheet wrote the comment.
 */
async function dropCommentCache(taskId: string, subtaskId: string | null) {
  await redis
    .del(`comments:list:${taskId}`, ...(subtaskId ? [`comments:list:${taskId}:sub:${subtaskId}`] : []))
    .catch(() => { });
}

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
    const select = { id: true, taskId: true, subtaskId: true, externalId: true, userId: true, content: true, task: { select: { listId: true } } };
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

      const childReplies = await prisma.taskComment.findMany({
        where: { parentCommentId: existing.id },
        select: { id: true, userId: true, content: true },
      });
      const allDeletedComments = [existing, ...childReplies];
      const allDeletedCommentIds = allDeletedComments.map(c => c.id);

      await prisma.taskComment.delete({ where: { id: existing.id } });

      try {
        const previews = allDeletedComments.map(c => toNotificationPreview(c.content)).filter(Boolean);
        const actorIds = Array.from(new Set(allDeletedComments.map(c => c.userId)));
        const matchingNotifs = await prisma.taskNotification.findMany({
          where: {
            taskId: existing.taskId,
            type: { in: ['MENTION', 'COMMENT', 'REPLY', 'REACTION'] },
            OR: [
              { actorId: { in: actorIds }, content: { in: previews } },
              { userId: { in: actorIds }, content: { in: previews } },
            ],
          },
          select: { id: true, userId: true },
        });

        if (matchingNotifs.length > 0) {
          await prisma.taskNotification.deleteMany({
            where: { id: { in: matchingNotifs.map(n => n.id) } },
          });
          matchingNotifs.forEach(n => {
            io.to(`user:${n.userId}`).emit('notification_cleared', { id: n.id });
            io.to(`user:${n.userId}`).emit('notification_received');
          });
        }

        const commentIdFilters = allDeletedCommentIds.flatMap(id => [
          { details: { path: ['commentId'], equals: id } },
          { details: { path: ['parentCommentId'], equals: id } },
        ]);
        if (commentIdFilters.length > 0) {
          await prisma.auditLog.deleteMany({
            where: {
              action: { in: ['COMMENT', 'REPLY'] },
              OR: commentIdFilters,
            },
          }).catch(() => { });
        }
      } catch (cleanErr) {
        console.error('[sheets:deleteComment] Cleanup error:', cleanErr);
      }

      io.to(`list:${existing.task.listId}`).emit('task:comment_deleted', { taskId: existing.taskId, subtaskId: existing.subtaskId, commentId: existing.id });
      io.emit('task:comment_deleted', { taskId: existing.taskId, subtaskId: existing.subtaskId, commentId: existing.id });
      await invalidateCache(`task:${existing.taskId}`);
      await dropCommentCache(existing.taskId, existing.subtaskId);
      // n8n deletes the ClickUp copy with this.
      return res.status(200).json({ success: true, id: existing.id, clickup_comment_id: existing.externalId });
    }

    if (action !== 'create' && action !== 'update') {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const text = str(body.message);
    if (!text) return res.status(400).json({ error: 'message is required' });
    const content = formatSheetComment(body.name, body.date_posted, text);

    const explicitSubtaskId =
      (typeof body.subtaskId === 'string' && body.subtaskId) ||
      (typeof body.subtask_id === 'string' && body.subtask_id) ||
      undefined;
    const target = await findByNexusLink(link, explicitSubtaskId);

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
        io.emit('task:comment_deleted', { taskId: existing.taskId, subtaskId: existing.subtaskId, commentId: existing.id });
        io.to(`list:${existing.task.listId}`).emit('task:comment_deleted', { taskId: existing.taskId, subtaskId: existing.subtaskId, commentId: existing.id });
        io.emit('task:comment_added', { taskId: target!.taskId, subtaskId: target!.subtaskId, comment });
        io.to(`list:${target!.listId}`).emit('task:comment_added', { taskId: target!.taskId, subtaskId: target!.subtaskId, comment });
        await invalidateCache(`task:${existing.taskId}`, `task:${target!.taskId}`);
        await dropCommentCache(target!.taskId, target!.subtaskId);
      } else {
        io.emit('task:comment_updated', { taskId: existing.taskId, subtaskId: existing.subtaskId, comment });
        io.to(`list:${existing.task.listId}`).emit('task:comment_updated', { taskId: existing.taskId, subtaskId: existing.subtaskId, comment });
        await invalidateCache(`task:${existing.taskId}`);
      }
      await dropCommentCache(existing.taskId, existing.subtaskId);
      const current = target ?? (await findByNexusLink(existing.taskId, existing.subtaskId ?? undefined));
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

    if (!target) {
      console.warn('[Sheets] handleSheetComment: task not found for link:', link);
      return res.status(404).json({
        error: 'Task not found in Nexus',
        receivedLink: link,
        action,
        authorName: body.name,
        hint: 'Ensure task_link or clickup_link is a valid Nexus task URL, Nexus UUID, or ClickUp task link/ID linked to a task in Nexus.',
      });
    }

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

    const log = await prisma.auditLog.create({
      data: {
        action: 'COMMENT',
        entity: 'TASK',
        entityId: target.taskId,
        userId: author.id,
        details: { text: content.trim(), commentId: comment.id, subtaskId: target.subtaskId || null, source: 'sheets' },
      },
    }).catch(() => null);

    const activity = {
      id: log ? log.id : comment.id,
      commentId: comment.id,
      type: 'comment',
      author: author?.name || body.name || 'VIPScale',
      text: content.trim(),
      date: comment.createdAt,
      user: author,
      subtaskId: target.subtaskId || null,
    };

    io.emit('task:comment_added', { taskId: target.taskId, subtaskId: target.subtaskId, comment, activity });
    io.to(`list:${target.listId}`).emit('task:comment_added', { taskId: target.taskId, subtaskId: target.subtaskId, comment, activity });
    io.emit('task_activity', { listId: target.listId, taskId: target.taskId, activity });
    io.to(`list:${target.listId}`).emit('task_activity', { listId: target.listId, taskId: target.taskId, activity });
    await invalidateCache(`task:${target.taskId}`, `task:activities:${target.taskId}`);
    await dropCommentCache(target.taskId, target.subtaskId);
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

/**
 * Robust time string cleaner: formats into "hh:mm AM/PM" or null
 */
function cleanTimeString(val?: unknown): string | null {
  if (!val || typeof val !== 'string') return null;
  const s = val.trim();
  if (!s) return null;

  const ampmMatch = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampmMatch) {
    const hours = parseInt(ampmMatch[1], 10);
    const mins = ampmMatch[2];
    const ampm = ampmMatch[3].toUpperCase();
    const h12 = (hours % 12 || 12).toString().padStart(2, '0');
    return `${h12}:${mins} ${ampm}`;
  }

  const gmtMatch = s.match(/(?:1899|GMT).*?(\d{1,2}):(\d{2})(?::\d{2})?/i);
  if (gmtMatch) {
    const hours = parseInt(gmtMatch[1], 10);
    const mins = gmtMatch[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = (hours % 12 || 12).toString().padStart(2, '0');
    return `${h12}:${mins} ${ampm}`;
  }

  const plainMatch = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (plainMatch) {
    const hours = parseInt(plainMatch[1], 10);
    const mins = plainMatch[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = (hours % 12 || 12).toString().padStart(2, '0');
    return `${h12}:${mins} ${ampm}`;
  }

  return s;
}

/**
 * POST /api/webhooks/sheets/progress
 * Ingests MA Daily Schedule row progress (time in, time out, client, status, is_missing_time, upwork).
 * Emits realtime socket events ('task_map:updated', 'task:progress_updated', 'upwork:status_changed').
 */
export const handleSheetProgress = async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  try {
    const body = req.body || {};
    const {
      task_link,
      taskId,
      task_id,
      ma_name,
      time_in,
      time_out,
      client,
      time_tracker,
      task,
      task_status,
      date,
      sheet_row,
      task_deliverables_description,
      task_update_and_deliverables,
    } = body;

    const cleanTimeIn = cleanTimeString(time_in);
    const cleanTimeOut = cleanTimeString(time_out);
    const clientStr = client ? String(client).trim() : null;
    const statusStr = task_status ? String(task_status).trim() : null;
    const trackerStr = time_tracker ? String(time_tracker).trim() : null;
    const maNameStr = ma_name ? String(ma_name).trim() : null;

    // "if the user forgots to input time only the status or client it would mark as red a and an infinite logo time"
    const hasStatusOrClientOrTask = Boolean(statusStr || clientStr || task);
    const isMissingTime = Boolean(hasStatusOrClientOrTask && !cleanTimeIn);

    // Determine Upwork: Based on configured Upwork clients list, OR if Column H (Time Tracker) explicitly specifies Upwork.
    const upworkClientsList = await getUpworkClients();
    const isConfiguredUpworkClient = clientStr
      ? upworkClientsList.some((c) => c.toLowerCase() === clientStr.toLowerCase())
      : false;
    const isTrackerUpwork = trackerStr ? trackerStr.toLowerCase().includes('upwork') : false;

    let isUpwork = isConfiguredUpworkClient || isTrackerUpwork;

    const link = task_link || taskId || task_id;
    let target = await findByNexusLink(link);
    if (!target && task) {
      // Fallback lookup by exact task title
      const matched = await prisma.task.findFirst({
        where: { title: { equals: String(task).trim(), mode: 'insensitive' } },
        select: { id: true, listId: true, externalId: true },
      });
      if (matched) {
        target = { taskId: matched.id, subtaskId: null, listId: matched.listId, clickUpLink: null };
      }
    }

    // Secondary fallback: if task was not matched by title/link, but client was given, find the client list's active task
    if (!target && clientStr) {
      const clientList = await prisma.list.findFirst({
        where: { name: { equals: clientStr, mode: 'insensitive' } },
        select: { id: true },
      });
      if (clientList) {
        const matched = await prisma.task.findFirst({
          where: {
            listId: clientList.id,
            status: { notIn: ['CLOSED', 'DONE', 'Complete', 'Completed', 'Closed', 'Done'] },
          },
          select: { id: true, listId: true, externalId: true },
          orderBy: { updatedAt: 'desc' },
        });
        if (matched) {
          target = { taskId: matched.id, subtaskId: null, listId: matched.listId, clickUpLink: null };
        }
      }
    }

    if (!target) {
      // If still no target task, but it IS an Upwork tracking row or has MA and Client:
      if (isUpwork) {
        const sessionId = `upwork_${(maNameStr || 'ma').toLowerCase().replace(/\s+/g, '_')}_${(clientStr || 'client').toLowerCase().replace(/\s+/g, '_')}`;
        const effectiveClientName = clientStr || 'UPWORK';
        if (!cleanTimeOut && cleanTimeIn) {
          if (isRedisReady()) {
            await redis.hset(
              'task_map:upwork_active',
              sessionId,
              JSON.stringify({
                taskId: sessionId,
                taskTitle: task || `${effectiveClientName} (Ad-hoc)`,
                userId: '',
                userName: maNameStr || 'MA Member',
                pmName: effectiveClientName,
                clientName: effectiveClientName,
                startedAt: new Date().toISOString(),
              })
            );
          }
          io.emit('upwork:status_changed', {
            taskId: sessionId,
            taskTitle: task || `${effectiveClientName} (Ad-hoc)`,
            active: true,
            userName: maNameStr,
            pmName: effectiveClientName,
            clientName: effectiveClientName,
            startedAt: new Date().toISOString(),
          });
        } else if (cleanTimeOut) {
          if (isRedisReady()) {
            await redis.hdel('task_map:upwork_active', sessionId);
          }
          io.emit('upwork:status_changed', {
            taskId: sessionId,
            taskTitle: task || `${effectiveClientName} (Ad-hoc)`,
            active: false,
            userName: maNameStr,
            pmName: effectiveClientName,
            clientName: effectiveClientName,
          });
        }

        return res.status(200).json({
          success: true,
          isUpwork: true,
          active: !cleanTimeOut && Boolean(cleanTimeIn),
          message: 'Upwork live session tracked without direct task card attachment',
        });
      }

      console.warn('[Sheets] handleSheetProgress: task not found for link/title/client:', link || task || clientStr);
      return res.status(404).json({
        error: 'Task not found in Nexus',
        receivedLink: link,
        taskTitle: task,
        client: clientStr,
      });
    }

    // Get or create TaskMapRecord
    const record = await getOrCreateTaskMapRecord(target.taskId);

    // If task was manually marked as Upwork on TaskMap (project-based), honor it
    const hasManualUpworkTag = (record.statuses || []).some((s: string) => s.toUpperCase().startsWith('UPWORK'));
    if (hasManualUpworkTag) {
      isUpwork = true;
    }

    let reviewsList = record.pmReviews || [];
    if (typeof reviewsList === 'string') {
      try { reviewsList = JSON.parse(reviewsList); } catch { reviewsList = []; }
    }
    if (!Array.isArray(reviewsList)) reviewsList = [];

    // Filter out previous SHEET_PROGRESS entry
    reviewsList = reviewsList.filter((r: any) => r.type !== 'SHEET_PROGRESS');

    const progressObj = {
      type: 'SHEET_PROGRESS',
      timeIn: cleanTimeIn,
      timeOut: cleanTimeOut,
      isMissingTime,
      isUpwork,
      client: clientStr,
      timeTracker: trackerStr,
      maName: maNameStr,
      status: statusStr,
      date: date ? String(date).trim() : null,
      sheetRow: sheet_row ? Number(sheet_row) : undefined,
      taskDeliverables: task_deliverables_description ? String(task_deliverables_description).trim() : null,
      taskUpdateAndDeliverables: task_update_and_deliverables ? String(task_update_and_deliverables).trim() : null,
      updatedAt: new Date().toISOString(),
    };

    reviewsList.push(progressObj);

    // Handle Upwork session tracking if Upwork client/task and in progress (no time_out)
    if (isUpwork) {
      const activeIdx = reviewsList.findIndex((r: any) => r.type === 'UPWORK_SESSION' && r.active);
      const effectiveClientName = clientStr || 'UPWORK';
      if (!cleanTimeOut) {
        if (activeIdx >= 0) {
          reviewsList[activeIdx].userName = maNameStr || reviewsList[activeIdx].userName;
          reviewsList[activeIdx].clientName = effectiveClientName;
        } else {
          reviewsList.push({
            type: 'UPWORK_SESSION',
            active: true,
            taskId: target.taskId,
            taskTitle: task || 'Task',
            userId: '',
            userName: maNameStr || 'MA Member',
            pmName: effectiveClientName,
            clientName: effectiveClientName,
            startedAt: new Date().toISOString(),
          });
        }

        if (isRedisReady()) {
          redis.hset(
            'task_map:upwork_active',
            target.taskId,
            JSON.stringify({
              taskId: target.taskId,
              taskTitle: task || 'Task',
              userId: '',
              userName: maNameStr || 'MA Member',
              pmName: effectiveClientName,
              clientName: effectiveClientName,
              startedAt: progressObj.updatedAt,
            })
          ).catch(() => {});
        }

        io.emit('upwork:status_changed', {
          taskId: target.taskId,
          taskTitle: task || 'Task',
          active: true,
          userName: maNameStr || 'MA Member',
          pmName: effectiveClientName,
          clientName: effectiveClientName,
          startedAt: progressObj.updatedAt,
        });
      } else if (cleanTimeOut) {
        if (activeIdx >= 0) {
          reviewsList[activeIdx].active = false;
          reviewsList[activeIdx].stoppedAt = new Date().toISOString();
        }
        if (isRedisReady()) {
          redis.hdel('task_map:upwork_active', target.taskId).catch(() => {});
        }

        io.emit('upwork:status_changed', {
          taskId: target.taskId,
          taskTitle: task || 'Task',
          active: false,
          userName: maNameStr,
          pmName: effectiveClientName,
          clientName: effectiveClientName,
        });
      }
    }

    // Save back to TaskMapRecord
    await updateTaskMapRecord(target.taskId, { pmReviews: reviewsList });

    // Invalidate caches
    await invalidateCache(`task:${target.taskId}`, 'task-map:data');

    // Emit Realtime WebSockets so TaskMapContainer and BoardView update immediately
    io.emit('task_map:updated', {
      taskId: target.taskId,
      taskMap: {
        statuses: record.statuses,
      },
      progress: progressObj,
    });
    io.emit('task:progress_updated', {
      taskId: target.taskId,
      progress: progressObj,
    });

    if (isUpwork) {
      io.emit('upwork:status_changed', {
        taskId: target.taskId,
        taskTitle: task || 'Task',
        active: !cleanTimeOut,
        userName: maNameStr,
        pmName: clientStr || 'UPWORK',
        clientName: clientStr,
        startedAt: progressObj.updatedAt,
      });
    }

    return res.status(200).json({
      success: true,
      taskId: target.taskId,
      progress: progressObj,
    });
  } catch (error: any) {
    console.error('[Sheets] progress failed:', error);
    return res.status(500).json({ error: error.message });
  }
};
