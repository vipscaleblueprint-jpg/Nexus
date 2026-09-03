import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { validateTaskStatusTransition } from '../services/ruleEngine';
import { getR2PresignedUrl } from '../services/r2Service';

const prisma = new PrismaClient();
export const taskRouter = Router();

// POST /api/tasks (Create task)
taskRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { title, description, clientName, priority, listId, columnId, assigneeUserId, assigneeTeam, creatorId } = req.body;

    const task = await prisma.task.create({
      data: {
        title,
        description,
        clientName,
        priority: priority || 'MEDIUM',
        listId,
        columnId,
        assigneeUserId,
        assigneeTeam,
        creatorId,
      },
      include: {
        column: true,
        subtasks: true,
        checklists: { include: { items: true } },
      },
    });

    return res.status(201).json({ task });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id/move (Move column status with rule engine validation)
taskRouter.patch('/:id/move', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetColumnId, userRoles } = req.body; // userRoles array e.g. ["PM", "TECH"]

    const validation = await validateTaskStatusTransition(id, targetColumnId, userRoles || []);
    if (!validation.allowed) {
      return res.status(403).json({ error: validation.reason });
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: { columnId: targetColumnId },
      include: { column: true },
    });

    return res.json({ task: updatedTask, message: 'Status updated successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/attachments/r2-url (Generate Cloudflare R2 presigned upload URL)
taskRouter.post('/:id/attachments/r2-url', async (req: Request, res: Response) => {
  try {
    const { fileName, mimeType } = req.body;
    const r2Config = getR2PresignedUrl(fileName, mimeType);
    return res.json(r2Config);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
