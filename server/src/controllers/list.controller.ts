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
        tasks: {
          include: {
            subtasks: true,
            checklists: { include: { items: true } },
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
        tasks: {
          orderBy: { createdAt: 'asc' },
          include: {
            subtasks: { orderBy: { createdAt: 'asc' } },
            checklists: { include: { items: { orderBy: { createdAt: 'asc' } } } },
            assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
            creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
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
    const { name } = req.body;
    const list = await prisma.list.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
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
