import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

// GET /api/notifications
export async function getNotifications(req: Request, res: Response) {
  try {
    const authReq = req as any;
    if (!authReq.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { tab, page, limit, filter } = req.query; // 'primary' or 'cleared'
    const isCleared = tab === 'cleared';

    const pageNum = page ? Math.max(1, parseInt(page as string, 10)) : 1;
    const take = limit ? Math.min(100, Math.max(1, parseInt(limit as string, 10))) : undefined;
    const skip = take ? (pageNum - 1) * take : undefined;

    const whereClause: any = {
      userId: authReq.user.id,
      isCleared,
    };

    if (filter === 'unread') {
      whereClause.isRead = false;
    } else if (filter === 'mentions') {
      whereClause.OR = [
        { type: 'MENTION' },
        { title: { contains: 'mentioned', mode: 'insensitive' } },
        { content: { contains: '@' } },
      ];
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.taskNotification.findMany({
        where: whereClause,
        include: {
          actor: { select: { id: true, name: true, avatarUrl: true, imageUrl: true } },
          task: { select: { id: true, title: true, status: true, listId: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...(take !== undefined ? { take, skip } : {}),
      }),
      prisma.taskNotification.count({
        where: whereClause,
      }),
      prisma.taskNotification.count({
        where: {
          userId: authReq.user.id,
          isCleared: false,
          isRead: false,
        },
      }),
    ]);

    const hasMore = take !== undefined ? (skip || 0) + notifications.length < total : false;

    return res.json({
      notifications,
      total,
      unreadCount,
      hasMore,
      page: pageNum,
      limit: take,
    });
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

// PATCH /api/notifications/read-all
export async function markAllAsRead(req: Request, res: Response) {
  try {
    const authReq = req as any;
    if (!authReq.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await prisma.taskNotification.updateMany({
      where: {
        userId: authReq.user.id,
        isRead: false,
        isCleared: false,
      },
      data: { isRead: true },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/notifications/clear-all
export async function clearAll(req: Request, res: Response) {
  try {
    const authReq = req as any;
    if (!authReq.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await prisma.taskNotification.updateMany({
      where: {
        userId: authReq.user.id,
        isCleared: false,
      },
      data: { isCleared: true, isRead: true },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
