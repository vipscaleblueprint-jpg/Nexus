import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { toNotificationPreview } from '../utils/mentionNotification';

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

    // Prune orphaned comment and mention notifications whose comment was deleted from TaskComment
    const commentNotifs = notifications.filter(
      n => (n.type === 'MENTION' || n.type === 'COMMENT') && n.taskId
    );

    let activeNotifications = notifications;
    let activeTotal = total;
    let activeUnreadCount = unreadCount;

    if (commentNotifs.length > 0) {
      const taskIds = Array.from(new Set(commentNotifs.map(n => n.taskId!)));
      const existingComments = await prisma.taskComment.findMany({
        where: { taskId: { in: taskIds } },
        select: { id: true, taskId: true, userId: true, content: true, subtaskId: true },
      });

      const orphanedNotifIds: string[] = [];
      const notifMetaMap = new Map<string, { commentId: string; subtaskId?: string | null }>();

      commentNotifs.forEach(n => {
        const preview = n.content?.trim();
        const matched = existingComments.find(c => {
          if (c.taskId !== n.taskId) return false;
          if (n.actorId && c.userId !== n.actorId) return false;
          if (!preview) return true;
          const cPreview = toNotificationPreview(c.content);
          return cPreview === preview || c.content.includes(preview) || preview.includes(cPreview);
        });
        if (!matched) {
          orphanedNotifIds.push(n.id);
        } else {
          notifMetaMap.set(n.id, { commentId: matched.id, subtaskId: matched.subtaskId });
        }
      });

      if (orphanedNotifIds.length > 0) {
        prisma.taskNotification.deleteMany({
          where: { id: { in: orphanedNotifIds } },
        }).catch(err => console.error('Failed to clean up orphaned notifications:', err));

        activeNotifications = notifications.filter(n => !orphanedNotifIds.includes(n.id));
        activeTotal = Math.max(0, total - orphanedNotifIds.length);
        const removedUnread = notifications.filter(n => orphanedNotifIds.includes(n.id) && !n.isRead).length;
        activeUnreadCount = Math.max(0, unreadCount - removedUnread);
      }

      activeNotifications = activeNotifications.map(n => {
        const meta = notifMetaMap.get(n.id);
        if (meta) {
          return { ...n, commentId: meta.commentId, ...(meta.subtaskId ? { subtaskId: meta.subtaskId } : {}) };
        }
        return n;
      });
    }

    return res.json({
      notifications: activeNotifications,
      total: activeTotal,
      unreadCount: activeUnreadCount,
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
