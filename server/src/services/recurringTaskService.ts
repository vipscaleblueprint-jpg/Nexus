import { mirrorNewTaskToClickUp } from './clickupMirror';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';
import { taskInclude } from '../controllers/task.controller';
import { aiAuditExternalId, isAiAuditChecklist, isNexusAuditChecklist } from '../utils/auditChecklist';
import { queueAuditPick } from './aiAuditPicker';

export type RecurrencePausePreset = '1d' | '3d' | '1w' | '2w' | 'indefinite';

export interface RecurringConfig {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  time?: string; // "HH:mm" (24h) e.g. "21:00", "21:30", "09:00"
  daysOfWeek?: number[]; // [1, 2, 3, 4, 5] (1=Monday ... 7=Sunday or 0=Sunday)
  dayOfMonth?: number; // 1 to 31
  lastRunAt?: string; // ISO string of when it last created a duplicate
  timezone?: string; // default "Asia/Singapore"
  paused?: boolean;
  pausedUntil?: string | null; // ISO timestamp (UTC) when pause expires, or null for indefinite
  pausedAt?: string | null;
  pausePreset?: RecurrencePausePreset | null;
}

/**
 * Evaluates whether a recurring task is currently paused as of `referenceDate`.
 * - paused: true + pausedUntil: null -> paused indefinitely
 * - paused: true + referenceDate < pausedUntil -> paused until that timestamp
 * - paused: true + referenceDate >= pausedUntil -> pause has expired (active again)
 */
export function getRecurringPauseStatus(
  config: RecurringConfig | null | undefined,
  referenceDate: Date = new Date()
): { isPaused: boolean; reason?: string; expired?: boolean } {
  if (!config?.paused) {
    return { isPaused: false };
  }
  if (!config.pausedUntil) {
    return { isPaused: true, reason: 'Paused indefinitely' };
  }
  const until = new Date(config.pausedUntil);
  if (isNaN(until.getTime())) {
    return { isPaused: true, reason: 'Paused indefinitely' };
  }
  if (referenceDate.getTime() < until.getTime()) {
    const untilDateStr = getCalendarDateParts(until, 'Asia/Manila').dateStr;
    return { isPaused: true, reason: `Paused until ${untilDateStr}` };
  }
  return { isPaused: false, expired: true };
}

/**
 * Computes the pause end timestamp (ISO string) for a given preset, or null for indefinite.
 */
export function computePausedUntil(
  preset: RecurrencePausePreset,
  fromDate: Date = new Date()
): string | null {
  const DAY_MS = 24 * 60 * 60 * 1000;
  switch (preset) {
    case '1d':
      return new Date(fromDate.getTime() + 1 * DAY_MS).toISOString();
    case '3d':
      return new Date(fromDate.getTime() + 3 * DAY_MS).toISOString();
    case '1w':
      return new Date(fromDate.getTime() + 7 * DAY_MS).toISOString();
    case '2w':
      return new Date(fromDate.getTime() + 14 * DAY_MS).toISOString();
    case 'indefinite':
    default:
      return null;
  }
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

  const formattedTimestamp = dateStr;

  return { dateStr, timeStr: '', formattedTimestamp };
}

/**
 * Cleans any existing date (or date/time) stamp from a task title before appending the new one.
 */
export function cleanTitleFromTimestamp(title: string): string {
  return (title || 'Untitled Task')
    .replace(/\s+\d{2}-\d{2}-\d{4}(?:\s+\d{1,2}(?::\d{2})?(?:am|pm))?$/i, '')
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
      subtasks: {
        include: {
          checklists: {
            include: {
              items: true,
            },
          },
          assignees: true,
        },
      },
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
        // The AI's audit pick carries over to the copy.
        ...(isAiAuditChecklist(cl) && { externalId: aiAuditExternalId(newTask.id) }),
      },
    });

    if (cl.items && cl.items.length > 0) {
      const isAudit = isNexusAuditChecklist(cl);
      const sortedItems = [...cl.items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      await prisma.checklistItem.createMany({
        data: sortedItems.map((item) => ({
          checklistId: createdChecklist.id,
          text: item.text,
          completed: isAudit ? false : item.completed,
          checkedById: isAudit ? null : item.checkedById,
          assigneeId: isAudit ? [] : item.assigneeId,
        })),
      });
    }
  }

  // 3. Clone ALL comments (batch inserted with createMany for max performance)
  if (sourceTask.comments && sourceTask.comments.length > 0) {
    const topLevelComments = sourceTask.comments.filter((c) => !c.parentCommentId);
    const replyComments = sourceTask.comments.filter((c) => !!c.parentCommentId);
    const commentIdMap = new Map<string, string>();
    const attachmentsToCreate: any[] = [];

    const commentData = topLevelComments.map((c) => {
      const newCommentId = randomUUID();
      commentIdMap.set(c.id, newCommentId);

      if (c.attachments && c.attachments.length > 0) {
        for (const att of c.attachments) {
          attachmentsToCreate.push({
            fileName: att.fileName,
            fileUrl: att.fileUrl,
            fileKey: att.fileKey,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
            uploadedById: att.uploadedById,
            taskCommentId: newCommentId,
          });
        }
      }

      return {
        id: newCommentId,
        taskId: newTask.id,
        userId: c.userId,
        content: c.content,
        createdAt: c.createdAt,
      };
    });

    if (commentData.length > 0) {
      await prisma.taskComment.createMany({ data: commentData });
    }

    if (attachmentsToCreate.length > 0) {
      await prisma.attachment.createMany({ data: attachmentsToCreate });
    }

    if (replyComments.length > 0) {
      const replyData = replyComments.map((r) => ({
        id: randomUUID(),
        taskId: newTask.id,
        userId: r.userId,
        content: r.content,
        createdAt: r.createdAt,
        parentCommentId: r.parentCommentId ? commentIdMap.get(r.parentCommentId) || null : null,
      }));
      await prisma.taskComment.createMany({ data: replyData });
    }
  }

  // 4. Clone ALL subtasks and their checklists
  if (sourceTask.subtasks && sourceTask.subtasks.length > 0) {
    for (const sub of sourceTask.subtasks) {
      const createdSubtask = await prisma.subtask.create({
        data: {
          taskId: newTask.id,
          title: sub.title,
          description: sub.description,
          status: 'PENDING',
          completed: false,
          priority: sub.priority,
          assigneeId: sub.assigneeId,
          assignees: sub.assignees && sub.assignees.length > 0 ? {
            connect: sub.assignees.map(a => ({ id: a.id })),
          } : undefined,
          teamId: sub.teamId,
          assigneeRoleRestrictions: sub.assigneeRoleRestrictions,
          teamAssignAccessRole: sub.teamAssignAccessRole,
          dueDate: targetDueDate,
        },
      });

      if (sub.checklists && sub.checklists.length > 0) {
        for (const cl of sub.checklists) {
          const createdChecklist = await prisma.checklist.create({
            data: {
              name: cl.name,
              taskId: newTask.id,
              subtaskId: createdSubtask.id,
              ...(isAiAuditChecklist(cl) && { externalId: aiAuditExternalId(createdSubtask.id) }),
            },
          });

          if (cl.items && cl.items.length > 0) {
            const isAudit = isNexusAuditChecklist(cl);
            const sortedItems = [...cl.items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            await prisma.checklistItem.createMany({
              data: sortedItems.map((item) => ({
                checklistId: createdChecklist.id,
                text: item.text,
                completed: isAudit ? false : item.completed,
                checkedById: isAudit ? null : item.checkedById,
                assigneeId: isAudit ? [] : item.assigneeId,
              })),
            });
          }
        }
      }
      // No pick to carry over (a subtask made before the AI picked audits): the AI picks now.
      if (!(sub.checklists || []).some((cl) => isAiAuditChecklist(cl))) {
        queueAuditPick({ taskId: newTask.id, subtaskId: createdSubtask.id });
      }
    }
  }
  if (!sourceTask.checklists.some((cl) => isAiAuditChecklist(cl))) {
    queueAuditPick({ taskId: newTask.id });
  }

  // 5. Update the source recurring task's lastRunAt only if it had a recurringConfig
  //    (also auto-clear any expired pause metadata once the task resumes running)
  if (config) {
    const pauseStatus = getRecurringPauseStatus(config, targetDate);
    const cleanedConfig: RecurringConfig = {
      ...config,
      ...(pauseStatus.expired
        ? { paused: false, pausedUntil: null, pausedAt: null, pausePreset: null }
        : {}),
      lastRunAt: new Date().toISOString(),
    };
    await prisma.task.update({
      where: { id: sourceTaskId },
      data: {
        recurringConfig: cleanedConfig as any,
      },
    });
  }

  // Keep the ClickUp backup complete: recurring copies are made only in Nexus.
  mirrorNewTaskToClickUp(newTask.id).catch(() => {});

  // 6. Broadcast via WebSocket immediately
  const fullNewTask = await prisma.task.findUnique({
    where: { id: newTask.id },
    include: taskInclude,
  });

  if (fullNewTask) {
    io.emit('task:created', fullNewTask);
  }

  // Invalidate caches in background (non-blocking)
  invalidateCache('tasks:all', 'spaces:all', 'dashboard:all', 'lists:all').catch(() => {});

  return fullNewTask;
}

/**
 * Periodically called by background scheduler to inspect all recurring tasks
 * and create pending duplicates when their scheduled date & time arrives.
 */
export async function checkAndRunRecurringTasks() {
  try {
    const recurringTasks = (
      await prisma.task.findMany({
        where: {
          recurringConfig: { not: Prisma.DbNull },
        },
        select: {
          id: true,
          title: true,
          status: true,
          recurringConfig: true,
        },
      })
    ).filter(
      (t) =>
        t.recurringConfig !== null &&
        t.recurringConfig !== undefined &&
        typeof t.recurringConfig === 'object' &&
        !!(t.recurringConfig as any).time
    );

    const now = new Date();

    for (const task of recurringTasks) {
      const config = task.recurringConfig as RecurringConfig | null;
      if (!config || !config.time) continue;

      if (getRecurringPauseStatus(config, now).isPaused) {
        continue;
      }

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

export interface RecurringRolloverOptions {
  dateOverride?: string | Date;
  force?: boolean;
}

export interface RecurringRolloverResult {
  success: boolean;
  date: string;
  totalChecked: number;
  createdCount: number;
  skippedCount: number;
  created: Array<{
    sourceTaskId: string;
    newTaskId?: string;
    title?: string;
    frequency: string;
  }>;
  skipped: Array<{
    taskId: string;
    title: string;
    reason: string;
  }>;
}

/**
 * Daily Rollover function for DAILY status tasks (runs at 4:30 AM Manila):
 * Queries all tasks whose status is DAILY (with or without recurringConfig).
 * Duplicates each DAILY task into the list's canonical PENDING status column with mm-dd-yyyy.
 * Handles deduplication so running multiple times on the same date is safe (unless force: true).
 */
export async function runRecurringDailyRollover(
  options?: RecurringRolloverOptions
): Promise<RecurringRolloverResult> {
  const targetDate = options?.dateOverride ? new Date(options.dateOverride) : new Date();
  const created: RecurringRolloverResult['created'] = [];
  const skipped: RecurringRolloverResult['skipped'] = [];

  try {
    // 1. Pull ONLY tasks with status = DAILY (case-insensitive)
    const candidateTasks = await prisma.task.findMany({
      where: {
        status: { equals: 'DAILY', mode: 'insensitive' },
      },
      include: {
        list: {
          include: {
            statuses: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Batch load existing pending tasks for today across all lists (avoids N+1 DB round-trips)
    const todayDateStr = formatRecurrenceDateTime(targetDate, 'Asia/Singapore').dateStr;
    const existingTodayPending = await prisma.task.findMany({
      where: {
        status: { in: ['PENDING', 'Pending'] },
        title: { contains: todayDateStr },
      },
      select: { id: true, listId: true, title: true },
    });
    const existingPendingSet = new Set(
      existingTodayPending.map(p => `${p.listId}:::${cleanTitleFromTimestamp(p.title).toLowerCase()}`)
    );

    for (const task of candidateTasks) {
      const config = (task.recurringConfig as RecurringConfig | null) || null;
      const frequency = 'DAILY';
      const timezone = config?.timezone || 'Asia/Singapore';
      const { dateStr } = formatRecurrenceDateTime(targetDate, timezone, config?.time);

      // Pause check: skip paused tasks unless force is enabled
      if (!options?.force) {
        const pauseStatus = getRecurringPauseStatus(config, targetDate);
        if (pauseStatus.isPaused) {
          skipped.push({
            taskId: task.id,
            title: task.title,
            reason: pauseStatus.reason || 'Paused',
          });
          continue;
        }
      }

      // Idempotency: Prevent duplicate pending task on the same date unless force is enabled
      if (!options?.force) {
        if (config?.lastRunAt) {
          const lastRunDateStr = formatRecurrenceDateTime(new Date(config.lastRunAt), timezone).dateStr;
          if (lastRunDateStr === dateStr) {
            skipped.push({
              taskId: task.id,
              title: task.title,
              reason: `Already ran today (${dateStr})`,
            });
            continue;
          }
        }

        const baseTitle = cleanTitleFromTimestamp(task.title);
        const lookupKey = `${task.listId}:::${baseTitle.toLowerCase()}`;
        if (existingPendingSet.has(lookupKey)) {
          skipped.push({
            taskId: task.id,
            title: task.title,
            reason: `Pending task already exists for ${dateStr}`,
          });
          continue;
        }
      }

      // Execute duplication into PENDING
      try {
        const duplicated = await duplicateRecurringTask(task.id, targetDate);
        created.push({
          sourceTaskId: task.id,
          newTaskId: duplicated?.id,
          title: duplicated?.title,
          frequency,
        });
        const baseTitle = cleanTitleFromTimestamp(task.title);
        existingPendingSet.add(`${task.listId}:::${baseTitle.toLowerCase()}`);
        console.log(`[RecurringRollover] Duplicated "${task.title}" (${task.id}) -> "${duplicated?.title}" into PENDING.`);
      } catch (dupErr: any) {
        console.error(`[RecurringRollover] Error duplicating "${task.title}":`, dupErr);
        skipped.push({
          taskId: task.id,
          title: task.title,
          reason: `Error during duplication: ${dupErr?.message || dupErr}`,
        });
      }
    }

    return {
      success: true,
      date: formatRecurrenceDateTime(targetDate, 'Asia/Singapore').dateStr,
      totalChecked: candidateTasks.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
    };
  } catch (err: any) {
    console.error('[RecurringRollover] Critical failure running recurring rollover:', err);
    throw err;
  }
}

export interface CalendarDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  weekday: number; // 0 = Sun, 1 = Mon ... 6 = Sat
  daysInMonth: number;
  dateStr: string; // mm-dd-yyyy
  yearMonthKey: string; // yyyy-mm
  weekKey: string; // yyyy-mm-dd of that week's Monday
}

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Extracts calendar date components in the given timezone (default: Asia/Manila, UTC+8).
 */
export function getCalendarDateParts(
  date: Date,
  timezone: string = 'Asia/Manila'
): CalendarDateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const parts = dtf.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = parseInt(partMap.year || `${date.getUTCFullYear()}`, 10);
  const month = parseInt(partMap.month || '1', 10);
  const day = parseInt(partMap.day || '1', 10);
  const weekday = WEEKDAY_MAP[(partMap.weekday || '').toLowerCase()] ?? 0;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const dateStr = `${mm}-${dd}-${year}`;
  const yearMonthKey = `${year}-${mm}`;

  // Monday-based week key (yyyy-mm-dd of the Monday of this week)
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday;
  const mondayDate = new Date(Date.UTC(year, month - 1, day + offsetToMonday));
  const weekKey = `${mondayDate.getUTCFullYear()}-${String(mondayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(mondayDate.getUTCDate()).padStart(2, '0')}`;

  return {
    year,
    month,
    day,
    weekday,
    daysInMonth,
    dateStr,
    yearMonthKey,
    weekKey,
  };
}

/**
 * Resolves the effective scheduled day of the month for a MONTHLY task:
 * - Respects requestedDay (recurringConfig.dayOfMonth), defaulting to 1 when unset.
 * - Clamps to the last day of the target month (e.g. 31 -> 28/29 in Feb).
 * - Monthly tasks only run Monday-Saturday: if the target day lands on Sunday,
 *   rolls forward to Monday (+1), or backward to Saturday (-1) if it is the last day of the month.
 */
export function resolveMonthlyScheduledDay(
  year: number,
  month: number,
  requestedDay?: number
): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const desired = requestedDay && requestedDay >= 1 ? Math.floor(requestedDay) : 1;
  const clamped = Math.min(desired, daysInMonth);
  const weekday = new Date(Date.UTC(year, month - 1, clamped)).getUTCDay();

  if (weekday === 0) {
    // Sunday -> skip Sunday; run Monday if still in the same month, else Saturday
    return clamped < daysInMonth ? clamped + 1 : clamped - 1;
  }
  return clamped;
}

/**
 * Weekly Rollover function for WEEKLY status tasks (runs inside 4:30 AM Manila DailyRollover):
 * - Automatically gates to Mondays in Asia/Manila (UTC+8), unless force: true.
 * - Queries all tasks whose status is WEEKLY (with or without recurringConfig).
 * - Duplicates each WEEKLY task into the list's canonical PENDING status column with mm-dd-yyyy.
 * - Handles deduplication per week and per date so repeated runs are safe (unless force: true).
 */
export async function runRecurringWeeklyRollover(
  options?: RecurringRolloverOptions
): Promise<RecurringRolloverResult> {
  const targetDate = options?.dateOverride ? new Date(options.dateOverride) : new Date();
  const manilaToday = getCalendarDateParts(targetDate, 'Asia/Manila');
  const created: RecurringRolloverResult['created'] = [];
  const skipped: RecurringRolloverResult['skipped'] = [];

  try {
    // Weekly tasks automatically run only on Mondays (Asia/Manila) unless forced
    if (!options?.force && manilaToday.weekday !== 1) {
      return {
        success: true,
        date: manilaToday.dateStr,
        totalChecked: 0,
        createdCount: 0,
        skippedCount: 0,
        created,
        skipped,
      };
    }

    // 1. Pull ONLY tasks with status = WEEKLY (case-insensitive)
    const candidateTasks = await prisma.task.findMany({
      where: {
        status: { equals: 'WEEKLY', mode: 'insensitive' },
      },
      include: {
        list: {
          include: {
            statuses: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Batch load existing pending tasks for today across all lists
    const existingTodayPending = await prisma.task.findMany({
      where: {
        status: { in: ['PENDING', 'Pending'] },
        title: { contains: manilaToday.dateStr },
      },
      select: { id: true, listId: true, title: true },
    });
    const existingPendingSet = new Set(
      existingTodayPending.map(p => `${p.listId}:::${cleanTitleFromTimestamp(p.title).toLowerCase()}`)
    );

    for (const task of candidateTasks) {
      const config = (task.recurringConfig as RecurringConfig | null) || null;
      const frequency = 'WEEKLY';

      // Pause check: skip paused tasks unless force is enabled
      if (!options?.force) {
        const pauseStatus = getRecurringPauseStatus(config, targetDate);
        if (pauseStatus.isPaused) {
          skipped.push({
            taskId: task.id,
            title: task.title,
            reason: pauseStatus.reason || 'Paused',
          });
          continue;
        }
      }

      // Idempotency: Prevent duplicate pending task in the same Manila week unless force is enabled
      if (!options?.force) {
        if (config?.lastRunAt) {
          const lastRunParts = getCalendarDateParts(new Date(config.lastRunAt), 'Asia/Manila');
          if (lastRunParts.weekKey === manilaToday.weekKey || lastRunParts.dateStr === manilaToday.dateStr) {
            skipped.push({
              taskId: task.id,
              title: task.title,
              reason: `Already ran this week (${manilaToday.weekKey})`,
            });
            continue;
          }
        }

        const baseTitle = cleanTitleFromTimestamp(task.title);
        const lookupKey = `${task.listId}:::${baseTitle.toLowerCase()}`;
        if (existingPendingSet.has(lookupKey)) {
          skipped.push({
            taskId: task.id,
            title: task.title,
            reason: `Pending task already exists for ${manilaToday.dateStr}`,
          });
          continue;
        }
      }

      // Execute duplication into PENDING
      try {
        const duplicated = await duplicateRecurringTask(task.id, targetDate);
        created.push({
          sourceTaskId: task.id,
          newTaskId: duplicated?.id,
          title: duplicated?.title,
          frequency,
        });
        const baseTitle = cleanTitleFromTimestamp(task.title);
        existingPendingSet.add(`${task.listId}:::${baseTitle.toLowerCase()}`);
        console.log(`[RecurringWeeklyRollover] Duplicated "${task.title}" (${task.id}) -> "${duplicated?.title}" into PENDING.`);
      } catch (dupErr: any) {
        console.error(`[RecurringWeeklyRollover] Error duplicating "${task.title}":`, dupErr);
        skipped.push({
          taskId: task.id,
          title: task.title,
          reason: `Error during duplication: ${dupErr?.message || dupErr}`,
        });
      }
    }

    return {
      success: true,
      date: manilaToday.dateStr,
      totalChecked: candidateTasks.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
    };
  } catch (err: any) {
    console.error('[RecurringWeeklyRollover] Critical failure running weekly rollover:', err);
    throw err;
  }
}

/**
 * Monthly Rollover function for MONTHLY status tasks (runs inside 4:30 AM Manila DailyRollover):
 * - Never runs on Sunday (Asia/Manila) unless force: true; only runs Monday-Saturday.
 * - Respects recurringConfig.dayOfMonth (clamped to the last day of the month), defaulting to 1st.
 * - If a task's target day falls on Sunday, its scheduled run day shifts to Monday (+1),
 *   or Saturday (-1) if it is the last day of the month, so it is never dropped.
 * - Queries all tasks whose status is MONTHLY (with or without recurringConfig).
 * - Handles deduplication per month and per date so repeated runs are safe (unless force: true).
 */
export async function runRecurringMonthlyRollover(
  options?: RecurringRolloverOptions
): Promise<RecurringRolloverResult> {
  const targetDate = options?.dateOverride ? new Date(options.dateOverride) : new Date();
  const manilaToday = getCalendarDateParts(targetDate, 'Asia/Manila');
  const created: RecurringRolloverResult['created'] = [];
  const skipped: RecurringRolloverResult['skipped'] = [];

  try {
    // Monthly tasks run Monday-Saturday only; skip Sundays unless forced
    if (!options?.force && manilaToday.weekday === 0) {
      return {
        success: true,
        date: manilaToday.dateStr,
        totalChecked: 0,
        createdCount: 0,
        skippedCount: 0,
        created,
        skipped,
      };
    }

    // 1. Pull ONLY tasks with status = MONTHLY (case-insensitive)
    const candidateTasks = await prisma.task.findMany({
      where: {
        status: { equals: 'MONTHLY', mode: 'insensitive' },
      },
      include: {
        list: {
          include: {
            statuses: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Batch load existing pending tasks for today across all lists
    const existingTodayPending = await prisma.task.findMany({
      where: {
        status: { in: ['PENDING', 'Pending'] },
        title: { contains: manilaToday.dateStr },
      },
      select: { id: true, listId: true, title: true },
    });
    const existingPendingSet = new Set(
      existingTodayPending.map(p => `${p.listId}:::${cleanTitleFromTimestamp(p.title).toLowerCase()}`)
    );

    for (const task of candidateTasks) {
      const config = (task.recurringConfig as RecurringConfig | null) || null;
      const frequency = 'MONTHLY';

      // Pause check: skip paused tasks unless force is enabled
      if (!options?.force) {
        const pauseStatus = getRecurringPauseStatus(config, targetDate);
        if (pauseStatus.isPaused) {
          skipped.push({
            taskId: task.id,
            title: task.title,
            reason: pauseStatus.reason || 'Paused',
          });
          continue;
        }
      }

      const scheduledDay = resolveMonthlyScheduledDay(
        manilaToday.year,
        manilaToday.month,
        config?.dayOfMonth
      );

      if (!options?.force && manilaToday.day !== scheduledDay) {
        skipped.push({
          taskId: task.id,
          title: task.title,
          reason: `Not scheduled for today (scheduled day: ${scheduledDay}, today: ${manilaToday.day})`,
        });
        continue;
      }

      // Idempotency: Prevent duplicate pending task in the same Manila month unless force is enabled
      if (!options?.force) {
        if (config?.lastRunAt) {
          const lastRunParts = getCalendarDateParts(new Date(config.lastRunAt), 'Asia/Manila');
          if (lastRunParts.yearMonthKey === manilaToday.yearMonthKey || lastRunParts.dateStr === manilaToday.dateStr) {
            skipped.push({
              taskId: task.id,
              title: task.title,
              reason: `Already ran this month (${manilaToday.yearMonthKey})`,
            });
            continue;
          }
        }

        const baseTitle = cleanTitleFromTimestamp(task.title);
        const lookupKey = `${task.listId}:::${baseTitle.toLowerCase()}`;
        if (existingPendingSet.has(lookupKey)) {
          skipped.push({
            taskId: task.id,
            title: task.title,
            reason: `Pending task already exists for ${manilaToday.dateStr}`,
          });
          continue;
        }
      }

      // Execute duplication into PENDING
      try {
        const duplicated = await duplicateRecurringTask(task.id, targetDate);
        created.push({
          sourceTaskId: task.id,
          newTaskId: duplicated?.id,
          title: duplicated?.title,
          frequency,
        });
        const baseTitle = cleanTitleFromTimestamp(task.title);
        existingPendingSet.add(`${task.listId}:::${baseTitle.toLowerCase()}`);
        console.log(`[RecurringMonthlyRollover] Duplicated "${task.title}" (${task.id}) -> "${duplicated?.title}" into PENDING.`);
      } catch (dupErr: any) {
        console.error(`[RecurringMonthlyRollover] Error duplicating "${task.title}":`, dupErr);
        skipped.push({
          taskId: task.id,
          title: task.title,
          reason: `Error during duplication: ${dupErr?.message || dupErr}`,
        });
      }
    }

    return {
      success: true,
      date: manilaToday.dateStr,
      totalChecked: candidateTasks.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
    };
  } catch (err: any) {
    console.error('[RecurringMonthlyRollover] Critical failure running monthly rollover:', err);
    throw err;
  }
}
