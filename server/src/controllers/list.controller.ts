import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache } from '../services/redisService';

// GET /api/lists - Redis Cache-Aside
export async function listLists(req: Request, res: Response) {
  try {
    const cachedLists = await getCache<any[]>('lists:all');
    if (cachedLists) {
      return res.json({ lists: cachedLists, cached: true });
    }

    const lists = await prisma.list.findMany({
      include: {
        statuses: true,
        tasks: {
          include: {
            subtasks: true,
            checklists: { include: { items: true } },
            comments: { select: { id: true } },
            attachments: { select: { id: true } },
            assignee: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    await setCache('lists:all', lists, 300);

    return res.json({ lists, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/lists/:id
export async function getList(req: Request, res: Response) {
  try {
    const list = await prisma.list.findUnique({
      where: { id: req.params.id },
      include: {
        space: { select: { id: true, name: true, color: true } },
        folder: { select: { id: true, name: true } },
        statuses: true,
        tasks: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            description: true, // Needed if UI shows hasDescription icon
            status: true,
            priority: true,
            dueDate: true,
            createdAt: true,
            listId: true,
            creatorId: true,
            assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true, primaryRole: true } },
            creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
            subtasks: { 
              include: { 
                checklists: { select: { id: true, items: { select: { id: true, completed: true } } } }
              } 
            },
            checklists: { select: { id: true, items: { select: { id: true, completed: true } } } },
            _count: {
              select: {
                comments: true,
                attachments: true,
              }
            }
          },
        },
      },
    });

    if (!list) return res.status(404).json({ error: 'List not found' });

    return res.json({ list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}



// POST /api/lists
export async function createList(req: Request, res: Response) {
  try {
    const { name, spaceId, folderId } = req.body;
    const list = await prisma.list.create({
      data: { name, spaceId: spaceId || null, folderId: folderId || null },
    });

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.status(201).json({ list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/lists/:id
export async function updateList(req: Request, res: Response) {
  try {
    const { name, customGroups } = req.body;
    const list = await prisma.list.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(customGroups && { customGroups }),
      },
    });

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.json({ list });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'List not found' });
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/lists/:id/duplicate
export async function duplicateList(req: Request, res: Response) {
  try {
    const original = await prisma.list.findUnique({ where: { id: req.params.id } });
    if (!original) return res.status(404).json({ error: 'List not found' });

    const list = await prisma.list.create({
      data: {
        name: `${original.name} (Copy)`,
        spaceId: original.spaceId,
        folderId: original.folderId,
      },
    });

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.status(201).json({ list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/lists/:id
export async function deleteList(req: Request, res: Response) {
  try {
    await prisma.list.delete({ where: { id: req.params.id } });

    await invalidateCache('lists:all', 'spaces:all', 'dashboard:all');

    return res.json({ message: 'List deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'List not found' });
    return res.status(500).json({ error: err.message });
  }
}

const DEFAULT_STATUS_THEMES: Record<string, string> = {
  KYC: 'cyan',
  'Pin Board': 'blue',
  PIN_BOARD: 'blue',
  Daily: 'purple',
  Weekly: 'indigo',
  Monthly: 'violet',
  DAILY: 'purple',
  WEEKLY: 'indigo',
  MONTHLY: 'violet',
  Pending: 'amber',
  PENDING: 'amber',
  'In Progress': 'blue',
  IN_PROGRESS: 'blue',
  Revision: 'rose',
  REVISION: 'rose',
  Waiting: 'orange',
  WAITING: 'orange',
  'In Review': 'purple',
  IN_REVIEW: 'purple',
  Checking: 'teal',
  CHECKING: 'teal',
  'On-Hold': 'zinc',
  ON_HOLD: 'zinc',
  Closed: 'emerald',
  CLOSED: 'emerald',
  TODO: 'teal',
  DONE: 'emerald',
  CANCELLED: 'rose',
};

// POST /api/lists/:id/statuses
export async function createStatus(req: Request, res: Response) {
  try {
    const { name, color, allowedRoles } = req.body;
    const defaultColor = DEFAULT_STATUS_THEMES[name] || 'zinc';
    const status = await prisma.listStatus.create({
      data: {
        name,
        color: color || defaultColor,
        allowedRoles: allowedRoles || [],
        listId: req.params.id,
      },
    });
    return res.status(201).json({ status });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/lists/:id/statuses/:statusId
export async function updateStatus(req: Request, res: Response) {
  try {
    const { name, color, allowedRoles } = req.body;
    const status = await prisma.listStatus.update({
      where: { id: req.params.statusId },
      data: {
        ...(name && { name }),
        ...(color && { color }),
        ...(allowedRoles && { allowedRoles }),
      },
    });
    return res.json({ status });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Status not found' });
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/lists/:id/statuses/:statusId
export async function deleteStatus(req: Request, res: Response) {
  try {
    await prisma.listStatus.delete({ where: { id: req.params.statusId } });
    return res.json({ message: 'Status deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Status not found' });
    return res.status(500).json({ error: err.message });
  }
}
