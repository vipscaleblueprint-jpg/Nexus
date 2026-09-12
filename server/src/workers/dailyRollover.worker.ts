import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

export const dailyRolloverWorker = new Worker(
  'DailyRollover',
  async (job) => {
    logger.info('Running DailyRollover job (Dynamic Generation)...');

    // Content representing the LiveKanbanBlockNode for realtime Priorities
    const docBlocks = [
      {
        id: `blk-${Date.now()}`,
        type: 'text',
        content: '<div data-type="live-kanban-block" data-block-type="daily-report"></div>'
      }
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

      // Create hierarchy for today
      await createHierarchyForDate(new Date());

      // (Optional) For testing purposes, generate previous days to populate the folder
      await createHierarchyForDate(new Date('2026-09-08T00:00:00Z'));
      await createHierarchyForDate(new Date('2026-09-09T00:00:00Z'));
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
