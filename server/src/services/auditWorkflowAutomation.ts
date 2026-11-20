import { Server } from 'socket.io';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { invalidateCache } from './redisService';
import { getOrCreateTaskMapRecord, updateTaskMapRecord } from './taskMapService';
import {
  isNexusAuditChecklist,
} from '../utils/auditChecklist';
import {
  AuditProgressTransitionResult,
  evaluateAuditProgressTransition,
  isNonMaReviewerOnlyRole,
  normalizeWorkflowStatusToken,
  parsePmReviewsSafe,
  planRevisionReturnTransition,
  upsertOriginalMaEntry,
} from '../utils/auditWorkflowRules';

export * from '../utils/auditWorkflowRules';

/**
 * Records the original assigned MA in TaskMapRecord.pmReviews (if eligible),
 * so returning from Audit Map / CRM Map to Revision always knows which MA column owns the card.
 */
export async function recordOriginalAssignedMa(params: {
  taskId: string;
  subtaskId?: string | null;
  userId: string;
  userName?: string | null;
}): Promise<void> {
  const { taskId, subtaskId = null, userId } = params;
  if (!taskId || !userId) return;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, roles: true },
    });
    if (!user || isNonMaReviewerOnlyRole(user)) return;

    const record = await getOrCreateTaskMapRecord(taskId);
    const reviews = parsePmReviewsSafe(record.pmReviews);
    const nextReviews = upsertOriginalMaEntry(reviews, {
      userId: user.id,
      userName: params.userName || user.name,
      subtaskId,
    });
    await updateTaskMapRecord(taskId, { pmReviews: nextReviews });
  } catch (err) {
    logger.warn({ err, taskId, subtaskId, userId }, 'recordOriginalAssignedMa failed (non-fatal)');
  }
}

/**
 * Resolves the original assigned MA for a task or subtask using:
 * 1) Saved ORIGINAL_MA entry in TaskMapRecord.pmReviews
 * 2) Task Map SHEET_PROGRESS entry (`maName`)
 * 3) Chronological AuditLog history (`ASSIGNMENT`, `TASK_MAP_ASSIGN`, `TASK_MAP_STATUS_CHANGE`)
 *    prior to Audit/CRM transfers, preferring non-auditor/non-CRM users
 */
export async function resolveOriginalAssignedMa(params: {
  taskId: string;
  subtaskId?: string | null;
  pmReviews?: any;
  currentAssigneeId?: string | null;
}): Promise<{ userId: string | null; userName: string | null }> {
  const { taskId, subtaskId = null, currentAssigneeId = null } = params;
  const reviews = parsePmReviewsSafe(params.pmReviews);

  // 1. Saved ORIGINAL_MA
  const stored = reviews.find(
    (r: any) =>
      r?.type === 'ORIGINAL_MA' &&
      r?.userId &&
      (subtaskId ? r?.subtaskId === subtaskId : !r?.subtaskId)
  );
  if (stored?.userId) {
    return { userId: stored.userId, userName: stored.userName || null };
  }

  // Load users for role validation and sheet maName matching
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, roles: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  // 2. SHEET_PROGRESS maName lookup
  const sheetEntry = reviews.find(
    (r: any) =>
      r?.type === 'SHEET_PROGRESS' &&
      r?.maName &&
      (subtaskId ? r?.subtaskId === subtaskId : !r?.subtaskId)
  );
  if (sheetEntry?.maName) {
    const cleanMa = String(sheetEntry.maName).trim().toLowerCase();
    const matched = users.find((u) => {
      const n = (u.name || '').trim().toLowerCase();
      return (
        n === cleanMa ||
        n.split(/\s+/)[0] === cleanMa ||
        (u.email || '').toLowerCase().startsWith(`${cleanMa}@`)
      );
    });
    if (matched) {
      return { userId: matched.id, userName: matched.name };
    }
  }

  // 3. AuditLog history fallback for pre-existing tasks
  const entityIds = subtaskId ? [subtaskId, taskId] : [taskId];
  const logs = await prisma.auditLog.findMany({
    where: {
      entity: { in: ['TASK', 'SUBTASK'] },
      entityId: { in: entityIds },
      action: { in: ['ASSIGNMENT', 'TASK_MAP_ASSIGN', 'TASK_MAP_STATUS_CHANGE'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { action: true, userId: true, details: true },
  });

  const candidateIds: string[] = [];
  for (const log of logs) {
    const d: any = log.details || {};
    if (d.assignedTo) candidateIds.push(d.assignedTo);
    if (d.newAssigneeId) candidateIds.push(d.newAssigneeId);
    if (d.assigneeId) candidateIds.push(d.assigneeId);
    if (d.previousAssigneeId) candidateIds.push(d.previousAssigneeId);
    if (log.action === 'TASK_MAP_STATUS_CHANGE' && log.userId) {
      const newStatuses = Array.isArray(d.newStatuses)
        ? d.newStatuses.map(normalizeWorkflowStatusToken)
        : [];
      if (
        newStatuses.some((st: string) =>
          ['TOREVIEW', 'INREVIEW', 'CHECKING', 'CRM', 'ASKCLIENT'].includes(st)
        )
      ) {
        candidateIds.push(log.userId);
      }
    }
  }

  for (const candId of candidateIds) {
    const u = userById.get(candId);
    if (u && !isNonMaReviewerOnlyRole(u)) {
      return { userId: u.id, userName: u.name };
    }
  }

  // 4. Current assignee fallback if they are an MA
  if (currentAssigneeId) {
    const curUser = userById.get(currentAssigneeId);
    if (curUser && !isNonMaReviewerOnlyRole(curUser)) {
      return { userId: curUser.id, userName: curUser.name };
    }
  }

  return { userId: null, userName: null };
}

/**
 * Transitions a task or subtask to REVISION and restores it to the original assigned MA's
 * Task Map column, clearing Audit Map / CRM Map visibility immediately with realtime updates.
 */
export async function applyRevisionReturnToOriginalMa(params: {
  targetId: string;
  actorUser?: { id?: string; name?: string | null; email?: string | null } | null;
  io?: Server | null;
  requestedStatuses?: string[];
}): Promise<{
  taskId: string;
  subtaskId: string | null;
  originalMaId: string | null;
  statuses: string[];
  handedOver: boolean;
  pmReviews: any[];
  assignee: any | null;
}> {
  const { targetId, actorUser = null, io = null, requestedStatuses = [] } = params;
  const isSubtaskTarget = targetId.startsWith('subtask:');
  const entityId = isSubtaskTarget ? targetId.slice('subtask:'.length) : targetId;
  const actorName = actorUser?.name || actorUser?.email || 'User';

  if (isSubtaskTarget) {
    const subtask = await prisma.subtask.findUnique({
      where: { id: entityId },
      select: { id: true, title: true, taskId: true, assigneeId: true },
    });
    if (!subtask) {
      throw new Error('Subtask not found');
    }

    const parentRecord = await getOrCreateTaskMapRecord(subtask.taskId);
    const parentReviews = parsePmReviewsSafe(parentRecord.pmReviews);
    const subState = parentReviews.find(
      (r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === subtask.id
    );

    const { userId: origId, userName: origName } = await resolveOriginalAssignedMa({
      taskId: subtask.taskId,
      subtaskId: subtask.id,
      pmReviews: parentReviews,
      currentAssigneeId: subtask.assigneeId,
    });

    const plan = planRevisionReturnTransition({
      pmReviews: parentReviews,
      existingStatuses: requestedStatuses.length > 0 ? requestedStatuses : subState?.statuses || [],
      fallbackOriginalMaId: origId,
      fallbackOriginalMaName: origName,
      subtaskId: subtask.id,
      actorId: actorUser?.id || null,
      actorName,
    });

    await prisma.subtask.update({
      where: { id: subtask.id },
      data: {
        status: 'REVISION',
        completed: false,
        assigneeId: plan.originalMaId,
        assignees: plan.originalMaId ? { set: [{ id: plan.originalMaId }] } : { set: [] },
      },
    });

    const subStateEntry = {
      type: 'SUBTASK_STATE',
      subtaskId: subtask.id,
      statuses: plan.nextSubStatuses,
      handedOver: plan.handedOver,
      updatedAt: new Date().toISOString(),
    };
    const finalReviews = plan.pmReviews.filter(
      (r: any) => !(r?.type === 'SUBTASK_STATE' && r?.subtaskId === subtask.id)
    );
    finalReviews.push(subStateEntry);

    const updatedParent = await updateTaskMapRecord(subtask.taskId, { pmReviews: finalReviews });
    const restoredUser = plan.originalMaId
      ? await prisma.user.findUnique({
          where: { id: plan.originalMaId },
          select: { id: true, name: true, email: true, avatarUrl: true, roles: true },
        })
      : null;

    await invalidateCache(
      `task:${subtask.taskId}`,
      `task:${subtask.id}`,
      'tasks:all',
      'task_map:*',
      'lists:all',
      'dashboard:all',
      'launch_map:all'
    ).catch(() => {});

    const subTaskMap = {
      ...updatedParent,
      taskId: targetId,
      subtaskId: subtask.id,
      statuses: plan.nextSubStatuses,
      handedOver: plan.handedOver,
      pmReviews: finalReviews,
    };

    io?.emit('task_map:updated', {
      taskId: targetId,
      subtaskId: subtask.id,
      parentTaskId: subtask.taskId,
      status: 'REVISION',
      statuses: plan.nextSubStatuses,
      handedOver: plan.handedOver,
      assigneeId: plan.originalMaId,
      assignee: restoredUser,
      taskMap: subTaskMap,
    });
    io?.emit('task:updated', { id: subtask.taskId });

    return {
      taskId: subtask.taskId,
      subtaskId: subtask.id,
      originalMaId: plan.originalMaId,
      statuses: plan.nextSubStatuses,
      handedOver: plan.handedOver,
      pmReviews: finalReviews,
      assignee: restoredUser,
    };
  }

  const task = await prisma.task.findUnique({
    where: { id: entityId },
    select: { id: true, title: true, listId: true, assigneeId: true },
  });
  if (!task) {
    throw new Error('Task not found');
  }

  const record = await getOrCreateTaskMapRecord(entityId);
  const { userId: origId, userName: origName } = await resolveOriginalAssignedMa({
    taskId: entityId,
    pmReviews: record.pmReviews,
    currentAssigneeId: task.assigneeId,
  });

  const plan = planRevisionReturnTransition({
    pmReviews: record.pmReviews,
    existingStatuses: requestedStatuses.length > 0 ? requestedStatuses : record.statuses || [],
    fallbackOriginalMaId: origId,
    fallbackOriginalMaName: origName,
    actorId: actorUser?.id || null,
    actorName,
  });

  // Reset Nexus Audit checklist items so re-review requires fresh audits
  const auditChecklists = (
    await prisma.checklist.findMany({
      where: { taskId: entityId, subtaskId: null, name: { equals: 'Audit', mode: 'insensitive' } },
      include: { items: { select: { text: true } } },
    })
  ).filter(isNexusAuditChecklist);

  for (const cl of auditChecklists) {
    await prisma.checklistItem.updateMany({
      where: { checklistId: cl.id },
      data: { completed: false, checkedById: null, assigneeId: [] },
    });
  }

  const updatedTask = await prisma.task.update({
    where: { id: entityId },
    data: {
      status: 'REVISION',
      assigneeId: plan.originalMaId,
      assignees: plan.originalMaId ? { set: [{ id: plan.originalMaId }] } : { set: [] },
    },
  });

  const updatedRecord = await updateTaskMapRecord(entityId, {
    statuses: plan.nextSubStatuses,
    handedOver: plan.handedOver,
    pmReviews: plan.pmReviews,
  });

  const restoredUser = plan.originalMaId
    ? await prisma.user.findUnique({
        where: { id: plan.originalMaId },
        select: { id: true, name: true, email: true, avatarUrl: true, roles: true },
      })
    : null;

  await invalidateCache(
    `task:${entityId}`,
    `task:activities:${entityId}`,
    'tasks:all',
    'task_map:*',
    'lists:all',
    'dashboard:all',
    'launch_map:all'
  ).catch(() => {});

  const taskPayload: any = {
    ...updatedTask,
    assigneeId: plan.originalMaId,
    assignee: restoredUser,
    assignees: restoredUser ? [restoredUser] : [],
    assigneeIds: restoredUser ? [restoredUser.id] : [],
    taskMap: updatedRecord,
  };

  io?.emit('task:updated', taskPayload);
  io?.emit('task_map:updated', {
    taskId: entityId,
    status: 'REVISION',
    statuses: plan.nextSubStatuses,
    handedOver: plan.handedOver,
    assigneeId: plan.originalMaId,
    assignee: restoredUser,
    taskMap: updatedRecord,
    task: taskPayload,
  });

  return {
    taskId: entityId,
    subtaskId: null,
    originalMaId: plan.originalMaId,
    statuses: plan.nextSubStatuses,
    handedOver: plan.handedOver,
    pmReviews: plan.pmReviews,
    assignee: restoredUser,
  };
}

/**
 * Evaluates a task's Audit checklist right after an item is checked/created server-side
 * and enforces partial -> Audit Pool (next hierarchy step) or all -> Ready to Send + CRM Map.
 */
export async function applyAuditChecklistAutomation(params: {
  taskId: string;
  actorUserId?: string | null;
  io?: Server | null;
}): Promise<AuditProgressTransitionResult> {
  const { taskId, actorUserId = null, io = null } = params;
  if (!taskId) {
    return { outcome: 'NONE', completedAudits: [], remainingAudits: [] };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      status: true,
      listId: true,
      assigneeId: true,
      assigneeRoleRestrictions: true,
      assignees: { select: { id: true } },
      checklists: {
        where: { subtaskId: null },
        include: { items: true },
      },
      subtasks: {
        select: {
          id: true,
          title: true,
          assigneeRoleRestrictions: true,
        },
      },
    },
  });

  if (!task) {
    return { outcome: 'NONE', completedAudits: [], remainingAudits: [] };
  }

  const record = await getOrCreateTaskMapRecord(taskId);

  const auditorRoles = [
    ...(task.assigneeRoleRestrictions || []),
    ...(task.subtasks || [])
      .filter((st) => st.title?.toLowerCase().startsWith('--audit'))
      .flatMap((st) => st.assigneeRoleRestrictions || []),
  ];

  const transition = evaluateAuditProgressTransition({
    taskStatus: task.status,
    taskTitle: task.title,
    taskMapStatuses: record.statuses || [],
    auditorRoles,
    checklists: task.checklists as any,
  });

  if (transition.outcome === 'NONE') {
    return transition;
  }

  const existingReviews = parsePmReviewsSafe(record.pmReviews);

  // Strip active auditor PM_ASSIGNMENT and any stale CRM_WAITING_META; preserve ORIGINAL_MA
  const nextReviews = existingReviews.filter(
    (r: any) =>
      !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId) &&
      !(r?.type === 'CRM_WAITING_META')
  );

  // Preserve an ORIGINAL_MA if task still has a non-auditor/non-CRM assignee and none was saved yet
  const hasOriginalMa = nextReviews.some((r: any) => r?.type === 'ORIGINAL_MA' && !r?.subtaskId);
  if (!hasOriginalMa && task.assigneeId) {
    const curUser = await prisma.user.findUnique({
      where: { id: task.assigneeId },
      select: { id: true, name: true, roles: true },
    });
    if (curUser && !isNonMaReviewerOnlyRole(curUser)) {
      nextReviews.push({
        type: 'ORIGINAL_MA',
        userId: curUser.id,
        userName: curUser.name,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: transition.nextStatus,
      assigneeId: null,
      assignees: { set: [] },
    },
  });

  const updatedRecord = await updateTaskMapRecord(taskId, {
    statuses: transition.nextSubStatuses || [],
    handedOver: false,
    pmReviews: nextReviews,
  });

  if (actorUserId) {
    await prisma.auditLog
      .create({
        data: {
          action: 'AUDIT_WORKFLOW_AUTO_TRANSITION',
          entity: 'TASK',
          entityId: taskId,
          userId: actorUserId,
          details: {
            outcome: transition.outcome,
            fromStatus: task.status,
            toStatus: transition.nextStatus,
            toSubStatuses: transition.nextSubStatuses,
            completedAudits: transition.completedAudits,
            remainingAudits: transition.remainingAudits,
          },
        },
      })
      .catch(() => {});
  }

  await invalidateCache(
    `task:${taskId}`,
    `task:activities:${taskId}`,
    'tasks:all',
    'task_map:*',
    'lists:all',
    'dashboard:all',
    'launch_map:all'
  ).catch(() => {});

  const taskPayload: any = {
    ...updatedTask,
    assigneeId: null,
    assignee: null,
    assignees: [],
    assigneeIds: [],
    taskMap: updatedRecord,
  };

  io?.emit('task:updated', taskPayload);
  io?.emit('task_map:updated', {
    taskId,
    status: transition.nextStatus,
    statuses: transition.nextSubStatuses || [],
    handedOver: false,
    assigneeId: null,
    assignee: null,
    taskMap: updatedRecord,
    task: taskPayload,
  });

  return transition;
}
