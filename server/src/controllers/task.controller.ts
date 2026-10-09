import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getR2PresignedUrl } from '../services/r2Service';
import { getCache, setCache, invalidateCache } from '../services/redisService';
import { taskUpdatesQueue } from '../queues/task.queue';
import { getPositionAfter } from '../services/taskOrderService';
import { io } from '../server';
import {
  safeCreateClickUpTask,
  safeUpdateClickUpTask,
  safeDeleteClickUpTask,
  safeCreateClickUpComment,
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

// In-memory maps: nexus ID -> ClickUp ID (avoids needing a DB migration)
const cuChecklistIdMap = new Map<string, string>(); // nexusChecklistId -> cuChecklistId
const cuChecklistItemIdMap = new Map<string, { cuChecklistId: string; cuItemId: string }>(); // nexusItemId -> { cuChecklistId, cuItemId }
const cuSubtaskIdMap = new Map<string, string>(); // nexusSubtaskId -> cuSubtaskId


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
    if (r.includes('design')) audits.add('Design Audit');
    if (r.includes('funnel') || r.includes('backend')) audits.add('Funnel Audit');
  });

  // 1. Graphics, Reels, Video, Samples -> ONLY Design
  if (t.match(/graphic|reel|video|sample/)) {
    audits.add('Design Audit');
  }

  // 2. Newsletters, Emails, Social Media Packages -> Design + Funnel
  if (t.match(/email|newsletter|social media/)) {
    audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  // 3. Websites, Links, Landing Pages -> ALL THREE
  if (t.match(/website|page|funnel|link/)) {
    audits.add('UI UX Audit');
    audits.add('Design Audit');
    audits.add('Funnel Audit');
  }

  return Array.from(audits);
};

const taskInclude = {
  subtasks: {
    orderBy: { createdAt: 'asc' } as any,
    include: {
      User: { select: { id: true, name: true, email: true, avatarUrl: true } },
      assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true } },
      team: { select: { id: true, name: true, color: true } },
      comments: { 
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } }
        },
        orderBy: { createdAt: 'asc' } as any
      },
      checklists: { 
        include: { 
          items: {
            include: { checkedBy: { select: { id: true, name: true, avatarUrl: true } } }
          } 
        } 
      },
    }
  },
  checklists: { 
    where: { subtaskId: null },
    include: { 
      items: {
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

// GET /api/tasks - Redis Cache-Aside
export async function listTasks(req: Request, res: Response) {
  try {
    const { listId, assigneeId, status, lightweight } = req.query as Record<string, string | undefined>;
    const cacheKey = `tasks:all:${listId || 'all'}:${assigneeId || 'all'}:${status || 'all'}:${lightweight || 'false'}`;

    const cachedTasks = await getCache<any[]>(cacheKey);
    if (cachedTasks) {
      return res.json({ tasks: cachedTasks, cached: true });
    }

    console.time('[API] listTasks db query');
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
            list: { select: { id: true, name: true, space: { select: { id: true, name: true } }, folder: { select: { id: true, name: true } } } }
          }
        : taskInclude,
      orderBy: { createdAt: 'desc' },
    });
    console.timeEnd('[API] listTasks db query');

    await setCache(cacheKey, tasks, 300);

    return res.json({ tasks, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
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

    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Cache under the actual task ID, not the requested ID (in case it was a subtask ID)
    await setCache(`task:${task.id}`, task, 300);

    return res.json({ task, subtask: foundSubtask, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/batch - fetch many tasks in one round trip (used by docs with many task mentions).
// Returns results keyed by the requested ID, each shaped like GET /api/tasks/:id ({ task, subtask }).
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
      // 2. Missing IDs as tasks, in one query
      const tasks = await prisma.task.findMany({ where: { id: { in: missing } }, include: taskInclude });
      const taskById = new Map(tasks.map(t => [t.id, t]));

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
      const parentIds = Array.from(new Set(subtasks.map(s => s.taskId))).filter(id => !taskById.has(id));
      if (parentIds.length > 0) {
        const parents = await prisma.task.findMany({ where: { id: { in: parentIds } }, include: taskInclude });
        parents.forEach(p => taskById.set(p.id, p));
      }

      missing.forEach(id => {
        const task = taskById.get(id);
        if (task) results[id] = { task, subtask: null };
      });
      subtasks.forEach(s => {
        const parent = taskById.get(s.taskId);
        if (parent) results[s.id] = { task: parent, subtask: s };
      });

      // Warm the per-task cache without blocking the response
      Promise.all(Array.from(taskById.values()).map(t => setCache(`task:${t.id}`, t, 300))).catch(() => {});
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
    } = req.body;

    const effectiveAssigneeId = (assigneeIds && assigneeIds.length > 0) ? assigneeIds[0] : (assigneeId || null);
    const position = afterTaskId ? await getPositionAfter(listId, afterTaskId) : null;

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status: status || 'TODO',
        priority: priority || 'MEDIUM',
        listId,
        assigneeId: effectiveAssigneeId,
        ...(assigneeIds && assigneeIds.length > 0
          ? { assignees: { connect: assigneeIds.map((id: string) => ({ id })) } }
          : assigneeId
          ? { assignees: { connect: [{ id: assigneeId }] } }
          : {}),
        teamId: teamId || null,
        creatorId,
        dueDate: dueDate ? new Date(dueDate) : null,
        startDate: startDate ? new Date(startDate) : null,
        assigneeRoleRestrictions: assigneeRoleRestrictions || [],
        teamAssignAccessRole: teamAssignAccessRole || null,
        position,
      },
      include: taskInclude,
    });

    await invalidateCache('tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

    // Backend injection into Daily Rollover doc
    try {
      const docs = await prisma.doc.findMany({ where: { isDailyRollover: true } });
      for (const doc of docs) {
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

        let blocks = [];
        try {
          blocks = JSON.parse(dayPage.content);
        } catch(e) {}

        let clientName = task.list?.name || 'Unknown Client';
        let clientHeaderIndex = blocks.findIndex((b: any) => {
          if (b.type !== 'text') return false;
          const stripped = b.content.replace(/<[^>]+>/g, '').trim();
          return b.content.match(/<h[1-6]/) && stripped.toLowerCase() === clientName.toLowerCase();
        });
        if (clientHeaderIndex === -1) {
          blocks.push({
            id: `blk-h-${Date.now()}-${clientName.replace(/\s+/g, '')}`,
            type: 'text',
            content: `<h2>${clientName}</h2>`
          });
          clientHeaderIndex = blocks.length - 1;
        }

        let insertClientIndex = clientHeaderIndex + 1;
        while (insertClientIndex < blocks.length) {
          const nextBlock = blocks[insertClientIndex];
          if (nextBlock.type === 'text' && (nextBlock.content.startsWith('<h2') || nextBlock.content.startsWith('<h3'))) {
            break;
          }
          insertClientIndex++;
        }

        // Backtrack to skip over trailing empty spaces so we insert BEFORE the gap
        while (insertClientIndex > clientHeaderIndex + 1) {
          const prevBlock = blocks[insertClientIndex - 1];
          if (prevBlock.type === 'text' && (prevBlock.content === '<p></p>' || prevBlock.content === '<p><br></p>' || prevBlock.content.trim() === '')) {
            insertClientIndex--;
          } else {
            break;
          }
        }

                const escapedTitle = task.title.replace(/"/g, '&quot;');
        const statusColor = '#3b82f6';
        const taskStatusStr = JSON.stringify({ name: task.status, color: statusColor }).replace(/"/g, '&quot;');
        const assigneesStr = JSON.stringify(task.assignees || []).replace(/"/g, '&quot;');

        blocks.splice(insertClientIndex, 0, {
          id: `blk-t-${Date.now()}-${task.id}`,
          type: 'text',
          content: `<p><span data-type="mention" data-id="${task.id}" data-label="${escapedTitle}" data-mention-type="task" data-task-status="${taskStatusStr}" data-task-assignees="${assigneesStr}" data-task-list-name="${clientName}">@${escapedTitle}</span></p>`
        });

        // Ensure a trailing spacer below the new task if there isn't one
        if (insertClientIndex + 1 < blocks.length) {
          const nextBlock = blocks[insertClientIndex + 1];
          if (nextBlock.type === 'text' && (nextBlock.content.startsWith('<h2') || nextBlock.content.startsWith('<h3'))) {
            blocks.splice(insertClientIndex + 1, 0, { id: `blk-space-${Date.now()}-${clientName.replace(/\s+/g, '')}`, type: 'text', content: '<p></p>' });
          }
        } else if (insertClientIndex === blocks.length - 1) {
           blocks.push({ id: `blk-space-${Date.now()}-${clientName.replace(/\s+/g, '')}`, type: 'text', content: '<p></p>' });
        }

        let newTasksHeaderIndex = blocks.findIndex((b: any) => {
          if (b.type !== 'text') return false;
          const stripped = b.content.replace(/<[^>]+>/g, '').trim();
          return b.content.match(/<h[1-6]/) && stripped.toLowerCase() === 'new tasks';
        });
        if (newTasksHeaderIndex === -1) {
          blocks.push({
            id: `blk-h-${Date.now()}-NewTasks`,
            type: 'text',
            content: '<h3>New Tasks</h3>'
          });
          newTasksHeaderIndex = blocks.length - 1;
        }

        let insertNewTasksIndex = newTasksHeaderIndex + 1;
        while (insertNewTasksIndex < blocks.length) {
          const nextBlock = blocks[insertNewTasksIndex];
          if (nextBlock.type === 'text' && (nextBlock.content.startsWith('<h2') || nextBlock.content.startsWith('<h3'))) {
            break;
          }
          insertNewTasksIndex++;
        }

        blocks.splice(insertNewTasksIndex, 0, {
          id: `blk-t-${Date.now()}-${task.id}-n`,
          type: 'text',
          content: `<p><span data-type="mention" data-id="${task.id}" data-label="${escapedTitle}" data-mention-type="task" data-task-status="${taskStatusStr}" data-task-assignees="${assigneesStr}" data-task-list-name="${clientName}">@${escapedTitle}</span></p>`
        });
        
        await prisma.page.update({
          where: { id: dayPage.id },
          data: { content: JSON.stringify(blocks) }
        });
        
        io.to(`doc:${doc.id}`).emit('page_updated', { pageId: dayPage.id });
      }
    } catch (err) {
      console.error('Failed to inject task into daily rollover:', err);
    }

    // Broadcast new task to the list room and globally for real-time sync
    io.to(`list:${listId}`).emit('task:created', task);
    io.emit('task:created', task);

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

    return res.status(201).json({ task });
  } catch (err: any) {
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

async function resolveUsersFromRoles(roleRestrictions: string[]): Promise<string[]> {
  if (!roleRestrictions || roleRestrictions.length === 0) return [];
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { roles: { hasSome: roleRestrictions } },
        {
          team: {
            teamRoles: {
              some: { name: { in: roleRestrictions, mode: 'insensitive' } }
            }
          }
        }
      ]
    },
    select: { id: true }
  });
  return users.map(u => u.id);
}

// PATCH /api/tasks/:id
export async function updateTask(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const authReq = req as any;
    const {
      title, description, status, priority,
      listId, assigneeId, assigneeIds, teamId, dueDate, startDate, currentListId, userId,
      assigneeRoleRestrictions, teamAssignAccessRole,
    } = req.body;
    const effectiveUser = authReq.user || (userId ? { id: userId } : null);

    // Status lock is now open to all, only audit checklist completion is checked later.

    const currentTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
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
      const restrictedStatuses = ['in review', 'inreview', 'checking', 'crm'];
      if (restrictedStatuses.includes(status.toLowerCase())) {
        // Find if ANY subtask is NOT "Closed"
        const hasUnclosedSubtasks = currentTask.subtasks.some((st: any) => st.status.toLowerCase() !== 'closed');
        if (hasUnclosedSubtasks) {
          return res.status(400).json({ error: `Cannot move to ${status}: All subtasks must be Closed first.` });
        }
      }
    }

    if (status !== undefined && status.toLowerCase() === 'checking') {
      // Check task audit checklists
      const requiredTaskAudits = getRequiredAudits(currentTask.title, (currentTask as any).assigneeRoleRestrictions);
      const auditChecklists = currentTask.checklists.filter((c: any) => c.name.toLowerCase().includes('audit'));
      for (const c of auditChecklists) {
        if (c.items.some((i: any) => requiredTaskAudits.includes(i.text) && !i.completed)) {
          return res.status(400).json({ error: `Cannot move to ${status}: Required audits for task are not fully completed.` });
        }
      }

      // Check subtasks audit checklists
      for (const subtask of currentTask.subtasks) {
        const requiredSubtaskAudits = getRequiredAudits(subtask.title, (subtask as any).assigneeRoleRestrictions);
        const subtaskAuditChecklists = subtask.checklists.filter((c: any) => c.name.toLowerCase().includes('audit'));
        for (const c of subtaskAuditChecklists) {
          if (c.items.some((i: any) => requiredSubtaskAudits.includes(i.text) && !i.completed)) {
            return res.status(400).json({ error: `Cannot move to ${status}: Subtask "${subtask.title}" required audits are not fully completed.` });
          }
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
    }
    
    if (teamId !== undefined) {
      payload.team = teamId ? await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true, color: true }
      }) : null;
    }

    // Broadcast IMMEDIATELY after update
    const roomListId = listId || currentListId || currentTask.listId;
    if (roomListId) {
      io.to(`list:${roomListId}`).emit('task:updated', payload);
    }
    // Global broadcast so dashboards and other lists update in real-time
    io.emit('task:updated', payload);

    // Return the response immediately so the client doesn't wait
    res.json({ task: payload, queued: true });

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
    invalidateCache(`task:${taskId}`, 'tasks:all', 'spaces:all', 'dashboard:all', 'lists:all').catch(console.error);

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
            if (roomListId) {
              io.to(`list:${roomListId}`).emit('task_activity', { listId: roomListId, taskId, activity: act });
            }
            io.emit('task_activity', { taskId, activity: act });
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

            const usersToNotify = currentTask.assignees
              .map((a: any) => a.id)
              .filter((id: any) => id !== actingUserId);

            if (usersToNotify.length > 0) {
              await prisma.taskNotification.createMany({
                data: usersToNotify.map((id: any) => ({
                  userId: id,
                  actorId: actingUserId,
                  taskId,
                  type: 'STATUS_CHANGE',
                  title: `${user?.name || 'Someone'} changed the status to ${status}`,
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
            if (newlyAssigned.length > 0) {
              const newAssigneesToNotify = newlyAssigned.filter((id: string) => id !== actingUserId);
              if (newAssigneesToNotify.length > 0) {
                await prisma.taskNotification.createMany({
                  data: newAssigneesToNotify.map((id: string) => ({
                    userId: id,
                    actorId: actingUserId,
                    taskId,
                    type: 'ASSIGNMENT',
                    title: `${user?.name || 'Someone'} assigned this task to you`,
                  })),
                });
                newAssigneesToNotify.forEach((id: string) => {
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
            if (assigneeId && assigneeId !== actingUserId) {
              await prisma.taskNotification.create({
                data: {
                  userId: assigneeId,
                  actorId: actingUserId,
                  taskId,
                  type: 'ASSIGNMENT',
                  title: `${user?.name || 'Someone'} assigned this task to you`,
                },
              });
              io.to(`user:${assigneeId}`).emit('notification_received');
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

    if (taskToDelete?.listId) {
      io.to(`list:${taskToDelete.listId}`).emit('task:deleted', { id: taskId });
    }
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
      select: { id: true, status: true, listId: true, creatorId: true, externalId: true, assignees: { select: { id: true } } },
    });

    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const oldStatus = currentTask.status;

    // Immediately persist to DB (scalar fields only for max speed)
    if (status && status.toLowerCase() === 'revision') {
      const auditChecklist = await prisma.checklist.findFirst({
        where: { taskId: id, subtaskId: null, name: { equals: 'Audit', mode: 'insensitive' } },
      });
      if (auditChecklist) {
        await prisma.checklistItem.updateMany({
          where: { checklistId: auditChecklist.id },
          data: { completed: false },
        });
      }
    }
    const updated = await prisma.task.update({
      where: { id },
      data: { status },
    });

    // Broadcast IMMEDIATELY after update
    const roomListId = currentListId || currentTask.listId;
    if (roomListId) {
      io.to(`list:${roomListId}`).emit('task:updated', updated);
    }
    io.emit('task:updated', updated);

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
    invalidateCache(`task:${id}`, 'tasks:all', 'spaces:all', 'dashboard:all', 'lists:all').catch(err => {
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
            if (roomListId) {
              io.to(`list:${roomListId}`).emit('task_activity', { listId: roomListId, taskId: id, activity });
            }
            // Global broadcast so the Activity page and dashboards refresh too
            io.emit('task_activity', { taskId: id, activity });

            // Notify assignees (same as updateTask) so the change shows in their "For Me" feed
            const usersToNotify = currentTask.assignees
              .map((a: any) => a.id)
              .filter((uid: string) => uid !== actingUserId);
            if (usersToNotify.length > 0) {
              await prisma.taskNotification.createMany({
                data: usersToNotify.map((uid: string) => ({
                  userId: uid,
                  actorId: actingUserId,
                  taskId: id,
                  type: 'STATUS_CHANGE',
                  title: `${user?.name || 'Someone'} changed the status to ${status}`,
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

    const comment = await prisma.taskComment.create({
      data: {
        content: content.trim(),
        taskId,
        userId: effectiveUserId,
        ...(parentCommentId ? { parentCommentId } : {}),
        ...(subtaskId ? { subtaskId } : {}),
      },
      include: {
        reactions: { include: { user: { select: { id: true, name: true } } } },
        replies: {
          include: {
            reactions: { include: { user: { select: { id: true, name: true } } } },
          },
        },
      },
    });

    // Increment replyCount on parent comment
    if (parentCommentId) {
      await prisma.taskComment.update({
        where: { id: parentCommentId },
        data: { replyCount: { increment: 1 } },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: effectiveUserId },
      select: { id: true, name: true, avatarUrl: true, email: true },
    });

    if (mentionedUserIds && Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
      const usersToNotify = mentionedUserIds.filter((id: any) => id !== effectiveUserId);
      if (usersToNotify.length > 0) {
        await prisma.taskNotification.createMany({
          data: usersToNotify.map((id: string) => ({
            userId: id,
            actorId: effectiveUserId,
            taskId,
            type: 'MENTION',
            title: `${user?.name || 'Someone'} mentioned you in a comment`,
            content: content.trim().substring(0, 100),
          })),
        });
        usersToNotify.forEach((id: string) => {
          io.to(`user:${id}`).emit('notification_received');
        });
      }
    }

    // Notify task assignees about the comment (if they weren't mentioned)
    const taskData = await prisma.task.findUnique({
      where: { id: taskId },
      select: { assignees: { select: { id: true } } }
    });
    if (taskData) {
      const assigneesToNotify = taskData.assignees
        .map((a: any) => a.id)
        .filter((id: any) => id !== effectiveUserId && !(mentionedUserIds && mentionedUserIds.includes(id)));
      
      if (assigneesToNotify.length > 0) {
        await prisma.taskNotification.createMany({
          data: assigneesToNotify.map((id: any) => ({
            userId: id,
            actorId: effectiveUserId,
            taskId,
            type: 'COMMENT',
            title: `${user?.name || 'Someone'} commented on a task you're assigned to`,
            content: content.trim().substring(0, 100),
          })),
        });
        assigneesToNotify.forEach((id: any) => {
          io.to(`user:${id}`).emit('notification_received');
        });
      }
    }

    const log = await prisma.auditLog.create({
      data: {
        action: parentCommentId ? 'REPLY' : 'COMMENT',
        entity: 'TASK',
        entityId: taskId,
        userId: effectiveUserId,
        details: { text: content.trim(), commentId: comment.id, parentCommentId: parentCommentId || null, subtaskId: subtaskId || null },
      },
    });

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
    if (listId) {
      io.to(`list:${listId}`).emit('task:comment_added', payload);
      // Broadcast globally (room members included) so the Activity page, which isn't in list rooms, refreshes live
      io.emit('task_activity', { listId, taskId, activity });
    } else {
      io.emit('task:comment_added', payload);
      io.emit('task_activity', { taskId, activity });
    }

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
          // Only mirror top-level comments (not internal thread replies)
          const authorName = user?.name || 'Nexus';
          // ClickUp requires plain text / markdown, strip HTML generated by the rich text editor
          const plainTextContent = content.trim()
            .replace(/<\/p>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/<[^>]*>?/gm, '')
            .trim();

          const clickupCommentId = await safeCreateClickUpComment(
            clickUpTaskId,
            `**[${authorName}]** ${plainTextContent}`
          );
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
    if (listId) {
      io.to(`list:${listId}`).emit('task:comment_updated', payload);
    } else {
      io.emit('task:comment_updated', payload);
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

    return res.json({ comments: enriched });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}



// GET /api/tasks/:id/activities
export async function getTaskActivities(req: Request, res: Response) {
  try {
    const taskId = req.params.id;

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
        return {
          id: log.id,
          type: 'status_change',
          author: log.user?.name || 'Someone',
          oldStatus: details.oldStatus,
          newStatus: details.newStatus,
          subtaskTitle: details.subtaskTitle,
          date: log.createdAt,
          user: log.user,
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
      return {
        id: log.id,
        type: log.action.toLowerCase(),
        author: log.user?.name || 'Someone',
        details,
        date: log.createdAt,
        user: log.user,
      };
    });

    return res.json({
      taskCreatedAt: task.createdAt,
      creator: task.creator,
      activities,
    });
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

    const tasks = await prisma.task.findMany({
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
      await invalidateCache(`tasks:all:${task.listId}*`);
      io.to(`list:${task.listId}`).emit('task:updated', task);
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

        try {
      const today = new Date();
      const monthTitle = today.toLocaleString('default', { month: 'long', year: 'numeric' });
      const dayTitle = today.toLocaleString('default', { weekday: 'long', month: 'short', day: 'numeric' });
      
      const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
      if (doc) {
        const monthPage = await prisma.page.findFirst({ where: { docId: doc.id, title: monthTitle } });
        if (monthPage) {
          const dayPage = await prisma.page.findFirst({ where: { docId: doc.id, title: dayTitle, parentPageId: monthPage.id } });
          if (dayPage) {
            let blocks = [];
            try { blocks = JSON.parse(dayPage.content); } catch(e) {}
            
            let updated = false;
            let i = 0;
            while (i < blocks.length) {
              if (blocks[i].content && blocks[i].content.includes(`data-id="${taskId}"`) && blocks[i].content.includes('data-mention-type="task"')) {
                const escapedTitle = subtask.title.replace(/"/g, '&quot;');
                blocks.splice(i + 1, 0, {
                  id: `blk-sub-${Date.now()}-${subtask.id}`,
                  type: 'text',
                  content: `<p>&nbsp;&nbsp;&nbsp;&nbsp;└─ <span data-type="mention" data-id="${subtask.id}" data-label="${escapedTitle}" data-mention-type="subtask">@${escapedTitle}</span></p>`
                });
                updated = true;
                i++; // skip new block
              }
              i++;
            }
            if (updated) {
              await prisma.page.update({
                where: { id: dayPage.id },
                data: { content: JSON.stringify(blocks) }
              });
              const { io } = require('../socket');
              io.to(`doc:${doc.id}`).emit('page_updated', { pageId: dayPage.id });
            }
          }
        }
      }
    } catch(err) {
      console.error('Failed to inject subtask', err);
    }

    return res.json({ subtask });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateSubtask(req: Request, res: Response) {
  try {
    const { id: taskId, subtaskId } = req.params;
    const { title, description, completed, assigneeIds, assigneeId, teamId, priority, dueDate, status, assigneeRoleRestrictions, teamAssignAccessRole } = req.body;
    
    if (status !== undefined && status.toLowerCase() === 'checking') {
      const currentSubtask = await prisma.subtask.findUnique({
        where: { id: subtaskId },
        include: { checklists: { include: { items: true } } }
      });
      if (currentSubtask) {
        const requiredSubtaskAudits = getRequiredAudits(currentSubtask.title, (currentSubtask as any).assigneeRoleRestrictions);
        const auditChecklists = currentSubtask.checklists.filter((c: any) => c.name.toLowerCase().includes('audit'));
        for (const c of auditChecklists) {
          if (c.items.some((i: any) => requiredSubtaskAudits.includes(i.text) && !i.completed)) {
            return res.status(400).json({ error: `Cannot move to ${status}: Required audits for subtask are not fully completed.` });
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
      const auditChecklist = await prisma.checklist.findFirst({
        where: { subtaskId: subtaskId, name: { equals: 'Audit', mode: 'insensitive' } },
      });
      if (auditChecklist) {
        await prisma.checklistItem.updateMany({
          where: { checklistId: auditChecklist.id },
          data: { completed: false },
        });
      }
    }

    // Snapshot previous assignees so the activity feed (and ClickUp sync) can tell who was added/removed
    const assigneesChanging = (computedAssigneeIds !== undefined && Array.isArray(computedAssigneeIds)) || assigneeId !== undefined;
    const previousAssignees: { id: string; name: string; email?: string | null }[] = assigneesChanging
      ? ((await prisma.subtask.findUnique({
          where: { id: subtaskId },
          // @ts-ignore
          select: { assignees: { select: { id: true, name: true, email: true } } } as any,
        })) as any)?.assignees || []
      : [];

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

        for (const assigneeId of computedAssigneeIds) {
          if (assigneeId !== actingUserId) {
            await prisma.taskNotification.create({
              data: {
                userId: assigneeId,
                actorId: actingUserId,
                taskId,
                type: 'ASSIGNMENT',
                title: `You were assigned to a subtask: ${subtask.title}`
              }
            });
          }
        }
      }
      if (status !== undefined) {
        await prisma.auditLog.create({
          data: {
            action: 'STATUS_CHANGE',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { newStatus: status, subtaskTitle: subtask.title }
          }
        });
      }
      if (priority !== undefined) {
        await prisma.auditLog.create({
          data: {
            action: 'PRIORITY_CHANGE',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { newPriority: priority, subtaskTitle: subtask.title }
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

    await invalidateCache(`task:${taskId}`);

    const task = await prisma.task.findUnique({ 
      where: { id: taskId }, 
      select: { id: true, listId: true, subtasks: taskInclude.subtasks }
    });
    if (task) {
      io.to(`list:${task.listId}`).emit('task:updated', task);
      
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
          // removed duplicate emit
        }
        if (status !== undefined) {
          const act = {
            id: (Date.now() + 1).toString(),
            type: 'status_change',
            author: authorName,
            oldStatus: undefined,
            newStatus: status,
            subtaskTitle: subtask.title,
            date: new Date().toISOString(),
          };
          io.to(`list:${task.listId}`).emit('task_activity', { taskId, activity: act });
          // removed duplicate emit
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

    return res.json({ subtask });
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
    if (task) io.to(`list:${task.listId}`).emit('task:updated', task);

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

    // --- ClickUp Sync: rename checklist ---
    (async () => {
      try {
        const cl = await prisma.checklist.findUnique({ where: { id: checklistId }, select: { externalId: true } });
        if (cl?.externalId) await safeUpdateClickUpChecklist(cl.externalId, name);
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

    // --- ClickUp Sync ---
    (async () => {
      try {
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
    const { checklistId } = req.params;
    const { text } = req.body;

    const item = await prisma.checklistItem.create({
      data: {
        text: text || '',
        checklistId,
      },
    });

    // --- ClickUp Sync: add checklist item ---
    (async () => {
      try {
        const cl = await prisma.checklist.findUnique({
          where: { id: checklistId },
          select: { name: true, taskId: true, subtaskId: true, externalId: true },
        });
        
        let cuChecklistId = cl?.externalId;

        // 2. Fallback: if not in map (server restart / pre-existing checklist),
        //    look it up from ClickUp by matching the checklist name against the parent task
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
          }
        }
      } catch (err) { console.error('[ClickUp] createChecklistItem sync error:', err); }
    })();

    return res.json({ item });
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
    });

    // --- ClickUp Sync: update checklist item ---
    (async () => {
      try {
        const itemRef = await prisma.checklistItem.findUnique({ 
          where: { id: itemId }, 
          select: { externalId: true, checklist: { select: { externalId: true } } }
        });
        if (itemRef?.externalId && itemRef.checklist?.externalId) {
          const cuPayload: { name?: string; resolved?: boolean } = {};
          if (text !== undefined) cuPayload.name = text;
          if (completed !== undefined) cuPayload.resolved = completed;
          if (Object.keys(cuPayload).length > 0) {
            await safeUpdateClickUpChecklistItem(itemRef.checklist.externalId, itemRef.externalId, cuPayload);
          }
        }
      } catch (err) { console.error('[ClickUp] updateChecklistItem sync error:', err); }
    })();

    return res.json({ item });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklistItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    const item = await prisma.checklistItem.findUnique({ where: { id: itemId }, select: { externalId: true, checklist: { select: { externalId: true } } } });
    await prisma.checklistItem.delete({ where: { id: itemId } });

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

