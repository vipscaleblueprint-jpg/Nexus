import { prisma } from '../config/prisma';
import { invalidateCache } from './redisService';

function getIo() {
  try {
    return require('../server').io;
  } catch {
    return null;
  }
}
import { getRequiredAudits, getTaskMoverAndUpdaters } from '../controllers/task.controller';
import {
  getAiPickedAudits,
  isNexusAuditChecklist,
  normalizeAuditName,
  isReviewStatus,
} from '../utils/auditChecklist';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';

// Which user role (User.roles) audits each item, matched loosely ("Instruction Auditor", "UI UX Auditor"...)
const AUDIT_ROLE_MATCHERS: Record<string, (role: string) => boolean> = {
  'instructions audit': (r) => r.includes('instruction'),
  'ui ux audit': (r) => /ui\s*\/?\s*ux/.test(r),
  'design audit': (r) => r.includes('design'),
  'funnel audit': (r) => r.includes('funnel'),
};

export type ShiftType = 'AM' | 'PM_AFTERNOON' | 'PM_NIGHT' | 'OFF_SHIFT';

export interface DbShiftConfig {
  id: string;
  shiftKey: string;
  name: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  auditorNames: string[];
  auditorIds: string[];
  isActive: boolean;
  order: number;
}

export const DEFAULT_SHIFTS: DbShiftConfig[] = [
  {
    id: 'default-am',
    shiftKey: 'AM',
    name: 'Morning Shift',
    startHour: 8,
    startMinute: 0,
    endHour: 12,
    endMinute: 0,
    auditorNames: ['Aaron', 'Darlene', 'Mimi', 'Bea', 'Blessie'],
    auditorIds: [],
    isActive: true,
    order: 1,
  },
  {
    id: 'default-pm-afternoon',
    shiftKey: 'PM_AFTERNOON',
    name: 'Afternoon Shift',
    startHour: 12,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    auditorNames: ['Aaron', 'Darlene', 'Mimi', 'Bea', 'Blessie', 'Cherilyn', 'Gie'],
    auditorIds: [],
    isActive: true,
    order: 2,
  },
  {
    id: 'default-pm-night',
    shiftKey: 'PM_NIGHT',
    name: 'Night Shift',
    startHour: 17,
    startMinute: 0,
    endHour: 1,
    endMinute: 0,
    auditorNames: ['Cherilyn', 'Gie', 'Pau2x', 'Hannah', 'Gwyneth'],
    auditorIds: [],
    isActive: true,
    order: 3,
  },
];

let cachedShifts: DbShiftConfig[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

/**
 * Invalidates the shift configuration cache (both in-memory and Redis).
 */
export function invalidateAuditShiftsCache(): void {
  cachedShifts = null;
  lastCacheTime = 0;
  invalidateCache('cache:audit_shifts').catch(() => {});
}

/**
 * Retrieves active shift configurations from the database with in-memory caching and graceful fallback.
 */
export async function getDbShiftConfigs(): Promise<DbShiftConfig[]> {
  const now = Date.now();
  if (cachedShifts && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedShifts;
  }

  try {
    const dbConfigs = await (prisma as any).auditShiftConfig.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });

    if (dbConfigs && dbConfigs.length > 0) {
      cachedShifts = dbConfigs as DbShiftConfig[];
      lastCacheTime = now;
      return cachedShifts;
    }
  } catch (err) {
    // If DB read fails, fall back to default configs
  }

  return DEFAULT_SHIFTS;
}

/**
 * Evaluates whether a shift is currently running based on hour and minute (handling overnight ranges).
 */
export function isShiftActive(
  shift: { startHour: number; startMinute?: number; endHour: number; endMinute?: number },
  hour: number,
  minute: number
): boolean {
  const currentMins = hour * 60 + minute;
  const startMins = shift.startHour * 60 + (shift.startMinute || 0);
  const endMins = shift.endHour * 60 + (shift.endMinute || 0);

  if (startMins <= endMins) {
    return currentMins >= startMins && currentMins < endMins;
  } else {
    // Overnight shift (e.g. 17:00 to 01:00)
    return currentMins >= startMins || currentMins < endMins;
  }
}

/**
 * Retrieves the current hour and minute in Manila Time (UTC+8).
 */
export function getManilaHourAndMinute(date: Date = new Date()): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  return { hour, minute };
}

/**
 * Asynchronously determines the active shift in Manila Time from database configurations.
 */
export async function getActiveManilaShift(date: Date = new Date()): Promise<string> {
  const configs = await getDbShiftConfigs();
  const { hour, minute } = getManilaHourAndMinute(date);

  for (const s of configs) {
    if (isShiftActive(s, hour, minute)) {
      return s.shiftKey;
    }
  }

  return 'OFF_SHIFT';
}

/**
 * Synchronous shift resolver (uses cached DB shifts if loaded, or defaults).
 */
export function getCurrentManilaShift(date: Date = new Date(), configs?: DbShiftConfig[]): ShiftType | string {
  const targetConfigs = configs || cachedShifts || DEFAULT_SHIFTS;
  const { hour, minute } = getManilaHourAndMinute(date);

  for (const s of targetConfigs) {
    if (s.isActive && isShiftActive(s, hour, minute)) {
      return s.shiftKey;
    }
  }

  return 'OFF_SHIFT';
}

/**
 * Verifies if a user is part of the designated shift based on ID, name, or email.
 */
export function isUserInShift(
  user: { id?: string; name?: string | null; email?: string | null },
  shiftKey: string,
  configs?: DbShiftConfig[]
): boolean {
  if (shiftKey === 'OFF_SHIFT') return false;
  const targetConfigs = configs || cachedShifts || DEFAULT_SHIFTS;
  const shift = targetConfigs.find((s) => s.shiftKey === shiftKey);
  if (!shift) return false;

  // 1. Direct ID match
  if (user.id && shift.auditorIds && shift.auditorIds.includes(user.id)) {
    return true;
  }

  // 2. Name or email substring match
  const name = (user.name || '').trim().toLowerCase();
  const email = (user.email || '').trim().toLowerCase();
  return (shift.auditorNames || []).some((target) => {
    const t = target.toLowerCase();
    return name.includes(t) || email.includes(t);
  });
}

export interface AutoAssignOptions {
  force?: boolean;
  shift?: ShiftType | string;
  isSweep?: boolean;
}

/**
 * Assigns or updates audits for a task based on Manila Time shifts:
 * - Only assigns when task status is IN REVIEW (isReviewStatus).
 * - Assigns unassigned, unchecked audit items to least-busy eligible auditors in active shift.
 * - In PM Night (5 PM to 1 AM): adds night shift auditors to unchecked audits on in-review tasks.
 * - In AM Morning (8 AM sweep): assigns morning shift auditors to unchecked audits.
 * - Dispatches notifications to assigned users and emits real-time socket events.
 */
export async function autoAssignAudits(
  taskId: string,
  actorId?: string | null,
  options?: AutoAssignOptions
): Promise<{ success: boolean; assignedCount: number }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      status: true,
      creatorId: true,
      assigneeId: true,
      assigneeRoleRestrictions: true,
      assignees: { select: { id: true } },
      subtasks: {
        select: {
          title: true,
          assigneeRoleRestrictions: true,
          assigneeId: true,
          assignees: { select: { id: true } },
        },
      },
      checklists: {
        where: { subtaskId: null },
        select: {
          id: true,
          name: true,
          externalId: true,
          subtaskId: true,
          items: {
            select: { id: true, text: true, completed: true, assigneeId: true },
          },
        },
      },
    },
  });
  if (!task) return { success: false, assignedCount: 0 };

  // Status Gate: Only assign audits when task is IN REVIEW
  if (!options?.force && !isReviewStatus(task.status)) {
    return { success: false, assignedCount: 0 };
  }

  const shiftConfigs = await getDbShiftConfigs();
  const currentShift = options?.shift || (await getActiveManilaShift());
  if (currentShift === 'OFF_SHIFT') {
    // During off-hours, hold until the morning shift
    return { success: false, assignedCount: 0 };
  }

  const auditorRoles = [
    ...(task.assigneeRoleRestrictions || []),
    ...task.subtasks
      .filter((s) => s.title?.toLowerCase().startsWith('--audit'))
      .flatMap((s) => s.assigneeRoleRestrictions || []),
  ];
  const auditChecklists = task.checklists.filter((c) => isNexusAuditChecklist(c));
  const allItems = auditChecklists.flatMap((c) => c.items);
  const excluded = new Set(
    allItems.filter((i) => i.text.startsWith('!')).map((i) => normalizeAuditName(i.text.slice(1)))
  );
  const required = Array.from(
    new Set([
      ...(getAiPickedAudits(task.checklists) ? [] : getRequiredAudits(task.title, auditorRoles)),
      ...allItems.filter((i) => !i.text.startsWith('!')).map((i) => i.text),
    ])
  ).filter((text) => {
    const norm = normalizeAuditName(text);
    return !excluded.has(norm) && !!AUDIT_ROLE_MATCHERS[norm];
  });
  if (required.length === 0) return { success: true, assignedCount: 0 };

  // Fetch active users and filter to active shift auditors from DB configs
  const allUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, roles: true },
  });
  const shiftAuditors = allUsers.filter((u) => isUserInShift(u, currentShift, shiftConfigs));

  // Align with audit restrictions: exclude task assignees, inProgress mover, and MA updaters for this iteration
  const { inProgressMovedBy, maUpdaterIds, maUpdaterNames } = await getTaskMoverAndUpdaters(task.id);
  const taskAssigneeIds = new Set(
    [
      task.assigneeId,
      ...task.assignees.map((a) => a.id),
      ...task.subtasks.map((s) => s.assigneeId),
      ...task.subtasks.flatMap((s) => s.assignees?.map((a) => a.id) || []),
    ].filter(Boolean) as string[]
  );

  const blockedUserIds = new Set<string>([
    ...taskAssigneeIds,
    ...maUpdaterIds,
    ...(inProgressMovedBy?.id ? [inProgressMovedBy.id] : []),
  ]);
  const blockedNames = new Set<string>([
    ...maUpdaterNames.map((n) => n.trim().toLowerCase()),
    ...(inProgressMovedBy?.name ? [inProgressMovedBy.name.trim().toLowerCase()] : []),
  ]);

  const isUserBlocked = (u: { id: string; name?: string | null; email?: string | null }) => {
    if (blockedUserIds.has(u.id)) return true;
    const uName = (u.name || '').trim().toLowerCase();
    const uEmail = (u.email || '').trim().toLowerCase();
    if (!uName && !uEmail) return false;

    for (const b of blockedNames) {
      if (!b) continue;
      if (uName === b) return true;
      if (uName.includes(b) || b.includes(uName)) return true;
      if (uEmail && (uEmail === b || uEmail.includes(b) || b.includes(uEmail))) return true;
      const bTokens = b.split(/[\s\-_\/]+/).filter((t) => t.length > 2);
      const uTokens = uName.split(/[\s\-_\/]+/).filter((t) => t.length > 2);
      if (bTokens.some((bt) => uTokens.includes(bt))) return true;
    }
    return false;
  };

  let checklistId = auditChecklists[0]?.id;
  const assigned: { itemId: string; text: string; userId: string }[] = [];

  for (const text of required) {
    const norm = normalizeAuditName(text);
    const existing = allItems.find((i) => normalizeAuditName(i.text) === norm);

    // Never modify or reassign already completed audits
    if (existing?.completed) continue;

    // Filter to shift auditors who hold the matching audit role and are NOT blocked
    const eligibleAuditors = shiftAuditors.filter((u) =>
      !isUserBlocked(u) &&
      u.roles.some((r) => r.toLowerCase().includes('audit') && AUDIT_ROLE_MATCHERS[norm](r.toLowerCase()))
    );

    const eligibleAuditorIds = eligibleAuditors.map((u) => u.id);
    const existingAssigneeIds = (existing?.assigneeId || []).filter((id) => {
      if (blockedUserIds.has(id)) return false;
      const user = allUsers.find((u) => u.id === id);
      return user ? !isUserBlocked(user) : true;
    });

    // If no eligible auditors on shift and no existing assignees need cleanup, skip
    if (eligibleAuditors.length === 0 && existing && existing.assigneeId.length === existingAssigneeIds.length) {
      continue;
    }

    // Multiple assignees: add shift auditors to existing assignees
    const updatedAssignees = Array.from(new Set([...existingAssigneeIds, ...eligibleAuditorIds]));

    // Find newly added auditors to notify
    const newlyAdded = eligibleAuditors.filter((u) => !existingAssigneeIds.includes(u.id));

    // If no change in assignees, skip DB update
    if (
      existing &&
      existing.assigneeId.length === updatedAssignees.length &&
      existing.assigneeId.every((id) => updatedAssignees.includes(id))
    ) {
      continue;
    }

    if (!checklistId) {
      const checklist = await prisma.checklist.create({
        data: { name: 'Audit', taskId: task.id },
        select: { id: true },
      });
      checklistId = checklist.id;
    }

    const item = existing
      ? await prisma.checklistItem.update({
          where: { id: existing.id },
          data: { assigneeId: updatedAssignees },
          select: { id: true },
        })
      : await prisma.checklistItem.create({
          data: { checklistId, text, assigneeId: updatedAssignees },
          select: { id: true },
        });

    newlyAdded.forEach((u) => {
      assigned.push({ itemId: item.id, text, userId: u.id });
    });
  }

  if (assigned.length === 0) return { success: true, assignedCount: 0 };

  // Invalidate task cache before notifying and broadcasting
  await invalidateCache(`task:${task.id}`);

  const checklists = await prisma.checklist.findMany({
    where: { taskId: task.id, subtaskId: null },
    include: { items: true },
  });
  getIo()?.emit('task:updated', { id: task.id, checklists });

  const notifierId = actorId || task.creatorId;
  for (const { text, userId } of assigned) {
    if (userId === notifierId) continue;
    const shouldNotify = await filterUsersByNotificationPreference([userId], 'checklists');
    if (shouldNotify.length === 0) continue;
    await prisma.taskNotification.create({
      data: {
        userId,
        actorId: notifierId || '',
        taskId: task.id,
        type: 'CHECKLIST_ITEM_ASSIGNED',
        title: `You were assigned "${text}" in Audit on ${task.title}`,
      },
    });
    getIo()?.to(`user:${userId}`).emit('notification_received');
  }

  return { success: true, assignedCount: assigned.length };
}

/**
 * Sweeps all tasks currently in review and assigns/adds the active shift auditors.
 * Used by cron triggers, catch-up intervals, and external webhooks.
 */
export async function sweepInReviewTasksForShiftAudits(
  targetShift?: ShiftType | string
): Promise<{ checkedTasks: number; updatedTasks: number }> {
  const shift = targetShift || (await getActiveManilaShift());
  if (shift === 'OFF_SHIFT') return { checkedTasks: 0, updatedTasks: 0 };

  const inReviewTasks = await prisma.task.findMany({
    where: {
      OR: [
        { status: { equals: 'IN REVIEW', mode: 'insensitive' } },
        { status: { equals: 'In Review', mode: 'insensitive' } },
        { status: { equals: 'review', mode: 'insensitive' } },
        { status: { contains: 'review', mode: 'insensitive' } },
      ],
    },
    select: { id: true, status: true },
  });

  const matchingTasks = inReviewTasks.filter((t) => isReviewStatus(t.status));
  let updatedTasks = 0;

  for (const t of matchingTasks) {
    const res = await autoAssignAudits(t.id, null, { shift, isSweep: true });
    if (res?.assignedCount && res.assignedCount > 0) {
      updatedTasks++;
    }
  }

  return { checkedTasks: matchingTasks.length, updatedTasks };
}
