import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from './redisService';
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

/**
 * Shift definitions in Manila Time (UTC+8):
 * - AM (Morning Shift): 08:00 - 12:00 -> Aaron, Darlene, Mimi, Bea, Blessie
 * - PM Afternoon Shift: 12:00 - 17:00 -> Aaron, Darlene, Mimi, Bea, Blessie, Cherilyn, Gie
 * - PM Night Shift: 17:00 - 01:00 (next day) -> Cherilyn, Gie, Pau2x (Gwyneth), Hannah
 * - Off-Shift: 01:00 - 08:00 -> No shift assignments; tasks wait until 8 AM morning shift
 */
const SHIFT_AUDITORS: Record<Exclude<ShiftType, 'OFF_SHIFT'>, string[]> = {
  AM: ['Aaron', 'Darlene', 'Mimi', 'Bea', 'Blessie'],
  PM_AFTERNOON: ['Aaron', 'Darlene', 'Mimi', 'Bea', 'Blessie', 'Cherilyn', 'Gie'],
  PM_NIGHT: ['Cherilyn', 'Gie', 'Pau2x', 'Hannah', 'Gwyneth'],
};

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
 * Determines the active shift in Manila Time.
 */
export function getCurrentManilaShift(date: Date = new Date()): ShiftType {
  const { hour } = getManilaHourAndMinute(date);
  // 08:00 to 11:59 -> AM Morning shift
  if (hour >= 8 && hour < 12) {
    return 'AM';
  }
  // 12:00 to 16:59 -> PM Afternoon shift (Cherilyn and Gie start at 12pm)
  if (hour >= 12 && hour < 17) {
    return 'PM_AFTERNOON';
  }
  // 17:00 to 00:59 -> PM Night shift (until 1:00 AM)
  if (hour >= 17 || hour < 1) {
    return 'PM_NIGHT';
  }
  // 01:00 to 07:59 -> Off-shift
  return 'OFF_SHIFT';
}

/**
 * Verifies if a user is part of the designated shift based on name or email.
 */
export function isUserInShift(
  user: { name?: string | null; email?: string | null },
  shift: ShiftType
): boolean {
  if (shift === 'OFF_SHIFT') return false;
  const allowed = SHIFT_AUDITORS[shift];
  const name = (user.name || '').trim().toLowerCase();
  const email = (user.email || '').trim().toLowerCase();
  return allowed.some((target) => {
    const t = target.toLowerCase();
    return name.includes(t) || email.includes(t);
  });
}

export interface AutoAssignOptions {
  force?: boolean;
  shift?: ShiftType;
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
      subtasks: { select: { title: true, assigneeRoleRestrictions: true } },
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

  const currentShift = options?.shift || getCurrentManilaShift();
  if (currentShift === 'OFF_SHIFT') {
    // During off-hours (1 AM - 8 AM), hold until the 8 AM morning shift
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

  // Fetch active users and filter to active shift auditors
  const allUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, roles: true },
  });
  const shiftAuditors = allUsers.filter((u) => isUserInShift(u, currentShift));

  // Align with audit restrictions: exclude task assignees, inProgress mover, and MA updaters for this iteration
  const { inProgressMovedBy, maUpdaterIds, maUpdaterNames } = await getTaskMoverAndUpdaters(task.id);
  const taskAssigneeIds = new Set(
    [task.assigneeId, ...task.assignees.map((a) => a.id)].filter(Boolean) as string[]
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

  const isUserBlocked = (u: { id: string; name?: string | null }) => {
    if (blockedUserIds.has(u.id)) return true;
    if (u.name && blockedNames.has(u.name.trim().toLowerCase())) return true;
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

    if (eligibleAuditors.length === 0) continue;

    const eligibleAuditorIds = eligibleAuditors.map((u) => u.id);
    const existingAssigneeIds = (existing?.assigneeId || []).filter((id) => !blockedUserIds.has(id));

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

  // Per gotchas: invalidate task cache before notifying and broadcasting
  await invalidateCache(`task:${task.id}`);

  const checklists = await prisma.checklist.findMany({
    where: { taskId: task.id, subtaskId: null },
    include: { items: true },
  });
  io.emit('task:updated', { id: task.id, checklists });

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
    io.to(`user:${userId}`).emit('notification_received');
  }

  return { success: true, assignedCount: assigned.length };
}

/**
 * Sweeps all tasks currently in review and assigns/adds the active shift auditors.
 * Used by 8 AM and 5 PM cron triggers, catch-up intervals, and external webhooks.
 */
export async function sweepInReviewTasksForShiftAudits(
  targetShift?: ShiftType
): Promise<{ checkedTasks: number; updatedTasks: number }> {
  const shift = targetShift || getCurrentManilaShift();
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
