import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';

const prisma = new PrismaClient();

async function getOrCreateVipScaleUser() {
  let vipScaleUser = await prisma.user.findFirst({
    where: { name: { equals: 'VIPSCALE', mode: 'insensitive' } }
  });

  if (!vipScaleUser) {
    const password = await bcrypt.hash(Math.random().toString(36), 10);
    vipScaleUser = await prisma.user.create({
      data: {
        name: 'VIPSCALE',
        email: 'api-vipscale@system.local',
        password,
        systemRole: 'ADMIN',
      }
    });
  }

  return vipScaleUser;
}

// ---------------------------------------------------------------------------
// Auth helper: validates API key and returns the key record (with user)
// ---------------------------------------------------------------------------
async function authenticateApiKey(req: Request, res: Response) {
  const authHeader = req.headers.authorization || req.headers['x-api-key'] as string;
  if (!authHeader) {
    res.status(401).json({ error: 'Missing API Key' });
    return null;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const apiKey = await (prisma as any).apiKey.findUnique({
    where: { key: token },
    include: { user: true }
  });

  if (!apiKey) {
    res.status(401).json({ error: 'Invalid API Key' });
    return null;
  }

  // Track last usage
  await (prisma as any).apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsed: new Date() }
  });

  return apiKey;
}

// ---------------------------------------------------------------------------
// POST /api/external/lists
// Creates a new list (board) with specific statuses
// ---------------------------------------------------------------------------
export async function createExternalList(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { name, spaceId, folderId, statuses } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    let targetSpaceId = spaceId;
    let targetFolderId = folderId;
    
    // If user didn't specify a folder ID, fallback to 'Client Dashboard' folder automatically
    if (!targetFolderId) {
      const dashboardFolder = await prisma.folder.findFirst({ where: { name: 'Client Dashboard' } });
      if (dashboardFolder) {
        targetFolderId = dashboardFolder.id;
        targetSpaceId = targetSpaceId || dashboardFolder.spaceId;
      }
    }

    const customGroups = statuses 
      ? Array.from(new Set(statuses.map((s: any) => s.groupName).filter(Boolean))) as string[]
      : ['Client Details', 'Recurring', 'Workflow & Progress'];

    const list = await prisma.list.create({
      data: {
        name,
        spaceId: targetSpaceId || null,
        folderId: targetFolderId || null,
        customGroups: ['Client Details', 'Recurring', 'Workflow & Progress', 'Management']
      }
    });

    // We will use standard DEFAULT_STATUSES but NEVER rename KYC to list.name
    // (As requested: "instead of names of the boards it should be kyc")
    const DEFAULT_STATUSES = [
      { name: 'KYC', color: 'cyan', groupName: 'Client Details' },
      { name: 'Pin Board', color: 'blue', groupName: 'Client Details' },
      { name: 'Daily', color: 'purple', groupName: 'Recurring' },
      { name: 'Weekly', color: 'indigo', groupName: 'Recurring' },
      { name: 'Monthly', color: 'violet', groupName: 'Recurring' },
      { name: 'Pending', color: 'amber', groupName: 'Workflow & Progress' },
      { name: 'In Progress', color: 'blue', groupName: 'Workflow & Progress' },
      { name: 'Revision', color: 'rose', groupName: 'Workflow & Progress' },
      { name: 'On-Hold', color: 'zinc', groupName: 'Workflow & Progress' },
      { name: 'Closed', color: 'emerald', groupName: 'Workflow & Progress' },
      { name: 'Waiting', color: 'orange', groupName: 'Management' },
      { name: 'In Review', color: 'purple', groupName: 'Management' },
      { name: 'Checking', color: 'teal', groupName: 'Management' },
      { name: 'CRM', color: 'emerald', groupName: 'Management' },
    ];

    const statusesToCreate: any[] = [];
    if (statuses && Array.isArray(statuses) && statuses.length > 0) {
      // If caller explicitly provides statuses, use them
      statuses.forEach((s, i) => {
        statusesToCreate.push({
          name: s.name,
          color: s.color || 'blue',
          groupName: s.groupName || null,
          order: i,
          listId: list.id
        });
      });
    } else {
      // Use DEFAULT_STATUSES (keep KYC as KYC)
      DEFAULT_STATUSES.forEach((s, i) => {
        statusesToCreate.push({
          name: s.name,
          color: s.color,
          groupName: s.groupName,
          order: i,
          listId: list.id
        });
      });
    }

    if (statusesToCreate.length > 0) {
      await prisma.listStatus.createMany({
        data: statusesToCreate,
        skipDuplicates: true
      });
    }

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.status(201).json({ list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/tasks
// Returns tasks with title, status, client (space name), listName, and link
// ---------------------------------------------------------------------------
export async function getTasks(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { status, listId } = req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (listId) where.listId = String(listId);

    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        listId: true,
        createdAt: true,
        updatedAt: true,
        list: {
          select: {
            name: true,
            space: {
              select: { name: true }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 50
    });

    const formattedTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      client: task.list?.space?.name || 'Unknown Client',
      listName: task.list?.name || 'Unknown List',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      link: `${process.env.FRONTEND_URL || 'https://nexus.vipscaleph.com'}/lists/${task.listId}?task=${task.id}`
    }));

    return res.json({ tasks: formattedTasks });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/tasks/:taskId
// Returns full details of a specific task
// ---------------------------------------------------------------------------
export async function getTask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId } = req.params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        list: { select: { name: true, space: { select: { name: true } } } },
        assignee: { select: { id: true, name: true, email: true } },
        subtasks: true,
        comments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!task) return res.status(404).json({ error: 'Task not found' });

    return res.json({ task });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/tasks
// Creates a new task
// Body: title (required), listId (required), description, priority, status
// ---------------------------------------------------------------------------
export async function createTask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { title, listId, description, priority, status, assigneeId, checklists } = req.body;

    if (!title || !listId) {
      return res.status(400).json({ error: 'title and listId are required' });
    }

    const list = await prisma.list.findUnique({ where: { id: listId }, include: { statuses: true } });
    if (!list) return res.status(404).json({ error: 'List not found' });

    // Skip auto-seeding if statuses already exist to prevent duplicating/messing up createExternalList statuses
    if (list.statuses.length === 0) {
      const defaultGroupedStatuses = [
        { name: 'KYC', color: 'cyan', groupName: 'Client Details', order: 0 },
        { name: 'Pin Board', color: 'blue', groupName: 'Client Details', order: 1 },
        { name: 'Daily', color: 'purple', groupName: 'Recurring', order: 0 },
        { name: 'Weekly', color: 'indigo', groupName: 'Recurring', order: 1 },
        { name: 'Monthly', color: 'violet', groupName: 'Recurring', order: 2 },
        { name: 'Pending', color: 'amber', groupName: 'Workflow & Progress', order: 0 },
        { name: 'In Progress', color: 'blue', groupName: 'Workflow & Progress', order: 1 },
        { name: 'Revision', color: 'rose', groupName: 'Workflow & Progress', order: 2 },
        { name: 'On-Hold', color: 'zinc', groupName: 'Workflow & Progress', order: 3 },
        { name: 'Closed', color: 'emerald', groupName: 'Workflow & Progress', order: 4 },
        { name: 'Waiting', color: 'orange', groupName: 'Management', order: 0 },
        { name: 'In Review', color: 'purple', groupName: 'Management', order: 1 },
        { name: 'Checking', color: 'teal', groupName: 'Management', order: 2 },
        { name: 'CRM', color: 'emerald', groupName: 'Management', order: 3 },
      ];

      await prisma.list.update({
        where: { id: list.id },
        data: {
          customGroups: ['Client Details', 'Recurring', 'Workflow & Progress', 'Management']
        }
      });

      for (const st of defaultGroupedStatuses) {
        if (!list.statuses.some(existing => existing.name.toUpperCase() === st.name.toUpperCase())) {
          await prisma.listStatus.create({
            data: {
              name: st.name,
              color: st.color,
              groupName: st.groupName,
              order: st.order,
              listId: list.id
            }
          });
        }
      }
    }

    const vipScaleUser = await getOrCreateVipScaleUser();

    const task = await prisma.task.create({
      data: {
        title,
        listId,
        description: description || '',
        priority: priority || 'MEDIUM',
        status: status || 'Pending',
        creatorId: vipScaleUser.id,
        assigneeId: assigneeId || undefined,
      }
    });

    if (checklists && Array.isArray(checklists)) {
      for (const cl of checklists) {
        const checklist = await prisma.checklist.create({
          data: {
            name: cl.name,
            taskId: task.id
          }
        });
        if (cl.items && Array.isArray(cl.items)) {
          await prisma.checklistItem.createMany({
            data: cl.items.map((itemText: string) => ({
              text: itemText,
              completed: false,
              checklistId: checklist.id
            }))
          });
        }
      }
    }

    try {
      const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
      if (doc) {
        const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
        const dayFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        const dayTitle = dayFormatter.format(new Date());

        const todayPage = await prisma.page.findFirst({
          where: { 
            docId: doc.id, 
            title: dayTitle 
          },
          orderBy: { createdAt: 'desc' }
        });

        if (todayPage && todayPage.content) {
          const blocks = JSON.parse(todayPage.content);
          
          const clientName = list.name || 'Unknown Client';
          const headerContentClient = `<h3>${clientName}</h3>`;
          const headerContentNewTasks = `<h3>New Tasks</h3>`;
          
          const getNewTaskBlock = (suffix: string) => ({
            id: `blk-t-${Date.now()}-${task.id}-${suffix}`,
            type: "text",
            content: `<p><span data-type="mention" data-id="${task.id}" data-label="${task.title}" data-mention-type="task">@${task.title}</span></p>`
          });

          // 1. Insert into Client section
          let clientHeaderIndex = blocks.findIndex((b: any) => b.type === 'text' && b.content === headerContentClient);
          if (clientHeaderIndex === -1) {
            blocks.push({
              id: `blk-h-${Date.now()}-${clientName.replace(/\s+/g, '')}`,
              type: 'text',
              content: headerContentClient
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
          blocks.splice(insertClientIndex, 0, getNewTaskBlock('c'));

          // 2. Insert into New Tasks section
          let newTasksHeaderIndex = blocks.findIndex((b: any) => b.type === 'text' && b.content === headerContentNewTasks);
          if (newTasksHeaderIndex === -1) {
            blocks.push({
              id: `blk-h-${Date.now()}-NewTasks`,
              type: 'text',
              content: headerContentNewTasks
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
          blocks.splice(insertNewTasksIndex, 0, getNewTaskBlock('n'));

          await prisma.page.update({
            where: { id: todayPage.id },
            data: { content: JSON.stringify(blocks) }
          });

          io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: todayPage.id });
        }
      }
    } catch (error) {
      console.error('Failed to inject task into Priorities Journal:', error);
    }

    return res.status(201).json({ message: 'Task created successfully', task });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/external/tasks/:taskId
// Updates task fields (title, description, status, priority, assigneeId)
// ---------------------------------------------------------------------------
export async function updateTask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId } = req.params;
    const { title, description, status, priority, assigneeId } = req.body;

    const existingTask = await prisma.task.findUnique({ 
      where: { id: taskId },
      include: { list: true }
    });
    if (!existingTask) return res.status(404).json({ error: 'Task not found' });

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(assigneeId !== undefined && { assigneeId }),
      }
    });

    if (status && status !== existingTask.status && status.toLowerCase() !== 'closed') {
      try {
        const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
        if (doc) {
          const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
          const dayFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          });
          const dayTitle = dayFormatter.format(new Date());

          const todayPage = await prisma.page.findFirst({
            where: { 
              docId: doc.id, 
              title: dayTitle 
            },
            orderBy: { createdAt: 'desc' }
          });

          if (todayPage && todayPage.content) {
            const blocks = JSON.parse(todayPage.content);
            
            const taskMention = `data-id="${task.id}"`;
            const isAlreadyInJournal = blocks.some((b: any) => b.type === 'text' && b.content.includes(taskMention));

            if (!isAlreadyInJournal) {
              const clientName = existingTask.list?.name || 'Unknown Client';
              const headerContentClient = `<h3>${clientName}</h3>`;
              const headerContentNewTasks = `<h3>New Tasks</h3>`;
              
              const getNewTaskBlock = (suffix: string) => ({
                id: `blk-t-${Date.now()}-${task.id}-${suffix}`,
                type: "text",
                content: `<p><span data-type="mention" data-id="${task.id}" data-label="${task.title}" data-mention-type="task">@${task.title}</span></p>`
              });

              // 1. Insert into Client section
              let clientHeaderIndex = blocks.findIndex((b: any) => b.type === 'text' && b.content === headerContentClient);
              if (clientHeaderIndex === -1) {
                blocks.push({
                  id: `blk-h-${Date.now()}-${clientName.replace(/\s+/g, '')}`,
                  type: 'text',
                  content: headerContentClient
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
              blocks.splice(insertClientIndex, 0, getNewTaskBlock('c'));

              // 2. Insert into New Tasks section
              let newTasksHeaderIndex = blocks.findIndex((b: any) => b.type === 'text' && b.content === headerContentNewTasks);
              if (newTasksHeaderIndex === -1) {
                blocks.push({
                  id: `blk-h-${Date.now()}-NewTasks`,
                  type: 'text',
                  content: headerContentNewTasks
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
              blocks.splice(insertNewTasksIndex, 0, getNewTaskBlock('n'));

              await prisma.page.update({
                where: { id: todayPage.id },
                data: { content: JSON.stringify(blocks) }
              });

              io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: todayPage.id });
            }
          }
        }
      } catch (error) {
        console.error('Failed to inject re-opened task into Priorities Journal:', error);
      }
    }

    return res.json({ message: 'Task updated successfully', task });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}


// ---------------------------------------------------------------------------
// POST /api/external/activity
// Logs an audit entry against a task (shows in the activity feed)
// ---------------------------------------------------------------------------
export async function postActivity(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId, action, details } = req.body;

    if (!taskId || !action) {
      return res.status(400).json({ error: 'taskId and action are required' });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const auditLog = await prisma.auditLog.create({
      data: {
        action,
        entity: 'TASK',
        entityId: taskId,
        userId: apiKey.userId,
        details: details || {}
      }
    });

    return res.json({ message: 'Activity logged successfully', auditLog });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/comment
// Posts a formatted comment to a task — shows up in the task modal Comments
// section exactly like a regular user comment (with avatar, reactions, reply).
//
// Body:
//   taskId  (string, required) — ID of the target task
//   content (string, required) — Markdown-formatted comment body
//
// Tip: format your spreadsheet columns as markdown and pass as `content`.
// The comment will appear under the API key owner's account.
// ---------------------------------------------------------------------------
export async function postComment(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId, content } = req.body;

    if (!taskId || !content) {
      return res.status(400).json({ error: 'taskId and content are required' });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Create the comment as the API key owner
    const comment = await prisma.taskComment.create({
      data: {
        content,
        taskId,
        userId: apiKey.userId,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } }
      }
    });

    // Realtime update for the frontend
    io.emit('task:comment_added', { taskId, comment });

    return res.json({
      message: 'Comment posted successfully',
      comment
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/external/comment
// Updates an existing comment.
//
// Body:
//   commentId (string, required)
//   content (string, required)
// ---------------------------------------------------------------------------
export async function updateComment(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { commentId, content } = req.body;

    if (!commentId || !content) {
      return res.status(400).json({ error: 'commentId and content are required' });
    }

    const existingComment = await prisma.taskComment.findUnique({
      where: { id: commentId }
    });

    if (!existingComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only allow the API key owner to update their own comments
    if (existingComment.userId !== apiKey.userId) {
      return res.status(403).json({ error: 'You do not have permission to update this comment' });
    }

    const updatedComment = await prisma.taskComment.update({
      where: { id: commentId },
      data: { content },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } }
      }
    });

    io.emit('task:comment_updated', { taskId: existingComment.taskId, comment: updatedComment });

    return res.json({
      message: 'Comment updated successfully',
      comment: updatedComment
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/external/comment/:commentId
// Deletes an existing comment.
// ---------------------------------------------------------------------------
export async function deleteComment(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { commentId } = req.params;

    const existingComment = await prisma.taskComment.findUnique({
      where: { id: commentId }
    });

    if (!existingComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (existingComment.userId !== apiKey.userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this comment' });
    }

    await prisma.taskComment.delete({
      where: { id: commentId }
    });

    io.emit('task:comment_deleted', { taskId: existingComment.taskId, commentId });

    return res.json({ message: 'Comment deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/tasks/:taskId/subtasks
// Creates a new subtask
// Body: title (required), description, priority, assigneeId
// ---------------------------------------------------------------------------
export async function createSubtask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId } = req.params;
    const { title, description, priority, assigneeId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const subtask = await prisma.subtask.create({
      data: {
        title,
        taskId,
        description: description || '',
        priority: priority || 'MEDIUM',
        assigneeId: assigneeId || undefined,
      }
    });

    try {
      const doc = await prisma.doc.findFirst({ where: { isDailyRollover: true } });
      if (doc) {
        const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
        const dayFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        const dayTitle = dayFormatter.format(new Date());

        const todayPage = await prisma.page.findFirst({
          where: { 
            docId: doc.id, 
            title: dayTitle 
          },
          orderBy: { createdAt: 'desc' }
        });

        if (todayPage && todayPage.content) {
          const blocks = JSON.parse(todayPage.content);
          
          const parentTaskMention = `data-id="${task.id}"`;
          const parentTaskIndex = blocks.findIndex((b: any) => b.type === 'text' && b.content.includes(parentTaskMention));

          if (parentTaskIndex !== -1) {
            const newSubtaskBlock = {
              id: `blk-st-${Date.now()}-${subtask.id}`,
              type: "text",
              content: `<p>&nbsp;&nbsp;└─ <span data-type="mention" data-id="${subtask.id}" data-label="${subtask.title}" data-mention-type="subtask">@${subtask.title}</span></p>`
            };

            let insertIndex = parentTaskIndex + 1;
            while (insertIndex < blocks.length) {
              const nextBlock = blocks[insertIndex];
              if (nextBlock.type === 'text' && nextBlock.content.includes('└─')) {
                insertIndex++;
              } else {
                break;
              }
            }
            
            blocks.splice(insertIndex, 0, newSubtaskBlock);

            await prisma.page.update({
              where: { id: todayPage.id },
              data: { content: JSON.stringify(blocks) }
            });

            io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: todayPage.id });
          }
        }
      }
    } catch (error) {
      console.error('Failed to inject subtask into Priorities Journal:', error);
    }

    return res.status(201).json({ message: 'Subtask created successfully', subtask });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/external/tasks/:taskId/subtasks/:subtaskId
// Updates subtask fields (title, description, completed, priority, assigneeId)
// ---------------------------------------------------------------------------
export async function updateSubtask(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { taskId, subtaskId } = req.params;
    const { title, description, completed, priority, assigneeId } = req.body;

    const subtask = await prisma.subtask.findFirst({
      where: { id: subtaskId, taskId }
    });

    if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

    const updated = await prisma.subtask.update({
      where: { id: subtaskId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(completed !== undefined && { completed }),
        ...(priority !== undefined && { priority }),
        ...(assigneeId !== undefined && { assigneeId }),
      }
    });

    return res.json({ message: 'Subtask updated successfully', subtask: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/assignable-groups
// Returns all users, roles, teamroles, and teams for VIPScale assignee dropdowns
// ---------------------------------------------------------------------------
export async function getAssignableGroups(req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        team: { select: { id: true } }
      }
    });

    const teams = await prisma.team.findMany({
      select: {
        id: true,
        name: true,
        teamRoles: { select: { id: true, name: true } }
      }
    });

    // Map generic roles (TECH, PM, AUDITOR...) to their users
    const roleUsersMap = new Map<string, string[]>();
    users.forEach(u => {
      const addRole = (role?: string | null) => {
        if (role) {
          if (!roleUsersMap.has(role)) roleUsersMap.set(role, []);
          roleUsersMap.get(role)!.push(u.id);
        }
      };
      u.roles.forEach(addRole);
    });

    const options = [
      // Generic roles derived from user.roles (TECH, PM, AUDITOR...)
      ...Array.from(roleUsersMap.entries()).map(([role, userIds]) => ({
        id: `role_${role}`,
        name: role,
        type: 'role',
        userIds
      })),
      // Specific TeamRoles (Funnel Auditor, Design Auditor, UI UX Auditor...)
      ...teams.flatMap(t =>
        (t.teamRoles || []).map(tr => ({
          id: `teamrole_${tr.id}`,
          name: tr.name,
          type: 'teamrole',
          teamId: t.id,
          teamName: t.name,
          // Users in this team are the pool for this role
          userIds: users.filter(u => u.team?.id === t.id).map(u => u.id)
        }))
      ),
      // Teams
      ...teams.map(t => {
        const teamUsers = users.filter(u => u.team?.id === t.id).map(u => u.id);
        return {
          id: `team_${t.id}`,
          name: t.name,
          type: 'team',
          userIds: teamUsers
        };
      }),
      // Individual users
      ...users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        type: 'user'
      }))
    ];

    return res.json({ success: true, options });
  } catch (err: any) {
    console.error("Error in getAssignableGroups:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/external/roles
// Returns all workspace roles
// ---------------------------------------------------------------------------
export async function getRoles(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const [workspaceRoles, teamRoles] = await Promise.all([
      prisma.workspaceRole.findMany({ orderBy: { createdAt: 'asc' } }),
      (prisma as any).teamRole.findMany({
        orderBy: { createdAt: 'asc' },
        include: { team: { select: { id: true, name: true } } },
      }),
    ]);

    // Merge: workspace roles first, then team-specific roles
    const merged = [
      ...workspaceRoles.map((r: any) => ({
        id: r.id,
        name: r.name,
        color: r.color || null,
        type: 'workspace',
      })),
      ...teamRoles.map((r: any) => ({
        id: r.id,
        name: r.name,
        color: null,
        type: 'teamrole',
        teamId: r.teamId,
        teamName: r.team?.name || null,
      })),
    ];

    res.json(merged);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/external/roles
// Creates a new workspace role
// ---------------------------------------------------------------------------
export async function createRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { name, color } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const role = await prisma.workspaceRole.create({
      data: {
        name: name.toUpperCase(),
        color,
      },
    });

    res.status(201).json(role);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Role already exists' });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/external/roles/:id
// Updates a workspace role
// ---------------------------------------------------------------------------
export async function updateRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    const { name, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const updatedRole = await prisma.workspaceRole.update({
      where: { id },
      data: {
        name: name.toUpperCase(),
        color,
      },
    });

    res.json(updatedRole);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Role name already exists' });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/external/roles/:id
// Deletes a workspace role
// ---------------------------------------------------------------------------
export async function deleteRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    
    await prisma.workspaceRole.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// External Users Management
// ---------------------------------------------------------------------------
export async function getExternalUsers(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        dailySheetUrl: true,
        starRating: true,
        employmentType: true,
        isActive: true,
        systemRole: true,
        roles: true,
      },
      orderBy: { name: 'asc' },
    });

    return res.json({ users });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteExternalUser(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    
    // Prevent deletion of VIPSCALE API user or own user
    if (apiKey.userId === id) {
      return res.status(400).json({ error: 'Cannot delete your own account via API' });
    }

    await prisma.user.delete({ where: { id } });
    return res.json({ message: 'User deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateExternalUserRoles(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    const { roles, systemRole, employmentType, starRating, isActive } = req.body;

    const dataToUpdate: any = {};
    if (roles && Array.isArray(roles)) dataToUpdate.roles = roles;
    if (systemRole) dataToUpdate.systemRole = systemRole;
    if (employmentType) dataToUpdate.employmentType = employmentType;
    if (starRating !== undefined) dataToUpdate.starRating = starRating;
    if (isActive !== undefined) dataToUpdate.isActive = isActive;

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        systemRole: true,
        employmentType: true,
        starRating: true,
        isActive: true,
      }
    });

    return res.json({ user: updatedUser });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// External Invitations Management
// ---------------------------------------------------------------------------
export async function getExternalInvitations(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return res.json({ invitations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createExternalInvitation(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { email, role, employmentType, expiresInDays } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 7));

    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const invite = await prisma.invitation.create({
      data: {
        email: email.trim().toLowerCase(),
        token,
        role: role || 'MEMBER',
        employmentType: employmentType || 'FULL_TIME',
        status: 'PENDING',
        expiresAt,
        invitedById: apiKey.userId
      }
    });

    return res.status(201).json({ invitation: invite });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function revokeExternalInvitation(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    await prisma.invitation.delete({ where: { id } });
    return res.json({ message: 'Invitation revoked' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function resendExternalInvitation(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { id } = req.params;
    const invite = await prisma.invitation.findUnique({ where: { id } });
    if (!invite) return res.status(404).json({ error: 'Not found' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const updated = await prisma.invitation.update({
      where: { id },
      data: { status: 'PENDING', expiresAt }
    });

    return res.json({ message: 'Invitation resent', invitation: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// External Teams & Roles Management
// ---------------------------------------------------------------------------
export async function getExternalTeams(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const teams = await prisma.team.findMany({
      include: { teamRoles: true },
      orderBy: { name: 'asc' },
    });

    return res.json({ teams });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createExternalTeam(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    const team = await prisma.team.create({
      data: { name },
      include: { teamRoles: true },
    });

    return res.status(201).json({ team });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createExternalTeamRole(req: Request, res: Response) {
  try {
    const apiKey = await authenticateApiKey(req, res);
    if (!apiKey) return;

    const { teamId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const role = await (prisma as any).teamRole.create({
      data: { name, teamId },
    });

    return res.status(201).json({ role });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
