import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true }
        }
      }
    });

    const comments = await prisma.taskComment.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } }
      }
    });

    const commentLogs = comments.map(c => ({
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
      .slice(0, 200);

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
