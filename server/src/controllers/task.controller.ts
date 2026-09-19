import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getR2PresignedUrl } from '../services/r2Service';
import { getCache, setCache, invalidateCache } from '../services/redisService';
import { taskUpdatesQueue } from '../queues/task.queue';
import { io } from '../server';

export const getRequiredAudits = (taskTitle: string) => {
  const t = taskTitle.toLowerCase();
  
  // 1. Graphics, Reels, Video, Samples -> ONLY Design
  if (t.match(/graphic|reel|video|sample/)) {
    return ['Design Audit'];
  }
  
  // 2. Newsletters, Emails, Social Media Packages -> Design + Funnel
  if (t.match(/email|newsletter|social media/)) {
    return ['Design Audit', 'Funnel Audit'];
  }
  
  // 3. Websites, Links, Landing Pages -> ALL THREE
  if (t.match(/website|page|funnel|link/)) {
    return ['UI UX Audit', 'Design Audit', 'Funnel Audit'];
  }
  
  // Default fallback if we don't recognize the type
  return [];
};

const taskInclude = {
  subtasks: {
    include: {
      User: { select: { id: true, name: true, email: true, avatarUrl: true } },
      assignees: { select: { id: true, name: true, email: true, avatarUrl: true, primaryRole: true, secondaryRole: true } },
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
    include: { 
      items: {
        include: { checkedBy: { select: { id: true, name: true, avatarUrl: true } } }
      } 
    } 
  },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  assignees: { select: { id: true, name: true, email: true, avatarUrl: true, primaryRole: true } },
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

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: taskInclude,
    });

    if (!task) return res.status(404).json({ error: 'Task not found' });

    await setCache(cacheKey, task, 300);

    return res.json({ task, cached: false });
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
      assigneeRoleRestrictions, teamAssignAccessRole,
    } = req.body;

    const effectiveAssigneeId = (assigneeIds && assigneeIds.length > 0) ? assigneeIds[0] : (assigneeId || null);

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

        let newTasksIdx = -1;
        for (let i = 0; i < blocks.length; i++) {
          if (blocks[i].content && blocks[i].content.includes('>New Tasks</')) {
            newTasksIdx = i;
            break;
          }
        }
        
        if (newTasksIdx !== -1) {
          const escapedTitle = task.title.replace(/"/g, '&quot;');
          const statusColor = '#3b82f6';
          const taskStatusStr = JSON.stringify({ name: task.status, color: statusColor }).replace(/"/g, '&quot;');
          const assigneesStr = JSON.stringify(task.assignees || []).replace(/"/g, '&quot;');
          
          blocks.splice(newTasksIdx + 1, 0, {
            id: `blk-t-${Date.now()}-${task.id}`,
            type: 'text',
            content: `<p><span data-type="mention" data-id="${task.id}" data-label="${escapedTitle}" data-mention-type="task" data-task-status="${taskStatusStr}" data-task-assignees="${assigneesStr}">@${escapedTitle}</span></p>`
          });
          
          await prisma.page.update({
            where: { id: dayPage.id },
            data: { content: JSON.stringify(blocks) }
          });
          
          io.to(`doc:${doc.id}`).emit('page_updated', { pageId: dayPage.id });
        }
      }
    } catch (err) {
      console.error('Failed to inject task into daily rollover:', err);
    }

    // Broadcast new task to the list room and globally for real-time sync
    io.to(`list:${listId}`).emit('task:created', task);
    io.emit('task:created', task);

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
      select: { primaryRole: true, secondaryRole: true, tertiaryRole: true, minorRole: true, systemRole: true },
    });

    const isAdmin =
      (user && user.systemRole === 'ADMIN') ||
      (user && user.primaryRole?.trim().toUpperCase() === 'ADMIN') ||
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

    const userRoles = [user.primaryRole, user.secondaryRole, user.tertiaryRole, user.minorRole]
      .filter(Boolean)
      .map((r: any) => r.trim().toUpperCase());

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
        assignees: { select: { id: true, name: true } },
        checklists: { include: { items: true } },
        subtasks: { include: { checklists: { include: { items: true } } } },
      },
    });

    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (status !== undefined && status.toLowerCase() === 'checking') {
      // Check task audit checklists
      const requiredTaskAudits = getRequiredAudits(currentTask.title);
      const auditChecklists = currentTask.checklists.filter((c: any) => c.name.toLowerCase().includes('audit'));
      for (const c of auditChecklists) {
        if (c.items.some((i: any) => requiredTaskAudits.includes(i.text) && !i.completed)) {
          return res.status(400).json({ error: `Cannot move to ${status}: Required audits for task are not fully completed.` });
        }
      }
      
      // Check subtasks audit checklists
      for (const subtask of currentTask.subtasks) {
        const requiredSubtaskAudits = getRequiredAudits(subtask.title);
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

    if (assigneeIds !== undefined) {
      updateData.assignees = { set: assigneeIds.map((id: string) => ({ id })) };
      updateData.assigneeId = assigneeIds.length > 0 ? assigneeIds[0] : null;
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
    if (assigneeIds !== undefined || assigneeId !== undefined) {
      const idsToFetch = assigneeIds !== undefined ? assigneeIds : (assigneeId ? [assigneeId] : []);
      if (idsToFetch.length > 0) {
        payload.assignees = await prisma.user.findMany({
          where: { id: { in: idsToFetch } },
          select: { id: true, name: true, email: true, avatarUrl: true, primaryRole: true }
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
          } else if (assigneeIds !== undefined) {
            const assignedUsers = assigneeIds.length > 0
              ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true, avatarUrl: true } })
              : [];
            const names = assignedUsers.length > 0 ? assignedUsers.map((u: any) => u.name).join(', ') : 'Unassigned';
            const log = await prisma.auditLog.create({
              data: {
                action: 'ASSIGNMENT',
                entity: 'TASK',
                entityId: taskId,
                userId: actingUserId,
                details: { assigneeName: names, assigneeNames: assignedUsers.map((u: any) => u.name), count: assignedUsers.length },
              },
            });
            const newlyAssigned = assigneeIds.filter((id: string) => !currentTask.assignees.some((a: any) => a.id === id));
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

          if (activity) {
            if (roomListId) {
              io.to(`list:${roomListId}`).emit('task_activity', { listId: roomListId, taskId, activity });
            }
            io.emit('task_activity', { taskId, activity });
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
      select: { listId: true },
    });
    await prisma.task.delete({ where: { id: taskId } });

    await invalidateCache(`task:${taskId}`, 'tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

    if (taskToDelete?.listId) {
      io.to(`list:${taskToDelete.listId}`).emit('task:deleted', { id: taskId });
    }
    io.emit('task:deleted', { id: taskId });

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
      select: { id: true, status: true, listId: true, creatorId: true },
    });

    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const oldStatus = currentTask.status;

    // Immediately persist to DB (scalar fields only for max speed)
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
          }).then(log => {
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
            io.emit('task_activity', { taskId: id, activity });
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
      io.to(`list:${listId}`).emit('task_activity', { listId, taskId, activity });
    } else {
      io.emit('task:comment_added', payload);
      io.emit('task_activity', { taskId, activity });
    }

    return res.status(201).json({ comment, activity });
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
        checklists: { include: { items: true } },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, primaryRole: true } },
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
        const status = task.status || 'Pending';
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
      select: { id: true, listId: true, subtasks: taskInclude.subtasks }
    });
    if (task) io.to(`list:${task.listId}`).emit('task:updated', task);

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
        const requiredSubtaskAudits = getRequiredAudits(currentSubtask.title);
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

    const subtask = await prisma.subtask.update({
      where: { id: subtaskId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(finalCompleted !== undefined && { completed: finalCompleted }),
        ...(assigneeIds !== undefined && Array.isArray(assigneeIds) ? {
          assigneeId: assigneeIds.length > 0 ? assigneeIds[0] : null,
          assignees: { set: assigneeIds.map((id: string) => ({ id })) }
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
    if (actingUserId) {
      if (assigneeIds !== undefined && Array.isArray(assigneeIds)) {
        await prisma.auditLog.create({
          data: {
            action: 'ASSIGNMENT',
            entity: 'TASK',
            entityId: taskId,
            userId: actingUserId,
            details: { assignees: (subtask as any).assignees ? (subtask as any).assignees.map((u: any) => u.name) : ((subtask as any).User ? [(subtask as any).User.name] : []), subtaskTitle: subtask.title }
          }
        });

        for (const assigneeId of assigneeIds) {
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
        if (assigneeIds !== undefined && Array.isArray(assigneeIds)) {
          io.to(`list:${task.listId}`).emit('task_activity', { taskId, activity: {
            id: Date.now().toString(),
            type: 'assignment',
            author: (req as any).user?.name || 'Someone',
            assigneeName: (subtask as any).assignees?.length ? (subtask as any).assignees.map((u: any) => u.name).join(', ') : ((subtask as any).User ? (subtask as any).User.name : 'Unassigned'),
            subtaskTitle: subtask.title,
            date: new Date().toISOString(),
          }});
        }
        if (status !== undefined) {
          io.to(`list:${task.listId}`).emit('task_activity', { taskId, activity: {
            id: (Date.now() + 1).toString(),
            type: 'status_change',
            author: (req as any).user?.name || 'Someone',
            oldStatus: undefined,
            newStatus: status,
            subtaskTitle: subtask.title,
            date: new Date().toISOString(),
          }});
        }
      }
    }

    return res.json({ subtask });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteSubtask(req: Request, res: Response) {
  try {
    const { id: taskId, subtaskId } = req.params;
    await prisma.subtask.delete({ where: { id: subtaskId } });
    await invalidateCache(`task:${taskId}`);

    const task = await prisma.task.findUnique({ 
      where: { id: taskId }, 
      select: { id: true, listId: true, subtasks: taskInclude.subtasks }
    });
    if (task) io.to(`list:${task.listId}`).emit('task:updated', task);

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

    return res.json({ checklist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklist(req: Request, res: Response) {
  try {
    const { checklistId } = req.params;
    await prisma.checklist.delete({
      where: { id: checklistId },
    });
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

    return res.json({ item });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteChecklistItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    await prisma.checklistItem.delete({
      where: { id: itemId },
    });
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
