import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getR2PresignedUrl } from '../services/r2Service';
import { getCache, setCache, invalidateCache } from '../services/redisService';

const taskInclude = {
  subtasks: true,
  checklists: { include: { items: true } },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  creator: { select: { id: true, name: true, email: true } },
};

// GET /api/tasks - Redis Cache-Aside
export async function listTasks(req: Request, res: Response) {
  try {
    const { listId, assigneeId, status } = req.query as Record<string, string | undefined>;
    const cacheKey = `tasks:all:${listId || 'all'}:${assigneeId || 'all'}:${status || 'all'}`;

    const cachedTasks = await getCache<any[]>(cacheKey);
    if (cachedTasks) {
      return res.json({ tasks: cachedTasks, cached: true });
    }

    const tasks = await prisma.task.findMany({
      where: {
        ...(listId ? { listId } : {}),
        ...(status ? { status } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      },
      include: taskInclude,
      orderBy: { createdAt: 'desc' },
    });

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
      assigneeId, teamId, creatorId, dueDate, startDate,
    } = req.body;

    const task = await prisma.task.create({
      data: {
        title,
        description,
        status: status || 'TODO',
        priority: priority || 'MEDIUM',
        listId,
        assigneeId: assigneeId || null,
        teamId: teamId || null,
        creatorId,
        dueDate: dueDate ? new Date(dueDate) : null,
        startDate: startDate ? new Date(startDate) : null,
      },
      include: taskInclude,
    });

    await invalidateCache('tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

    return res.status(201).json({ task });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/tasks/:id
export async function updateTask(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    const {
      title, description, status, priority,
      listId, assigneeId, teamId, dueDate, startDate,
    } = req.body;

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(listId !== undefined ? { listId } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(teamId !== undefined ? { teamId } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      },
      include: taskInclude,
    });

    await invalidateCache(`task:${taskId}`, 'tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

    return res.json({ task });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Task not found' });
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/tasks/:id
export async function deleteTask(req: Request, res: Response) {
  try {
    const taskId = req.params.id;
    await prisma.task.delete({ where: { id: taskId } });

    await invalidateCache(`task:${taskId}`, 'tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

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
    const { status } = req.body;

    const updatedTask = await prisma.task.update({
      where: { id },
      data: { status },
      include: taskInclude,
    });

    await invalidateCache(`task:${id}`, 'tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

    return res.json({ task: updatedTask, message: 'Status updated successfully' });
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
