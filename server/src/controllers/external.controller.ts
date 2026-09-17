import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

    const { title, listId, description, priority, status, assigneeId } = req.body;

    if (!title || !listId) {
      return res.status(400).json({ error: 'title and listId are required' });
    }

    const list = await prisma.list.findUnique({ where: { id: listId } });
    if (!list) return res.status(404).json({ error: 'List not found' });

    const task = await prisma.task.create({
      data: {
        title,
        listId,
        description: description || '',
        priority: priority || 'MEDIUM',
        status: status || 'Pending',
        creatorId: apiKey.userId,
        assigneeId: assigneeId || undefined,
      }
    });

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

    const existingTask = await prisma.task.findUnique({ where: { id: taskId } });
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
