import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from './redisService';
import { getRequiredAudits } from '../controllers/task.controller';
import { getAiPickedAudits, isNexusAuditChecklist, normalizeAuditName } from '../utils/auditChecklist';
import { filterUsersByNotificationPreference } from '../utils/notificationPreferences';

// Which user role (User.roles) audits each item, matched loosely ("Instruction Auditor", "UI UX Auditor"...)
const AUDIT_ROLE_MATCHERS: Record<string, (role: string) => boolean> = {
  'instructions audit': (r) => r.includes('instruction'),
  'ui ux audit': (r) => /ui\s*\/?\s*ux/.test(r),
  'design audit': (r) => r.includes('design'),
  'funnel audit': (r) => r.includes('funnel'),
};

/**
 * Gives every unassigned, unchecked audit item on a task to the least busy user holding the
 * matching auditor role (fewest unchecked audit items assigned to them). The task's own assignees
 * are skipped when anyone else holds the role, so nobody audits their own work.
 * Only fills empty slots: a manual assignment or unassignment made later is never overwritten,
 * because this runs once when the task (or its "--Audit" subtask) is created.
 */
export async function autoAssignAudits(taskId: string, actorId?: string | null): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      creatorId: true,
      assigneeId: true,
      assigneeRoleRestrictions: true,
      assignees: { select: { id: true } },
      subtasks: { select: { title: true, assigneeRoleRestrictions: true } },
      checklists: {
        where: { subtaskId: null },
        select: { id: true, name: true, externalId: true, subtaskId: true, items: { select: { id: true, text: true, completed: true, assigneeId: true } } },
      },
    },
  });
  if (!task) return;

  // Same required-audit rules as the completion gate in updateTask
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
  const required = Array.from(new Set([
    ...(getAiPickedAudits(task.checklists) ? [] : getRequiredAudits(task.title, auditorRoles)),
    ...allItems.filter((i) => !i.text.startsWith('!')).map((i) => i.text),
  ])).filter((text) => {
    const norm = normalizeAuditName(text);
    return !excluded.has(norm) && !!AUDIT_ROLE_MATCHERS[norm];
  });
  if (required.length === 0) return;

  const auditors = await prisma.user.findMany({ select: { id: true, roles: true } });
  const taskAssigneeIds = new Set([task.assigneeId, ...task.assignees.map((a) => a.id)].filter(Boolean) as string[]);

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
    if (existing && (existing.assigneeId.length > 0 || existing.completed)) continue;

    const holders = auditors
      .filter((u) => u.roles.some((r) => r.toLowerCase().includes('audit') && AUDIT_ROLE_MATCHERS[norm](r.toLowerCase())))
      .map((u) => u.id);
    const others = holders.filter((id) => !taskAssigneeIds.has(id));
    const pool = others.length > 0 ? others : holders;
    if (pool.length === 0) continue;

    // Least busy wins; ties are broken randomly so the same person isn't always first
    const minLoad = Math.min(...pool.map((id) => load.get(id) || 0));
    const tied = pool.filter((id) => (load.get(id) || 0) === minLoad);
    const userId = tied[Math.floor(Math.random() * tied.length)];
    load.set(userId, minLoad + 1);

    if (!checklistId) {
      const checklist = await prisma.checklist.create({ data: { name: 'Audit', taskId: task.id }, select: { id: true } });
      checklistId = checklist.id;
    }
    const item = existing
      ? await prisma.checklistItem.update({ where: { id: existing.id }, data: { assigneeId: [userId] }, select: { id: true } })
      : await prisma.checklistItem.create({ data: { checklistId, text, assigneeId: [userId] }, select: { id: true } });
    assigned.push({ itemId: item.id, text, userId });
  }

  if (assigned.length === 0) return;

  await invalidateCache(`task:${task.id}`);

  // Open task views pick up the new Audit checklist and its assignees
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
}
