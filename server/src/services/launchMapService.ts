import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { isReviewStatus } from '../utils/auditChecklist';
import { getLaunchReviewRecipients } from '../utils/roleNotification';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';
import { getManilaDateStr, getOrCreateTaskMapRecord, updateTaskMapRecord } from './taskMapService';
import { invalidateCache } from './redisService';

function getIo() {
  try {
    return require('../server').io;
  } catch {
    return null;
  }
}

export interface LaunchMeta {
  type: 'LAUNCH_META';
  launchDate: string | null;
  isLaunchDate: boolean;
  workstream?: string | null;
  notes?: string | null;
  updatedAt: string;
  updatedById?: string | null;
}

const isClosedStatus = (status?: string | null) => {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return (
    s === 'CLOSED' ||
    s === 'DONE' ||
    s === 'COMPLETE' ||
    s === 'COMPLETED' ||
    s === 'RESOLVED' ||
    s === 'CANCELLED'
  );
};

export function parseReviewsList(pmReviews: any): any[] {
  if (typeof pmReviews === 'string') {
    try {
      const parsed = JSON.parse(pmReviews);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(pmReviews) ? pmReviews : [];
}

export function extractLaunchMeta(
  pmReviews: any,
  fallbackDueDate?: Date | string | null
): {
  launchMeta: LaunchMeta | null;
  effectiveLaunchDate: string | null;
  isLaunchDate: boolean;
} {
  const reviewsList = parseReviewsList(pmReviews);
  const raw = reviewsList.find((r: any) => r && r.type === 'LAUNCH_META') as LaunchMeta | undefined;

  const normalizedStoredDate =
    raw?.launchDate && /^\d{4}-\d{2}-\d{2}/.test(String(raw.launchDate))
      ? String(raw.launchDate).slice(0, 10)
      : null;

  const fallbackStr = fallbackDueDate ? getManilaDateStr(fallbackDueDate) : null;
  const effectiveLaunchDate = normalizedStoredDate || fallbackStr || null;

  return {
    launchMeta: raw
      ? {
          type: 'LAUNCH_META',
          launchDate: normalizedStoredDate,
          isLaunchDate: Boolean(raw.isLaunchDate),
          workstream: raw.workstream || null,
          notes: raw.notes || null,
          updatedAt: raw.updatedAt || new Date().toISOString(),
          updatedById: raw.updatedById || null,
        }
      : null,
    effectiveLaunchDate,
    isLaunchDate: Boolean(raw?.isLaunchDate),
  };
}

export async function upsertTaskLaunchMeta(
  taskId: string,
  input: {
    launchDate?: string | null;
    isLaunchDate?: boolean;
    workstream?: string | null;
    notes?: string | null;
    syncDueDate?: boolean;
  },
  actorId?: string | null
): Promise<{ launchMeta: LaunchMeta; effectiveLaunchDate: string | null; dueDate: Date | null }> {
  const existingTask = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, dueDate: true },
  });
  if (!existingTask) {
    throw new Error('Task not found');
  }

  const record = await getOrCreateTaskMapRecord(taskId);
  const reviewsList = parseReviewsList(record.pmReviews);
  const existingIdx = reviewsList.findIndex((r: any) => r && r.type === 'LAUNCH_META');
  const prevMeta = (existingIdx >= 0 ? reviewsList[existingIdx] : null) as Partial<LaunchMeta> | null;

  const cleanDate =
    input.launchDate === undefined
      ? (prevMeta?.launchDate ?? null)
      : input.launchDate
      ? String(input.launchDate).trim().slice(0, 10)
      : null;

  if (cleanDate && !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('Invalid launchDate format (expected YYYY-MM-DD)');
  }

  const nextMeta: LaunchMeta = {
    type: 'LAUNCH_META',
    launchDate: cleanDate,
    isLaunchDate:
      input.isLaunchDate !== undefined ? Boolean(input.isLaunchDate) : Boolean(prevMeta?.isLaunchDate),
    workstream: input.workstream !== undefined ? (input.workstream || null) : (prevMeta?.workstream ?? null),
    notes: input.notes !== undefined ? (input.notes || null) : (prevMeta?.notes ?? null),
    updatedAt: new Date().toISOString(),
    updatedById: actorId || null,
  };

  const nextReviews = [...reviewsList];
  if (existingIdx >= 0) {
    nextReviews[existingIdx] = nextMeta;
  } else {
    nextReviews.push(nextMeta);
  }

  await updateTaskMapRecord(taskId, { pmReviews: nextReviews });

  let nextDueDate: Date | null = existingTask.dueDate;
  if (input.syncDueDate !== false && input.launchDate !== undefined) {
    const dueDateValue = cleanDate ? new Date(`${cleanDate}T12:00:00+08:00`) : null;
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { dueDate: dueDateValue },
      select: { dueDate: true },
    });
    nextDueDate = updatedTask.dueDate;
  }

  await invalidateCache(`task:${taskId}`, 'tasks:all', 'task_map:all', 'task_map:*', 'launch_map:all', 'lists:all').catch(() => {});

  const { effectiveLaunchDate } = extractLaunchMeta(nextReviews, nextDueDate);
  return { launchMeta: nextMeta, effectiveLaunchDate, dueDate: nextDueDate };
}

function formatReadableLaunchDate(dateStr: string): string {
  try {
    const d = new Date(`${dateStr}T12:00:00+08:00`);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

async function resolveFallbackActorId(actingUserId?: string | null): Promise<string | null> {
  if (actingUserId) return actingUserId;
  const admin = await prisma.user.findFirst({
    where: { isActive: true, systemRole: 'ADMIN' },
    select: { id: true },
  });
  if (admin) return admin.id;
  const anyUser = await prisma.user.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  return anyUser?.id || null;
}

/**
 * Alerts Project Managers and Auditors ONLY when the task's status is IN REVIEW
 * and it has a scheduled Launch Date / Due Date. Always includes the task name.
 */
export async function triggerLaunchReviewAlertIfNeeded(
  taskId: string,
  options: { actingUserId?: string | null; force?: boolean } = {}
): Promise<{ sent: boolean; reason?: string; recipientsCount?: number }> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        teamId: true,
        listId: true,
        list: { select: { name: true } },
        taskMapRecord: { select: { pmReviews: true } },
      },
    });

    if (!task) return { sent: false, reason: 'task_not_found' };
    if (isClosedStatus(task.status) || !isReviewStatus(task.status)) {
      return { sent: false, reason: 'not_in_review' };
    }

    const { launchMeta, effectiveLaunchDate, isLaunchDate } = extractLaunchMeta(
      task.taskMapRecord?.pmReviews,
      task.dueDate
    );

    if (!effectiveLaunchDate) {
      return { sent: false, reason: 'no_launch_date' };
    }

    const todayManila = getManilaDateStr();

    if (!options.force) {
      const recentLogs = await prisma.auditLog.findMany({
        where: {
          action: 'LAUNCH_REVIEW_ALERT_SENT',
          entity: 'TASK',
          entityId: task.id,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { details: true },
      });

      const alreadySentToday = recentLogs.some((log) => {
        const d: any = log.details || {};
        return d.manilaDate === todayManila && d.launchDate === effectiveLaunchDate;
      });
      if (alreadySentToday) {
        return { sent: false, reason: 'already_alerted_today' };
      }
    }

    const rawRecipients = await getLaunchReviewRecipients(
      { id: task.id, teamId: task.teamId },
      options.actingUserId
    );
    const recipients = await filterUsersByNotificationPreference(rawRecipients, 'status');
    if (recipients.length === 0) {
      return { sent: false, reason: 'no_recipients' };
    }

    const readableDate = formatReadableLaunchDate(effectiveLaunchDate);
    const milestonePrefix = isLaunchDate ? 'LAUNCH DATE' : 'Scheduled Launch';
    const title = `Launch Alert: "${task.title}" is IN REVIEW (${milestonePrefix}: ${readableDate})`;
    const parts: string[] = [];
    if (task.list?.name) parts.push(`Client: ${task.list.name}`);
    if (launchMeta?.workstream) parts.push(`Workstream: ${launchMeta.workstream}`);
    parts.push(`Launch Date: ${readableDate}`);
    parts.push('Status is IN REVIEW — needs Project Manager & Auditor review');
    const content = parts.join(' · ');

    await prisma.taskNotification.createMany({
      data: recipients.map((uid) => ({
        userId: uid,
        actorId: options.actingUserId || null,
        taskId: task.id,
        type: 'LAUNCH_REVIEW_ALERT',
        title,
        content,
      })),
    });

    const io = getIo();
    if (io) {
      recipients.forEach((uid) => {
        io.to(`user:${uid}`).emit('notification_received', {
          type: 'LAUNCH_REVIEW_ALERT',
          taskId: task.id,
          taskTitle: task.title,
          launchDate: effectiveLaunchDate,
        });
      });
    }

    const auditActorId = await resolveFallbackActorId(options.actingUserId);
    if (auditActorId) {
      await prisma.auditLog.create({
        data: {
          action: 'LAUNCH_REVIEW_ALERT_SENT',
          entity: 'TASK',
          entityId: task.id,
          userId: auditActorId,
          details: {
            taskTitle: task.title,
            launchDate: effectiveLaunchDate,
            manilaDate: todayManila,
            isLaunchDate,
            recipientsCount: recipients.length,
          },
        },
      });
    }

    return { sent: true, recipientsCount: recipients.length };
  } catch (err) {
    logger.warn({ err, taskId }, 'triggerLaunchReviewAlertIfNeeded failed');
    return { sent: false, reason: 'error' };
  }
}

/**
 * Scheduled sweep: alerts PMs & Auditors for tasks whose Launch Date is overdue, today,
 * or within the next 2 days (Manila time) while still strictly IN REVIEW.
 */
export async function sweepLaunchInReviewAlerts(): Promise<{ checked: number; alerted: number }> {
  try {
    const todayManila = getManilaDateStr();
    const horizonDate = getManilaDateStr(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

    const candidates = await prisma.task.findMany({
      where: {
        OR: [
          { dueDate: { not: null } },
          { taskMapRecord: { isNot: null } },
        ],
      },
      select: {
        id: true,
        status: true,
        dueDate: true,
        taskMapRecord: { select: { pmReviews: true } },
      },
    });

    let checked = 0;
    let alerted = 0;

    for (const t of candidates) {
      if (isClosedStatus(t.status) || !isReviewStatus(t.status)) continue;
      const { effectiveLaunchDate } = extractLaunchMeta(t.taskMapRecord?.pmReviews, t.dueDate);
      if (!effectiveLaunchDate) continue;
      if (effectiveLaunchDate > horizonDate) continue;

      checked++;
      const res = await triggerLaunchReviewAlertIfNeeded(t.id);
      if (res.sent) alerted++;
    }

    if (alerted > 0) {
      logger.info(`[LaunchMap Sweep] Checked ${checked} IN REVIEW launch task(s) (<= ${horizonDate}, today=${todayManila}); sent ${alerted} alert(s).`);
    }
    return { checked, alerted };
  } catch (err) {
    logger.warn({ err }, 'sweepLaunchInReviewAlerts failed');
    return { checked: 0, alerted: 0 };
  }
}
