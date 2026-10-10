import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    // Optional ?userId= scopes the feed to one user's own actions (the "For Me" view),
    // so their entries aren't pushed out of the window by everyone else's activity
    const userId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined;
    const userFilter = userId ? { userId } : {};

    const logInclude = {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true }
      }
    };
    const [recentLogs, statusLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: userFilter,
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: logInclude,
      }),
      // Status/title/checklist/audit changes get their own window: bulk assignment logs otherwise push them out
      prisma.auditLog.findMany({
        where: { ...userFilter, action: { in: ['STATUS_CHANGE', 'TITLE_CHANGE', 'AUDIT_ITEM_CHECKED', 'CHECKLIST_ITEM_CHECKED'] } },
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: logInclude,
      }),
    ]);
    const recentLogIds = new Set(recentLogs.map(l => l.id));
    const logs = [...recentLogs, ...statusLogs.filter(l => !recentLogIds.has(l.id))];

    const comments = await prisma.taskComment.findMany({
      where: userFilter,
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } }
      }
    });

    const existingCommentIds = new Set(
      logs
        .filter(l => (l.action === 'COMMENT' || l.action === 'REPLY') && (l.details as any)?.commentId)
        .map(l => (l.details as any).commentId)
    );

    // Collapse duplicate rows (same author, task and text posted within 10s — e.g. an integration
    // that fired its request twice) so each comment only appears once in the feed
    const lastSeenComment = new Map<string, number>();
    const dedupedComments = comments.filter(c => {
      const key = `${c.userId}:${c.taskId}:${c.content}`;
      const t = c.createdAt.getTime();
      const prev = lastSeenComment.get(key);
      lastSeenComment.set(key, t);
      return prev === undefined || Math.abs(prev - t) > 10_000;
    });

    const commentLogs = dedupedComments
      .filter(c => !existingCommentIds.has(c.id))
      .map(c => ({
      id: c.id,
      action: c.parentCommentId ? 'REPLY' : 'COMMENT',
      entity: 'TASK',
      entityId: c.taskId,
      userId: c.userId,
      details: { text: c.content },
      createdAt: c.createdAt,
      user: c.user
    }));

    const allLogs = [...logs, ...commentLogs]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 300);

    // ---------------------------------------------------------------
    // Batch enrich: collect all unique task/subtask IDs in ONE pass
    // then fetch all titles in exactly 2 queries (no N+1)
    // ---------------------------------------------------------------
    const taskIds = new Set<string>();
    const subtaskIds = new Set<string>();

    for (const log of allLogs) {
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

    const enrichedLogs = allLogs.map((log: any) => {
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

    res.json({ logs: enrichedLogs });
  } catch (error: any) {
    console.error('getAuditLogs error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
