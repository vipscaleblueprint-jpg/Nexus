import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

export const dailyRolloverWorker = new Worker(
  'DailyRollover',
  async (job) => {
    logger.info('Running DailyRollover job (Dynamic Generation)...');

    // Custom status priority order (lower index = higher priority in the list)
    const STATUS_ORDER: Record<string, number> = {
      'KYC':          1,
      'PIN BOARD':    2,
      'DAILY':        3,
      'WEEKLY':       4,
      'MONTHLY':      5,
      'PENDING':      6,
      'IN PROGRESS':  7,
      'REVISION':     8,
      'CLOSED':       9,
      'ON-HOLD':      10,
      'WAITING':      11,
      'IN REVIEW':    12,
      'CHECKING':     13,
      'CRM':          14,
    };

    const getStatusOrder = (status: string) => STATUS_ORDER[(status || '').toUpperCase()] ?? 99;

    const activeTasks = await prisma.task.findMany({
      where: { status: { notIn: ['Closed', 'CLOSED'] } },
      include: {
        list: { select: { id: true, name: true } },
        subtasks: { orderBy: { createdAt: 'asc' } },
      },
      // Fetch newest first so new tasks appear at the top of their status group
      orderBy: { createdAt: 'desc' }
    });

    const clients: Record<string, any[]> = {};
    for (const task of activeTasks) {
      if (task.list) {
        if (!clients[task.list.name]) clients[task.list.name] = [];
        clients[task.list.name].push(task);
      }
    }

    // Sort each client's tasks by status order, then newest first within same status
    for (const clientName of Object.keys(clients)) {
      clients[clientName].sort((a, b) => {
        const statusDiff = getStatusOrder(a.status) - getStatusOrder(b.status);
        if (statusDiff !== 0) return statusDiff;
        // Same status: newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }

    const sortedClientNames = Object.keys(clients).sort();

    const tiptapNodes: any[] = [];

    // Main Tasks by Client
    for (const clientName of sortedClientNames) {
      const clientTasks = clients[clientName];
      if (clientTasks.length === 0) continue;

      tiptapNodes.push({
        id: `blk-h-${Date.now()}-${clientName.replace(/\s+/g, '')}`,
        type: 'text',
        content: `<h2>${clientName}</h2>`
      });

      for (const task of clientTasks) {
        tiptapNodes.push({
          id: `blk-t-${Date.now()}-${task.id}`,
          type: 'text',
          content: `<p><span data-type="mention" data-id="${task.id}" data-label="${task.title}" data-mention-type="task">@${task.title}</span></p>`
        });
        
        if (task.subtasks && task.subtasks.length > 0) {
          for (const sub of task.subtasks) {
            tiptapNodes.push({
              id: `blk-sub-${Date.now()}-${sub.id}`,
              type: 'text',
              content: `<p>&nbsp;&nbsp;&nbsp;&nbsp;<span style="color: #2A2A2E;">└─ </span><span data-type="mention" data-id="${sub.id}" data-label="${sub.title}" data-mention-type="subtask">@${sub.title}</span></p>`
            });
          }
        }
      }

      // Add a blank line to space out clients
      tiptapNodes.push({
        id: `blk-space-${Date.now()}-${clientName.replace(/\s+/g, '')}`,
        type: 'text',
        content: `<p></p>`
      });
    }

    // Prepend the Priorities Header
    const prioritiesHeader = {
      id: `blk-${Date.now()}-prio-head`,
      type: 'text',
      content: `<h2>🚨 Priorities for Today</h2>`
    };

    const noPrioritiesText = {
      id: `blk-${Date.now()}-noprio`,
      type: 'text',
      content: `<p>No priorities</p>`
    };

    const activeClientHeader = {
      id: `blk-${Date.now()}-client-head`,
      type: 'text',
      content: `<h2>👀 ACTIVE CLIENT</h2>`
    };

    const newTasksHeader = {
      id: `blk-${Date.now()}-new-tasks`,
      type: 'text',
      content: `<h3>New Tasks</h3>`
    };

    const docBlocks = [
      prioritiesHeader,
      noPrioritiesText,
      activeClientHeader,
      ...tiptapNodes,
      newTasksHeader
    ];

    const contentString = JSON.stringify(docBlocks);

    // Find docs that are meant for Daily Rollover
    const docs = await prisma.doc.findMany({
      where: { isDailyRollover: true },
    });

    for (const doc of docs) {
      const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
      
      const createHierarchyForDate = async (dateObj: Date) => {
        // Formatter for Month Folder (e.g. "September 2026")
        const monthFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          year: 'numeric'
        });
        const monthTitle = monthFormatter.format(dateObj);

        // Formatter for Day Page (e.g. "September 12, 2026")
        const dayFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        const dayTitle = dayFormatter.format(dateObj);

        // 1. Ensure the Month Folder Page exists
        let monthPage = await prisma.page.findFirst({
          where: { 
            docId: doc.id, 
            title: monthTitle,
            parentPageId: null // Top level page acts as folder
          }
        });

        if (!monthPage) {
          monthPage = await prisma.page.create({
            data: {
              title: monthTitle,
              content: JSON.stringify([{ id: `blk-m-${Date.now()}`, type: 'text', content: '' }]),
              docId: doc.id,
            }
          });
          logger.info(`Created auto-generated Month Folder "${monthTitle}" in Doc ${doc.id}`);
        }

        // 2. Ensure the Day Subpage exists under the Month Folder
        const existingDayPage = await prisma.page.findFirst({
          where: { 
            docId: doc.id, 
            title: dayTitle,
            parentPageId: monthPage.id
          }
        });

        if (!existingDayPage) {
          await prisma.page.create({
            data: {
              title: dayTitle,
              content: contentString,
              docId: doc.id,
              parentPageId: monthPage.id
            }
          });
          logger.info(`Created auto-generated Day Subpage "${dayTitle}" in Doc ${doc.id}`);
        }
      };

      // Create hierarchy for today (or overridden date)
      const dateToRun = job.data?.dateOverride ? new Date(job.data.dateOverride) : new Date();
      await createHierarchyForDate(dateToRun);

      // (Optional) For testing purposes, generate previous days to populate the folder
      await createHierarchyForDate(new Date('2026-09-08T00:00:00Z'));
      await createHierarchyForDate(new Date('2026-09-09T00:00:00Z'));
      
      // Force test dates
      await createHierarchyForDate(new Date('2026-09-16T15:00:00Z')); // Sep 17 in Asia/Singapore
      await createHierarchyForDate(new Date('2026-09-17T15:00:00Z')); // Sep 18 in Asia/Singapore
    }

    logger.info('Finished DailyRollover job.');
  },
  { connection: redis }
);

// Listeners for logging
dailyRolloverWorker.on('completed', (job) => {
  logger.info(`DailyRollover job ${job.id} has completed!`);
});

dailyRolloverWorker.on('failed', (job, err) => {
  logger.error(`DailyRollover job ${job?.id} has failed with ${err.message}`);
});
