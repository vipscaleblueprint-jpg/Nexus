import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import {
  getManilaDateStr,
  getOrCreateTaskMapRecord,
  updateTaskMapRecord,
  isHiddenAdminOrInternalTask,
} from './taskMapService';
import { invalidateCache } from './redisService';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';
import {
  isNexusAuditChecklist,
  getAiPickedAudits,
  normalizeAuditName,
} from '../utils/auditChecklist';

function getIo() {
  try {
    return require('../server').io;
  } catch {
    return null;
  }
}

const HIDE_DESIGN_AUDIT = true;

function getRequiredAuditsForClose(taskTitle: string, auditorRoles?: string[]): string[] {
  const t = (taskTitle || '').toLowerCase();
  const audits = new Set<string>();
  audits.add('Instructions Audit');

  const isFunnel =
    t.includes('funnel') ||
    t.includes('landing page') ||
    t.includes('website') ||
    t.includes('web page') ||
    t.includes('sales page') ||
    t.includes('opt-in') ||
    t.includes('optin') ||
    t.includes('checkout') ||
    t.includes('order form') ||
    t.includes('thank you page') ||
    t.includes('clickfunnels') ||
    t.includes('ghl') ||
    t.includes('gohighlevel') ||
    t.includes('wordpress') ||
    t.includes('shopify');
  if (isFunnel) {
    audits.add('Funnel Audit');
    audits.add('UI UX Audit');
  }

  const isDesign =
    t.includes('design') ||
    t.includes('graphic') ||
    t.includes('creative') ||
    t.includes('banner') ||
    t.includes('thumbnail') ||
    t.includes('logo') ||
    t.includes('flyer') ||
    t.includes('brochure') ||
    t.includes('mockup') ||
    t.includes('ad ') ||
    t.includes('ads') ||
    t.includes('social media') ||
    t.includes('carousel') ||
    t.includes('canva') ||
    t.includes('figma') ||
    t.includes('photoshop');
  if (isDesign && !HIDE_DESIGN_AUDIT) {
    audits.add('Design Audit');
  }

  const isUiUx =
    t.includes('ui') ||
    t.includes('ux') ||
    t.includes('wireframe') ||
    t.includes('prototype') ||
    t.includes('mockup') ||
    t.includes('figma');
  if (isUiUx) {
    audits.add('UI UX Audit');
  }

  if (auditorRoles && Array.isArray(auditorRoles)) {
    for (const r of auditorRoles) {
      const rl = r.toLowerCase();
      if (rl.includes('funnel')) audits.add('Funnel Audit');
      if (rl.includes('design') && !HIDE_DESIGN_AUDIT) audits.add('Design Audit');
      if (rl.includes('ui') || rl.includes('ux')) audits.add('UI UX Audit');
    }
  }

  return Array.from(audits);
}

export type CrmFollowUpTier =
  | 'TODAY'
  | 'NEXT_DAY'
  | 'THIRD_DAY'
  | 'FIFTH_DAY'
  | 'SEVENTH_PLUS';

export interface CrmFollowUpRule {
  tier: CrmFollowUpTier;
  label: string;
  colorName: 'neutral' | 'yellow' | 'orange' | 'red' | 'violet';
  hex: string;
  breathe: boolean;
  requiresModal: boolean;
}

export interface CrmWaitingMeta {
  type: 'CRM_WAITING_META';
  waitingSince: string;
  lastResponseAt?: string | null;
  lastResponseById?: string | null;
  lastResponseByName?: string | null;
  lastResponseNote?: string | null;
  lastResponseAction?: string | null;
  updatedAt: string;
}

export function parseReviewsListSafe(pmReviews: any): any[] {
  if (typeof pmReviews === 'string') {
    try {
      const parsed = JSON.parse(pmReviews);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(pmReviews) ? [...pmReviews] : [];
}

export function extractCrmWaitingMeta(pmReviews: any): CrmWaitingMeta | null {
  const list = parseReviewsListSafe(pmReviews);
  const raw = list.find((r: any) => r && r.type === 'CRM_WAITING_META');
  if (!raw || !raw.waitingSince) return null;
  return {
    type: 'CRM_WAITING_META',
    waitingSince: String(raw.waitingSince),
    lastResponseAt: raw.lastResponseAt || null,
    lastResponseById: raw.lastResponseById || null,
    lastResponseByName: raw.lastResponseByName || null,
    lastResponseNote: raw.lastResponseNote || null,
    lastResponseAction: raw.lastResponseAction || null,
    updatedAt: raw.updatedAt || raw.waitingSince,
  };
}

export function isWaitingMainStatus(status?: string | null): boolean {
  const s = (status || '').trim().toUpperCase();
  return s === 'WAITING' || s === 'SENT';
}

/**
 * Returns the effective start timestamp for counting waiting days:
 * uses the latest CRM follow-up log timestamp (`lastResponseAt`) when present,
 * falling back to `waitingSince` (when the task entered WAITING) if no follow-up has been logged.
 */
export function getEffectiveWaitingSince(
  meta?: Pick<CrmWaitingMeta, 'waitingSince' | 'lastResponseAt'> | null
): string | null {
  if (!meta) return null;
  return meta.lastResponseAt || meta.waitingSince || null;
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

export function getManilaCalendarDaysPassed(
  sinceInput?: Date | string | null,
  now: Date = new Date()
): number {
  if (!sinceInput) return 0;
  const sinceStr = getManilaDateStr(sinceInput);
  const todayStr = getManilaDateStr(now);
  const [sy, sm, sd] = sinceStr.split('-').map(Number);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  if (!sy || !sm || !sd || !ty || !tm || !td) return 0;
  const sinceUtc = Date.UTC(sy, sm - 1, sd);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.floor((todayUtc - sinceUtc) / 86_400_000));
}

export function getCrmFollowUpRule(daysPassed: number): CrmFollowUpRule {
  if (daysPassed >= 7) {
    return {
      tier: 'SEVENTH_PLUS',
      label: '7th Day+',
      colorName: 'violet',
      hex: '#8b5cf6',
      breathe: true,
      requiresModal: true,
    };
  }
  if (daysPassed >= 5) {
    return {
      tier: 'FIFTH_DAY',
      label: '5th Day',
      colorName: 'red',
      hex: '#ef4444',
      breathe: true,
      requiresModal: true,
    };
  }
  if (daysPassed >= 3) {
    return {
      tier: 'THIRD_DAY',
      label: '3rd Day',
      colorName: 'orange',
      hex: '#f97316',
      breathe: true,
      requiresModal: daysPassed >= 4,
    };
  }
  if (daysPassed >= 1) {
    return {
      tier: 'NEXT_DAY',
      label: 'Next Day',
      colorName: 'yellow',
      hex: '#eab308',
      breathe: true,
      requiresModal: false,
    };
  }
  return {
    tier: 'TODAY',
    label: 'Today',
    colorName: 'neutral',
    hex: '#71717a',
    breathe: false,
    requiresModal: false,
  };
}

/**
 * Stamps or clears CRM_WAITING_META inside TaskMapRecord.pmReviews when a task enters or leaves WAITING.
 */
export async function syncCrmWaitingMetaForTask(
  taskId: string,
  options: {
    isEnteringWaiting?: boolean;
    isLeavingWaiting?: boolean;
    waitingSince?: string | null;
  }
): Promise<CrmWaitingMeta | null> {
  if (!taskId || taskId.startsWith('subtask:')) return null;
  const record = await getOrCreateTaskMapRecord(taskId);
  const reviewsList = parseReviewsListSafe(record.pmReviews);
  const idx = reviewsList.findIndex((r: any) => r && r.type === 'CRM_WAITING_META');

  if (options.isLeavingWaiting) {
    if (idx === -1) return null;
    const filtered = reviewsList.filter((r: any) => !(r && r.type === 'CRM_WAITING_META'));
    await updateTaskMapRecord(taskId, { pmReviews: filtered });
    return null;
  }

  if (options.isEnteringWaiting) {
    if (idx !== -1 && reviewsList[idx]?.waitingSince) {
      return extractCrmWaitingMeta(reviewsList);
    }
    const nowIso = options.waitingSince || new Date().toISOString();
    const meta: CrmWaitingMeta = {
      type: 'CRM_WAITING_META',
      waitingSince: nowIso,
      lastResponseAt: null,
      lastResponseById: null,
      lastResponseByName: null,
      lastResponseNote: null,
      lastResponseAction: null,
      updatedAt: nowIso,
    };
    const next = [...reviewsList.filter((r: any) => !(r && r.type === 'CRM_WAITING_META')), meta];
    await updateTaskMapRecord(taskId, { pmReviews: next });
    return meta;
  }

  return extractCrmWaitingMeta(reviewsList);
}

/**
 * Resolves waitingSince timestamps for a batch of WAITING tasks, backfilling legacy tasks
 * from AuditLog transitions before falling back to TaskMapRecord/Task updatedAt.
 */
export async function resolveWaitingSinceMap(
  waitingTasks: Array<{
    id: string;
    status?: string | null;
    updatedAt?: Date | string | null;
    createdAt?: Date | string | null;
    pmReviews?: any;
    recordUpdatedAt?: Date | string | null;
  }>
): Promise<Map<string, CrmWaitingMeta>> {
  const result = new Map<string, CrmWaitingMeta>();
  const missingIds: string[] = [];

  for (const t of waitingTasks) {
    const existing = extractCrmWaitingMeta(t.pmReviews);
    if (existing) {
      result.set(t.id, existing);
    } else {
      missingIds.push(t.id);
    }
  }

  if (missingIds.length === 0) return result;

  const logs = await prisma.auditLog.findMany({
    where: {
      entity: 'TASK',
      entityId: { in: missingIds },
      action: { in: ['STATUS_CHANGE', 'TASK_MAP_STATUS_CHANGE'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, action: true, details: true, createdAt: true },
  });

  const logsByTask = new Map<string, typeof logs>();
  for (const l of logs) {
    const arr = logsByTask.get(l.entityId) || [];
    arr.push(l);
    logsByTask.set(l.entityId, arr);
  }

  for (const t of waitingTasks) {
    if (result.has(t.id)) continue;
    const taskLogs = logsByTask.get(t.id) || [];
    const matchedLog = taskLogs.find((l) => {
      const d: any = l.details || {};
      if (l.action === 'STATUS_CHANGE') {
        return isWaitingMainStatus(d.newStatus);
      }
      if (l.action === 'TASK_MAP_STATUS_CHANGE' && Array.isArray(d.newStatuses)) {
        return d.newStatuses.some((st: string) => {
          const up = String(st || '').trim().toUpperCase();
          return up === 'SENT' || up === 'SENT BUT WAITING' || up === 'WAITING';
        });
      }
      return false;
    });

    const fallbackDate =
      matchedLog?.createdAt || t.recordUpdatedAt || t.updatedAt || t.createdAt || new Date();
    const iso = new Date(fallbackDate).toISOString();
    result.set(t.id, {
      type: 'CRM_WAITING_META',
      waitingSince: iso,
      lastResponseAt: null,
      lastResponseById: null,
      lastResponseByName: null,
      lastResponseNote: null,
      lastResponseAction: null,
      updatedAt: iso,
    });
  }

  return result;
}

export async function getAllCrmUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, roles: true },
  });
  return users
    .filter((u) => {
      if ((u.email || '').toLowerCase().endsWith('@system.local')) return false;
      return (u.roles || []).some(
        (r) => typeof r === 'string' && /crm|client\s*relationship/i.test(r.trim())
      );
    })
    .map((u) => u.id);
}

async function resolveSystemActorId(): Promise<string | null> {
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
 * Sends a daily CRM_FOLLOW_UP_ALERT notification to all CRM users for a Sent but Waiting task
 * once it has passed >= 1 calendar day in Asia/Manila (deduplicated per task per day).
 */
export async function triggerCrmFollowUpAlertIfNeeded(
  taskId: string,
  options: { force?: boolean; deferSocketEmit?: boolean } = {}
): Promise<{
  sent: boolean;
  reason?: string;
  recipientsCount?: number;
  recipientIds?: string[];
  socketPayload?: any;
}> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        createdAt: true,
        list: {
          select: {
            name: true,
            folder: {
              select: {
                name: true,
                parentFolder: { select: { name: true } },
              },
            },
          },
        },
        taskMapRecord: { select: { pmReviews: true, updatedAt: true, statuses: true } },
      },
    });

    if (!task) return { sent: false, reason: 'task_not_found' };
    if (isClosedStatus(task.status) || !isWaitingMainStatus(task.status)) {
      return { sent: false, reason: 'not_waiting' };
    }

    // Exclude Dormant Clients and Admin / internal lists — CRM follow-ups are strictly for active clients
    const isDormantOrAdmin =
      isHiddenAdminOrInternalTask(task.list) ||
      (task.list?.folder?.name || '').toLowerCase().includes('dormant') ||
      (task.list?.folder?.parentFolder?.name || '').toLowerCase().includes('dormant') ||
      (task.list?.name || '').toLowerCase().includes('dormant');
    if (isDormantOrAdmin) {
      return { sent: false, reason: 'dormant_or_admin' };
    }

    const metaMap = await resolveWaitingSinceMap([
      {
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
        createdAt: task.createdAt,
        pmReviews: task.taskMapRecord?.pmReviews,
        recordUpdatedAt: task.taskMapRecord?.updatedAt,
      },
    ]);
    const meta = metaMap.get(task.id);
    const effectiveSince = getEffectiveWaitingSince(meta);
    if (!effectiveSince) return { sent: false, reason: 'no_waiting_since' };

    const daysPassed = getManilaCalendarDaysPassed(effectiveSince);
    if (daysPassed < 1) {
      return { sent: false, reason: 'same_day' };
    }

    const todayManila = getManilaDateStr();
    const rule = getCrmFollowUpRule(daysPassed);

    if (!options.force) {
      const recentLogs = await prisma.auditLog.findMany({
        where: {
          action: 'CRM_FOLLOW_UP_ALERT_SENT',
          entity: 'TASK',
          entityId: task.id,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { details: true },
      });
      const alreadySentToday = recentLogs.some((l) => {
        const d: any = l.details || {};
        return d.manilaDate === todayManila;
      });
      if (alreadySentToday) {
        return { sent: false, reason: 'already_alerted_today' };
      }
    }

    const crmIds = await getAllCrmUserIds();
    const recipients = await filterUsersByNotificationPreference(crmIds, 'status');
    if (recipients.length === 0) {
      return { sent: false, reason: 'no_crm_recipients' };
    }

    const dayWord = daysPassed === 1 ? '1 day' : `${daysPassed} days`;
    const clientLabel = task.list?.name ? `Client: ${task.list.name} · ` : '';
    const responseNote =
      daysPassed >= 4 ? ' · Follow-up response required (4th day+)' : '';
    const title = `CRM Follow-Up (${rule.label} · ${dayWord}): "${task.title}"`;
    const content = `${clientLabel}Sent but Waiting for ${dayWord} (${rule.colorName.toUpperCase()})${responseNote}`;

    await prisma.taskNotification.createMany({
      data: recipients.map((uid) => ({
        userId: uid,
        actorId: null,
        taskId: task.id,
        type: 'CRM_FOLLOW_UP_ALERT',
        title,
        content,
      })),
    });

    const socketPayload = {
      type: 'CRM_FOLLOW_UP_ALERT',
      taskId: task.id,
      taskTitle: task.title,
      daysPassed,
      tier: rule.tier,
      requiresModal: rule.requiresModal,
    };

    if (!options.deferSocketEmit) {
      const io = getIo();
      if (io) {
        recipients.forEach((uid) => {
          io.to(`user:${uid}`).emit('notification_received', socketPayload);
          io.to(`user:${uid}`).emit('crm:follow_up_alert', socketPayload);
        });
      }
    }

    const actorId = await resolveSystemActorId();
    if (actorId) {
      await prisma.auditLog.create({
        data: {
          action: 'CRM_FOLLOW_UP_ALERT_SENT',
          entity: 'TASK',
          entityId: task.id,
          userId: actorId,
          details: {
            taskTitle: task.title,
            manilaDate: todayManila,
            daysPassed,
            tier: rule.tier,
            colorName: rule.colorName,
            recipientsCount: recipients.length,
          },
        },
      });
    }

    return { sent: true, recipientsCount: recipients.length, recipientIds: recipients, socketPayload };
  } catch (err) {
    logger.warn({ err, taskId }, 'triggerCrmFollowUpAlertIfNeeded failed');
    return { sent: false, reason: 'error' };
  }
}

/**
 * Scheduled sweep: evaluates all WAITING / Sent tasks and informs all CRM users via notification.
 */
export async function sweepCrmFollowUpAlerts(): Promise<{ checked: number; alerted: number }> {
  try {
    const candidates = await prisma.task.findMany({
      where: {
        OR: [
          { status: { equals: 'WAITING', mode: 'insensitive' } },
          { status: { equals: 'SENT', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    let checked = 0;
    let alerted = 0;
    const latestPayloadByUser = new Map<string, any>();
    for (const c of candidates) {
      checked++;
      const res = await triggerCrmFollowUpAlertIfNeeded(c.id, { deferSocketEmit: true });
      if (res.sent) {
        alerted++;
        if (res.recipientIds && res.socketPayload) {
          for (const uid of res.recipientIds) {
            latestPayloadByUser.set(uid, res.socketPayload);
          }
        }
      }
    }

    // Emit at most one batched notification_received per recipient user after the sweep
    // instead of N socket events in a tight loop (which triggers a storm of /api/notifications polls).
    if (latestPayloadByUser.size > 0) {
      const io = getIo();
      if (io) {
        for (const [uid, payload] of latestPayloadByUser.entries()) {
          io.to(`user:${uid}`).emit('notification_received', payload);
          io.to(`user:${uid}`).emit('crm:follow_up_alert', payload);
        }
      }
    }

    if (alerted > 0) {
      logger.info(`[CRM Follow-Up Sweep] Checked ${checked} waiting task(s); sent ${alerted} alert(s).`);
    }
    return { checked, alerted };
  } catch (err) {
    logger.warn({ err }, 'sweepCrmFollowUpAlerts failed');
    return { checked: 0, alerted: 0 };
  }
}

export interface PendingCrmFollowUpItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  listId: string;
  list: { id: string; name: string } | null;
  waitingSince: string;
  daysPassed: number;
  rule: CrmFollowUpRule;
  lastResponseAt: string | null;
  lastResponseByName: string | null;
  lastResponseNote: string | null;
  subStatuses: string[];
}

/**
 * Lists all Sent but Waiting tasks at >= 4 days passed that have not yet received a CRM response today.
 */
export async function listPendingCrmFollowUps(): Promise<PendingCrmFollowUpItem[]> {
  const candidates = await prisma.task.findMany({
    where: {
      OR: [
        { status: { equals: 'WAITING', mode: 'insensitive' } },
        { status: { equals: 'SENT', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      listId: true,
      updatedAt: true,
      createdAt: true,
      list: {
        select: {
          id: true,
          name: true,
          folder: {
            select: {
              id: true,
              name: true,
              parentFolder: { select: { id: true, name: true } },
            },
          },
        },
      },
      taskMapRecord: { select: { pmReviews: true, statuses: true, updatedAt: true } },
    },
    orderBy: { updatedAt: 'asc' },
  });

  if (candidates.length === 0) return [];

  const metaMap = await resolveWaitingSinceMap(
    candidates.map((t) => ({
      id: t.id,
      status: t.status,
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
      pmReviews: t.taskMapRecord?.pmReviews,
      recordUpdatedAt: t.taskMapRecord?.updatedAt,
    }))
  );

  const todayManila = getManilaDateStr();
  const items: PendingCrmFollowUpItem[] = [];

  for (const t of candidates) {
    if (isClosedStatus(t.status)) continue;

    // Filter out Dormant Clients & Admin / internal lists — only active clients appear
    const isDormantOrAdmin =
      isHiddenAdminOrInternalTask(t.list) ||
      (t.list?.folder?.name || '').toLowerCase().includes('dormant') ||
      (t.list?.folder?.parentFolder?.name || '').toLowerCase().includes('dormant') ||
      (t.list?.name || '').toLowerCase().includes('dormant');
    if (isDormantOrAdmin) continue;

    const meta = metaMap.get(t.id);
    const effectiveSince = getEffectiveWaitingSince(meta);
    if (!meta?.waitingSince || !effectiveSince) continue;
    const daysPassed = getManilaCalendarDaysPassed(effectiveSince);
    if (daysPassed < 4) continue;

    // If a CRM user already logged a response or read report today (Manila date), clear it for today
    if (meta.lastResponseAt && getManilaDateStr(meta.lastResponseAt) === todayManila) {
      continue;
    }

    items.push({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      listId: t.listId,
      list: t.list ? { id: t.list.id, name: t.list.name } : null,
      waitingSince: meta.waitingSince,
      daysPassed,
      rule: getCrmFollowUpRule(daysPassed),
      lastResponseAt: meta.lastResponseAt || null,
      lastResponseByName: meta.lastResponseByName || null,
      lastResponseNote: meta.lastResponseNote || null,
      subStatuses: Array.isArray(t.taskMapRecord?.statuses)
        ? t.taskMapRecord!.statuses
        : ['Sent but Waiting'],
    });
  }

  return items.sort((a, b) => b.daysPassed - a.daysPassed);
}

/**
 * Acknowledges that the user reviewed the CRM follow-up report for active client tasks.
 * Creates an AuditLog entry for each task so it is recorded in the task's activity stream
 * (displayed in TaskDetailModal), sets lastResponseAt to today so it won't prompt again today,
 * invalidates caches, and emits real-time task_activity events.
 */
export async function acknowledgeCrmFollowUps(params: {
  taskIds: string[];
  userId: string;
}): Promise<{
  success: boolean;
  count: number;
  error?: string;
  statusCode?: number;
}> {
  const { taskIds, userId } = params;
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return { success: false, statusCode: 400, count: 0, error: 'No task IDs provided' };
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true },
  });
  if (!actor) {
    return { success: false, statusCode: 401, count: 0, error: 'Authentication required' };
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      createdAt: true,
      taskMapRecord: { select: { pmReviews: true, updatedAt: true, statuses: true } },
    },
  });

  if (tasks.length === 0) {
    return { success: true, count: 0 };
  }

  const metaMap = await resolveWaitingSinceMap(
    tasks.map((t) => ({
      id: t.id,
      status: t.status,
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
      pmReviews: t.taskMapRecord?.pmReviews,
      recordUpdatedAt: t.taskMapRecord?.updatedAt,
    }))
  );

  const nowIso = new Date().toISOString();
  const todayManila = getManilaDateStr();
  const io = getIo();
  let count = 0;

  for (const t of tasks) {
    const meta = metaMap.get(t.id);
    const waitingSince = meta?.waitingSince || nowIso;
    const daysPassed = getManilaCalendarDaysPassed(waitingSince);

    // 1. Create AuditLog row for the read event (visible in TaskDetailModal activity feed)
    const auditLog = await prisma.auditLog.create({
      data: {
        action: 'CRM_FOLLOW_UP_READ',
        entity: 'TASK',
        entityId: t.id,
        userId: actor.id,
        details: {
          type: 'crm_follow_up_read',
          actorName: actor.name,
          daysPassed,
          manilaDate: todayManila,
          source: 'crm_follow_up_report',
        },
      },
    });

    // 2. Update taskMapRecord with read metadata so it won't prompt again today
    const record = await getOrCreateTaskMapRecord(t.id);
    let reviewsList = parseReviewsListSafe(record.pmReviews);
    const waitingMeta: CrmWaitingMeta = {
      type: 'CRM_WAITING_META',
      waitingSince,
      lastResponseAt: nowIso,
      lastResponseById: actor.id,
      lastResponseByName: actor.name,
      lastResponseNote: 'Read follow-up report',
      lastResponseAction: 'REPORT_READ',
      updatedAt: nowIso,
    };
    reviewsList = [
      ...reviewsList.filter((r: any) => !(r && r.type === 'CRM_WAITING_META')),
      waitingMeta,
    ];
    await updateTaskMapRecord(t.id, {
      pmReviews: reviewsList,
    });

    // 3. Invalidate Redis caches
    await invalidateCache(
      `task:${t.id}`,
      `task:activities:${t.id}`,
      'tasks:all',
      'task_map:*',
      'task_map:all'
    ).catch(() => {});

    // 4. Emit real-time Socket.io events
    if (io) {
      io.emit('task_activity', {
        taskId: t.id,
        activity: {
          id: auditLog.id,
          type: 'crm_follow_up_read',
          author: actor.name,
          daysPassed,
          date: auditLog.createdAt,
          user: actor,
          details: {
            daysPassed,
            manilaDate: todayManila,
          },
        },
      });
      io.emit('crm:follow_up_responded', {
        taskId: t.id,
        action: 'REPORT_READ',
      });
    }

    count++;
  }

  return { success: true, count };
}

export type CrmFollowUpResponseAction =
  | 'FOLLOWED_UP'
  | 'REVISIONS'
  | 'MOVE_TO_POOL'
  | 'CLOSED';

export async function respondToCrmFollowUp(params: {
  taskId: string;
  userId: string;
  note: string;
  action: CrmFollowUpResponseAction;
  parentCommentId?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  statusCode?: number;
  uncheckedAudits?: string[];
  openSubtasks?: string[];
  task?: any;
  comment?: any;
}> {
  const { taskId, userId, note, action, parentCommentId } = params;
  const trimmedNote = (note || '').trim();
  if (!trimmedNote) {
    return {
      success: false,
      statusCode: 400,
      error: 'Please enter a follow-up response note before submitting.',
    };
  }

  const [actor, task] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true },
    }),
    prisma.task.findUnique({
      where: { id: taskId },
      include: {
        list: { select: { id: true, name: true } },
        checklists: { where: { subtaskId: null }, include: { items: true } },
        subtasks: { include: { checklists: { include: { items: true } } } },
      },
    }),
  ]);

  if (!actor) {
    return { success: false, statusCode: 401, error: 'Authentication required' };
  }
  if (!task) {
    return { success: false, statusCode: 404, error: 'Task not found' };
  }

  const isCrmOrAdmin =
    actor.systemRole === 'ADMIN' ||
    (actor.roles || []).some((r) => /crm|client\s*relationship/i.test(r || ''));
  if (!isCrmOrAdmin) {
    return {
      success: false,
      statusCode: 403,
      error: 'Only CRM members and Admins can respond to CRM follow-up alerts.',
    };
  }

  // Validate audits & subtasks if closing
  if (action === 'CLOSED') {
    const openSubtasks = (task.subtasks || [])
      .filter((st: any) => {
        if ((st.title || '').trim().toLowerCase().startsWith('--audit')) return false;
        const s = (st.status || '').toLowerCase();
        return s !== 'closed' && s !== 'done' && !st.completed;
      })
      .map((st: any) => st.title);
    if (openSubtasks.length > 0) {
      return {
        success: false,
        statusCode: 400,
        error: `Cannot move to CLOSED: All subtasks must be Closed first.`,
        openSubtasks,
        uncheckedAudits: [],
      };
    }

    const auditorRoles = [
      ...((task as any).assigneeRoleRestrictions || []),
      ...(task.subtasks || [])
        .filter((s: any) => s.title?.toLowerCase().startsWith('--audit'))
        .flatMap((s: any) => (s as any).assigneeRoleRestrictions || []),
    ];
    const auditChecklists = (task.checklists || []).filter((c: any) => isNexusAuditChecklist(c));
    const allItems = auditChecklists.flatMap((c: any) => c.items || []);
    const excludedAudits = new Set(
      allItems
        .filter((i: any) => (i.text || '').startsWith('!'))
        .map((i: any) => normalizeAuditName((i.text || '').slice(1)))
    );
    const activeItems = allItems
      .filter((i: any) => !(i.text || '').startsWith('!'))
      .map((i: any) => i.text);
    // Design stays hidden only on older tasks; a saved AI pick of it must be passed.
    const aiPicked = getAiPickedAudits(task.checklists);
    const requiredTaskAudits = Array.from(
      new Set([
        ...(aiPicked ? [] : getRequiredAuditsForClose(task.title, auditorRoles)),
        ...activeItems,
      ])
    ).filter(
      (r) =>
        !r.startsWith('!') &&
        !excludedAudits.has(normalizeAuditName(r)) &&
        (!HIDE_DESIGN_AUDIT || !!aiPicked || normalizeAuditName(r) !== 'design audit')
    );
    const completedTexts = new Set(
      allItems
        .filter((i: any) => i.completed && !i.text.startsWith('!'))
        .map((i: any) => normalizeAuditName(i.text))
    );
    const uncheckedAudits = requiredTaskAudits.filter(
      (r) => !completedTexts.has(normalizeAuditName(r))
    );
    if (uncheckedAudits.length > 0) {
      return {
        success: false,
        statusCode: 400,
        error: `Cannot move to CLOSED: Required audits are not completed (${uncheckedAudits.join(', ')}).`,
        uncheckedAudits,
        openSubtasks: [],
      };
    }
  }

  const nowIso = new Date().toISOString();
  const record = await getOrCreateTaskMapRecord(taskId);
  let reviewsList = parseReviewsListSafe(record.pmReviews);
  const existingMetaMap = await resolveWaitingSinceMap([
    {
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
      createdAt: task.createdAt,
      pmReviews: record.pmReviews,
      recordUpdatedAt: record.updatedAt,
    },
  ]);
  const existingMeta = existingMetaMap.get(task.id);
  const waitingSince = existingMeta?.waitingSince || nowIso;
  const effectiveSince = getEffectiveWaitingSince(existingMeta) || waitingSince;
  const daysPassed = getManilaCalendarDaysPassed(effectiveSince);

  let nextTaskStatus = task.status;
  let nextSubStatuses = Array.isArray(record.statuses) ? [...record.statuses] : ['Sent but Waiting'];
  let clearAssignee = false;
  let nextHandedOver = record.handedOver;
  let actionLabel = 'Followed up with client';

  if (action === 'FOLLOWED_UP') {
    nextTaskStatus = 'WAITING';
    nextSubStatuses = ['Sent but Waiting'];
    const meta: CrmWaitingMeta = {
      type: 'CRM_WAITING_META',
      waitingSince,
      lastResponseAt: nowIso,
      lastResponseById: actor.id,
      lastResponseByName: actor.name,
      lastResponseNote: trimmedNote,
      lastResponseAction: action,
      updatedAt: nowIso,
    };
    reviewsList = [
      ...reviewsList.filter((r: any) => !(r && r.type === 'CRM_WAITING_META')),
      meta,
    ];
  } else if (action === 'REVISIONS') {
    actionLabel = 'Sent to Revisions (Task Map for delegation)';
    nextTaskStatus = 'REVISION';
    nextSubStatuses = ['Revisions'];
    clearAssignee = true;
    nextHandedOver = true;
    reviewsList = reviewsList.filter(
      (r: any) =>
        !(r && r.type === 'CRM_WAITING_META') &&
        !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId)
    );
  } else if (action === 'MOVE_TO_POOL') {
    actionLabel = 'Returned to CRM Pool';
    nextTaskStatus = 'CRM';
    nextSubStatuses = ['To send'];
    clearAssignee = true;
    nextHandedOver = false;
    reviewsList = reviewsList.filter(
      (r: any) =>
        !(r && r.type === 'CRM_WAITING_META') &&
        !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId)
    );
  } else if (action === 'CLOSED') {
    actionLabel = 'Marked Closed';
    nextTaskStatus = 'CLOSED';
    nextSubStatuses = ['Closed'];
    reviewsList = reviewsList.filter((r: any) => !(r && r.type === 'CRM_WAITING_META'));
  }

  const updateTaskPayload: any = { status: nextTaskStatus };
  if (clearAssignee) {
    updateTaskPayload.assigneeId = null;
    updateTaskPayload.assignees = { set: [] };
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: updateTaskPayload,
  });

  const updatedRecord = await updateTaskMapRecord(taskId, {
    statuses: nextSubStatuses,
    pmReviews: reviewsList,
    handedOver: nextHandedOver,
  });

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let validParentCommentId: string | null = null;
  if (parentCommentId) {
    const parentComment = await prisma.taskComment.findFirst({
      where: { id: parentCommentId, taskId },
      select: { id: true },
    });
    if (parentComment) {
      validParentCommentId = parentComment.id;
    }
  }

  const comment = await prisma.taskComment.create({
    data: {
      taskId,
      userId: actor.id,
      parentCommentId: validParentCommentId,
      content: `<p><strong>CRM Follow-Up Response (${daysPassed}d · ${escapeHtml(actionLabel)}):</strong> ${escapeHtml(trimmedNote)}</p>`,
    },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  if (validParentCommentId) {
    await prisma.taskComment.update({
      where: { id: validParentCommentId },
      data: { replyCount: { increment: 1 } },
    }).catch(() => {});
  }

  const auditLog = await prisma.auditLog.create({
    data: {
      action: 'CRM_FOLLOW_UP_RESPONSE',
      entity: 'TASK',
      entityId: taskId,
      userId: actor.id,
      details: {
        action,
        actionLabel,
        note: trimmedNote,
        daysPassed,
        oldStatus: task.status,
        newStatus: nextTaskStatus,
        manilaDate: getManilaDateStr(),
        actorName: actor.name,
      },
    },
  });

  if (nextTaskStatus !== task.status) {
    await prisma.auditLog.create({
      data: {
        action: 'STATUS_CHANGE',
        entity: 'TASK',
        entityId: taskId,
        userId: actor.id,
        details: {
          oldStatus: task.status,
          newStatus: nextTaskStatus,
          source: 'crm_follow_up_modal',
        },
      },
    });
  }

  await invalidateCache(
    `task:${taskId}`,
    `task:activities:${taskId}`,
    `comments:list:${taskId}`,
    'tasks:all',
    'dashboard:all',
    'lists:all',
    'task_map:*',
    'task_map:all'
  ).catch(() => {});

  const io = getIo();
  if (io) {
    io.emit('task:comment_added', {
      taskId,
      comment,
      activity: {
        id: auditLog.id,
        type: 'comment',
        author: actor.name,
        content: comment.content,
        date: comment.createdAt,
        user: actor,
      },
    });
    io.emit('task:updated', {
      ...updatedTask,
      ...(clearAssignee ? { assigneeId: null, assignee: null, assignees: [] } : {}),
    });
    io.emit('task_map:updated', {
      taskId,
      statuses: nextSubStatuses,
      taskMap: updatedRecord,
      ...(clearAssignee ? { assigneeId: null, assignee: null, handedOver: nextHandedOver } : {}),
    });
    io.emit('crm:follow_up_responded', {
      taskId,
      action,
      respondedBy: actor.name,
      respondedAt: nowIso,
    });
  }

  return { success: true, task: updatedTask, comment };
}
