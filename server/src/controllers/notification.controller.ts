import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';

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

    // The cowbell is strictly "For Me Only" (workspace activities are viewed in Activity Page > Show All).
    // A notification belongs in the personal cowbell if:
    // 1. Direct mention
    // 2. Direct assignment / unassignment to the user
    // 3. Direct reply to the user's comment
    // 4. Update on a task or subtask where the user is an active assignee
    // 5. System notification not linked to any task
    const forMeCondition: any[] = [
      { type: { equals: 'MENTION', mode: 'insensitive' } },
      { title: { contains: 'mentioned you', mode: 'insensitive' } },
      { title: { contains: 'assigned you', mode: 'insensitive' } },
      { title: { contains: 'unassigned you', mode: 'insensitive' } },
      { title: { contains: 'replied to your comment', mode: 'insensitive' } },
      {
        task: {
          OR: [
            { assigneeId: authReq.user.id },
            { assignees: { some: { id: authReq.user.id } } },
            {
              subtasks: {
                some: {
                  OR: [
                    { assigneeId: authReq.user.id },
                    { assignees: { some: { id: authReq.user.id } } },
                  ],
                },
              },
            },
          ],
        },
      },
      { taskId: null },
    ];

    const whereClause: any = {
      userId: authReq.user.id,
      isCleared,
    };

    if (filter === 'unread') {
      whereClause.isRead = false;
      whereClause.OR = forMeCondition;
    } else if (filter === 'mentions') {
      whereClause.OR = [
        { type: { equals: 'MENTION', mode: 'insensitive' } },
        { title: { contains: 'mentioned you', mode: 'insensitive' } },
      ];
    } else {
      whereClause.OR = forMeCondition;
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
          OR: forMeCondition,
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
    const authReq = req as any;
    if (!authReq.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const existing = await prisma.taskNotification.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.json({ notification: null });
    }

    if (existing.userId !== authReq.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (existing.isCleared) {
      return res.json({ notification: existing });
    }

    const notification = await prisma.taskNotification.update({
      where: { id },
      data: { isCleared: true },
    });

    io.to(`user:${authReq.user.id}`).emit('notification_cleared', { id });

    return res.json({ notification });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/notifications/:id/read
export async function markAsRead(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const authReq = req as any;
    if (!authReq.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const existing = await prisma.taskNotification.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.json({ notification: null });
    }

    if (existing.userId !== authReq.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (existing.isRead) {
      return res.json({ notification: existing });
    }

    const notification = await prisma.taskNotification.update({
      where: { id },
      data: { isRead: true },
    });

    io.to(`user:${authReq.user.id}`).emit('notification_read', { id });

    return res.json({ notification });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/notifications/cleared
export async function deleteCleared(req: Request, res: Response) {
  try {
    const authReq = req as any;
    if (!authReq.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await prisma.taskNotification.deleteMany({
      where: { userId: authReq.user.id, isCleared: true },
    });

    io.to(`user:${authReq.user.id}`).emit('notifications_deleted_cleared');

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

    io.to(`user:${authReq.user.id}`).emit('notifications_all_read');

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

    io.to(`user:${authReq.user.id}`).emit('notifications_all_cleared');

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
