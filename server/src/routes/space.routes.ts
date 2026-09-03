import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const spaceRouter = Router();

// GET /api/spaces (Get full hierarchy: Spaces -> Folders -> Subfolders -> Lists/Docs)
spaceRouter.get('/', async (req: Request, res: Response) => {
  try {
    const spaces = await prisma.space.findMany({
      include: {
        folders: {
          include: {
            subfolders: {
              include: { lists: true, docs: true },
            },
            lists: true,
            docs: true,
          },
        },
        lists: true,
        docs: true,
      },
    });
    return res.json({ spaces });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/spaces (Create Space)
spaceRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, icon, color, ownerId } = req.body;
    const space = await prisma.space.create({
      data: { name, icon, color, ownerId },
    });
    return res.status(201).json({ space });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/docs (Create Doc, organized by date)
spaceRouter.post('/docs', async (req: Request, res: Response) => {
  try {
    const { title, content, docDate, spaceId, folderId, subfolderId } = req.body;
    const doc = await prisma.doc.create({
      data: {
        title,
        content,
        docDate: docDate ? new Date(docDate) : new Date(),
        spaceId,
        folderId,
        subfolderId,
      },
    });
    return res.status(201).json({ doc });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/docs/:id/task-subtab (Auto-list available tasks/subtasks sorted by client)
spaceRouter.get('/docs/:id/task-subtab', async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
      include: {
        subtasks: true,
        column: true,
        assigneeUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { clientName: 'asc' },
    });
    return res.json({ tasks });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
