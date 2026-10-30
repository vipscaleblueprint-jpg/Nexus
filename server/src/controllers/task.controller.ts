import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { getR2PresignedUrl } from '../services/r2Service';
import { getCache, setCache, invalidateCache, getCacheGeneration } from '../services/redisService';
import { redis } from '../config/redis';
import { taskUpdatesQueue } from '../queues/task.queue';
import { getPositionAfter } from '../services/taskOrderService';
import { io } from '../server';
import {
  safeCreateClickUpTask,
  safeUpdateClickUpTask,
  safeDeleteClickUpTask,
  safeCreateClickUpComment,
  safeUpdateClickUpComment,
  uploadClickUpTaskAttachment,
  safeCreateClickUpChecklist,
  safeUpdateClickUpChecklist,
  safeDeleteClickUpChecklist,
  safeCreateClickUpChecklistItem,
  safeUpdateClickUpChecklistItem,
  safeDeleteClickUpChecklistItem,
  safeCreateClickUpSubtask,
  safeSyncClickUpAssignees,
  resolveClickUpAssigneeIds,
  findClickUpChecklistByName,
  findClickUpSubtaskByName,
  mapNexusStatusToClickUp,
  mapNexusPriorityToClickUp,
  extractClickUpTaskId,
  resolveClickUpListId,
} from '../services/clickupService';
import { convertCommentHtmlToClickUp, fetchImageBuffer } from '../utils/clickupCommentConverter';
import { isNexusAuditChecklist, isAiAuditChecklist, getAiPickedAudits, requiresClosedSubtasks, requiresCompletedAudits, normalizeAuditName } from '../utils/auditChecklist';
import { extractMentionedUserIds, notifyMentionedUsers, toNotificationPreview } from '../utils/mentionNotification';
import { appendTaskToJournal, NEW_TASK_BADGE } from '../utils/pageBlocks';
import { canUserSetAssignees, getAssignDeniedMessage } from '../utils/assignPermission';
import { updatePageBlocks } from '../services/pageContentService';
import { injectSubtaskIntoJournal } from '../services/journalInjectionService';
import {
  getStatusChangeRecipients,
  getChecklistCheckRecipients,
  isAuditItem,
  formatChecklistNotificationTitle,
} from '../utils/roleNotification';
import { duplicateRecurringTask, runRecurringDailyRollover } from '../services/recurringTaskService';
import { filterUsersByNotificationPreference, shouldUserReceiveNotification } from '../utils/notificationPreferences';

// In-memory maps: nexus ID -> ClickUp ID (avoids needing a DB migration)
const cuChecklistIdMap = new Map<string, string>(); // nexusChecklistId -> cuChecklistId
const cuChecklistItemIdMap = new Map<string, { cuChecklistId: string; cuItemId: string }>(); // nexusItemId -> { cuChecklistId, cuItemId }
const cuSubtaskIdMap = new Map<string, string>(); // nexusSubtaskId -> cuSubtaskId


// TEMPORARY TOGGLE: Hide Design Audit per user request until process is finalized. Set to false to restore.
const HIDE_DESIGN_AUDIT = true;

export const getRequiredAudits = (taskTitle: string, auditorRoles?: string[]) => {
  const t = taskTitle.toLowerCase();
  const audits = new Set<string>();

  // Every task must pass an Instructions Audit globally
  audits.add('Instructions Audit');

  // Whatever auditor role was actually assigned determines the required audit item directly,
  // regardless of what the task title says.
  (auditorRoles || []).forEach((role) => {
    const r = role.toLowerCase();
    if (r.includes('ui') || r.includes('ux')) audits.add('UI UX Audit');
    if (!HIDE_DESIGN_AUDIT && r.includes('design')) audits.add('Design Audit');
    if (r.includes('funnel') || r.includes('backend')) audits.add('Funnel Audit');
  });

  // 1. Graphics, Reels, Video, Samples -> ONLY Design
  if (!HIDE_DESIGN_AUDIT && t.match(/graphic|reel|video|sample/)) {
    audits.add('Design Audit');
  }

  // 2. Newsletters, Emails, Social Media Packages -> Design + Funnel
  if (t.match(/email|newsletter|social media/)) {
    if (!HIDE_DESIGN_AUDIT) audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  // 3. Websites, Links, Landing Pages -> ALL THREE
  if (t.match(/website|page|funnel|link/)) {
    audits.add('UI UX Audit');
    if (!HIDE_DESIGN_AUDIT) audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  return Array.from(audits);
};

export const taskInclude = {
  subtasks: {
    orderBy: { createdAt: 'asc' } as any,
    include: {
      User: { select: { id: true, name: true, email: true, avatarUrl: true } },
      assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
      team: { select: { id: true, name: true, color: true } },
      // Only the count: every subtask's full comment thread made each task payload (and the
      // all-tasks list) huge. The UI loads a subtask's comments on demand via GET /:id/comments.
      _count: { select: { comments: true } },
      checklists: {
        orderBy: { createdAt: 'asc' } as any,
        include: {
          items: {
            orderBy: { createdAt: 'asc' } as any,
            include: { checkedBy: { select: { id: true, name: true, avatarUrl: true } } }
          }
        }
      },
    }
  },
  // Stable order so the same Audit checklist is picked on every load.
  checklists: {
    where: { subtaskId: null },
    orderBy: { createdAt: 'asc' } as any,
    include: {
      items: {
        orderBy: { createdAt: 'asc' } as any,
        include: { checkedBy: { select: { id: true, name: true, avatarUrl: true } } }
      }
    }
  },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
  creator: { select: { id: true, name: true, email: true } },
  list: {
    select: {
      id: true,
      name: true,
      space: { select: { id: true, name: true } },
      folder: { select: { id: true, name: true } },
    },
  },
  team: { select: { id: true, name: true, color: true } },
  attachments: true,
};

// Identical listTasks queries already running, keyed by cache key. The all-tasks query is slow, and
// several pages (dashboard, docs) plus their reloads request it at once — they share one query.
const listTasksInFlight = new Map<string, Promise<any[]>>();

// GET /api/tasks - Redis Cache-Aside
export async function listTasks(req: Request, res: Response) {
  try {
    const { listId, assigneeId, status, lightweight } = req.query as Record<string, string | undefined>;
    const cacheKey = `tasks:all:${listId || 'all'}:${assigneeId || 'all'}:${status || 'all'}:${lightweight || 'false'}`;

    const cachedTasks = await getCache<any[]>(cacheKey);
    if (cachedTasks) {
      return res.json({ tasks: cachedTasks, cached: true });
    }

    // Keyed by cache generation too: a request made after a change must not join a query that started before it
    const generation = getCacheGeneration(cacheKey);
    const inFlightKey = `${cacheKey}@${generation}`;
    let pending = listTasksInFlight.get(inFlightKey);
    if (!pending) {
      pending = queryListTasks({ listId, assigneeId, status, lightweight }, cacheKey, generation).finally(() => {
        listTasksInFlight.delete(inFlightKey);
      });
      listTasksInFlight.set(inFlightKey, pending);
    }
    const tasks = await pending;

    return res.json({ tasks, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

async function queryListTasks(
  { listId, assigneeId, status, lightweight }: Record<string, string | undefined>,
  cacheKey: string,
  generation: string,
) {
    const startedAt = Date.now();
    const tasks = await prisma.task.findMany({
      where: {
        ...(listId ? { listId } : {}),
        ...(status ? { status } : {}),
        ...(assigneeId
          ? {
              OR: [
                { assigneeId },
                { assignees: { some: { id: assigneeId } } },
              ],
            }
          : {}),
      },
          include: lightweight === 'true' 
        ? {
            assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true } },
            team: { select: { id: true, name: true, color: true } },
            list: { select: { id: true, name: true, space: { select: { id: true, name: true } }, folder: { select: { id: true, name: true } } } },
            // Card-level subtask fields so the dashboard can list subtasks as their own rows
            subtasks: {
              orderBy: { createdAt: 'asc' } as any,
              select: {
                id: true, title: true, status: true, completed: true, priority: true, dueDate: true,
                createdAt: true, assigneeId: true, assigneeRoleRestrictions: true, taskId: true,
                assignees: { select: { id: true, name: true, email: true, avatarUrl: true } },
              },
            },
            _count: { select: { subtasks: true, comments: true, attachments: true } },
          }
        : taskInclude,
      orderBy: { createdAt: 'desc' },
    });
    console.log(`[API] listTasks db query: ${((Date.now() - startedAt) / 1000).toFixed(3)}s (${tasks.length} tasks)`);

    // Lightweight all-tasks query: cache for 5 minutes. With 1200+ tasks this query
    // takes 12–20s cold — the cache is the primary performance mechanism here.
    // Full taskInclude: cache for 5 minutes too (heavier but less frequent).
    await setCache(cacheKey, tasks, 300, generation);
    return tasks;
}

// GET /api/tasks/:id - Redis Cache-Aside
export async function getTask(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const cacheKey = `task:${taskId}`;

    const cachedTask = await getCache<any>(cacheKey);
    if (cachedTask) {
      return res.json({ task: cachedTask, cached: true });
    }

    const generation = getCacheGeneration(cacheKey);
    let task = await prisma.task.findUnique({
      where: { id: taskId },
      include: taskInclude,
    });

    let foundSubtask = null;
    if (!task) {
      foundSubtask = await prisma.subtask.findUnique({
        where: { id: taskId },
        include: {
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
          team: { select: { id: true, name: true, color: true } }
        }
      });
      if (foundSubtask) {
        task = await prisma.task.findUnique({
          where: { id: foundSubtask.taskId },
          include: taskInclude,
        });
      }
    }

    // Fallback: check by externalId (e.g. ClickUp task ID or URL)
    if (!task && !foundSubtask) {
      task = await prisma.task.findFirst({
        where: {
          OR: [
            { externalId: taskId },
            { externalId: { endsWith: `/${taskId}` } },
            { externalId: `https://app.clickup.com/t/${taskId}` },
          ],
        },
        include: taskInclude,
      });

      if (!task) {
        foundSubtask = await prisma.subtask.findFirst({
          where: {
            OR: [
              { externalId: taskId },
              { externalId: { endsWith: `/${taskId}` } },
              { externalId: `https://app.clickup.com/t/${taskId}` },
            ],
          },
          include: {
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
            team: { select: { id: true, name: true, color: true } },
          },
        });
        if (foundSubtask) {
          task = await prisma.task.findUnique({
            where: { id: foundSubtask.taskId },
            include: taskInclude,
          });
        }
      }
    }

    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.json({ task, subtask: foundSubtask, cached: false });
    // Cache under the actual task ID, not the requested ID (in case it was a subtask ID) — after responding,
    // since the modal waits on this request
    setCache(`task:${task.id}`, task, 300, generation).catch(() => {});
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/batch - fetch many tasks in one round trip (used by docs with many task mentions).
// Returns results keyed by the requested ID, each shaped like GET /api/tasks/:id ({ task, subtask }).
// Uses a lean select — batch calls come from doc task-mention nodes that only need title, status,
// priority, assignees and list context for the inline chip. Full taskInclude here caused 6–13s responses.
const batchTaskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  listId: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  assigneeId: true,
  teamId: true,
  description: true,
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  assignees: { select: { id: true, name: true, email: true, avatarUrl: true } },
  team: { select: { id: true, name: true, color: true } },
  list: { select: { id: true, name: true, space: { select: { id: true, name: true } }, folder: { select: { id: true, name: true } } } },
  _count: { select: { subtasks: true, comments: true, attachments: true } },
};

export async function batchGetTasks(req: Request, res: Response) {
  try {
    const ids: string[] = Array.from(new Set(req.body.ids as string[]));
    const results: Record<string, { task: any; subtask: any }> = {};

    // 1. Serve what we can from cache
    const cached = await Promise.all(ids.map(id => getCache<any>(`task:${id}`)));
    const missing: string[] = [];
    ids.forEach((id, i) => {
      if (cached[i]) results[id] = { task: cached[i], subtask: null };
      else missing.push(id);
    });

    if (missing.length > 0) {
      const generation = getCacheGeneration('task:');
      // 2. Missing IDs as tasks, in one query — lean select instead of full taskInclude
      const tasks = await prisma.task.findMany({ where: { id: { in: missing } }, select: batchTaskSelect as any });
      const taskById = new Map(tasks.map((t: any) => [t.id, t]));

      // 3. Whatever is left may be subtask IDs — resolve to their parent task
      const stillMissing = missing.filter(id => !taskById.has(id));
      const subtasks = stillMissing.length > 0
        ? await prisma.subtask.findMany({
            where: { id: { in: stillMissing } },
            include: {
              assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
              team: { select: { id: true, name: true, color: true } },
            },
          })
        : [];
      const parentIds = Array.from(new Set(subtasks.map((s: any) => s.taskId))).filter((id: any) => !taskById.has(id));
      if (parentIds.length > 0) {
        const parents = await prisma.task.findMany({ where: { id: { in: parentIds as string[] } }, select: batchTaskSelect as any });
        parents.forEach((p: any) => taskById.set(p.id, p));
      }

      missing.forEach(id => {
        const task = taskById.get(id);
        if (task) results[id] = { task, subtask: null };
      });
      subtasks.forEach((s: any) => {
        const parent = taskById.get(s.taskId);
        if (parent) results[s.id] = { task: parent, subtask: s };
      });

      // Warm the per-task cache without blocking the response
      Promise.all(Array.from(taskById.values()).map((t: any) => setCache(`task:${t.id}`, t, 60, generation))).catch(() => {});
    }

    return res.json({ results });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks
export async function createTask(req: Request, res: Response) {
  try {
    const {
      title, description, status, priority, listId,
      assigneeId, assigneeIds, teamId, creatorId, dueDate, startDate,
      assigneeRoleRestrictions, teamAssignAccessRole, afterTaskId,
      recurringConfig,
    } = req.body;

    let computedAssigneeIds = assigneeIds;
    if (assigneeRoleRestrictions && assigneeRoleRestrictions.length > 0 && (!assigneeIds || assigneeIds.length === 0) && !assigneeId) {
      computedAssigneeIds = await resolveUsersFromRoles(assigneeRoleRestrictions);
    }
    const effectiveAssigneeId = (computedAssigneeIds && computedAssigneeIds.length > 0) ? computedAssigneeIds[0] : (assigneeId || null);
    const position = afterTaskId ? await getPositionAfter(listId, afterTaskId) : null;

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status: status || 'TODO',
        priority: priority || 'MEDIUM',
        listId,
        assigneeId: effectiveAssigneeId,
        ...(computedAssigneeIds && computedAssigneeIds.length > 0
          ? { assignees: { connect: computedAssigneeIds.map((id: string) => ({ id })) } }
          : assigneeId
          ? { assignees: { connect: [{ id: assigneeId }] } }
          : {}),
        teamId: teamId || null,
        creatorId,
        dueDate: dueDate ? new Date(dueDate) : null,
        startDate: startDate ? new Date(startDate) : null,
        assigneeRoleRestrictions: assigneeRoleRestrictions || [],
        teamAssignAccessRole: teamAssignAccessRole || null,
        recurringConfig: recurringConfig || null,
        position,
      },
      include: taskInclude,
    });

    await invalidateCache('tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

    // Global broadcast reaches list-room members too, so a separate room emit would deliver it twice
    io.emit('task:created', task);
    res.status(201).json({ task });

    // Notify the assignees a task was created for (the creator excluded) — after the broadcast/response
    (async () => {
      const actingUserId = (req as any).user?.id || creatorId;
      const rawAssigneeIds = (task.assignees ?? []).map((a: any) => a.id).filter((id: string) => id !== actingUserId);
      if (!actingUserId || rawAssigneeIds.length === 0) return;
      const assigneeIdsToNotify = await filterUsersByNotificationPreference(rawAssigneeIds, 'assigned');
      if (assigneeIdsToNotify.length === 0) return;
      const actor = await prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } });
      await prisma.taskNotification.createMany({
        data: assigneeIdsToNotify.map((id: string) => ({
          userId: id,
          actorId: actingUserId,
          taskId: task.id,
          type: 'ASSIGNMENT',
          title: `${actor?.name || 'Someone'} assigned you to task ${task.title}`,
        })),
      });
      assigneeIdsToNotify.forEach((id: string) => {
        io.to(`user:${id}`).emit('notification_received');
      });
    })().catch((err) => console.error('createTask: assignment notifications failed:', err));

    // Duplicate recurring task to PENDING immediately upon creation if set time is provided
    if (recurringConfig && recurringConfig.time) {
      duplicateRecurringTask(task.id).catch((err) =>
        console.error('createTask: immediate recurring duplication failed:', err)
      );
    }

    // Backend injection into Daily Rollover doc — after the broadcast/response, so boards see the new card
    // without waiting on the journal's page reads and write. Journal viewers get it via page_updated.
    (async () => {
      const docs = await prisma.doc.findMany({ where: { isDailyRollover: true } });
      for (const doc of docs) {
        try {
          const tz = doc.rolloverTimezone || 'Asia/Singapore';
          const dateObj = new Date();
          const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' });
          const monthTitle = monthFormatter.format(dateObj);
          const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' });
          const dayTitle = dayFormatter.format(dateObj);

          const monthPage = await prisma.page.findFirst({ where: { docId: doc.id, title: monthTitle, parentPageId: null } });
          if (!monthPage) continue;

          const dayPage = await prisma.page.findFirst({ where: { docId: doc.id, title: dayTitle, parentPageId: monthPage.id } });
          if (!dayPage) continue;

          const clientName = task.list?.name || 'Unknown Client';
          const escapedTitle = task.title.replace(/"/g, '&quot;');
          const statusColor = '#3b82f6';
          const taskStatusStr = JSON.stringify({ name: task.status, color: statusColor }).replace(/"/g, '&quot;');
          const assigneesStr = JSON.stringify(task.assignees || []).replace(/"/g, '&quot;');

          const written = await updatePageBlocks(dayPage, (blocks) => {
            appendTaskToJournal(blocks, clientName, {
              id: `blk-t-${Date.now()}-${task.id}`,
              type: 'text',
              content: `<p><span data-type="mention" data-id="${task.id}" data-label="${escapedTitle}" data-mention-type="task" data-task-status="${taskStatusStr}" data-task-assignees="${assigneesStr}" data-task-list-name="${clientName}">@${escapedTitle}</span> ${NEW_TASK_BADGE}</p>`
            });
          });

          if (written) io.to(`doc:${doc.id}`).emit('page_updated', { pageId: dayPage.id });
        } catch (err) {
          console.error('Failed to inject task into daily rollover:', err);
        }
      }
    })().catch((err) => console.error('Failed to inject task into daily rollover:', err));

    // --- ClickUp Sync (fire-and-forget) ---
    // Look up whether the target Nexus list is mapped to a ClickUp list
    (async () => {
      try {
        const nexusList = await prisma.list.findUnique({
          where: { id: listId },
          select: { externalId: true, clickUpListId: true }
        });
        const clickUpListId = resolveClickUpListId(nexusList);

        if (clickUpListId) {
          const cuAssigneeIds = await resolveClickUpAssigneeIds((task.assignees ?? []).map((a) => a.email));
          const cuPayload = {
            name: task.title,
            description: task.description ?? undefined,
            status: mapNexusStatusToClickUp(task.status),
            priority: mapNexusPriorityToClickUp(task.priority),
            ...(task.dueDate ? { due_date: new Date(task.dueDate).getTime() } : {}),
            ...(task.startDate ? { start_date: new Date(task.startDate).getTime() } : {}),
            ...(cuAssigneeIds.length > 0 ? { assignees: cuAssigneeIds } : {}),
          };
          const clickUpTaskId = await safeCreateClickUpTask(clickUpListId, cuPayload);
          if (clickUpTaskId) {
            // Persist the ClickUp task ID on the Nexus task for future syncs
            await prisma.task.update({
              where: { id: task.id },
              data: { externalId: clickUpTaskId } as any,
            }).catch(console.error);
          }
        }
      } catch (err) {
        console.error('[ClickUp] createTask sync error:', err);
      }
    })();
  } catch (err: any) {
    if (res.headersSent) return console.error('createTask error after response:', err);
    return res.status(500).json({ error: err.message });
  }
}

// Helper to enforce that only users with allowed roles (or Admins) can move a task OUT of a restricted status
async function checkCanMoveFromStatus(
  taskId: string,
  newStatus: string,
  currentListId: string | undefined,
  authReqUser: any
): Promise<{ allowed: boolean; error?: string }> {
  try {
    const currentTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, listId: true },
    });

    if (!currentTask || currentTask.status === newStatus) {
      return { allowed: true };
    }

    const effectiveListId = currentListId || currentTask.listId;
    if (!effectiveListId) {
      return { allowed: true };
    }

    const sourceStatusRule = await prisma.listStatus.findFirst({
      where: {
        listId: effectiveListId,
        name: { equals: currentTask.status, mode: 'insensitive' },
      },
    });

    if (!sourceStatusRule || sourceStatusRule.allowedRoles.length === 0) {
      return { allowed: true };
    }

    if (!authReqUser) {
      return { allowed: false, error: `Authentication required to move tasks from "${currentTask.status}".` };
    }

    const user = await prisma.user.findUnique({
      where: { id: authReqUser.id },
      select: { roles: true, systemRole: true },
    });

    const isAdmin =
      (user && user.systemRole === 'ADMIN') ||
      (user && user.roles[0]?.trim().toUpperCase() === 'ADMIN') ||
      (authReqUser.systemRole === 'ADMIN');

    if (isAdmin) {
      return { allowed: true };
    }

    if (!user) {
      return { allowed: false, error: 'User not found' };
    }

    const workspaceRoles = await prisma.workspaceRole.findMany();
    const allowedNames = sourceStatusRule.allowedRoles.map((r: any) => {
      const match = workspaceRoles.find((wr: any) => wr.id === r || wr.name.toUpperCase() === r.toUpperCase());
      return match ? match.name.toUpperCase() : r.toUpperCase();
    });

    const userRoles = user.roles
      .filter(Boolean)
      .map((r: string) => r.trim().toUpperCase());

    const hasAccess = allowedNames.some((r: any) => userRoles.includes(r));
    if (!hasAccess) {
      return {
        allowed: false,
        error: `Tasks in "${currentTask.status}" can only be moved or changed by: ${allowedNames.join(', ')}. Admins also have full access.`,
      };
    }

    return { allowed: true };
  } catch (err) {
    return { allowed: true };
  }
}

export function normalizeRoleName(role: string): string {
  if (!role) return '';
  return role
    .trim()
    .toLowerCase()
    .replace(/\baudits\b/g, 'audit')
    .replace(/\bauditors\b/g, 'audit')
    .replace(/\bauditor\b/g, 'audit')
    .replace(/s\b/g, '');
}

export function matchesRole(userRole: string, targetRole: string): boolean {
  if (!userRole || !targetRole) return false;
  const u = userRole.trim().toLowerCase();
  const t = targetRole.trim().toLowerCase();
  if (u === t) return true;
  return normalizeRoleName(u) === normalizeRoleName(t);
}

async function resolveUsersFromRoles(roleRestrictions: string[]): Promise<string[]> {
  if (!roleRestrictions || roleRestrictions.length === 0) return [];
  const [users, teams] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, roles: true, systemRole: true, teamId: true }
    }),
    prisma.team.findMany({
      select: { id: true, name: true }
    })
  ]);

  const teamNameToTeamId = new Map<string, string>();
  teams.forEach(t => {
    if (t.name) teamNameToTeamId.set(t.name.trim().toLowerCase(), t.id);
  });

  return users.filter(u => {
    const userRoles = u.roles || [];
    return roleRestrictions.some(role => {
      // 1. Direct role match on user roles
      if (userRoles.some(ur => matchesRole(ur, role))) return true;
      // 2. System role match
      if (u.systemRole && matchesRole(u.systemRole, role)) return true;
      // 3. Whole team name match
      const matchedTeamId = teamNameToTeamId.get(role.trim().toLowerCase());
      if (matchedTeamId && u.teamId === matchedTeamId) return true;
      return false;
    });
  }).map(u => u.id);
}

// PATCH /api/tasks/:id
export async function updateTask(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const authReq = req as any;
    const {
      title, description, status, priority,
      listId, assigneeId, assigneeIds, teamId, dueDate, startDate, currentListId, userId,
      assigneeRoleRestrictions, teamAssignAccessRole, recurringConfig,
    } = req.body;
    const effectiveUser = authReq.user || (userId ? { id: userId } : null);

    // Only Project Managers and Admins can set Team Role / Assignees (checked against the DB, not the token)
    const changesAssignment = assigneeIds !== undefined || assigneeId !== undefined || assigneeRoleRestrictions !== undefined;
    if (changesAssignment && !(await canUserSetAssignees(authReq.user?.id))) {
      return res.status(403).json({ error: await getAssignDeniedMessage() });
    }

    // Status lock is now open to all, only audit checklist completion is checked later.

    const currentTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        teamId: true,
        assigneeId: true,
        listId: true,
        creatorId: true,
        externalId: true,
        assignees: { select: { id: true, name: true, email: true } },
        assigneeRoleRestrictions: true,
        checklists: { where: { subtaskId: null }, include: { items: true } },
        subtasks: { include: { checklists: { include: { items: true } } } },
      },
    });

    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (status !== undefined) {
      // In Review: only subtasks must be Closed (auditing happens during review)
      if (requiresClosedSubtasks(status)) {
        const hasUnclosedSubtasks = currentTask.subtasks.some((st: any) => {
          if ((st.title || '').trim().toLowerCase().startsWith('--audit')) return false;
          const s = (st.status || '').toLowerCase();
          return s !== 'closed' && s !== 'done' && !st.completed;
        });
        if (hasUnclosedSubtasks) {
          return res.status(400).json({ error: `Cannot move to ${status}: All subtasks must be Closed first.` });
        }
      }

      // Completion statuses: required audits must also be checked
      if (requiresCompletedAudits(status)) {
        const auditorRoles = [
          ...((currentTask as any).assigneeRoleRestrictions || []),
          ...(currentTask.subtasks || [])
            .filter((s: any) => s.title?.toLowerCase().startsWith('--audit'))
            .flatMap((s: any) => (s as any).assigneeRoleRestrictions || []),
        ];
        const auditChecklists = (currentTask.checklists || []).filter((c: any) => isNexusAuditChecklist(c));
        const allItems = auditChecklists.flatMap((c: any) => c.items || []);
        const excludedAudits = new Set(
          allItems
            .filter((i: any) => (i.text || '').startsWith('!'))
            .map((i: any) => normalizeAuditName((i.text || '').slice(1)))
        );
        const activeItems = allItems
          .filter((i: any) => !(i.text || '').startsWith('!'))
          .map((i: any) => i.text);
        // Audits the Galaxy AI picked replace the role/title rules (saved items and exclusions still apply).
        const requiredTaskAudits = Array.from(new Set([
          ...(getAiPickedAudits(currentTask.checklists) ? [] : getRequiredAudits(currentTask.title, auditorRoles)),
          ...activeItems,
        ])).filter(r => !r.startsWith('!') && !excludedAudits.has(normalizeAuditName(r)) && (!HIDE_DESIGN_AUDIT || normalizeAuditName(r) !== 'design audit'));

        const completedTexts = new Set(
          allItems
            .filter((i: any) => i.completed && !i.text.startsWith('!'))
            .map((i: any) => normalizeAuditName(i.text))
        );
        const unchecked = requiredTaskAudits.filter(r => !completedTexts.has(normalizeAuditName(r)));
        if (unchecked.length > 0) {
          return res.status(400).json({ error: `Cannot move to ${status}: Required audits are not completed (${unchecked.join(', ')}).` });
        }
      }
    }

    const updateData: any = {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(listId !== undefined ? { listId } : {}),
      ...(teamId !== undefined ? { teamId } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(assigneeRoleRestrictions !== undefined ? { assigneeRoleRestrictions } : {}),
      ...(teamAssignAccessRole !== undefined ? { teamAssignAccessRole } : {}),
      ...(recurringConfig !== undefined ? { recurringConfig } : {}),
      // Ensure undefined fields are stripped out completely
    };

    let computedAssigneeIds = assigneeIds;
    if (assigneeRoleRestrictions !== undefined && assigneeIds === undefined && assigneeId === undefined) {
      computedAssigneeIds = await resolveUsersFromRoles(assigneeRoleRestrictions);
    }

    if (computedAssigneeIds !== undefined) {
      updateData.assignees = { set: computedAssigneeIds.map((id: string) => ({ id })) };
      updateData.assigneeId = computedAssigneeIds.length > 0 ? computedAssigneeIds[0] : null;
    } else if (assigneeId !== undefined) {
      updateData.assigneeId = assigneeId || null;
      updateData.assignees = assigneeId ? { set: [{ id: assigneeId }] } : { set: [] };
    }

    // Immediately persist to DB without heavy includes for realtime speed
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });

    // Manually construct the payload for frontend to merge efficiently
    const payload = { ...updated } as any;
    if (computedAssigneeIds !== undefined || assigneeId !== undefined) {
      const idsToFetch = computedAssigneeIds !== undefined ? computedAssigneeIds : (assigneeId ? [assigneeId] : []);
      if (idsToFetch.length > 0) {
        payload.assignees = await prisma.user.findMany({
          where: { id: { in: idsToFetch } },
          select: { id: true, name: true, email: true, avatarUrl: true, roles: true }
        });
      } else {
        payload.assignees = [];
      }
      payload.assigneeIds = idsToFetch;
      payload.assignee = payload.assignees[0] || null;
    } else {
      payload.assignees = currentTask.assignees || [];
      payload.assigneeIds = (currentTask.assignees || []).map((a: any) => a.id);
      payload.assignee = (currentTask.assignees && currentTask.assignees.length > 0) ? currentTask.assignees[0] : null;
    }
    
    if (teamId !== undefined) {
      payload.team = teamId ? await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true, color: true }
      }) : null;
    }
    // Invalidate Redis cache immediately BEFORE socket emit and HTTP response
    await invalidateCache(`task:${taskId}`, `task:activities:${taskId}`, 'tasks:all', 'dashboard:all', 'lists:all').catch(() => {});

    // Broadcast IMMEDIATELY after update
    const roomListId = listId || currentListId || currentTask.listId;
    // Global broadcast so dashboards and other lists update in real-time (list-room members receive it too)
    io.emit('task:updated', payload);

    // Return the response immediately so the client doesn't wait
    res.json({ task: payload, queued: true });

    // When set time was added or updated, immediately create a duplicate in PENDING
    if (recurringConfig && recurringConfig.time) {
      duplicateRecurringTask(taskId).catch((err) =>
        console.error('updateTask: immediate recurring duplication failed:', err)
      );
    }

    // Invalidate activity + task cache in the background (status/priority/assignment write an AuditLog)
    invalidateCache(`task:activities:${taskId}`, `task:${taskId}`).catch(() => {});

    // --- ClickUp Sync (fire-and-forget) ---
    (async () => {
      try {
        const clickUpTaskId = currentTask.externalId ?? null;
        if (clickUpTaskId) {
          const cuPayload: Record<string, any> = {};
          if (title !== undefined) cuPayload.name = title;
          if (description !== undefined) cuPayload.description = description;
          if (status !== undefined) cuPayload.status = mapNexusStatusToClickUp(status);
          if (priority !== undefined) cuPayload.priority = mapNexusPriorityToClickUp(priority);
          if (dueDate !== undefined) cuPayload.due_date = dueDate ? new Date(dueDate).getTime() : null;
          if (startDate !== undefined) cuPayload.start_date = startDate ? new Date(startDate).getTime() : null;
          if (Object.keys(cuPayload).length > 0) {
            console.log(`[ClickUp Debug] Syncing updateTask payload for ${clickUpTaskId}:`, cuPayload);
            await safeUpdateClickUpTask(clickUpTaskId, cuPayload);
            console.log(`[ClickUp Debug] Sync success for updateTask ${clickUpTaskId}`);
          }
          // Assignees (incl. ones resolved from role restrictions) — matched to ClickUp members by email
          if (computedAssigneeIds !== undefined || assigneeId !== undefined) {
            await safeSyncClickUpAssignees(
              clickUpTaskId,
              currentTask.assignees.map((a) => a.email),
              ((payload.assignees ?? []) as Array<{ email?: string | null }>).map((a) => a.email),
            );
          }
        }
      } catch (err: any) {
        console.error('[ClickUp Debug] updateTask sync error:', err?.response?.data || err?.message || err);
      }
    })();

    // Background Processing: Cache Invalidation & Audit Logs
    invalidateCache(`task:${taskId}`, 'tasks:all', 'dashboard:all', 'lists:all').catch(console.error);

    const actingUserId = effectiveUser?.id || (await prisma.user.findFirst())?.id;
    if (actingUserId) {
      (async () => {
        try {
          const user = await prisma.user.findUnique({
            where: { id: actingUserId },
            select: { id: true, name: true, avatarUrl: true, email: true },
          });
          let activity: any = null;

          const emitActivity = (act: any) => {
            io.emit('task_activity', { listId: roomListId, taskId, activity: act });
          };

          // Title changes are logged independently so they still show up when sent alongside other fields
          if (typeof title === 'string' && title !== currentTask.title) {
            const titleLog = await prisma.auditLog.create({
              data: {
                action: 'TITLE_CHANGE',
                entity: 'TASK',
                entityId: taskId,
                userId: actingUserId,
                details: { oldTitle: currentTask.title, newTitle: title },
              },
            });

            const titleUsersToNotify = currentTask.assignees
              .map((a: any) => a.id)
              .filter((id: any) => id !== actingUserId);
            if (titleUsersToNotify.length > 0) {
              await prisma.taskNotification.createMany({
                data: titleUsersToNotify.map((id: any) => ({
                  userId: id,
                  actorId: actingUserId,
                  taskId,
                  type: 'TITLE_CHANGE',
                  title: `${user?.name || 'Someone'} renamed "${currentTask.title}" to "${title}"`,
                })),
              });
              titleUsersToNotify.forEach((id: any) => {
                io.to(`user:${id}`).emit('notification_received');
              });
            }

            emitActivity({
              id: titleLog.id,
              type: 'title_change',
              author: user?.name || 'Someone',
              oldTitle: currentTask.title,
              newTitle: title,
              date: titleLog.createdAt,
              user,
            });
          }

          if (status && status !== currentTask.status) {
            const log = await prisma.auditLog.create({
              data: {
                action: 'STATUS_CHANGE',
                entity: 'TASK',
                entityId: taskId,
                userId: actingUserId,
                details: { oldStatus: currentTask.status, newStatus: status },
              },
            });

            const rawUsersToNotify = await getStatusChangeRecipients(
              status,
              { ...currentTask, teamId: teamId || currentTask.teamId },
              actingUserId
            );
            const usersToNotify = await filterUsersByNotificationPreference(rawUsersToNotify, 'status');

            if (usersToNotify.length > 0) {
              await prisma.taskNotification.createMany({
                data: usersToNotify.map((id: any) => ({
                  userId: id,
                  actorId: actingUserId,
                  taskId,
                  type: 'STATUS_CHANGE',
                  title: `${user?.name || 'Someone'} changed status from ${currentTask.status} to ${status} on task ${currentTask.title}`,
                })),
              });
              usersToNotify.forEach((id: any) => {
                io.to(`user:${id}`).emit('notification_received');
              });
            }

            activity = {
              id: log.id,
              type: 'status_change',
              author: user?.name || 'Someone',
              oldStatus: currentTask.status,
              newStatus: status,
              date: log.createdAt,
              user,
            };
          } else if (computedAssigneeIds !== undefined) {
            const assignedUsers = computedAssigneeIds.length > 0
              ? await prisma.user.findMany({ where: { id: { in: computedAssigneeIds } }, select: { id: true, name: true, avatarUrl: true } })
              : [];
            const names = assignedUsers.length > 0 ? assignedUsers.map((u: any) => u.name).join(', ') : 'Unassigned';
            // Diff against the previous assignees so the feed can say exactly who was added/removed
            const added = assignedUsers.filter((u: any) => !currentTask.assignees.some((a: any) => a.id === u.id)).map((u: any) => u.name);
            const removed = currentTask.assignees.filter((a: any) => !computedAssigneeIds.includes(a.id)).map((a: any) => a.name);
            const log = await prisma.auditLog.create({
              data: {
                action: 'ASSIGNMENT',
                entity: 'TASK',
                entityId: taskId,
                userId: actingUserId,
                details: { assigneeName: names, assigneeNames: assignedUsers.map((u: any) => u.name), count: assignedUsers.length, added, removed },
              },
            });
            const newlyAssigned = computedAssigneeIds.filter((id: string) => !currentTask.assignees.some((a: any) => a.id === id));
            const removedAssigneeIds = currentTask.assignees
              .filter((a: any) => !computedAssigneeIds.includes(a.id))
              .map((a: any) => a.id)
              .filter((id: string) => id !== actingUserId);

            if (newlyAssigned.length > 0) {
              const rawNewAssignees = newlyAssigned.filter((id: string) => id !== actingUserId);
              const newAssigneesToNotify = await filterUsersByNotificationPreference(rawNewAssignees, 'assigned');
              if (newAssigneesToNotify.length > 0) {
                await prisma.taskNotification.createMany({
                  data: newAssigneesToNotify.map((id: string) => ({
                    userId: id,
                    actorId: actingUserId,
                    taskId,
                    type: 'ASSIGNMENT',
                    title: `${user?.name || 'Someone'} assigned you to task ${currentTask.title}`,
                  })),
                });
                newAssigneesToNotify.forEach((id: string) => {
                  io.to(`user:${id}`).emit('notification_received');
                });
              }
            }

            if (removedAssigneeIds.length > 0) {
              const unassignedToNotify = await filterUsersByNotificationPreference(removedAssigneeIds, 'assigned');
              if (unassignedToNotify.length > 0) {
                await prisma.taskNotification.createMany({
                  data: unassignedToNotify.map((id: string) => ({
                    userId: id,
                    actorId: actingUserId,
                    taskId,
                    type: 'UNASSIGNMENT',
                    title: `${user?.name || 'Someone'} unassigned you from task ${currentTask.title}`,
                  })),
                });
                unassignedToNotify.forEach((id: string) => {
                  io.to(`user:${id}`).emit('notification_received');
                });
              }
            }

            activity = {
              id: log.id,
              type: 'assignment',
              author: user?.name || 'Someone',
              assigneeName: names,
              assignees: assignedUsers.map((u: any) => u.name),
              added,
              removed,
              date: log.createdAt,
              user,
            };
          } else if (assigneeId !== undefined && assigneeId !== currentTask.assigneeId) {
            const assignedUser = assigneeId
              ? await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true } })
              : null;
            const log = await prisma.auditLog.create({
              data: {
                action: 'ASSIGNMENT',
                entity: 'TASK',
                entityId: taskId,
                userId: actingUserId,
                details: { assigneeName: assignedUser?.name || 'Unassigned' },
              },
            });
            if (currentTask.assigneeId && currentTask.assigneeId !== actingUserId) {
              const oldToNotify = await filterUsersByNotificationPreference([currentTask.assigneeId], 'assigned');
              if (oldToNotify.length > 0) {
                await prisma.taskNotification.create({
                  data: {
                    userId: currentTask.assigneeId,
                    actorId: actingUserId,
                    taskId,
                    type: 'UNASSIGNMENT',
                    title: `${user?.name || 'Someone'} unassigned you from task ${currentTask.title}`,
                  },
                });
                io.to(`user:${currentTask.assigneeId}`).emit('notification_received');
              }
            }
            if (assigneeId && assigneeId !== actingUserId) {
              const newToNotify = await filterUsersByNotificationPreference([assigneeId], 'assigned');
              if (newToNotify.length > 0) {
                await prisma.taskNotification.create({
                  data: {
                    userId: assigneeId,
                    actorId: actingUserId,
                    taskId,
                    type: 'ASSIGNMENT',
                    title: `${user?.name || 'Someone'} assigned you to task ${currentTask.title}`,
                  },
                });
                io.to(`user:${assigneeId}`).emit('notification_received');
              }
            }

            activity = {
              id: log.id,
              type: 'assignment',
              author: user?.name || 'Someone',
              assigneeName: assignedUser?.name || 'Unassigned',
              date: log.createdAt,
              user,
            };
          } else if (priority && priority !== currentTask.priority) {
            const log = await prisma.auditLog.create({
              data: {
                action: 'PRIORITY_CHANGE',
                entity: 'TASK',
                entityId: taskId,
                userId: actingUserId,
                details: { oldPriority: currentTask.priority, newPriority: priority },
              },
            });
            activity = {
              id: log.id,
              type: 'priority_change',
              author: user?.name || 'Someone',
              oldPriority: currentTask.priority,
              newPriority: priority,
              date: log.createdAt,
              user,
            };
          }
          if (activity) emitActivity(activity);

          if (assigneeRoleRestrictions !== undefined) {
            const roleLog = await prisma.auditLog.create({
              data: {
                action: 'TEAM_ROLE_CHANGE',
                entity: 'TASK',
                entityId: taskId,
                userId: actingUserId,
                details: { roles: assigneeRoleRestrictions },
              },
            });
            emitActivity({
              id: roleLog.id,
              type: 'team_role_change',
              author: user?.name || 'Someone',
              roles: assigneeRoleRestrictions,
              date: roleLog.createdAt,
              user,
            });
          }
        } catch (err) {
          console.error('Background task logging error:', err);
        }
      })();
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/tasks/:id
export async function deleteTask(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const taskToDelete = await prisma.task.findUnique({
      where: { id: taskId },
      select: { listId: true, externalId: true },
    });
    await prisma.task.delete({ where: { id: taskId } });

    io.emit('task:deleted', { id: taskId });

    await invalidateCache(`task:${taskId}`, 'tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

    // --- ClickUp Sync ---
    if (taskToDelete?.externalId) {
      safeDeleteClickUpTask(taskToDelete.externalId).catch(console.error);
    }

    return res.json({ message: 'Task deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Task not found' });
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/tasks/:id/move - status transition
export async function moveTask(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status, currentListId, userId } = req.body;

    const authReq = req as any;
    const effectiveUser = authReq.user || (userId ? { id: userId } : null);

    const currentTask = await prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        listId: true,
        creatorId: true,
        teamId: true,
        externalId: true,
        assignees: { select: { id: true } },
        assigneeRoleRestrictions: true,
        checklists: { where: { subtaskId: null }, include: { items: true } },
        subtasks: { include: { checklists: { include: { items: true } } } },
        recurringConfig: true,
      },
    });

    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (status !== undefined) {
      // In Review: only subtasks must be Closed (auditing happens during review)
      if (requiresClosedSubtasks(status)) {
        const hasUnclosedSubtasks = currentTask.subtasks.some((st: any) => {
          if ((st.title || '').trim().toLowerCase().startsWith('--audit')) return false;
          const s = (st.status || '').toLowerCase();
          return s !== 'closed' && s !== 'done' && !st.completed;
        });
        if (hasUnclosedSubtasks) {
          return res.status(400).json({ error: `Cannot move to ${status}: All subtasks must be Closed first.` });
        }
      }

      // Completion statuses: required audits must also be checked
      if (requiresCompletedAudits(status)) {
        const auditorRoles = [
          ...((currentTask as any).assigneeRoleRestrictions || []),
          ...(currentTask.subtasks || [])
            .filter((s: any) => s.title?.toLowerCase().startsWith('--audit'))
            .flatMap((s: any) => (s as any).assigneeRoleRestrictions || []),
        ];
        const auditChecklists = (currentTask.checklists || []).filter((c: any) => isNexusAuditChecklist(c));
        const allItems = auditChecklists.flatMap((c: any) => c.items || []);
        const excludedAudits = new Set(
          allItems
            .filter((i: any) => (i.text || '').startsWith('!'))
            .map((i: any) => normalizeAuditName((i.text || '').slice(1)))
        );
        const activeItems = allItems
          .filter((i: any) => !(i.text || '').startsWith('!'))
          .map((i: any) => i.text);
        // Audits the Galaxy AI picked replace the role/title rules (saved items and exclusions still apply).
        const requiredTaskAudits = Array.from(new Set([
          ...(getAiPickedAudits(currentTask.checklists) ? [] : getRequiredAudits(currentTask.title, auditorRoles)),
          ...activeItems,
        ])).filter(r => !r.startsWith('!') && !excludedAudits.has(normalizeAuditName(r)) && (!HIDE_DESIGN_AUDIT || normalizeAuditName(r) !== 'design audit'));

        const completedTexts = new Set(
          allItems
            .filter((i: any) => i.completed && !i.text.startsWith('!'))
            .map((i: any) => normalizeAuditName(i.text))
        );
        const unchecked = requiredTaskAudits.filter(r => !completedTexts.has(normalizeAuditName(r)));
        if (unchecked.length > 0) {
          return res.status(400).json({ error: `Cannot move to ${status}: Required audits are not completed (${unchecked.join(', ')}).` });
        }
      }
    }

    const oldStatus = currentTask.status;

    // Immediately persist to DB (scalar fields only for max speed)
    if (status && status.toLowerCase() === 'revision') {
      // Reset only Nexus's Audit checklist, not a ClickUp checklist also named "Audit".
      const auditChecklist = (
        await prisma.checklist.findMany({
          where: { taskId: id, subtaskId: null, name: { equals: 'Audit', mode: 'insensitive' } },
          include: { items: { select: { text: true } } },
        })
      ).find(isNexusAuditChecklist);
      if (auditChecklist) {
        await prisma.checklistItem.updateMany({
          where: { checklistId: auditChecklist.id },
          data: { completed: false },
        });
      }
    }
    const statusUpper = (status || '').toUpperCase();
    const updateData: any = { status };
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(statusUpper) && (currentTask as any).recurringConfig) {
      updateData.recurringConfig = {
        ...(currentTask as any).recurringConfig,
        frequency: statusUpper,
      };
    }
    const updated = await prisma.task.update({
      where: { id },
      data: updateData,
    });

    // Broadcast IMMEDIATELY after update
    const roomListId = currentListId || currentTask.listId;
    io.emit('task:updated', updated);

    // Invalidate activity cache in background (status change writes an AuditLog)
    invalidateCache(`task:activities:${id}`, `task:${id}`).catch(() => {});

    // --- ClickUp Sync: status change (fire-and-forget) ---
    (async () => {
      try {
        const clickUpTaskId = currentTask.externalId ?? null;
        if (clickUpTaskId && status) {
          const cuPayload = { status: mapNexusStatusToClickUp(status) };
          console.log(`[ClickUp Debug] Syncing moveTask payload for ${clickUpTaskId}:`, cuPayload);
          await safeUpdateClickUpTask(clickUpTaskId, cuPayload);
          console.log(`[ClickUp Debug] Sync success for moveTask ${clickUpTaskId}`);
        }
      } catch (err: any) {
        console.error('[ClickUp Debug] moveTask sync error:', err?.response?.data || err?.message || err);
      }
    })();

    // Fire and forget cache invalidation so we don't block the API response
    invalidateCache(`task:${id}`, 'tasks:all', 'dashboard:all', 'lists:all').catch(err => {
      console.error('Cache invalidation error:', err);
    });

    // Create AuditLog activity entry asynchronously so it doesn't block the API response
    if (oldStatus !== status) {
      const actingUserId = effectiveUser?.id || (userId ? userId : null);
      if (actingUserId) {
        prisma.user.findUnique({
          where: { id: actingUserId },
          select: { id: true, name: true, avatarUrl: true, email: true },
        }).then(user => {
          prisma.auditLog.create({
            data: {
              action: 'STATUS_CHANGE',
              entity: 'TASK',
              entityId: id,
              userId: actingUserId,
              details: { oldStatus, newStatus: status },
            },
          }).then(async log => {
            const activity = {
              id: log.id,
              type: 'status_change',
              author: user?.name || 'Someone',
              oldStatus,
              newStatus: status,
              date: log.createdAt,
              user,
            };
            // Global broadcast so the Activity page and dashboards refresh too (list-room members receive it as well)
            io.emit('task_activity', { listId: roomListId, taskId: id, activity });

            // Notify role-based recipients + assignees so the change shows in their feed
            const rawUsersToNotify = await getStatusChangeRecipients(status, currentTask, actingUserId);
            const usersToNotify = await filterUsersByNotificationPreference(rawUsersToNotify, 'status');
            if (usersToNotify.length > 0) {
              await prisma.taskNotification.createMany({
                data: usersToNotify.map((uid: string) => ({
                  userId: uid,
                  actorId: actingUserId,
                  taskId: id,
                  type: 'STATUS_CHANGE',
                  title: `${user?.name || 'Someone'} changed status from ${oldStatus} to ${status} on task ${currentTask.title}`,
                })),
              });
              usersToNotify.forEach((uid: string) => {
                io.to(`user:${uid}`).emit('notification_received');
              });
            }
          }).catch(console.error);
        }).catch(console.error);
      }
    }

    return res.json({ task: updated, queued: true, message: 'Status updated successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/:id/comments
export async function createTaskComment(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const { content, userId, listId, mentionedUserIds, parentCommentId, subtaskId } = req.body;
    const authReq = req as any;
    const effectiveUserId = userId || authReq.user?.id || (await prisma.user.findFirst())?.id;

    if (!effectiveUserId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content cannot be empty' });
    }

    // The comment, its audit log, the author lookup and the parent's reply count are independent writes/reads,
    // so they run in parallel: one ~190 ms DB round trip before the broadcast instead of one per step. Ids are
    // made here so the audit log can reference the comment without waiting for it.
    const commentId = randomUUID();
    const logId = randomUUID();
    const loggedAt = new Date();
    const results = await Promise.allSettled([
      prisma.taskComment.create({
        data: {
          id: commentId,
          content: content.trim(),
          taskId,
          userId: effectiveUserId,
          ...(parentCommentId ? { parentCommentId } : {}),
          ...(subtaskId ? { subtaskId } : {}),
        },
      }),
      prisma.user.findUnique({
        where: { id: effectiveUserId },
        select: { id: true, name: true, avatarUrl: true, email: true },
      }),
      prisma.auditLog.create({
        data: {
          id: logId,
          createdAt: loggedAt,
          action: parentCommentId ? 'REPLY' : 'COMMENT',
          entity: 'TASK',
          entityId: taskId,
          userId: effectiveUserId,
          details: { text: content.trim(), commentId, parentCommentId: parentCommentId || null, subtaskId: subtaskId || null },
        },
      }),
      // Increment replyCount on parent comment
      parentCommentId
        ? prisma.taskComment.update({ where: { id: parentCommentId }, data: { replyCount: { increment: 1 } } })
        : Promise.resolve(null),
    ]);
    const [createdRes, userRes, logRes, parentRes] = results;
    if (createdRes.status === 'rejected') {
      // No comment, so nothing else may stand: undo whatever of the parallel writes did land
      if (logRes.status === 'fulfilled') prisma.auditLog.delete({ where: { id: logId } }).catch(() => {});
      if (parentCommentId && parentRes.status === 'fulfilled') {
        prisma.taskComment.update({ where: { id: parentCommentId }, data: { replyCount: { decrement: 1 } } }).catch(() => {});
      }
      throw createdRes.reason;
    }
    if (logRes.status === 'rejected') console.error('createTaskComment: audit log failed:', logRes.reason);
    const user = userRes.status === 'fulfilled' ? userRes.value : null;
    // Same shape the old include returned (a new comment has no reactions or replies yet), plus its author
    const comment = { ...createdRes.value, reactions: [], replies: [], user };
    const log = { id: logId, createdAt: loggedAt };

    // Mentions are derived from the comment content itself (mention:// links) so every
    // comment path (main task, subtask, replies) notifies, and removed mentions don't.
    const clientMentionIds: string[] = Array.isArray(mentionedUserIds) ? mentionedUserIds : [];
    const contentMentionIds = extractMentionedUserIds(content);
    const mentionIds = contentMentionIds.length > 0 ? contentMentionIds : clientMentionIds;

    const activity = {
      id: log.id,
      commentId: comment.id,
      type: parentCommentId ? 'reply' : 'comment',
      author: user?.name || 'Someone',
      text: content.trim(),
      date: log.createdAt,
      user,
      parentCommentId: parentCommentId || null,
      subtaskId: subtaskId || null,
    };

    const payload = { taskId, comment, activity, subtaskId };

    // Drop the cached comment list so the next GET rebuilds it from the DB. Pushing onto it
    // instead started a one-comment list whenever the key had expired or been cleared, which
    // hid every earlier comment (and its images) until the key expired.
    const redisCommentKey = `comments:list:${taskId}${subtaskId ? `:sub:${subtaskId}` : ''}`;
    redis.del(redisCommentKey).catch(() => {});
    // Also invalidate the activity cache since a new comment writes an AuditLog
    invalidateCache(`task:activities:${taskId}`).catch(() => {});

    if (listId) {
      io.to(`list:${listId}`).emit('task:comment_added', payload);
      // Broadcast globally (room members included) so the Activity page, which isn't in list rooms, refreshes live
      io.emit('task_activity', { listId, taskId, activity });
    } else {
      io.emit('task:comment_added', payload);
      io.emit('task_activity', { taskId, activity });
    }

    // Notifications after the broadcast (their own notification_received emits follow each write), so the
    // comment shows for everyone without waiting on the notification queries.
    (async () => {
      await notifyMentionedUsers({
        userIds: mentionIds,
        actorId: effectiveUserId,
        actorName: user?.name,
        taskId,
        content,
        isSubtask: Boolean(subtaskId),
      });

      // Notify task assignees about the comment (if they weren't mentioned)
      const taskData = await prisma.task.findUnique({
        where: { id: taskId },
        select: { title: true, assignees: { select: { id: true } } }
      });
      if (taskData) {
        const rawAssigneesToNotify = taskData.assignees
          .map((a: any) => a.id)
          .filter((id: any) => id !== effectiveUserId && !mentionIds.includes(id));

        const assigneesToNotify = await filterUsersByNotificationPreference(rawAssigneesToNotify, 'comments');

        if (assigneesToNotify.length > 0) {
          let itemTitle = taskData.title;
          if (subtaskId) {
            const subRec = await prisma.subtask.findUnique({ where: { id: subtaskId }, select: { title: true } });
            if (subRec?.title) itemTitle = subRec.title;
          }
          await prisma.taskNotification.createMany({
            data: assigneesToNotify.map((id: any) => ({
              userId: id,
              actorId: effectiveUserId,
              taskId,
              type: 'COMMENT',
              title: `${user?.name || 'Someone'} commented on ${subtaskId ? 'subtask' : 'task'} ${itemTitle}`,
              content: toNotificationPreview(content),
            })),
          });
          assigneesToNotify.forEach((id: any) => {
            io.to(`user:${id}`).emit('notification_received');
          });
        }
      }
    })().catch((err) => console.error('createTaskComment: notifications failed:', err));

    // --- ClickUp Sync: mirror comment to ClickUp (fire-and-forget) ---
    (async () => {
      try {
        let clickUpTaskId: string | null = null;
        if (subtaskId) {
          const subRecord = await prisma.subtask.findUnique({ where: { id: subtaskId }, select: { externalId: true } });
          clickUpTaskId = subRecord?.externalId ?? null;
        } else {
          const taskRecord = await prisma.task.findUnique({ where: { id: taskId }, select: { externalId: true } });
          clickUpTaskId = taskRecord?.externalId ?? null;
        }
        
        if (clickUpTaskId && !parentCommentId) {
          // Deduplicate rapid double submissions for ClickUp mirror (10s lock per comment ID)
          const dedupeKey = `dedupe:clickup_comment:${clickUpTaskId}:${comment.id}`;
          const isFirst = await redis.set(dedupeKey, '1', 'EX', 10, 'NX').catch(() => 'OK');
          if (!isFirst) {
            console.log('[ClickUp] Skipping duplicate comment mirror for task', clickUpTaskId);
            return;
          }

          // Only mirror top-level comments (not internal thread replies)
          const authorName = user?.name || 'Nexus';
          const conversion = convertCommentHtmlToClickUp(content, authorName);

          // Upload any inline comment images to the ClickUp task as attachments
          if (conversion.images && conversion.images.length > 0) {
            for (const img of conversion.images) {
              try {
                const imgData = await fetchImageBuffer(img.src);
                if (imgData) {
                  const attachment = await uploadClickUpTaskAttachment(
                    clickUpTaskId,
                    imgData.buffer,
                    imgData.filename,
                    imgData.mimetype
                  );
                  if (attachment?.url || attachment?.id) {
                    for (const seg of conversion.comment) {
                      if (seg.type === 'image' && seg.image?.url === img.src) {
                        seg.image = {
                          id: attachment.id,
                          name: attachment.name || imgData.filename,
                          url: attachment.url || img.src,
                          thumbnail_small: attachment.thumbnail_small,
                          thumbnail_large: attachment.thumbnail_large,
                          uploaded: true,
                        };
                      }
                    }
                  }
                }
              } catch (imgErr) {
                console.error('[ClickUp] Failed to upload comment image attachment:', imgErr);
              }
            }
          }

          // Send either rich comment array OR plain text fallback, never both
          const commentPayload =
            conversion.comment && conversion.comment.length > 0
              ? { comment: conversion.comment }
              : { comment_text: conversion.comment_text };

          const clickupCommentId = await safeCreateClickUpComment(clickUpTaskId, commentPayload);
          if (clickupCommentId) {
            await prisma.taskComment.update({
              where: { id: comment.id },
              data: { externalId: clickupCommentId.toString() },
            });
          }
        }
      } catch (err) {
        console.error('[ClickUp] createTaskComment sync error:', err);
      }
    })();

    return res.status(201).json({ comment, activity });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/tasks/:id/comments/:commentId
export async function updateTaskComment(req: Request, res: Response) {
  try {
    const { id: taskId, commentId } = req.params;
    const { content, listId } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content cannot be empty' });
    }

    const previous = await prisma.taskComment.findUnique({
      where: { id: commentId },
      select: { content: true, externalId: true },
    });

    const comment = await prisma.taskComment.update({
      where: { id: commentId },
      data: { content: content.trim() },
      include: {
        reactions: { include: { user: { select: { id: true, name: true } } } },
        replies: {
          include: {
            reactions: { include: { user: { select: { id: true, name: true } } } },
          },
        },
        user: { select: { id: true, name: true, avatarUrl: true, email: true } }
      }
    });

    const payload = { taskId, comment };
    // Delete the Redis List so next fetch rebuilds it with the edited content
    redis.del(`comments:list:${taskId}`).catch(() => {});
    if (comment.subtaskId) {
      redis.del(`comments:list:${taskId}:sub:${comment.subtaskId}`).catch(() => {});
    }
    if (listId) {
      io.to(`list:${listId}`).emit('task:comment_updated', payload);
    } else {
      io.emit('task:comment_updated', payload);
    }

    // Mirror comment update to ClickUp asynchronously
    if (previous?.externalId) {
      (async () => {
        try {
          const authorName = comment.user?.name || 'Nexus';
          const conversion = convertCommentHtmlToClickUp(comment.content, authorName);
          const commentPayload =
            conversion.comment && conversion.comment.length > 0
              ? { comment: conversion.comment }
              : { comment_text: conversion.comment_text };
          await safeUpdateClickUpComment(previous.externalId!, commentPayload);
        } catch (err) {
          console.error('[ClickUp] updateTaskComment sync error:', err);
        }
      })();
    }

    // Only notify users newly mentioned by this edit; runs after the realtime emit
    const previousMentionIds = new Set(extractMentionedUserIds(previous?.content || ''));
    const newMentionIds = extractMentionedUserIds(comment.content).filter(id => !previousMentionIds.has(id));
    if (newMentionIds.length > 0) {
      notifyMentionedUsers({
        userIds: newMentionIds,
        actorId: comment.userId,
        actorName: comment.user?.name,
        taskId,
        content: comment.content,
        isSubtask: Boolean(comment.subtaskId),
      }).catch(err => console.error('Failed to send mention notifications', err));
    }

    return res.json({ comment });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/tasks/:id/comments/:commentId
export async function deleteTaskComment(req: Request, res: Response) {
  try {
    const { id: taskId, commentId } = req.params;
    const { listId } = req.body; 

    const existingComment = await prisma.taskComment.findUnique({
      where: { id: commentId },
    });

    await prisma.taskComment.delete({
      where: { id: commentId },
    });

    // If this was a reply, decrement parent replyCount
    if (existingComment?.parentCommentId) {
      await prisma.taskComment.update({
        where: { id: existingComment.parentCommentId },
        data: { replyCount: { decrement: 1 } },
      }).catch(() => {});
    }

    // Clean up associated TaskNotification and AuditLog records
    if (existingComment) {
      try {
        const preview = toNotificationPreview(existingComment.content);
        const matchingNotifs = await prisma.taskNotification.findMany({
          where: {
            taskId: existingComment.taskId,
            actorId: existingComment.userId,
            type: { in: ['MENTION', 'COMMENT'] },
            content: preview,
          },
          select: { id: true, userId: true },
        });

        if (matchingNotifs.length > 0) {
          await prisma.taskNotification.deleteMany({
            where: { id: { in: matchingNotifs.map(n => n.id) } },
          });
          matchingNotifs.forEach(n => {
            io.to(`user:${n.userId}`).emit('notification_received');
          });
        }

        await prisma.auditLog.deleteMany({
          where: {
            entityId: taskId,
            action: { in: ['COMMENT', 'REPLY'] },
            details: { path: ['commentId'], equals: commentId },
          },
        }).catch(() => {});
      } catch (cleanErr) {
        console.error('[deleteTaskComment] Notification/Audit cleanup error:', cleanErr);
      }
    }

    // Delete from ClickUp asynchronously
    if (existingComment?.externalId) {
      (async () => {
        try {
          const { deleteClickUpComment } = await import('../services/clickupService');
          await deleteClickUpComment(existingComment.externalId!);
        } catch (err) {
          console.error('[ClickUp] deleteTaskComment sync error:', err);
        }
      })();
    }

    const payload = { taskId, commentId };
    // Delete the Redis List so next fetch rebuilds it cleanly without the deleted comment
    redis.del(`comments:list:${taskId}`).catch(() => {});
    if (existingComment?.subtaskId) {
      redis.del(`comments:list:${taskId}:sub:${existingComment.subtaskId}`).catch(() => {});
    }
    if (listId) {
      io.to(`list:${listId}`).emit('task:comment_deleted', payload);
    } else {
      io.emit('task:comment_deleted', payload);
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/:id/comments/:commentId/reactions - toggle (add or remove)
export async function toggleCommentReaction(req: Request, res: Response) {
  try {
    const { commentId } = req.params;
    const { userId, emoji } = req.body;
    const authReq = req as any;
    const effectiveUserId = userId || authReq.user?.id || (await prisma.user.findFirst())?.id;

    if (!effectiveUserId || !emoji) {
      return res.status(400).json({ error: 'userId and emoji are required' });
    }

    const existing = await (prisma as any).taskCommentReaction.findUnique({
      where: { commentId_userId_emoji: { commentId, userId: effectiveUserId, emoji } },
    });

    if (existing) {
      await (prisma as any).taskCommentReaction.delete({ where: { id: existing.id } });
    } else {
      await (prisma as any).taskCommentReaction.create({
        data: { commentId, userId: effectiveUserId, emoji },
      });
    }

    const reactions = await (prisma as any).taskCommentReaction.findMany({
      where: { commentId },
      include: { user: { select: { id: true, name: true } } },
    });

    // If reaction was added, notify comment author in background (fire-and-forget)
    if (!existing) {
      (async () => {
        const comment = await prisma.taskComment.findUnique({
          where: { id: commentId },
          select: {
            id: true,
            userId: true,
            content: true,
            taskId: true,
            subtaskId: true,
            task: { select: { title: true } },
            subtask: { select: { title: true } },
          },
        });

        if (comment && comment.userId && comment.userId !== effectiveUserId) {
          const allowed = await shouldUserReceiveNotification(comment.userId, 'comments');
          if (allowed) {
            const actor = await prisma.user.findUnique({
              where: { id: effectiveUserId },
              select: { name: true },
            });
            const actorName = actor?.name || 'Someone';
            const targetTitle = comment.subtask?.title || comment.task?.title || 'task';
            const contextType = comment.subtaskId ? 'subtask' : 'task';

            await prisma.taskNotification.create({
              data: {
                userId: comment.userId,
                actorId: effectiveUserId,
                taskId: comment.taskId,
                type: 'REACTION',
                title: `${actorName} reacted ${emoji} to your comment on ${contextType} ${targetTitle}`,
                content: toNotificationPreview(comment.content),
              },
            });

            io.to(`user:${comment.userId}`).emit('notification_received', {
              type: 'REACTION',
              taskId: comment.taskId,
              commentId: comment.id,
              subtaskId: comment.subtaskId,
            });
          }
        }
      })().catch((err) => console.error('toggleCommentReaction: notification failed:', err));
    }

    return res.json({ reactions, toggled: existing ? 'removed' : 'added' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/tasks/:id/comments - get comments with reactions and replies
export async function getTaskComments(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const { subtaskId } = req.query;

    // Redis List key — one list per task (or per subtask).
    // Stored oldest-first via rpush, so lrange 0 -1 is always in chronological order.
    const redisKey = `comments:list:${taskId}${subtaskId ? `:sub:${subtaskId}` : ''}`;

    const cachedItems = await redis.lrange(redisKey, 0, -1);
    if (cachedItems.length > 0) {
      if (cachedItems.length === 1 && cachedItems[0] === '__EMPTY__') {
        return res.json({ comments: [], cached: true });
      }
      const comments = cachedItems.filter((c: string) => c !== '__EMPTY__').map((c: string) => JSON.parse(c));
      return res.json({ comments, cached: true });
    }

    const whereClause: any = { taskId, parentCommentId: null };
    if (subtaskId) {
      whereClause.subtaskId = String(subtaskId);
    } else {
      whereClause.subtaskId = null;
    }

    const comments = await prisma.taskComment.findMany({
      where: whereClause,
      include: {
        reactions: { include: { user: { select: { id: true, name: true } } } },
        replies: {
          include: {
            reactions: { include: { user: { select: { id: true, name: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
        attachments: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Fetch user info for each comment
    const userIds = [...new Set([
      ...comments.map((c: any) => c.userId),
      ...comments.flatMap((c: any) => c.replies.map((r: any) => r.userId)),
    ])];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, avatarUrl: true },
    });
    const userMap = Object.fromEntries(users.map((u: any) => [u.id, u]));

    const enriched = comments.map((c: any) => ({
      ...c,
      user: userMap[c.userId],
      replies: c.replies.map((r: any) => ({ ...r, user: userMap[r.userId] })),
    }));

    // Populate Redis List — store oldest-first (rpush), so lrange 0 -1 is chronological
    // and lpush for new comments keeps newest at index 0 for efficient appends.
    // If no comments exist, store '__EMPTY__' sentinel so subsequent queries return in 2ms.
    // TTL: 1 hour — reset on every access so active tasks stay warm indefinitely.
    const pipeline = redis.pipeline();
    pipeline.del(redisKey);
    if (enriched.length > 0) {
      for (const c of enriched) {
        pipeline.rpush(redisKey, JSON.stringify(c));
      }
    } else {
      pipeline.rpush(redisKey, '__EMPTY__');
    }
    pipeline.expire(redisKey, 3600);
    await pipeline.exec();

    return res.json({ comments: enriched });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}



// GET /api/tasks/:id/activities
export async function getTaskActivities(req: Request, res: Response) {
  try {
    const taskId = req.params.id;

    // Redis cache — 60 second TTL, invalidated on any write to this task
    const cacheKey = `task:activities:${taskId}`;
    const cached = await getCache<any>(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        createdAt: true,
        creator: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const logs = await prisma.auditLog.findMany({
      where: {
        entity: 'TASK',
        entityId: taskId,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const activities = logs.map((log: any) => {
      const details = (log.details as any) || {};
      if (log.action === 'STATUS_CHANGE') {
        const rawName = log.user?.name;
        const authorName = (rawName && (rawName.toUpperCase() === 'VIPSCALE' || rawName.toUpperCase() === 'VIP SCALE'))
          ? 'VIPScale'
          : (rawName || 'Someone');
        return {
          id: log.id,
          type: 'status_change',
          author: authorName,
          oldStatus: details.oldStatus,
          newStatus: details.newStatus,
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user ? { ...log.user, name: authorName } : log.user,
        };
      }
      if (log.action === 'COMMENT') {
        return {
          id: log.id,
          type: 'comment',
          author: log.user?.name || 'Someone',
          text: details.text,
          date: log.createdAt,
          user: log.user,
        };
      }
      if (log.action === 'ASSIGNMENT') {
        return {
          id: log.id,
          type: 'assignment',
          author: log.user?.name || 'Someone',
          assigneeName: details.assigneeName || (details.assignees ? details.assignees.join(', ') : 'Unassigned'),
          added: details.added,
          removed: details.removed,
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user,
        };
      }
      if (log.action === 'PRIORITY_CHANGE') {
        return {
          id: log.id,
          type: 'priority_change',
          author: log.user?.name || 'Someone',
          oldPriority: details.oldPriority,
          newPriority: details.newPriority,
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user,
        };
      }
      if (log.action === 'TITLE_CHANGE') {
        return {
          id: log.id,
          type: 'title_change',
          author: log.user?.name || 'Someone',
          oldTitle: details.oldTitle,
          newTitle: details.newTitle,
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user,
        };
      }
      if (log.action === 'TEAM_ROLE_CHANGE') {
        return {
          id: log.id,
          type: 'team_role_change',
          author: log.user?.name || 'Someone',
          roles: details.roles,
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user,
        };
      }
      if (log.action === 'CREATE_SUBTASK') {
        return {
          id: log.id,
          type: 'create_subtask',
          author: log.user?.name || 'Someone',
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user,
        };
      }
      if (
        log.action === 'AUDIT_ITEM_CHECKED' ||
        log.action === 'CHECKLIST_ITEM_CHECKED' ||
        log.action === 'AUDIT_ITEM_UNCHECKED' ||
        log.action === 'CHECKLIST_ITEM_UNCHECKED'
      ) {
        return {
          id: log.id,
          type: log.action.toLowerCase(),
          author: log.user?.name || 'Someone',
          itemName: details.itemName || details.text || details.itemText,
          checklistName: details.checklistName,
          isAudit: details.isAudit,
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user,
        };
      }
      return {
        id: log.id,
        type: log.action.toLowerCase(),
        author: log.user?.name || 'Someone',
        details,
        date: log.createdAt,
        user: log.user,
      };
    });

    const result = {
      taskCreatedAt: task.createdAt,
      creator: task.creator,
      activities,
    };

    // Cache for 60 seconds — invalidated whenever a status change, comment, or
    // checklist action writes a new AuditLog entry for this task
    setCache(cacheKey, result, 60).catch(() => {});

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/:id/attachments/r2-url
export async function createAttachmentUrl(req: Request, res: Response) {
  try {
    const { fileName, fileType } = req.body;
    const upload = getR2PresignedUrl(fileName || 'file.dat', fileType || 'application/octet-stream');
    return res.json(upload);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/tasks/live-blocks
export async function getLiveBlocksData(req: Request, res: Response) {
  try {
    const { assigneeName, type, reportDate, listId } = req.query as Record<string, string>;

    let assigneeId = undefined;
    if (assigneeName) {
      const user = await prisma.user.findFirst({
        where: { name: { contains: assigneeName, mode: 'insensitive' } }
      });
      if (user) assigneeId = user.id;
    }

    const filters: any = {};
    if (reportDate && type === 'newtasks') {
      filters.createdAt = { gte: new Date(reportDate) };
    }
    if (listId) {
      filters.listId = listId;
    }

    // The daily report runs its own query below; this one (every task, with subtasks and checklists) isn't used there
    const tasks = type === 'daily-report' ? [] : await prisma.task.findMany({
      where: {
        ...filters,
        ...(assigneeId
          ? {
              OR: [
                { assigneeId },
                { assignees: { some: { id: assigneeId } } },
              ],
            }
          : {}),
      },
      include: {
        subtasks: true,
        checklists: { where: { subtaskId: null }, include: { items: true } },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
        creator: { select: { id: true, name: true, email: true } },
        list: {
          select: {
            id: true,
            name: true,
            space: { select: { id: true, name: true } },
            folder: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (type === 'daily-report') {
      const activeTasks = await prisma.task.findMany({
        where: { status: { not: 'Closed' } },
        include: {
          assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true } },
          list: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      });

      const priorities: Record<string, any[]> = {};
      const clients: Record<string, any[]> = {};

      // Get start of today in UTC+8
      const now = new Date();
      const utc8Time = now.getTime() + (8 * 60 * 60 * 1000);
      const utc8Date = new Date(utc8Time);
      utc8Date.setUTCHours(0, 0, 0, 0);
      const startOfTodayUtc8 = new Date(utc8Date.getTime() - (8 * 60 * 60 * 1000));

      for (const task of activeTasks) {
        // Only put TODAY's tasks in Priorities for Today
        if (new Date(task.createdAt) >= startOfTodayUtc8) {
          const assigneeNames = new Set<string>();
          if (task.assignee) assigneeNames.add(task.assignee.name);
          if (task.assignees && task.assignees.length > 0) {
            task.assignees.forEach((a: any) => assigneeNames.add(a.name));
          }

          assigneeNames.forEach(name => {
            if (!priorities[name]) priorities[name] = [];
            priorities[name].push(task);
          });
        }

        if (task.list) {
          if (!clients[task.list.name]) clients[task.list.name] = [];
          clients[task.list.name].push(task);
        }
      }

      // Sort alphabetically
      const sortedPriorities = Object.keys(priorities).sort().reduce((acc: any, key) => {
        acc[key] = priorities[key];
        return acc;
      }, {});

      const sortedClients = Object.keys(clients).sort().reduce((acc: any, key) => {
        acc[key] = clients[key];
        return acc;
      }, {});

      return res.json({ blocks: { priorities: sortedPriorities, clients: sortedClients } });
    }

    if (type === 'statuses') {
      const groupedTasks = tasks.reduce((acc: any, task: any) => {
        const status = task.status || 'PENDING';
        if (!acc[status]) acc[status] = [];
        acc[status].push(task);
        return acc;
      }, {});
      return res.json({ blocks: groupedTasks });
    }

    return res.json({ blocks: { 'New Tasks': tasks } });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}


export async function createSubtask(req: Request, res: Response) {
  try {
    const { id: taskId } = req.params;
    const { title, description, assigneeIds, assigneeId, teamId, priority, dueDate, status, assigneeRoleRestrictions, teamAssignAccessRole } = req.body;

    const effectiveAssigneeId = (assigneeIds && assigneeIds.length > 0) ? assigneeIds[0] : (assigneeId || null);

    const subtask = await prisma.subtask.create({
      data: {
        title,
        description,
        // @ts-ignore: IDE stale Prisma types issue
        status,
        assigneeId: effectiveAssigneeId,
        ...(assigneeIds && Array.isArray(assigneeIds) && assigneeIds.length > 0
          ? { assignees: { connect: assigneeIds.map((id: string) => ({ id })) } }
          : assigneeId
          ? { assignees: { connect: [{ id: assigneeId }] } }
          : {}),
        ...(teamId ? { teamId } : {}),
        priority: priority || 'MEDIUM',
        dueDate: dueDate ? new Date(dueDate) : null,
        assigneeRoleRestrictions: assigneeRoleRestrictions || [],
        teamAssignAccessRole: teamAssignAccessRole || null,
        taskId,
      },
      // @ts-ignore
      include: { 
        User: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true } },
        team: { select: { id: true, name: true, color: true } }
      } as any
    });
    await invalidateCache(`task:${taskId}`);

    const task = await prisma.task.findUnique({ 
      where: { id: taskId }, 
      select: { id: true, listId: true, externalId: true, subtasks: taskInclude.subtasks }
    });
    if (task) {
      // Whole tasks:all family: the dashboard's all-tasks list now carries subtasks too
      await invalidateCache('tasks:all');
      // Global broadcast (like updateSubtask) so the dashboard, which joins no list room, gets the new row
      io.emit('task:updated', task);

      const authReq = req as any;
      const actingUserId = authReq.user?.id || (await prisma.user.findFirst())?.id;
      if (actingUserId) {
        // Notify the subtask's assignees (the acting user excluded)
        const rawSubtaskAssigneeIds: string[] = (((subtask as any).assignees ?? []) as Array<{ id: string }>)
          .map((a) => a.id)
          .filter((id) => id !== actingUserId);
        const subtaskAssigneeIds = await filterUsersByNotificationPreference(rawSubtaskAssigneeIds, 'assigned');
        const actorUser = await prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } });
        if (subtaskAssigneeIds.length > 0) {
          await prisma.taskNotification.createMany({
            data: subtaskAssigneeIds.map((id) => ({
              userId: id,
              actorId: actingUserId,
              taskId,
              type: 'ASSIGNMENT',
              title: `${actorUser?.name || 'Someone'} assigned you to subtask ${subtask.title}`,
            })),
          });
          subtaskAssigneeIds.forEach((id) => {
            io.to(`user:${id}`).emit('notification_received');
          });
        }

        await prisma.auditLog.create({
          data: {
            action: 'CREATE_SUBTASK',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { subtaskTitle: title }
          }
        });
        const act = {
          id: Date.now().toString(),
          type: 'create_subtask',
          author: actorUser?.name || 'Someone',
          subtaskTitle: title,
          date: new Date().toISOString(),
        };
        io.to(`list:${task.listId}`).emit('task_activity', { taskId, activity: act });
      }
    }

    // --- ClickUp Sync: create subtask (fire-and-forget) ---
    if (task?.externalId) {
      (async () => {
        try {
          const list = await prisma.list.findUnique({ where: { id: task.listId }, select: { externalId: true, clickUpListId: true } });
          let cuListId = resolveClickUpListId(list);
          
          if (!cuListId && task.externalId) {
            try {
              const { getClickUpTask } = require('../services/clickupService');
              const cuTask = await getClickUpTask(task.externalId);
              if (cuTask?.list?.id) {
                cuListId = cuTask.list.id;
              }
            } catch (err) {
              console.error('[ClickUp] Failed to fetch ClickUp task for fallback list ID:', err);
            }
          }

          if (cuListId) {
            const cuAssigneeIds = await resolveClickUpAssigneeIds(
              (((subtask as any).assignees ?? []) as Array<{ email?: string | null }>).map((a) => a.email)
            );
            const cuSubtaskId = await safeCreateClickUpSubtask(
              cuListId,
              task.externalId!,
              {
                name: title,
                description: description,
                status: status ? mapNexusStatusToClickUp(status) : undefined,
                priority: priority ? mapNexusPriorityToClickUp(priority) : undefined,
                ...(cuAssigneeIds.length > 0 ? { assignees: cuAssigneeIds } : {}),
              }
            );
            if (cuSubtaskId) {
              cuSubtaskIdMap.set(subtask.id, cuSubtaskId);
              // @ts-ignore
              await prisma.subtask.update({
                where: { id: subtask.id },
                data: { externalId: cuSubtaskId }
              });
              console.log(`[ClickUp]   ✅ subtask externalId updated in DB: ${subtask.id} → ${cuSubtaskId}`);
            }
          }
        } catch (err) {
          console.error('[ClickUp] createSubtask sync error:', err);
        }
      })();
    }

    injectSubtaskIntoJournal(taskId, { id: subtask.id, title: subtask.title }).catch((err) => {
      console.error('Failed to inject subtask into journal:', err);
    });

    return res.json({ subtask });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateSubtask(req: Request, res: Response) {
  try {
    const { id: taskId, subtaskId } = req.params;
    const { title, description, completed, assigneeIds, assigneeId, teamId, priority, dueDate, status, assigneeRoleRestrictions, teamAssignAccessRole } = req.body;

    // Only Project Managers and Admins can set Team Role / Assignees (checked against the DB, not the token)
    const changesAssignment = assigneeIds !== undefined || assigneeId !== undefined || assigneeRoleRestrictions !== undefined;
    if (changesAssignment && !(await canUserSetAssignees((req as any).user?.id))) {
      return res.status(403).json({ error: await getAssignDeniedMessage() });
    }

    if (status !== undefined || completed === true) {
      // Subtasks have no children, so In Review is free; only completion statuses need audits
      const targetStatus = (status || (completed ? 'CLOSED' : '')).toLowerCase();
      if (requiresCompletedAudits(targetStatus)) {
        const currentSubtask = await prisma.subtask.findUnique({
          where: { id: subtaskId },
          include: { checklists: { include: { items: true } } }
        });
        if (currentSubtask) {
          const auditChecklists = (currentSubtask.checklists || []).filter((c: any) => isNexusAuditChecklist(c));
          const allItems = auditChecklists.flatMap((c: any) => c.items || []);
          const excludedAudits = new Set(
            allItems
              .filter((i: any) => (i.text || '').startsWith('!'))
              .map((i: any) => normalizeAuditName((i.text || '').slice(1)))
          );
          const activeItems = allItems
            .filter((i: any) => !(i.text || '').startsWith('!'))
            .map((i: any) => i.text);
          const requiredSubtaskAudits = Array.from(new Set([
            ...getRequiredAudits(currentSubtask.title, (currentSubtask as any).assigneeRoleRestrictions),
            ...activeItems,
          ])).filter(r => !r.startsWith('!') && !excludedAudits.has(normalizeAuditName(r)) && (!HIDE_DESIGN_AUDIT || normalizeAuditName(r) !== 'design audit'));

          const completedTexts = new Set(
            allItems
              .filter((i: any) => i.completed && !i.text.startsWith('!'))
              .map((i: any) => normalizeAuditName(i.text))
          );
          const unchecked = requiredSubtaskAudits.filter(r => !completedTexts.has(normalizeAuditName(r)));
          if (unchecked.length > 0) {
            return res.status(400).json({ error: `Cannot move to ${status || 'Closed'}: Required audits for subtask are not completed (${unchecked.join(', ')}).` });
          }
        }
      }
    }

    let finalCompleted = completed;
    if (status !== undefined) {
      finalCompleted = status === 'CLOSED';
    }

    let computedAssigneeIds = assigneeIds;
    if (assigneeRoleRestrictions !== undefined && assigneeIds === undefined && assigneeId === undefined) {
      computedAssigneeIds = await resolveUsersFromRoles(assigneeRoleRestrictions);
    }

    if (status && status.toLowerCase() === 'revision') {
      // Reset only Nexus's Audit checklist, not a ClickUp checklist also named "Audit".
      const auditChecklist = (
        await prisma.checklist.findMany({
          where: { subtaskId: subtaskId, name: { equals: 'Audit', mode: 'insensitive' } },
          include: { items: { select: { text: true } } },
        })
      ).find(isNexusAuditChecklist);
      if (auditChecklist) {
        await prisma.checklistItem.updateMany({
          where: { checklistId: auditChecklist.id },
          data: { completed: false },
        });
      }
    }

    const assigneesChanging = (computedAssigneeIds !== undefined && Array.isArray(computedAssigneeIds)) || assigneeId !== undefined;

    // Snapshot previous subtask data for audit logs and activity diffs
    const existingSubtask = (await prisma.subtask.findUnique({
      where: { id: subtaskId },
      select: {
        id: true,
        title: true,
        status: true,
        completed: true,
        priority: true,
        assignees: { select: { id: true, name: true, email: true } },
      },
    })) as any;
    const previousAssignees: { id: string; name: string; email?: string | null }[] = existingSubtask?.assignees || [];
    const oldSubtaskStatus: string = (existingSubtask?.status as string) || (existingSubtask?.completed ? 'CLOSED' : 'PENDING');
    const oldSubtaskPriority: string = (existingSubtask?.priority as string) || 'MEDIUM';

    const subtask = await prisma.subtask.update({
      where: { id: subtaskId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(finalCompleted !== undefined && { completed: finalCompleted }),
        ...(computedAssigneeIds !== undefined && Array.isArray(computedAssigneeIds) ? {
          assigneeId: computedAssigneeIds.length > 0 ? computedAssigneeIds[0] : null,
          assignees: { set: computedAssigneeIds.map((id: string) => ({ id })) }
        } : assigneeId !== undefined ? {
          assigneeId: assigneeId || null,
          assignees: assigneeId ? { set: [{ id: assigneeId }] } : { set: [] }
        } : {}),
        ...(teamId !== undefined && { teamId }),
        ...(priority !== undefined && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(assigneeRoleRestrictions !== undefined && { assigneeRoleRestrictions }),
        ...(teamAssignAccessRole !== undefined && { teamAssignAccessRole }),
      },
      // @ts-ignore
      include: { 
        User: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true } },
        team: { select: { id: true, name: true, color: true } }
      } as any
    });

    const authReq = req as any;
    const actingUserId = authReq.user?.id || (await prisma.user.findFirst())?.id;
    const newSubtaskAssignees: { id: string; name: string }[] = (subtask as any).assignees || [];
    const subtaskAdded = newSubtaskAssignees.filter(u => !previousAssignees.some(p => p.id === u.id)).map(u => u.name);
    const subtaskRemoved = previousAssignees.filter(p => !newSubtaskAssignees.some(u => u.id === p.id)).map(p => p.name);
    if (actingUserId) {
      if (computedAssigneeIds !== undefined && Array.isArray(computedAssigneeIds)) {
        await prisma.auditLog.create({
          data: {
            action: 'ASSIGNMENT',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { assignees: (subtask as any).assignees ? (subtask as any).assignees.map((u: any) => u.name) : ((subtask as any).User ? [(subtask as any).User.name] : []), subtaskTitle: subtask.title, added: subtaskAdded, removed: subtaskRemoved }
          }
        });

      }
      // Notify users newly added to or unassigned from the subtask
      if (assigneesChanging) {
        const rawNewlyAssignedIds = newSubtaskAssignees
          .map((u) => u.id)
          .filter((id) => id !== actingUserId && !previousAssignees.some((p) => p.id === id));
        const newlyAssignedIds = await filterUsersByNotificationPreference(rawNewlyAssignedIds, 'assigned');
        const actor = await prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } });

        if (newlyAssignedIds.length > 0) {
          await prisma.taskNotification.createMany({
            data: newlyAssignedIds.map((id) => ({
              userId: id,
              actorId: actingUserId,
              taskId,
              type: 'ASSIGNMENT',
              title: `${actor?.name || 'Someone'} assigned you to subtask ${subtask.title}`,
            })),
          });
          newlyAssignedIds.forEach((id) => {
            io.to(`user:${id}`).emit('notification_received');
          });
        }

        const rawUnassignedIds = previousAssignees
          .filter((p) => !newSubtaskAssignees.some((u) => u.id === p.id))
          .map((p) => p.id)
          .filter((id) => id !== actingUserId);
        const unassignedIds = await filterUsersByNotificationPreference(rawUnassignedIds, 'assigned');

        if (unassignedIds.length > 0) {
          await prisma.taskNotification.createMany({
            data: unassignedIds.map((id) => ({
              userId: id,
              actorId: actingUserId,
              taskId,
              type: 'UNASSIGNMENT',
              title: `${actor?.name || 'Someone'} unassigned you from subtask ${subtask.title}`,
            })),
          });
          unassignedIds.forEach((id) => {
            io.to(`user:${id}`).emit('notification_received');
          });
        }
      }
      if (status !== undefined) {
        await prisma.auditLog.create({
          data: {
            action: 'STATUS_CHANGE',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { oldStatus: oldSubtaskStatus, newStatus: status, subtaskTitle: subtask.title }
          }
        });

        // Notify role recipients and assignees for subtask status change
        (async () => {
          try {
            const parentTask = await prisma.task.findUnique({
              where: { id: taskId },
              select: { id: true, title: true, teamId: true, assigneeId: true, assignees: { select: { id: true } } },
            });
            if (parentTask) {
              const subtaskAssignees = (subtask as any).assignees || [];
              const combinedTask = {
                ...parentTask,
                assignees: [...parentTask.assignees, ...subtaskAssignees],
              };
              const rawRoleRecipients = await getStatusChangeRecipients(status, combinedTask, actingUserId);
              const roleRecipients = await filterUsersByNotificationPreference(rawRoleRecipients, 'status');
              if (roleRecipients.length > 0) {
                const actor = await prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } });
                await prisma.taskNotification.createMany({
                  data: roleRecipients.map((uid: string) => ({
                    userId: uid,
                    actorId: actingUserId,
                    taskId,
                    type: 'STATUS_CHANGE',
                    title: `${actor?.name || 'Someone'} changed status from ${oldSubtaskStatus} to ${status} on subtask ${subtask.title}`,
                  })),
                });
                roleRecipients.forEach((uid: string) => {
                  io.to(`user:${uid}`).emit('notification_received');
                });
              }
            }
          } catch (err) {
            console.error('[Subtask Notification Error]:', err);
          }
        })();
      }
      if (priority !== undefined) {
        await prisma.auditLog.create({
          data: {
            action: 'PRIORITY_CHANGE',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { oldPriority: oldSubtaskPriority, newPriority: priority, subtaskTitle: subtask.title }
          }
        });
      }
      if (assigneeRoleRestrictions !== undefined) {
        await prisma.auditLog.create({
          data: {
            action: 'TEAM_ROLE_CHANGE',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { roles: assigneeRoleRestrictions, subtaskTitle: subtask.title }
          }
        });
      }
    }

    let statusActivity: any = null;
    await invalidateCache(`task:${taskId}`, `task:activities:${taskId}`, 'tasks:all', 'dashboard:all', 'lists:all').catch(() => {});

    const task = await prisma.task.findUnique({ 
      where: { id: taskId }, 
      select: { id: true, listId: true, subtasks: taskInclude.subtasks }
    });
    if (task) {
      io.emit('task:updated', task);
      // After the emit: the dashboard's all-tasks list carries subtasks, so a reload must not serve the old copy
      invalidateCache('tasks:all').catch(() => {});

      // Emit socket events for the newly created audit logs so the frontend updates in real-time
      if (actingUserId) {
        const actorUser = await prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } });
        const authorName = actorUser?.name || 'Someone';

        if (computedAssigneeIds !== undefined && Array.isArray(computedAssigneeIds)) {
          const act = {
            id: Date.now().toString(),
            type: 'assignment',
            author: authorName,
            assigneeName: (subtask as any).assignees?.length ? (subtask as any).assignees.map((u: any) => u.name).join(', ') : ((subtask as any).User ? (subtask as any).User.name : 'Unassigned'),
            added: subtaskAdded,
            removed: subtaskRemoved,
            subtaskTitle: subtask.title,
            date: new Date().toISOString(),
          };
          io.to(`list:${task.listId}`).emit('task_activity', { taskId, activity: act });
        }
        statusActivity = null;
        if (status !== undefined) {
          const act = {
            id: (Date.now() + 1).toString(),
            type: 'status_change',
            author: authorName,
            oldStatus: oldSubtaskStatus,
            newStatus: status,
            subtaskTitle: subtask.title,
            date: new Date().toISOString(),
          };
          statusActivity = act;
          io.to(`list:${task.listId}`).emit('task_activity', { taskId, activity: act });
        }
        if (priority !== undefined) {
          const act = {
            id: (Date.now() + 2).toString(),
            type: 'priority_change',
            author: authorName,
            oldPriority: oldSubtaskPriority,
            newPriority: priority,
            subtaskTitle: subtask.title,
            date: new Date().toISOString(),
          };
          io.to(`list:${task.listId}`).emit('task_activity', { taskId, activity: act });
        }
      }
    }

    // --- ClickUp Sync: update subtask (fire-and-forget) ---
    (async () => {
      try {
        // Always resolve from DB first — survives server restarts
        const sub = await prisma.subtask.findUnique({ where: { id: subtask.id }, select: { externalId: true } });
        let clickUpSubtaskId = sub?.externalId || null;

        // Fallback: name-matching if no externalId stored yet
        if (!clickUpSubtaskId) {
          const parent = await prisma.task.findUnique({ where: { id: taskId }, select: { externalId: true } });
          if (parent?.externalId) {
            clickUpSubtaskId = await findClickUpSubtaskByName(parent.externalId, subtask.title);
            // Persist the found ID so future updates don't need name-matching
            if (clickUpSubtaskId) {
              // @ts-ignore
              await prisma.subtask.update({ where: { id: subtask.id }, data: { externalId: clickUpSubtaskId } });
            }
          }
        }
        
        if (clickUpSubtaskId) {
          const cuPayload: Record<string, any> = {};
          if (title !== undefined) cuPayload.name = title;
          if (description !== undefined) cuPayload.description = description;
          if (status !== undefined) cuPayload.status = mapNexusStatusToClickUp(status);
          if (priority !== undefined) cuPayload.priority = mapNexusPriorityToClickUp(priority);
          if (Object.keys(cuPayload).length > 0) {
            console.log(`[ClickUp Debug] Syncing updateSubtask payload for ${clickUpSubtaskId}:`, cuPayload);
            await safeUpdateClickUpTask(clickUpSubtaskId, cuPayload);
            console.log(`[ClickUp Debug] Sync success for updateSubtask ${clickUpSubtaskId}`);
          }
          // Assignees — ClickUp subtasks are tasks, so the same add/remove sync applies
          if (assigneesChanging) {
            await safeSyncClickUpAssignees(
              clickUpSubtaskId,
              previousAssignees.map((a) => a.email),
              (((subtask as any).assignees ?? []) as Array<{ email?: string | null }>).map((a) => a.email),
            );
          }
        }
      } catch (err: any) {
        console.error('[ClickUp Debug] updateSubtask sync error:', err?.response?.data || err?.message || err);
      }
    })();

    return res.json({ subtask, activity: statusActivity });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteSubtask(req: Request, res: Response) {
  try {
    const { id: taskId, subtaskId } = req.params;
    
    // Fetch first to get externalId
    const subtask = await prisma.subtask.findUnique({ where: { id: subtaskId }, select: { externalId: true } });
    
    await prisma.subtask.delete({ where: { id: subtaskId } });
    await invalidateCache(`task:${taskId}`);

    const task = await prisma.task.findUnique({ 
      where: { id: taskId }, 
      select: { id: true, listId: true, subtasks: taskInclude.subtasks }
    });
    // Global broadcast so the dashboard (no list room) drops the deleted subtask row too
    if (task) io.emit('task:updated', task);
    invalidateCache('tasks:all').catch(() => {});

    // --- ClickUp Sync ---
    (async () => {
      try {
        let cuSubtaskId = subtask?.externalId;
        if (!cuSubtaskId) {
          cuSubtaskId = cuSubtaskIdMap.get(subtaskId);
        }
        if (cuSubtaskId) {
          await safeDeleteClickUpTask(cuSubtaskId);
          cuSubtaskIdMap.delete(subtaskId);
        }
      } catch (err) {
        console.error('[ClickUp] deleteSubtask sync error:', err);
      }
    })();

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// -----------------------------------------------------------------------------
// CHECKLISTS
// -----------------------------------------------------------------------------

export async function createChecklist(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const { name, subtaskId } = req.body;

    const checklist = await prisma.checklist.create({
      data: {
        name: name || 'New Checklist',
        taskId,
        subtaskId: subtaskId || null,
      },
      include: { items: true },
    });

    io.emit('task:checklist_created', { taskId, subtaskId: subtaskId || null, checklist });
    invalidateCache(`task:${taskId}`).catch(console.error);
    if (subtaskId) {
      invalidateCache(`task:${subtaskId}`).catch(console.error);
    }

    // --- ClickUp Sync: create checklist (fire-and-forget) ---
    (async () => {
      try {
        console.log(`[ClickUp] createChecklist sync triggered — nexusChecklistId=${checklist.id}, name="${name}", taskId=${taskId}, subtaskId=${subtaskId || 'none'}`);
        
        // If this checklist belongs to a subtask, find the subtask's ClickUp ID
        let clickUpParentId: string | null = null;
        if (subtaskId) {
          const sub = (await prisma.subtask.findUnique({ where: { id: subtaskId } })) as any;
          clickUpParentId = sub?.externalId || cuSubtaskIdMap.get(subtaskId) || null;
          
          // Fallback: look up subtask by name in ClickUp
          if (!clickUpParentId) {
            const parent = await prisma.task.findUnique({ where: { id: taskId }, select: { externalId: true } });
            if (sub && parent?.externalId) {
              clickUpParentId = await findClickUpSubtaskByName(parent.externalId, sub.title);
              if (clickUpParentId) cuSubtaskIdMap.set(subtaskId, clickUpParentId);
            }
          }
          console.log(`[ClickUp]   subtask externalId=${clickUpParentId}`);
        } else {
          // Parent task checklist
          const parentTask = await prisma.task.findUnique({ where: { id: taskId }, select: { externalId: true } });
          clickUpParentId = parentTask?.externalId || null;
          console.log(`[ClickUp]   parent task externalId=${clickUpParentId}`);
        }

        if (clickUpParentId) {
          console.log(`[ClickUp]   calling safeCreateClickUpChecklist with id=${clickUpParentId}`);
          const cuChecklistId = await safeCreateClickUpChecklist(clickUpParentId, name || 'New Checklist');
          console.log(`[ClickUp]   result cuChecklistId=${cuChecklistId}`);
          if (cuChecklistId) {
            await prisma.checklist.update({ where: { id: checklist.id }, data: { externalId: cuChecklistId } });
            console.log(`[ClickUp]   ✅ saved externalId: ${checklist.id} → ${cuChecklistId}`);
          } else {
            console.warn(`[ClickUp]   ⚠️  safeCreateClickUpChecklist returned null`);
          }
        } else {
          console.warn(`[ClickUp]   ⚠️  no ClickUp parent ID found — sync skipped`);
        }
      } catch (err) {
        console.error('[ClickUp] createChecklist sync error:', err);
      }
    })();

    return res.json({ checklist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateChecklist(req: Request, res: Response) {
  try {
    const { checklistId } = req.params;
    const { name } = req.body;

    const checklist = await prisma.checklist.update({
      where: { id: checklistId },
      data: { name },
      include: { items: true },
    });

    const targetTaskId = req.params.id || (checklist as any).taskId;
    const targetSubtaskId = (checklist as any).subtaskId || null;
    if (targetTaskId) {
      invalidateCache(`task:${targetTaskId}`).catch(console.error);
    }
    if (targetSubtaskId) {
      invalidateCache(`task:${targetSubtaskId}`).catch(console.error);
    }

    // --- ClickUp Sync: rename checklist ---
    (async () => {
      try {
        const cl = await prisma.checklist.findUnique({ where: { id: checklistId }, select: { externalId: true } });
        if (cl?.externalId && !isAiAuditChecklist(cl)) await safeUpdateClickUpChecklist(cl.externalId, name);
      } catch (err) { console.error('[ClickUp] updateChecklist sync error:', err); }
    })();

    return res.json({ checklist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklist(req: Request, res: Response) {
  try {
    const { checklistId } = req.params;
    
    // Fetch first to map to ClickUp before deletion
    const cl = await prisma.checklist.findUnique({
      where: { id: checklistId },
      select: { name: true, taskId: true, subtaskId: true, externalId: true },
    });
    
    await prisma.checklist.delete({ where: { id: checklistId } });
    io.emit('task:checklist_deleted', { taskId: cl?.taskId || req.params.id, subtaskId: cl?.subtaskId || null, checklistId });

    const targetTaskId = cl?.taskId || req.params.id;
    const targetSubtaskId = cl?.subtaskId || null;
    if (targetTaskId) {
      invalidateCache(`task:${targetTaskId}`).catch(console.error);
    }
    if (targetSubtaskId) {
      invalidateCache(`task:${targetSubtaskId}`).catch(console.error);
    }

    // --- ClickUp Sync ---
    (async () => {
      try {
        // Nexus-only AI audits: never look up (and delete) a ClickUp "Audit" checklist by name.
        if (isAiAuditChecklist(cl)) return;
        let cuChecklistId: string | null | undefined = cl?.externalId;
        if (!cuChecklistId && cl) {
          // If we don't have it in memory, try looking it up in ClickUp by name
          let parentExternalId = null;
          if (cl.subtaskId) {
            const st = await prisma.subtask.findUnique({ where: { id: cl.subtaskId }, select: { title: true, externalId: true } });
            parentExternalId = st?.externalId;
            if (!parentExternalId) {
               const parent = await prisma.task.findUnique({ where: { id: cl.taskId }, select: { externalId: true } });
               if (st && parent?.externalId) {
                 const { findClickUpSubtaskByName } = require('../services/clickupService');
                 parentExternalId = await findClickUpSubtaskByName(parent.externalId, st.title);
               }
            }
          } else {
            const task = await prisma.task.findUnique({ where: { id: cl.taskId }, select: { externalId: true } });
            parentExternalId = task?.externalId;
          }
          if (parentExternalId) {
            cuChecklistId = await findClickUpChecklistByName(parentExternalId, cl.name);
          }
        }

        if (cuChecklistId) {
          await safeDeleteClickUpChecklist(cuChecklistId);
        }
      } catch (err) {
        console.error('[ClickUp] deleteChecklist sync error:', err);
      }
    })();

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createChecklistItem(req: Request, res: Response) {
  try {
    let { checklistId } = req.params;
    const { text, completed, assigneeId, subtaskId, checklistName } = req.body;
    const taskId = req.params.id;
    const userId = (req as any).user?.id;

    // Check if checklist exists or find/create it atomically if checklistId is temporary or named 'audit'
    let checklist: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(checklistId);
    if (isUuid) {
      checklist = await prisma.checklist.findUnique({
        where: { id: checklistId },
        select: { id: true, name: true, taskId: true, subtaskId: true, externalId: true },
      });
    }

    if (!checklist) {
      const targetName = checklistName || 'Audit';
      checklist = await prisma.checklist.findFirst({
        where: {
          taskId,
          subtaskId: subtaskId || null,
          name: targetName,
        },
        select: { id: true, name: true, taskId: true, subtaskId: true, externalId: true },
      });

      if (!checklist) {
        checklist = await prisma.checklist.create({
          data: {
            name: targetName,
            taskId,
            subtaskId: subtaskId || null,
          },
          select: { id: true, name: true, taskId: true, subtaskId: true, externalId: true },
        });
        io.emit('task:checklist_created', { taskId, subtaskId: subtaskId || null, checklist });
      }
      checklistId = checklist.id;
    }

    const data: any = {
      text: text || '',
      checklistId,
    };
    if (completed !== undefined) {
      data.completed = Boolean(completed);
      if (completed && userId) {
        data.checkedById = userId;
      }
    }
    if (assigneeId !== undefined) {
      data.assigneeId = assigneeId === '' ? null : assigneeId;
    }

    const item = await prisma.checklistItem.create({
      data,
      include: {
        checkedBy: { select: { id: true, name: true, avatarUrl: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        checklist: {
          select: {
            id: true,
            name: true,
            externalId: true,
            taskId: true,
            subtaskId: true,
            task: {
              select: {
                id: true,
                title: true,
                teamId: true,
                assigneeId: true,
                listId: true,
                assignees: { select: { id: true } },
              },
            },
            subtask: {
              select: {
                id: true,
                title: true,
                taskId: true,
                assigneeId: true,
                assignees: { select: { id: true } },
                task: {
                  select: {
                    id: true,
                    title: true,
                    teamId: true,
                    assigneeId: true,
                    listId: true,
                    assignees: { select: { id: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const targetTaskId = item.checklist?.taskId || taskId;
    const targetSubtaskId = item.checklist?.subtaskId || null;
    io.emit('task:checklist_item_created', { taskId: targetTaskId, subtaskId: targetSubtaskId, checklistId, item });

    // ONLY invalidate the specific task and subtask in Redis.
    // NEVER invalidate 'tasks:all' or 'dashboard:all' here — doing so evicts the 1200+ task list cache,
    // causing a 12-20s cold Postgres query storm that blocks the Prisma connection pool!
    if (targetTaskId) {
      invalidateCache(`task:${targetTaskId}`).catch(console.error);
      invalidateCache(`task:activities:${targetTaskId}`).catch(console.error);
    }
    if (targetSubtaskId) {
      invalidateCache(`task:${targetSubtaskId}`).catch(console.error);
      invalidateCache(`task:activities:${targetSubtaskId}`).catch(console.error);
    }

    // --- Background Operations: AuditLog & Notifications (Immediate), ClickUp Sync (Isolated) ---
    (async () => {
      try {
        if (text && text.startsWith('!')) return; // Internal Nexus exclusion marker
        const cl = item.checklist || checklist;

        // 1. AuditLog & Role Notifications on Item Check (completed === true)
        if (completed === true && cl) {
          const targetTask = cl.task || cl.subtask?.task;
          const subtask = cl.subtask;
          const isAudit = isAuditItem(cl.name, item.text, cl.externalId);

          const actor = userId
            ? await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, avatarUrl: true, email: true },
              })
            : null;
          const actorName = actor?.name || 'Someone';

          const notifTitle = formatChecklistNotificationTitle(
            actorName,
            item.text,
            targetTask?.title || subtask?.title || 'task',
            isAudit
          );

          const log = await prisma.auditLog.create({
            data: {
              action: isAudit ? 'AUDIT_ITEM_CHECKED' : 'CHECKLIST_ITEM_CHECKED',
              entity: 'TASK',
              entityId: targetTask?.id || subtask?.taskId || '',
              userId: userId || '',
              details: {
                isAudit,
                itemId: item.id,
                itemName: item.text,
                checklistId: cl.id,
                checklistName: cl.name,
                subtaskTitle: subtask?.title,
              },
            },
          });

          if (targetTask) {
            const combinedAssignees = [
              ...(targetTask.assignees || []),
              ...(subtask?.assignees || []),
            ];
            const rawRecipients = await getChecklistCheckRecipients(
              {
                id: targetTask.id,
                teamId: targetTask.teamId,
                assigneeId: targetTask.assigneeId,
                assignees: combinedAssignees,
              },
              userId
            );

            const recipients = await filterUsersByNotificationPreference(
              rawRecipients,
              isAudit ? 'audits' : 'checklists'
            );

            if (recipients.length > 0) {
              await prisma.taskNotification.createMany({
                data: recipients.map((rId: string) => ({
                  userId: rId,
                  actorId: userId,
                  taskId: targetTask.id,
                  type: isAudit ? 'AUDIT_ITEM_CHECKED' : 'CHECKLIST_ITEM_CHECKED',
                  title: notifTitle,
                })),
              });

              recipients.forEach((rId: string) => {
                io.to(`user:${rId}`).emit('notification_received');
              });
            }

            const activity = {
              id: log.id,
              type: isAudit ? 'audit_item_checked' : 'checklist_item_checked',
              author: actorName,
              itemName: item.text,
              checklistName: cl.name,
              isAudit,
              date: log.createdAt,
              user: actor,
              subtaskTitle: subtask?.title,
            };

            io.emit('task_activity', { listId: targetTask.listId, taskId: targetTask.id, activity });
          }
        }

        // 2. Checklist Item Assignment Notification
        if (assigneeId && cl) {
          const targetTask = cl.task || cl.subtask?.task;
          const subtask = cl.subtask;
          const actor = userId
            ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
            : null;
          const actorName = actor?.name || 'Someone';

          if (assigneeId !== userId) {
            const shouldNotify = await filterUsersByNotificationPreference([assigneeId], 'checklists');
            if (shouldNotify.length > 0) {
              await prisma.taskNotification.create({
                data: {
                  userId: assigneeId,
                  actorId: userId || '',
                  taskId: targetTask?.id || subtask?.taskId || '',
                  type: 'CHECKLIST_ITEM_ASSIGNED',
                  title: `${actorName} assigned you "${item.text}" in ${cl.name || 'Checklist'}`,
                },
              });
              io.to(`user:${assigneeId}`).emit('notification_received');
            }
          }
        }

        // 3. ClickUp Sync (Isolated in try/catch so network/API errors never block audit/activity)
        // Nexus-only AI audits: never attach to a ClickUp "Audit" checklist found by name.
        if (!isAiAuditChecklist(cl)) try {
          let cuChecklistId = cl?.externalId;
          if (!cuChecklistId && cl) {
            let parentExternalId = null;
            if (cl.subtaskId) {
              const st = await prisma.subtask.findUnique({ where: { id: cl.subtaskId }, select: { title: true, externalId: true } });
              parentExternalId = st?.externalId;
              if (!parentExternalId) {
                const parent = await prisma.task.findUnique({ where: { id: cl.taskId }, select: { externalId: true } });
                if (st && parent?.externalId) {
                  const { findClickUpSubtaskByName } = require('../services/clickupService');
                  parentExternalId = await findClickUpSubtaskByName(parent.externalId, st.title);
                }
              }
            } else {
              const parentTask = await prisma.task.findUnique({ where: { id: cl.taskId }, select: { externalId: true } });
              parentExternalId = parentTask?.externalId;
            }

            if (parentExternalId) {
              const clickUpTaskId = extractClickUpTaskId(parentExternalId);
              const foundId = await findClickUpChecklistByName(clickUpTaskId, cl.name);
              if (foundId) {
                await prisma.checklist.update({ where: { id: checklistId }, data: { externalId: foundId } });
                cuChecklistId = foundId;
              }
            }
          }

          if (cuChecklistId) {
            const cuItemId = await safeCreateClickUpChecklistItem(cuChecklistId, text || '');
            if (cuItemId) {
              await prisma.checklistItem.update({ where: { id: item.id }, data: { externalId: cuItemId } });
              if (completed) {
                await safeUpdateClickUpChecklistItem(cuChecklistId, cuItemId, { resolved: true });
              }
            }
          }
        } catch (cuErr) {
          console.error('[ClickUp] createChecklistItem sync error:', cuErr);
        }
      } catch (err) {
        console.error('[createChecklistItem background error]:', err);
      }
    })();

    return res.json({ item, checklistId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateChecklistItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    const { text, completed, assigneeId } = req.body;
    
    // We get user making request for checkedBy mapping 
    const userId = (req as any).user?.id;

    const data: any = {};
    if (text !== undefined) data.text = text;
    if (completed !== undefined) {
      data.completed = completed;
      if (completed && userId) {
        data.checkedById = userId;
      } else if (!completed) {
        data.checkedById = null;
      }
    }
    if (assigneeId !== undefined) {
      data.assigneeId = assigneeId === '' ? null : assigneeId;
    }

    const item = await prisma.checklistItem.update({
      where: { id: itemId },
      data,
      include: {
        checkedBy: { select: { id: true, name: true, avatarUrl: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        checklist: { select: { taskId: true, subtaskId: true } },
      },
    });

    const taskId = item.checklist?.taskId || req.params.id;
    const subtaskId = item.checklist?.subtaskId || null;
    io.emit('task:checklist_item_updated', { taskId, subtaskId, checklistId: req.params.checklistId, item });
    if (taskId) {
      invalidateCache(`task:${taskId}`).catch(console.error);
      invalidateCache(`task:activities:${taskId}`).catch(console.error);
    }
    if (subtaskId) {
      invalidateCache(`task:${subtaskId}`).catch(console.error);
      invalidateCache(`task:activities:${subtaskId}`).catch(console.error);
    }

    // --- Background Operations: AuditLog & Notifications (Immediate), ClickUp Sync (Isolated) ---
    (async () => {
      try {
        const itemRef = await prisma.checklistItem.findUnique({ 
          where: { id: itemId }, 
          select: { 
            id: true,
            text: true,
            externalId: true,
            checklist: { 
              select: { 
                id: true,
                name: true,
                externalId: true,
                taskId: true,
                subtaskId: true,
                task: {
                  select: {
                    id: true,
                    title: true,
                    teamId: true,
                    assigneeId: true,
                    listId: true,
                    assignees: { select: { id: true } }
                  }
                },
                subtask: {
                  select: {
                    id: true,
                    title: true,
                    taskId: true,
                    assigneeId: true,
                    assignees: { select: { id: true } },
                    task: {
                      select: {
                        id: true,
                        title: true,
                        teamId: true,
                        assigneeId: true,
                        listId: true,
                        assignees: { select: { id: true } }
                      }
                    }
                  }
                }
              } 
            } 
          }
        });

        // 1. AuditLog & Role Notifications on Item Check / Uncheck
        if (completed !== undefined && itemRef?.checklist) {
          const checklist = itemRef.checklist;
          const targetTask = checklist.task || checklist.subtask?.task;
          const subtask = checklist.subtask;
          const isAudit = isAuditItem(checklist.name, itemRef.text, checklist.externalId);

          const actor = userId
            ? await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, avatarUrl: true, email: true },
              })
            : null;
          const actorName = actor?.name || 'Someone';

          const notifTitle = formatChecklistNotificationTitle(
            actorName,
            itemRef.text,
            targetTask?.title || subtask?.title || 'task',
            isAudit
          );

          // Create AuditLog entry
          const log = await prisma.auditLog.create({
            data: {
              action: completed 
                ? (isAudit ? 'AUDIT_ITEM_CHECKED' : 'CHECKLIST_ITEM_CHECKED')
                : (isAudit ? 'AUDIT_ITEM_UNCHECKED' : 'CHECKLIST_ITEM_UNCHECKED'),
              entity: 'TASK',
              entityId: targetTask?.id || subtask?.taskId || '',
              userId: userId || '',
              details: {
                isAudit,
                completed,
                itemId: itemRef.id,
                itemName: itemRef.text,
                checklistId: checklist.id,
                checklistName: checklist.name,
                subtaskTitle: subtask?.title,
              },
            },
          });

          // Recipients: Assignees of task + subtask (only notify on check)
          if (targetTask) {
            if (completed) {
              const combinedAssignees = [
                ...(targetTask.assignees || []),
                ...(subtask?.assignees || []),
              ];
              const rawRecipients = await getChecklistCheckRecipients(
                {
                  id: targetTask.id,
                  teamId: targetTask.teamId,
                  assigneeId: targetTask.assigneeId,
                  assignees: combinedAssignees,
                },
                userId
              );

              const recipients = await filterUsersByNotificationPreference(
                rawRecipients,
                isAudit ? 'audits' : 'checklists'
              );

              if (recipients.length > 0) {
                await prisma.taskNotification.createMany({
                  data: recipients.map((rId: string) => ({
                    userId: rId,
                    actorId: userId,
                    taskId: targetTask.id,
                    type: isAudit ? 'AUDIT_ITEM_CHECKED' : 'CHECKLIST_ITEM_CHECKED',
                    title: notifTitle,
                  })),
                });

                recipients.forEach((rId: string) => {
                  io.to(`user:${rId}`).emit('notification_received');
                });
              }
            }

            // Realtime socket broadcast for Activity page and board
            const activity = {
              id: log.id,
              type: completed
                ? (isAudit ? 'audit_item_checked' : 'checklist_item_checked')
                : (isAudit ? 'audit_item_unchecked' : 'checklist_item_unchecked'),
              author: actorName,
              itemName: itemRef.text,
              checklistName: checklist.name,
              isAudit,
              date: log.createdAt,
              user: actor,
              subtaskTitle: subtask?.title,
            };

            io.emit('task_activity', { listId: targetTask.listId, taskId: targetTask.id, activity });
          }
        }

        // 2. Checklist Item Assignment Notification
        if (assigneeId !== undefined && assigneeId && itemRef?.checklist) {
          const checklist = itemRef.checklist;
          const targetTask = checklist.task || checklist.subtask?.task;
          const subtask = checklist.subtask;
          const actor = userId
            ? await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true },
              })
            : null;
          const actorName = actor?.name || 'Someone';

          if (assigneeId !== userId) {
            const shouldNotify = await filterUsersByNotificationPreference([assigneeId], 'checklists');
            if (shouldNotify.length > 0) {
              await prisma.taskNotification.create({
                data: {
                  userId: assigneeId,
                  actorId: userId || '',
                  taskId: targetTask?.id || subtask?.taskId || '',
                  type: 'CHECKLIST_ITEM_ASSIGNED',
                  title: `${actorName} assigned you "${itemRef.text}" in ${checklist.name || 'Checklist'}`,
                },
              });
              io.to(`user:${assigneeId}`).emit('notification_received');
            }
          }
        }

        // 3. ClickUp Sync (Isolated in try/catch)
        if (itemRef?.externalId && itemRef.checklist?.externalId) {
          try {
            const cuPayload: { name?: string; resolved?: boolean } = {};
            if (text !== undefined) cuPayload.name = text;
            if (completed !== undefined) cuPayload.resolved = completed;
            if (Object.keys(cuPayload).length > 0) {
              await safeUpdateClickUpChecklistItem(itemRef.checklist.externalId, itemRef.externalId, cuPayload);
            }
          } catch (cuErr) {
            console.error('[ClickUp] updateChecklistItem sync error:', cuErr);
          }
        }
      } catch (err) {
        console.error('[updateChecklistItem background error]:', err);
      }
    })();

    return res.json({ item });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklistItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    const item = await prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: {
        text: true,
        externalId: true,
        checklistId: true,
        checklist: { select: { externalId: true, taskId: true, subtaskId: true } },
      },
    });

    const targetTaskId = item?.checklist?.taskId || req.params.id;
    const targetSubtaskId = item?.checklist?.subtaskId || null;

    if (!item) {
      if (targetTaskId) {
        invalidateCache(`task:${targetTaskId}`).catch(console.error);
      }
      return res.json({ success: true, message: 'Item already deleted' });
    }

    await prisma.checklistItem.delete({ where: { id: itemId } });

    if (targetTaskId) {
      invalidateCache(`task:${targetTaskId}`).catch(console.error);
    }
    if (targetSubtaskId) {
      invalidateCache(`task:${targetSubtaskId}`).catch(console.error);
    }

    io.emit('task:checklist_item_deleted', {
      taskId: targetTaskId,
      subtaskId: item?.checklist?.subtaskId || null,
      checklistId: item?.checklistId || req.params.checklistId,
      itemId,
      text: item?.text,
    });

    // --- ClickUp Sync ---
    if (item?.externalId && item.checklist?.externalId) {
      safeDeleteClickUpChecklistItem(item.checklist.externalId, item.externalId).catch(console.error);
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/:id/attachments
export async function createTaskAttachment(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { fileName, fileUrl, fileKey, fileSize, mimeType } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const attachment = await prisma.attachment.create({
      data: {
        fileName,
        fileUrl,
        fileKey,
        fileSize,
        mimeType,
        taskId: id,
        uploadedById: userId,
      }
    });

    // Notify connected clients via Socket
    io.emit('task:attachment:created', { taskId: id, attachment });

    return res.status(201).json({ attachment });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/tasks/:id/attachments/:attachmentId
export async function deleteTaskAttachment(req: Request, res: Response) {
  try {
    const { id, attachmentId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment || attachment.taskId !== id) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    await prisma.attachment.delete({
      where: { id: attachmentId }
    });

    // Notify connected clients via Socket
    io.emit('task:attachment:deleted', { taskId: id, attachmentId });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/:id/recurring
export async function setTaskRecurrence(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { recurringConfig, triggerImmediate = true } = req.body;

    const current = await prisma.task.findUnique({ where: { id }, select: { status: true } });
    let finalConfig = recurringConfig as any;
    if (finalConfig && current) {
      const statusUpper = (current.status || '').toUpperCase();
      if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(statusUpper)) {
        finalConfig.frequency = statusUpper;
      }
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        recurringConfig: finalConfig,
      },
      include: taskInclude,
    });

    await invalidateCache('tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');
    io.emit('task:updated', task);

    let duplicatedTask = null;
    if (triggerImmediate && recurringConfig && recurringConfig.time) {
      duplicatedTask = await duplicateRecurringTask(id);
    }

    return res.json({ task, duplicatedTask });
  } catch (err: any) {
    console.error('setTaskRecurrence error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/:id/duplicate-pending
export async function duplicateTaskToPending(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const duplicatedTask = await duplicateRecurringTask(id);
    return res.json({ task: duplicatedTask });
  } catch (err: any) {
    console.error('duplicateTaskToPending error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/recurring/rollover
export async function triggerRecurringRollover(req: Request, res: Response) {
  try {
    const { dateOverride, force } = req.body || {};
    const result = await runRecurringDailyRollover({ dateOverride, force });
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('triggerRecurringRollover error:', err);
    return res.status(500).json({ error: err.message });
  }
}


