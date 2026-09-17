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
      link: `${process.env.FRONTEND_URL || 'https://app.vipscaleph.com'}/lists/${task.listId}?task=${task.id}`
    }));

    return res.json({ tasks: formattedTasks });
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
