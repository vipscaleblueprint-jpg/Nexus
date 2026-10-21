import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const userId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
    const skip = (page - 1) * limit;
    const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : 'all';
    const timeFilter = typeof req.query.timeFilter === 'string' ? req.query.timeFilter.toLowerCase() : 'all';

    const userFilter = userId ? { userId } : {};

    // Time filter boundaries
    let timeFilterWhere: any = {};
    const now = new Date();
    if (timeFilter === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      timeFilterWhere = { createdAt: { gte: startOfDay } };
    } else if (timeFilter === 'last7') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      timeFilterWhere = { createdAt: { gte: sevenDaysAgo } };
    } else if (timeFilter === 'last30') {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      timeFilterWhere = { createdAt: { gte: thirtyDaysAgo } };
    }

    const logInclude = {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    };

    // 1. Comments category directly queries taskComment for complete history
    if (category === 'comments') {
      const commentWhere: any = {
        ...userFilter,
        ...timeFilterWhere,
      };

      const [total, comments] = await Promise.all([
        prisma.taskComment.count({ where: commentWhere }),
        prisma.taskComment.findMany({
          where: commentWhere,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
            task: { select: { id: true, title: true } },
            subtask: { select: { id: true, title: true } },
          },
        }),
      ]);

      const enrichedLogs = comments.map(c => ({
        id: c.id,
        action: c.parentCommentId ? 'REPLY' : 'COMMENT',
        entity: c.subtaskId ? 'SUBTASK' : 'TASK',
        entityId: c.subtaskId || c.taskId,
        userId: c.userId,
        details: { text: c.content, subtaskTitle: c.subtask?.title },
        createdAt: c.createdAt,
        user: c.user,
        entityTitle: c.subtask?.title || c.task?.title || 'task',
        taskId: c.taskId,
      }));

      return res.json({
        logs: enrichedLogs,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    }

    // 2. Action filter for other specific categories
    let actionWhere: any = {};
    if (category === 'status') {
      actionWhere = { action: { in: ['STATUS_CHANGE', 'TITLE_CHANGE'] } };
    } else if (category === 'checklists') {
      actionWhere = { action: 'CHECKLIST_ITEM_CHECKED' };
    } else if (category === 'audits') {
      actionWhere = { action: 'AUDIT_ITEM_CHECKED' };
    } else if (category === 'assigned') {
      actionWhere = { action: 'ASSIGNMENT' };
    }

    const auditWhere: any = {
      ...userFilter,
      ...actionWhere,
      ...timeFilterWhere,
    };

    const [total, rawLogs] = await Promise.all([
      prisma.auditLog.count({ where: auditWhere }),
      prisma.auditLog.findMany({
        where: auditWhere,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: logInclude,
      }),
    ]);

    // Batch enrich task & subtask titles for the page's logs only
    const taskIds = new Set<string>();
    const subtaskIds = new Set<string>();

    for (const log of rawLogs) {
      const entityStr = (log as any).entity?.toLowerCase();
      if (entityStr === 'task') taskIds.add((log as any).entityId);
      else if (entityStr === 'subtask') subtaskIds.add((log as any).entityId);
    }

    const [tasks, subtasks] = await Promise.all([
      taskIds.size > 0
        ? prisma.task.findMany({ where: { id: { in: Array.from(taskIds) } }, select: { id: true, title: true } })
        : Promise.resolve([] as { id: string; title: string }[]),
      subtaskIds.size > 0
        ? prisma.subtask.findMany({ where: { id: { in: Array.from(subtaskIds) } }, select: { id: true, title: true, taskId: true } })
        : Promise.resolve([] as { id: string; title: string; taskId: string }[]),
    ]);

    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const subtaskMap = new Map(subtasks.map(s => [s.id, s]));

    const enrichedLogs = rawLogs.map((log: any) => {
      const entityStr = log.entity?.toLowerCase();
      let entityTitle: string | null = null;
      let resolvedTaskId: string = log.entityId;

      if (entityStr === 'task') {
        const t = taskMap.get(log.entityId);
        if (t) { entityTitle = t.title; resolvedTaskId = t.id; }
      } else if (entityStr === 'subtask') {
        const s = subtaskMap.get(log.entityId);
        if (s) { entityTitle = s.title; resolvedTaskId = s.taskId; }
      }

      return {
        ...log,
        entityTitle,
        taskId: resolvedTaskId,
      };
    });

    return res.json({
      logs: enrichedLogs,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error: any) {
    console.error('getAuditLogs error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
