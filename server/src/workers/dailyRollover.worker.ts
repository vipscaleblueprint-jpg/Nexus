import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

export const dailyRolloverWorker = new Worker(
  'DailyRollover',
  async (job) => {
    logger.info('Running DailyRollover job (Dynamic Generation)...');

    // 1. Fetch active tasks to build the template
    const activeTasks = await prisma.task.findMany({
      where: { status: { not: 'Closed' } },
      include: {
        assignee: true,
        list: true,
      }
    });

    // 2. Extract unique assignees and clients (lists)
    const assigneeMap = new Map();
    const listMap = new Map();

    for (const task of activeTasks) {
      if (task.assignee) assigneeMap.set(task.assignee.name, task.assignee);
      if (task.list) listMap.set(task.list.name, task.list);
    }

    const sortedAssignees = Array.from(assigneeMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    // 3. Group tasks for static report
    const priorities: Record<string, any[]> = {};
    const clients: Record<string, any[]> = {};

    // Get start of today in UTC+8
    const now = new Date();
    const utc8Time = now.getTime() + (8 * 60 * 60 * 1000);
    const utc8Date = new Date(utc8Time);
    utc8Date.setUTCHours(0, 0, 0, 0);
    const startOfTodayUtc8 = new Date(utc8Date.getTime() - (8 * 60 * 60 * 1000));

    for (const task of activeTasks) {
      // Group by all assignees for Priorities for Today (ONLY IF CREATED TODAY)
      if (new Date(task.createdAt) >= startOfTodayUtc8) {
        const assigneeNames = new Set<string>();
        if (task.assignee) assigneeNames.add(task.assignee.name);
        if ((task as any).assignees && (task as any).assignees.length > 0) {
          (task as any).assignees.forEach((a: any) => assigneeNames.add(a.name));
        }

        assigneeNames.forEach(name => {
          if (!priorities[name]) priorities[name] = [];
          priorities[name].push(task);
        });
      }

      // Group by list for Active Clients
      if (task.list) {
        if (!clients[task.list.name]) clients[task.list.name] = [];
        clients[task.list.name].push(task);
      }
    }

    const sortedPriorities = Object.keys(priorities).sort();
    const sortedClients = Object.keys(clients).sort();

    let htmlContent = `<div id="daily-report-container">`;

    // Priorities Section
    htmlContent += `<h2 id="priorities-header">🚨 Priorities for Today</h2>`;
    htmlContent += `<div id="priorities-section">`;
    for (const assigneeName of sortedPriorities) {
      htmlContent += `<div data-assignee-group="${assigneeName}"><p><strong>• ${assigneeName}</strong></p>`;
      for (const task of priorities[assigneeName]) {
        const safeTitle = task.title.replace(/"/g, '&quot;');
        const safeStatus = task.status ? task.status.replace(/"/g, '&quot;') : '';
        const safeAssignees = task.assignees ? JSON.stringify(task.assignees).replace(/"/g, '&quot;') : '[]';
        htmlContent += `<p><span data-type="task-mention" data-id="${task.id}" data-label="${safeTitle}" data-task-status="${safeStatus}" data-task-assignees="${safeAssignees}"></span></p>`;
      }
      htmlContent += `</div>`;
    }
    htmlContent += `</div>`;

    // Active Clients Section
    htmlContent += `<h2 id="clients-header">👀 ACTIVE CLIENT</h2>`;
    htmlContent += `<div id="clients-section">`;
    for (const listName of sortedClients) {
      htmlContent += `<div data-client-group="${listName}"><p><strong>• ${listName}</strong></p>`;
      for (const task of clients[listName]) {
        const safeTitle = task.title.replace(/"/g, '&quot;');
        const safeStatus = task.status ? task.status.replace(/"/g, '&quot;') : '';
        const safeAssignees = task.assignees ? JSON.stringify(task.assignees).replace(/"/g, '&quot;') : '[]';
        htmlContent += `<p><span data-type="task-mention" data-id="${task.id}" data-label="${safeTitle}" data-task-status="${safeStatus}" data-task-assignees="${safeAssignees}"></span></p>`;
      }
      htmlContent += `</div>`;
    }
    htmlContent += `</div></div>`;

    const docBlocks = [
      {
        id: `blk-${Date.now()}`,
        type: 'text',
        content: htmlContent
      }
    ];
    const contentString = JSON.stringify(docBlocks);

    // 4. Create the pages for docs with isDailyRollover = true
    const docs = await prisma.doc.findMany({
      where: { isDailyRollover: true },
    });

    for (const doc of docs) {
      const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
      const now = new Date();
      
      const createPageForDate = async (dateObj: Date, titleOverride?: string) => {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        const pageTitle = titleOverride || formatter.format(dateObj);

        const existingPage = await prisma.page.findFirst({
          where: { docId: doc.id, title: pageTitle }
        });

        if (!existingPage) {
          await prisma.page.create({
            data: {
              title: pageTitle,
              content: contentString,
              docId: doc.id,
            }
          });
          logger.info(`Created auto-generated page for ${pageTitle} in Doc ${doc.id}`);
        }
      };

      // Create today's page
      await createPageForDate(now);

      // Create comparison pages (September 8 and September 9)
      const sept8 = new Date('2026-09-08T00:00:00Z');
      const sept9 = new Date('2026-09-09T00:00:00Z');
      await createPageForDate(sept8, 'September 8, 2026');
      await createPageForDate(sept9, 'September 9, 2026');
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
