import { Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import { redis } from '../config/redis';
import { prisma } from '../config/prisma';
import { logger, errMsg } from '../config/logger';
import { io } from '../server';
import { updatePageBlocks } from '../services/pageContentService';
import {
  extractPrioritiesSection,
  hasCustomPriorities,
  cloneBlocksWithNewIds,
  stripNewTaskBadges,
  appendTaskToJournal,
  taskMentionIds,
  NEW_TASK_BADGE,
} from '../utils/pageBlocks';
import { runRecurringDailyRollover } from '../services/recurringTaskService';

// KYC, Closed, and Pin Board items never roll over (status is free text, so match any casing)
const notKyc = { NOT: { status: { equals: 'KYC', mode: 'insensitive' as const } } };
const notClosed = { NOT: { status: { equals: 'CLOSED', mode: 'insensitive' as const } } };
const notPinboard = {
  NOT: {
    OR: [
      { status: { equals: 'PIN BOARD', mode: 'insensitive' as const } },
      { status: { equals: 'PINBOARD', mode: 'insensitive' as const } },
      { status: { equals: 'PIN_BOARD', mode: 'insensitive' as const } },
    ],
  },
};

const isExcludedStatus = (status?: string | null) => {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return s === 'KYC' || s === 'CLOSED' || s === 'PINBOARD';
};

// The tasks a day page lists
const JOURNAL_TASKS: Prisma.TaskWhereInput = {
  AND: [
    { status: { notIn: ['Closed', 'CLOSED'] } },
    notKyc,
    notClosed,
    notPinboard,
    // Erased from a day page by a user: stays off (with its subtasks) until mentioned there again
    { rolloverExcluded: false },
  ],
};
// Closed/completed subtasks don't roll over either.
// Subtask.status is nullable; keep null-status subtasks (a bare NOT would drop them in SQL)
const OPEN_SUBTASKS: Prisma.SubtaskWhereInput = {
  completed: false,
  OR: [{ status: null }, { AND: [notKyc, notClosed, notPinboard] }],
};

/**
 * Runs the Daily Rollover generation for all daily rollover docs.
 * Ensures whatever was written, designed, and formatted in "Priorities for Today"
 * on the previous day page carries over to the next day's page.
 */
export async function runDailyRollover(options?: { dateOverride?: string | Date; force?: boolean }) {
  // Custom status priority order (lower index = higher priority in the list)
  const STATUS_ORDER: Record<string, number> = {
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
    where: JOURNAL_TASKS,
    include: {
      list: { select: { id: true, name: true } },
      subtasks: {
        where: OPEN_SUBTASKS,
        orderBy: { createdAt: 'asc' },
      },
    },
    // Fetch newest first so new tasks appear at the top of their status group
    orderBy: { createdAt: 'desc' }
  });

  const clients: Record<string, any[]> = {};
  for (const task of activeTasks) {
    if (isExcludedStatus(task.status)) continue;
    if (task.list) {
      if (!clients[task.list.name]) clients[task.list.name] = [];
      const validSubtasks = (task.subtasks || []).filter((sub: any) => !sub.completed && !isExcludedStatus(sub.status));
      clients[task.list.name].push({ ...task, subtasks: validSubtasks });
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

  // Find docs that are meant for Daily Rollover
  const docs = await prisma.doc.findMany({
    where: { isDailyRollover: true },
  });

  const results: any[] = [];

  for (const doc of docs) {
    const tz = (doc as any).rolloverTimezone || 'Asia/Singapore';
    const dateToRun = options?.dateOverride ? new Date(options.dateOverride) : new Date();

    // Formatter for Month Folder (e.g. "September 2026")
    const monthFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'long',
      year: 'numeric'
    });
    const monthTitle = monthFormatter.format(dateToRun);

    // Formatter for Day Page (e.g. "September 12, 2026")
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const dayTitle = dayFormatter.format(dateToRun);

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

    // 2. Find the most recent previous day page in this doc to carry over priorities
    const targetTime = dateToRun.getTime();
    const otherDayPages = await prisma.page.findMany({
      where: {
        docId: doc.id,
        parentPageId: { not: null },
        title: { not: dayTitle },
      },
      select: { id: true, title: true, content: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const sortedOther = otherDayPages
      .map((p) => ({ page: p, time: new Date(p.title).getTime() }))
      .filter((p) => !isNaN(p.time) && p.time < targetTime)
      .sort((a, b) => b.time - a.time);

    const previousPage = sortedOther[0]?.page || otherDayPages[0];

    // 3. Extract and carry over the "Priorities for Today" section from the previous day page
    let carriedPrioritiesHeader = {
      id: `blk-${Date.now()}-prio-head`,
      type: 'text',
      content: `<h2>🚨 Priorities for Today</h2>`
    };
    let carriedPriorityBlocks: any[] = [
      {
        id: `blk-${Date.now()}-noprio`,
        type: 'text',
        content: `<p>No priorities</p>`
      }
    ];

    if (previousPage?.content) {
      try {
        const prevBlocks = JSON.parse(previousPage.content);
        const { headerBlock, contentBlocks } = extractPrioritiesSection(prevBlocks);
        if (hasCustomPriorities(contentBlocks)) {
          if (headerBlock) {
            carriedPrioritiesHeader = {
              ...headerBlock,
              id: `blk-${Date.now()}-prio-head`,
            };
          }
          // A task's NEW TASK ADDED badge belongs to the day it was added
          carriedPriorityBlocks = cloneBlocksWithNewIds(stripNewTaskBadges(contentBlocks), 'blk-prio');
          logger.info(`Carried over ${carriedPriorityBlocks.length} priority block(s) from "${previousPage.title}" to "${dayTitle}" in Doc ${doc.id}`);
        }
      } catch (err) {
        logger.warn({ err }, `Failed to parse previous page content from "${previousPage.title}"`);
      }
    }

    const activeClientHeader = {
      id: `blk-${Date.now()}-client-head`,
      type: 'text',
      content: `<h2>👀 ACTIVE CLIENT</h2>`
    };

    // Tasks added during the day go under their client with a NEW TASK ADDED badge (appendTaskToJournal);
    // the lines above are rebuilt from the tasks, so that badge does not roll over.
    const docBlocks = [
      carriedPrioritiesHeader,
      ...carriedPriorityBlocks,
      activeClientHeader,
      ...tiptapNodes,
    ];

    const contentString = JSON.stringify(docBlocks);

    // 4. Ensure the Day Subpage exists under the Month Folder
    const existingDayPage = await prisma.page.findFirst({
      where: {
        docId: doc.id,
        title: dayTitle,
        parentPageId: monthPage.id
      }
    });

    if (!existingDayPage) {
      const created = await prisma.page.create({
        data: {
          title: dayTitle,
          content: contentString,
          docId: doc.id,
          parentPageId: monthPage.id
        }
      });
      logger.info(`Created auto-generated Day Subpage "${dayTitle}" in Doc ${doc.id}`);
      results.push({ action: 'created', pageId: created.id, title: dayTitle, carriedCount: carriedPriorityBlocks.length });
    } else {
      let existingBlocks: any[] = [];
      try {
        existingBlocks = JSON.parse(existingDayPage.content || '[]');
      } catch {}
      const { contentBlocks: existingPrioBlocks } = extractPrioritiesSection(existingBlocks);

      // If force is enabled or if today's page currently has no custom priorities but yesterday does:
      if (options?.force || (!hasCustomPriorities(existingPrioBlocks) && hasCustomPriorities(carriedPriorityBlocks))) {
        const targetSection = extractPrioritiesSection(existingBlocks);
        if (targetSection.startIndex !== -1) {
          const deleteCount = targetSection.endIndex - (targetSection.startIndex + 1);
          existingBlocks.splice(targetSection.startIndex + 1, deleteCount, ...carriedPriorityBlocks);
        } else {
          existingBlocks.unshift(carriedPrioritiesHeader, ...carriedPriorityBlocks);
        }
        await prisma.page.update({
          where: { id: existingDayPage.id },
          data: { content: JSON.stringify(existingBlocks) },
        });
        logger.info(`Updated priorities on existing Day Subpage "${dayTitle}" in Doc ${doc.id}`);
        results.push({ action: 'updated', pageId: existingDayPage.id, title: dayTitle, carriedCount: carriedPriorityBlocks.length });
      } else {
        results.push({ action: 'skipped', pageId: existingDayPage.id, title: dayTitle });
      }
    }
  }

  return results;
}

export const JOURNAL_CATCH_UP_JOB = 'journalCatchUp';

// What the previous catch-up run found missing, per day page. A task is only added once two runs in a row miss it, so
// the append made when it was created, or a user's erase still being recorded, always finishes first.
let missingLastRun = new Map<string, Set<string>>();

const escapeAttr = (s: string) => s.replace(/"/g, '&quot;');

/**
 * Safety net for the journal auto-append, run every few minutes: puts on today's page any task that belongs there (the
 * rollover's rules) but isn't, e.g. the server restarted before its append, the page kept changing, or the task came in
 * through the ClickUp pull. A task unchanged since the page was built was listed by the rollover, so only tasks changed
 * since then are checked. Tasks erased by a user are rolloverExcluded and stay off.
 */
export async function appendMissingTasksToJournal() {
  const docs = await prisma.doc.findMany({ where: { isDailyRollover: true }, select: { id: true, rolloverTimezone: true } });
  const missingThisRun = new Map<string, Set<string>>();

  for (const doc of docs) {
    const dayTitle = new Intl.DateTimeFormat('en-US', {
      timeZone: doc.rolloverTimezone || 'Asia/Singapore',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date());
    const dayPage = await prisma.page.findFirst({
      where: { docId: doc.id, title: dayTitle, parentPageId: { not: null } },
      select: { id: true, content: true, createdAt: true, updatedAt: true },
    });
    // The rollover hasn't made today's page yet; it will list every task itself
    if (!dayPage) continue;

    const changed = await prisma.task.findMany({
      where: { AND: [JOURNAL_TASKS, { updatedAt: { gte: dayPage.createdAt } }] },
      select: { id: true, status: true },
    });
    const onPage = taskMentionIds(dayPage.content);
    const missingIds = changed.filter((t) => !isExcludedStatus(t.status) && !onPage.has(t.id)).map((t) => t.id);
    const confirmedIds = missingIds.filter((id) => missingLastRun.get(dayPage.id)?.has(id));
    missingThisRun.set(dayPage.id, new Set(missingIds));
    if (confirmedIds.length === 0) continue;

    const tasks = await prisma.task.findMany({
      where: { id: { in: confirmedIds } },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        list: { select: { name: true } },
        assignees: { select: { id: true, name: true, avatarUrl: true } },
        subtasks: { where: OPEN_SUBTASKS, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let added: string[] = [];
    const written = await updatePageBlocks(dayPage, (blocks) => {
      const present = taskMentionIds(JSON.stringify(blocks));
      const toAdd = tasks.filter((t) => !present.has(t.id));
      added = toAdd.map((t) => t.title);
      if (toAdd.length === 0) return false;

      for (const t of toAdd) {
        // Same lines the append at creation and the rollover write; only tasks created today get the badge
        const title = escapeAttr(t.title);
        const status = escapeAttr(JSON.stringify({ name: t.status, color: '#3b82f6' }));
        const assignees = escapeAttr(JSON.stringify(t.assignees));
        const isNew = t.createdAt.getTime() >= dayPage.createdAt.getTime();
        const taskBlock = {
          id: `blk-tk-${Date.now()}-${t.id}`,
          type: 'text',
          content: `<p><span data-type="mention" data-id="${t.id}" data-label="${title}" data-mention-type="task" data-task-status="${status}" data-task-assignees="${assignees}" data-task-list-name="${escapeAttr(t.list.name)}">@${title}</span>${isNew ? ` ${NEW_TASK_BADGE}` : ''}</p>`,
        };
        appendTaskToJournal(blocks, t.list.name, taskBlock);

        const subtaskBlocks = t.subtasks
          .filter((s) => !isExcludedStatus(s.status))
          .map((s) => ({
            id: `blk-st-${Date.now()}-${s.id}`,
            type: 'text',
            content: `<p>&nbsp;&nbsp;&nbsp;&nbsp;└─ <span data-type="mention" data-id="${s.id}" data-label="${escapeAttr(s.title)}" data-mention-type="subtask">@${escapeAttr(s.title)}</span></p>`,
          }));
        blocks.splice(blocks.indexOf(taskBlock) + 1, 0, ...subtaskBlocks);
      }
    });

    if (written) {
      io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: dayPage.id });
      logger.info(`Journal catch-up: added ${added.length} missed task(s) to "${dayTitle}": ${added.join(' | ')}`);
    }
  }

  missingLastRun = missingThisRun;
}

export const dailyRolloverWorker = new Worker(
  'DailyRollover',
  async (job) => {
    // On the rollover's queue so it never runs while the rollover is building today's page
    if (job.name === JOURNAL_CATCH_UP_JOB) return appendMissingTasksToJournal();
    logger.info('Running DailyRollover job (Dynamic Generation)...');
    await runDailyRollover(job.data);
    logger.info('Running Daily Recurring Tasks Rollover...');
    try {
      const recurringRes = await runRecurringDailyRollover(job.data);
      logger.info(`Finished Recurring Tasks Rollover: created ${recurringRes.createdCount}, skipped ${recurringRes.skippedCount}`);
    } catch (recErr) {
      logger.error(`Recurring Tasks Rollover failed: ${errMsg(recErr)}`);
    }
    logger.info('Finished DailyRollover job.');
  },
  { connection: redis }
);

// Listeners for logging
dailyRolloverWorker.on('completed', (job) => {
  if (job.name === JOURNAL_CATCH_UP_JOB) return; // runs every few minutes; it logs when it adds something
  logger.info(`DailyRollover job ${job.id} has completed!`);
});

dailyRolloverWorker.on('failed', (job, err) => {
  logger.error(`DailyRollover job ${job?.id} has failed with ${errMsg(err)}`);
});

dailyRolloverWorker.on('error', (err) => {
  logger.error(`DailyRollover Redis error: ${errMsg(err)}`);
});
