export type TaskMapMoveMode = 'IN_PROGRESS' | 'QUEUE';
export type TaskMapMoveAction = 'ASSIGN' | 'TRANSFER';

export interface TaskMapMovePermissionInput {
  actorId?: string | null;
  isPm: boolean;
  currentOwnerId?: string | null;
  targetAssigneeId?: string | null;
  mode?: TaskMapMoveMode;
  action?: TaskMapMoveAction;
}

export interface TaskMapMovePermissionResult {
  allowed: boolean;
  statusCode: number;
  error?: string;
}

/**
 * Resolves the effective owner ID of a Task Map task or subtask from its active PM_ASSIGNMENT,
 * handedOver flag, and direct assignee fields (matching frontend getEffectiveTaskMapHandlerId).
 */
export function resolveEffectiveTaskMapOwnerId(params: {
  pmReviews?: any;
  handedOver?: boolean;
  statuses?: string[] | null;
  assigneeId?: string | null;
  assignees?: Array<{ id: string }> | null;
  subtaskId?: string | null;
}): string | null {
  let reviews = params.pmReviews;
  if (typeof reviews === 'string') {
    try {
      reviews = JSON.parse(reviews);
    } catch {
      reviews = [];
    }
  }
  if (Array.isArray(reviews)) {
    const pmAssign = reviews.find(
      (r: any) =>
        r?.type === 'PM_ASSIGNMENT' &&
        r?.assignedTo &&
        (params.subtaskId ? r?.subtaskId === params.subtaskId : !r?.subtaskId)
    );
    if (pmAssign?.assignedTo) {
      return pmAssign.assignedTo;
    }
  }

  const isHandedOver =
    Boolean(params.handedOver) ||
    (params.statuses || []).some((s) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'HANDOVER');
  if (isHandedOver) {
    return null;
  }

  if (params.assigneeId) return params.assigneeId;
  if (Array.isArray(params.assignees) && params.assignees.length > 0) {
    return params.assignees[0]?.id || null;
  }
  return null;
}

/**
 * Server-side permission enforcement for Task Map card moves and transfers:
 * - MA (!isPm): can move cards only within their own column (including into/out of their own In Progress block).
 *   Cannot move cards in other MAs' columns, into another MA's column, or to/from Available tasks.
 * - PM (isPm): cannot move/drop cards into any MA's In Progress block (MA action only).
 *   Can assign/queue/unassign/transfer tasks in QUEUE mode.
 * - Transfer: PM-only action; always lands in target MA's To Do (QUEUE), never In Progress.
 */
export function evaluateTaskMapMovePermission(
  input: TaskMapMovePermissionInput
): TaskMapMovePermissionResult {
  const {
    actorId,
    isPm,
    currentOwnerId = null,
    targetAssigneeId = null,
    mode = 'QUEUE',
    action = 'ASSIGN',
  } = input;

  if (!actorId) {
    return { allowed: false, statusCode: 401, error: 'Authentication required' };
  }

  if (action === 'TRANSFER') {
    if (!isPm) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'Only Project Managers and Admins can transfer tasks',
      };
    }
    if (!targetAssigneeId) {
      return {
        allowed: false,
        statusCode: 400,
        error: 'Target MA is required to transfer a task',
      };
    }
    return { allowed: true, statusCode: 200 };
  }

  if (mode === 'IN_PROGRESS') {
    if (isPm) {
      return { allowed: true, statusCode: 200 };
    }
    if (!targetAssigneeId || targetAssigneeId !== actorId) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'You can only move tasks into your own In Progress block',
      };
    }
    if (currentOwnerId && currentOwnerId !== actorId) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'You cannot move a task assigned to another user',
      };
    }
    return { allowed: true, statusCode: 200 };
  }

  // mode === 'QUEUE'
  if (!isPm) {
    if (!targetAssigneeId) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'Only Project Managers can move tasks to the Available column',
      };
    }
    if (targetAssigneeId !== actorId) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'You cannot move tasks into another MA\'s column. Only Project Managers and Admins can assign tasks to others.',
      };
    }
    if (currentOwnerId && currentOwnerId !== actorId) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'You cannot move a task assigned to another user',
      };
    }
  }

  return { allowed: true, statusCode: 200 };
}
