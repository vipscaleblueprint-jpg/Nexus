import { prisma } from '../config/prisma';
import { updatePageBlocks } from './pageContentService';
import { io } from '../server';

const MAX_TASK_WAIT_ATTEMPTS = 5;
const TASK_WAIT_INTERVAL_MS = 600;

/**
 * Appends a subtask block under its parent task in the Daily Rollover Priorities Journal.
 * Automatically retries if the parent task block is still being written by a concurrent task webhook.
 */
export async function injectSubtaskIntoJournal(
  parentTaskId: string,
  subtask: { id: string; title: string }
): Promise<boolean> {
  try {
    const docs = await prisma.doc.findMany({
      where: { isDailyRollover: true },
      orderBy: { createdAt: 'desc' }
    });

    if (!docs || docs.length === 0) return false;

    let anyWritten = false;

    for (const doc of docs) {
      const tz = doc.rolloverTimezone || 'Asia/Singapore';
      const now = new Date();
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
      const dayTitle = dayFormatter.format(now);

      // 1. Locate today's page
      let targetPage: any = await prisma.page.findFirst({
        where: { docId: doc.id, title: dayTitle },
        orderBy: { createdAt: 'desc' }
      });

      // 2. If today's page doesn't exist, check for any recent page containing the parent task
      if (!targetPage) {
        targetPage = await prisma.page.findFirst({
          where: {
            docId: doc.id,
            parentPageId: { not: null },
            content: { contains: parentTaskId }
          },
          orderBy: { createdAt: 'desc' }
        });
      }

      if (!targetPage || !targetPage.content) continue;

      const parentTaskMention = `data-id="${parentTaskId}"`;

      // 3. If parent task is not yet in targetPage (e.g. handleGalaxyTask is currently writing it),
      // wait briefly and reload up to MAX_TASK_WAIT_ATTEMPTS
      let currentContent: string = targetPage.content;
      for (let attempt = 0; attempt < MAX_TASK_WAIT_ATTEMPTS; attempt++) {
        if (currentContent.includes(parentTaskId)) break;
        await new Promise((resolve) => setTimeout(resolve, TASK_WAIT_INTERVAL_MS));
        const refreshed: { content: string; updatedAt: Date } | null = await prisma.page.findUnique({
          where: { id: targetPage.id },
          select: { content: true, updatedAt: true }
        });
        if (refreshed) {
          targetPage = { ...targetPage, content: refreshed.content, updatedAt: refreshed.updatedAt };
          currentContent = refreshed.content;
        }
      }

      if (!currentContent.includes(parentTaskId)) {
        const fallbackPage = await prisma.page.findFirst({
          where: {
            docId: doc.id,
            parentPageId: { not: null },
            content: { contains: parentTaskId }
          },
          orderBy: { createdAt: 'desc' }
        });
        if (fallbackPage && fallbackPage.content) {
          targetPage = fallbackPage;
          currentContent = fallbackPage.content;
        } else {
          continue;
        }
      }

      const escapedTitle = subtask.title.replace(/"/g, '&quot;');
      const written = await updatePageBlocks(targetPage, (blocks) => {
        let updated = false;
        let i = 0;
        while (i < blocks.length) {
          const b = blocks[i];
          if (
            b.type === 'text' &&
            b.content &&
            b.content.includes(parentTaskMention) &&
            !b.content.includes('data-mention-type="subtask"')
          ) {
            let insertIndex = i + 1;
            let alreadyExists = false;
            while (insertIndex < blocks.length) {
              const nextBlock = blocks[insertIndex];
              if (nextBlock.type === 'text' && nextBlock.content && nextBlock.content.includes('└─')) {
                if (nextBlock.content.includes(`data-id="${subtask.id}"`)) {
                  alreadyExists = true;
                }
                insertIndex++;
              } else {
                break;
              }
            }

            if (!alreadyExists) {
              const newSubtaskBlock = {
                id: `blk-st-${Date.now()}-${subtask.id}-${i}`,
                type: 'text',
                content: `<p>&nbsp;&nbsp;&nbsp;&nbsp;└─ <span data-type="mention" data-id="${subtask.id}" data-label="${escapedTitle}" data-mention-type="subtask">@${escapedTitle}</span></p>`
              };

              blocks.splice(insertIndex, 0, newSubtaskBlock);
              if (
                insertIndex + 1 >= blocks.length ||
                (blocks[insertIndex + 1]?.type === 'text' && /^<h[1-6]/i.test(blocks[insertIndex + 1]?.content || ''))
              ) {
                blocks.splice(insertIndex + 1, 0, {
                  id: `blk-space-${Date.now()}-${subtask.id}-${i}`,
                  type: 'text',
                  content: '<p></p>'
                });
              }
              updated = true;
              i = insertIndex;
            }
          }
          i++;
        }
        return updated;
      });

      if (written) {
        anyWritten = true;
        io.to(`doc:${doc.id}`).emit('page_updated', { docId: doc.id, pageId: targetPage.id });
      }
    }

    return anyWritten;
  } catch (error) {
    console.error('Failed to inject subtask into Priorities Journal:', error);
    return false;
  }
}
