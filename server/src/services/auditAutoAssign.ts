import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from './redisService';
import { getRequiredAudits } from '../controllers/task.controller';
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
 * - AM (Morning Shift): 08:00 - 13:00 -> Aaron, Darlene, Mimi, Bea, Blessie
 * - PM Afternoon Shift: 13:00 - 17:00 -> Aaron, Darlene, Mimi, Bea, Blessie, Cherilyn, Gie
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
  // 08:00 to 12:59 -> AM Morning shift
  if (hour >= 8 && hour < 13) {
    return 'AM';
  }
  // 13:00 to 16:59 -> PM Afternoon shift
  if (hour >= 13 && hour < 17) {
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
  const taskAssigneeIds = new Set(
    [task.assigneeId, ...task.assignees.map((a) => a.id)].filter(Boolean) as string[]
  );

  // Current load: unchecked audit items already assigned to each auditor
  const openItems = await prisma.checklistItem.findMany({
    where: {
      completed: false,
      assigneeId: { isEmpty: false },
      NOT: { text: { startsWith: '!' } },
      checklist: { name: { equals: 'Audit', mode: 'insensitive' } },
    },
    select: { assigneeId: true },
  });
  const load = new Map<string, number>();
  openItems.forEach((i) => i.assigneeId.forEach((id) => load.set(id, (load.get(id) || 0) + 1)));

  let checklistId = auditChecklists[0]?.id;
  const assigned: { itemId: string; text: string; userId: string }[] = [];

  for (const text of required) {
    const norm = normalizeAuditName(text);
    const existing = allItems.find((i) => normalizeAuditName(i.text) === norm);

    // Never modify or reassign already completed audits
    if (existing?.completed) continue;

    const holders = shiftAuditors
      .filter((u) =>
        u.roles.some((r) => r.toLowerCase().includes('audit') && AUDIT_ROLE_MATCHERS[norm](r.toLowerCase()))
      )
      .map((u) => u.id);
    const others = holders.filter((id) => !taskAssigneeIds.has(id));
    const pool = others.length > 0 ? others : holders;
    if (pool.length === 0) continue;

    // Pick least busy auditor in active shift; break ties randomly
    const minLoad = Math.min(...pool.map((id) => load.get(id) || 0));
    const tied = pool.filter((id) => (load.get(id) || 0) === minLoad);
    const userId = tied[Math.floor(Math.random() * tied.length)];

    let updatedAssignees: string[] = [];

    if (currentShift === 'PM_NIGHT') {
      // Night shift (5 PM to 1 AM): adds night shift auditors to unchecked audits
      if (existing) {
        if (existing.assigneeId.includes(userId)) {
          continue; // Already has this night shift auditor
        }
        updatedAssignees = Array.from(new Set([...existing.assigneeId, userId]));
      } else {
        updatedAssignees = [userId];
      }
    } else if (currentShift === 'AM') {
      // Morning shift: "8 am for morning shift automatic if audits is not checked automatically assign"
      if (existing && existing.assigneeId.length > 0) {
        const hasAmAuditor = existing.assigneeId.some((id) =>
          shiftAuditors.some((sa) => sa.id === id)
        );
        if (hasAmAuditor) continue;
        // Assign morning shift auditor
        updatedAssignees = [userId];
      } else {
        updatedAssignees = [userId];
      }
    } else {
      // PM Afternoon shift:
      if (existing && existing.assigneeId.length > 0) {
        const hasAfternoonAuditor = existing.assigneeId.some((id) =>
          shiftAuditors.some((sa) => sa.id === id)
        );
        if (hasAfternoonAuditor) continue;
        updatedAssignees = [userId];
      } else {
        updatedAssignees = [userId];
      }
    }

    load.set(userId, (load.get(userId) || 0) + 1);

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

    assigned.push({ itemId: item.id, text, userId });
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
