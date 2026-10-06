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

    // Enrich logs by fetching task titles if it's a task or subtask
    const enrichedLogs = await Promise.all(logs.map(async (log: any) => {
      let taskTitle = null;
      if (log.entity === 'Task') {
        const t = await prisma.task.findUnique({ where: { id: log.entityId }, select: { title: true } });
        if (t) taskTitle = t.title;
      } else if (log.entity === 'Subtask') {
        const s = await prisma.subtask.findUnique({ where: { id: log.entityId }, select: { title: true, taskId: true } });
        if (s) {
          taskTitle = s.title;
          // You could also fetch parent task here if needed
        }
      }
      return {
        ...log,
        entityTitle: taskTitle
      };
    }));

    res.json({ logs: enrichedLogs });
  } catch (error: any) {
    console.error('getAuditLogs error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
