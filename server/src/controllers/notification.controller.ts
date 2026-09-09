import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

// GET /api/notifications
export async function getNotifications(req: Request, res: Response) {
  try {
    const authReq = req as any;
    if (!authReq.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { tab } = req.query; // 'primary' or 'cleared'
    const isCleared = tab === 'cleared';

    const notifications = await prisma.taskNotification.findMany({
      where: {
        userId: authReq.user.id,
        isCleared,
      },
      include: {
        actor: { select: { id: true, name: true, avatarUrl: true } },
        task: { select: { id: true, title: true, status: true, listId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ notifications });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/notifications/:id/clear
export async function clearNotification(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const notification = await prisma.taskNotification.update({
      where: { id },
      data: { isCleared: true },
    });
    return res.json({ notification });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/notifications/:id/read
export async function markAsRead(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const notification = await prisma.taskNotification.update({
      where: { id },
      data: { isRead: true },
    });
    return res.json({ notification });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/notifications/cleared
export async function deleteCleared(req: Request, res: Response) {
  try {
    const authReq = req as any;
    await prisma.taskNotification.deleteMany({
      where: { userId: authReq.user.id, isCleared: true },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
