import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';
import { taskInclude } from '../controllers/task.controller';

export interface RecurringConfig {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  time: string; // "HH:mm" (24h) e.g. "21:00", "21:30", "09:00"
  daysOfWeek?: number[]; // [1, 2, 3, 4, 5] (1=Monday ... 7=Sunday or 0=Sunday)
  dayOfMonth?: number; // 1 to 31
  lastRunAt?: string; // ISO string of when it last created a duplicate
  timezone?: string; // default "Asia/Singapore"
}

/**
 * Formats date and time in the exact required format:
 * "mm-dd-yyyy 9pm" or "mm-dd-yyyy 9:30pm"
 * Space separator between title and timestamp.
 */
/**
 * Formats configured 24-hr time string (e.g. "21:00", "21:30", "09:00") into "9pm", "9:30pm", "9am".
 */
export function formatTimeFromConfig(timeStr?: string): string {
  if (!timeStr || !timeStr.includes(':')) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr || '0', 10);
  const m = parseInt(mStr || '0', 10);
  if (isNaN(h) || isNaN(m)) return '';
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

/**
 * Formats a Date object into "mm-dd-yyyy 9pm" or "mm-dd-yyyy 9:30pm" string based on the given timezone.
 * Strictly uses configuredTime (from task input) if provided, rather than the current clock time.
 */
export function formatRecurrenceDateTime(
  date: Date,
  timezone: string = 'Asia/Singapore',
  configuredTime?: string
): { dateStr: string; timeStr: string; formattedTimestamp: string } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const mm = partMap.month || '01';
  const dd = partMap.day || '01';
  const yyyy = partMap.year || `${date.getFullYear()}`;
  const dateStr = `${mm}-${dd}-${yyyy}`;

  let timeStr = '';
  // Strictly prioritize configured time from recurrence input (e.g. "21:00" -> "9pm")
  if (configuredTime && configuredTime.includes(':')) {
    timeStr = formatTimeFromConfig(configuredTime);
  }

  // Fallback to time of the date if configuredTime is missing
  if (!timeStr) {
    const timeDtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const timeParts = timeDtf.formatToParts(date);
    const timePartMap: Record<string, string> = {};
    for (const p of timeParts) {
      timePartMap[p.type] = p.value;
    }
    const hour = timePartMap.hour || '12';
    const minute = timePartMap.minute || '00';
    const dayPeriod = (timePartMap.dayPeriod || '').toLowerCase();
    timeStr = minute === '00' ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`;
  }

  const formattedTimestamp = `${dateStr} ${timeStr}`.trim();

  return { dateStr, timeStr, formattedTimestamp };
}

/**
 * Cleans any existing date/time stamp from a task title before appending the new one.
 */
export function cleanTitleFromTimestamp(title: string): string {
  return (title || 'Untitled Task')
    .replace(/\s+\d{2}-\d{2}-\d{4}\s+\d{1,2}(?::\d{2})?(?:am|pm)$/i, '')
    .trim();
}

/**
 * Duplicates a recurring task into the PENDING status column.
 * - Retain title with "mm-dd-yyyy 9pm or 9:30pm" from the input configuration
 * - Totally copies all checklists and audits checkmarks
 * - Totally copies all comments, replies, and attachments
 * - Preserves assignees, priority, description, listId, creatorId
 * - Emits task:created via Socket.io for immediate real-time sync
 */
export async function duplicateRecurringTask(sourceTaskId: string, scheduledDate?: Date) {
  const sourceTask = await prisma.task.findUnique({
    where: { id: sourceTaskId },
    include: {
      checklists: {
        where: { subtaskId: null },
        include: {
          items: true,
        },
      },
      comments: {
        where: { subtaskId: null },
        include: {
          attachments: true,
        },
      },
      assignees: true,
    },
  });

  if (!sourceTask) {
    throw new Error(`Recurring task with id ${sourceTaskId} not found`);
  }

  const config = (sourceTask.recurringConfig as RecurringConfig | null) || null;
  const timezone = config?.timezone || 'Asia/Singapore';
  const targetDate = scheduledDate || new Date();
  const { dateStr, timeStr, formattedTimestamp } = formatRecurrenceDateTime(targetDate, timezone, config?.time);

  const baseTitle = cleanTitleFromTimestamp(sourceTask.title);
  const newTitle = `${baseTitle} ${formattedTimestamp}`;

  // Find the canonical PENDING status for the task's list if available
  const list = await prisma.list.findUnique({
    where: { id: sourceTask.listId },
    include: { statuses: true },
  });

  let pendingStatusName = 'PENDING';
  if (list?.statuses) {
    const match = list.statuses.find(s => s.name.toUpperCase() === 'PENDING');
    if (match) pendingStatusName = match.name;
  }

  let targetDueDate = new Date(targetDate);
  if (config?.time && config.time.includes(':')) {
    const [h, m] = config.time.split(':').map((v: string) => parseInt(v, 10));
    if (!isNaN(h) && !isNaN(m)) {
      targetDueDate.setHours(h, m, 0, 0);
    }
  }

  // 1. Create the new task in PENDING status
  const newTask = await prisma.task.create({
    data: {
      title: newTitle,
      description: sourceTask.description,
      status: pendingStatusName,
      priority: sourceTask.priority,
      listId: sourceTask.listId,
      creatorId: sourceTask.creatorId,
      assigneeId: sourceTask.assigneeId,
      assignees: sourceTask.assignees && sourceTask.assignees.length > 0 ? {
        connect: sourceTask.assignees.map(a => ({ id: a.id })),
      } : undefined,
      assigneeRoleRestrictions: sourceTask.assigneeRoleRestrictions,
      teamAssignAccessRole: sourceTask.teamAssignAccessRole,
      teamId: sourceTask.teamId,
      dueDate: targetDueDate,
    },
  });

  // 2. Clone ALL checklists and preserve ALL checkmarks (items + audits)
  for (const cl of sourceTask.checklists) {
    const createdChecklist = await prisma.checklist.create({
      data: {
        name: cl.name,
        taskId: newTask.id,
        subtaskId: null,
      },
    });

    if (cl.items && cl.items.length > 0) {
      // Order items consistently so copied checklist maintains exact order
      const sortedItems = [...cl.items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const item of sortedItems) {
        await prisma.checklistItem.create({
          data: {
            checklistId: createdChecklist.id,
            text: item.text,
            completed: item.completed, // EXACT checkmark preserved!
            checkedById: item.checkedById,
            assigneeId: item.assigneeId,
          },
        });
      }
    }
  }

  // 3. Clone ALL comments (preserving user, content, attachments, and threaded replies)
  if (sourceTask.comments && sourceTask.comments.length > 0) {
    const topLevelComments = sourceTask.comments.filter(c => !c.parentCommentId);
    const replyComments = sourceTask.comments.filter(c => !!c.parentCommentId);
    const commentIdMap = new Map<string, string>();

    // Copy top level comments first
    for (const c of topLevelComments) {
      const createdComment = await prisma.taskComment.create({
        data: {
          taskId: newTask.id,
          userId: c.userId,
          content: c.content,
          createdAt: c.createdAt,
        },
      });
      commentIdMap.set(c.id, createdComment.id);

      if (c.attachments && c.attachments.length > 0) {
        for (const att of c.attachments) {
          await prisma.attachment.create({
            data: {
              fileName: att.fileName,
              fileUrl: att.fileUrl,
              fileKey: att.fileKey,
              fileSize: att.fileSize,
              mimeType: att.mimeType,
              uploadedById: att.uploadedById,
              taskCommentId: createdComment.id,
            },
          });
        }
      }
    }

    // Copy replies and map parentCommentId
    for (const r of replyComments) {
      const mappedParentId = r.parentCommentId ? commentIdMap.get(r.parentCommentId) || null : null;
      const createdReply = await prisma.taskComment.create({
        data: {
          taskId: newTask.id,
          userId: r.userId,
          content: r.content,
          createdAt: r.createdAt,
          parentCommentId: mappedParentId,
        },
      });
      commentIdMap.set(r.id, createdReply.id);
    }
  }

  // 4. Update the source recurring task's lastRunAt
  const updatedConfig: RecurringConfig = {
    ...(config || {
      frequency: (sourceTask.status.toUpperCase() as any) || 'DAILY',
      time: timeStr,
    }),
    lastRunAt: new Date().toISOString(),
  };

  await prisma.task.update({
    where: { id: sourceTaskId },
    data: {
      recurringConfig: updatedConfig as any,
    },
  });

  // 5. Invalidate caches and broadcast via WebSocket
  await invalidateCache('tasks:all', 'spaces:all', 'dashboard:all', 'lists:all');

  const fullNewTask = await prisma.task.findUnique({
    where: { id: newTask.id },
    include: taskInclude,
  });

  if (fullNewTask) {
    io.emit('task:created', fullNewTask);
  }

  return fullNewTask;
}

/**
 * Periodically called by background scheduler to inspect all recurring tasks
 * and create pending duplicates when their scheduled date & time arrives.
 */
export async function checkAndRunRecurringTasks() {
  try {
    const recurringTasks = await prisma.task.findMany({
      where: {
        OR: [
          { recurringConfig: { not: Prisma.DbNull } },
          { status: { in: ['DAILY', 'Daily', 'WEEKLY', 'Weekly', 'MONTHLY', 'Monthly'] } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        recurringConfig: true,
      },
    });

    const now = new Date();

    for (const task of recurringTasks) {
      const config = task.recurringConfig as RecurringConfig | null;
      if (!config || !config.time) continue;

      const timezone = config.timezone || 'Asia/Singapore';

      // Get current components in target timezone
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        day: 'numeric',
      });

      const parts = dtf.formatToParts(now);
      const partMap: Record<string, string> = {};
      for (const p of parts) partMap[p.type] = p.value;

      const currentHour = parseInt(partMap.hour || '0', 10);
      const currentMinute = parseInt(partMap.minute || '0', 10);
      const weekdayStr = (partMap.weekday || '').toLowerCase(); // 'mon', 'tue', ...
      const currentDayOfMonth = parseInt(partMap.day || '1', 10);

      const [confHourStr, confMinStr] = config.time.split(':');
      const confHour = parseInt(confHourStr || '0', 10);
      const confMin = parseInt(confMinStr || '0', 10);

      // Check hour and minute matching (with 5-minute safety window for scheduler jitter)
      const currentTotalMinutes = currentHour * 60 + currentMinute;
      const confTotalMinutes = confHour * 60 + confMin;
      const diffMinutes = Math.abs(currentTotalMinutes - confTotalMinutes);

      if (diffMinutes > 5) {
        continue;
      }

      // Frequency check: based directly on task status for DAILY, WEEKLY, MONTHLY
      const statusUpper = (task.status || '').toUpperCase();
      const freq = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(statusUpper)
        ? statusUpper
        : (config.frequency || 'DAILY');

      let isDue = false;
      if (freq === 'DAILY') {
        isDue = true;
      } else if (freq === 'WEEKLY') {
        // Default to Monday-Friday if daysOfWeek not specified
        const weekdayMap: Record<string, number> = {
          mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
        };
        const currentDayNum = weekdayMap[weekdayStr] ?? 1;
        const targetDays = config.daysOfWeek && config.daysOfWeek.length > 0
          ? config.daysOfWeek
          : [1, 2, 3, 4, 5]; // Mon to Fri

        if (targetDays.includes(currentDayNum)) {
          isDue = true;
        }
      } else if (freq === 'MONTHLY') {
        const targetDayOfMonth = config.dayOfMonth || 1;
        if (currentDayOfMonth === targetDayOfMonth) {
          isDue = true;
        }
      }

      if (!isDue) continue;

      // Deduplication: prevent duplicate generation in the same hour window
      if (config.lastRunAt) {
        const lastRun = new Date(config.lastRunAt);
        const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastRun < 1) {
          continue; // Already ran recently
        }
      }

      // Execute duplication
      await duplicateRecurringTask(task.id, now);
      console.log(`[RecurringTasks] Automatically duplicated task "${task.title}" (${task.id}) into PENDING.`);
    }
  } catch (error) {
    console.error('[RecurringTasks] Error checking recurring tasks:', error);
  }
}
