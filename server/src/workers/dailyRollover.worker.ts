import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

export const dailyRolloverWorker = new Worker(
  'DailyRollover',
  async (job) => {
    logger.info('Running DailyRollover job (Dynamic Generation)...');

    // Get all active tasks for static generation
    const activeTasks = await prisma.task.findMany({
      where: { status: { not: 'Closed' } },
      include: {
        list: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' }
    });

    const clients: Record<string, any[]> = {};
    for (const task of activeTasks) {
      if (task.list) {
        if (!clients[task.list.name]) clients[task.list.name] = [];
        clients[task.list.name].push(task);
      }
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
        content: `<h3>${clientName}</h3>`
      });

      for (const task of clientTasks) {
        tiptapNodes.push({
          id: `blk-t-${Date.now()}-${task.id}`,
          type: 'text',
          content: `<p><span data-type="mention" data-id="${task.id}" data-label="${task.title}" data-mention-type="task">@${task.title}</span></p>`
        });
      }
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
