export interface CanDragTaskMapCardParams {
  isPmUser: boolean;
  currentUserId?: string | null;
  columnUserId?: string | null;
  isFromAvailable?: boolean;
  isAssumptionBlock?: boolean;
}

export function canDragTaskMapCard(params: CanDragTaskMapCardParams): boolean {
  const {
    isPmUser,
    currentUserId,
    columnUserId,
    isFromAvailable = false,
    isAssumptionBlock = false,
  } = params;

  if (isAssumptionBlock) return false;
  if (isFromAvailable) return Boolean(isPmUser);
  if (!columnUserId) return false;
  return Boolean(isPmUser || (currentUserId && columnUserId === currentUserId));
}

export interface CanDropTaskMapCardParams {
  isPmUser: boolean;
  currentUserId?: string | null;
  sourceUserId?: string | null;
  isFromAvailable?: boolean;
  targetColumnId: string;
}

export interface CanDropTaskMapCardResult {
  allowed: boolean;
  reason?: string;
  mode?: 'IN_PROGRESS' | 'QUEUE';
  targetUserId?: string | null;
}

export function canDropTaskMapCard(
  params: CanDropTaskMapCardParams
): CanDropTaskMapCardResult {
  const {
    isPmUser,
    currentUserId,
    sourceUserId = null,
    isFromAvailable = false,
    targetColumnId,
  } = params;

  if (targetColumnId.startsWith('in-progress-')) {
    const targetUserId = targetColumnId.slice('in-progress-'.length);
    if (isPmUser) {
      return {
        allowed: false,
        reason: "Project Managers cannot move tasks into In Progress. Moving a task to In Progress is the MA's action only.",
      };
    }
    if (isFromAvailable) {
      return {
        allowed: false,
        reason: 'Only Project Managers and Admins can assign tasks from the Available column',
      };
    }
    if (!currentUserId || sourceUserId !== currentUserId || targetUserId !== currentUserId) {
      return {
        allowed: false,
        reason: 'You can only move tasks into your own In Progress block',
      };
    }
    return { allowed: true, mode: 'IN_PROGRESS', targetUserId };
  }

  if (targetColumnId.startsWith('user-')) {
    const targetUserId = targetColumnId.slice('user-'.length);
    if (!isPmUser) {
      if (isFromAvailable) {
        return {
          allowed: false,
          reason: 'Only Project Managers and Admins can assign tasks from the Available column',
        };
      }
      if (!currentUserId || sourceUserId !== currentUserId || targetUserId !== currentUserId) {
        return {
          allowed: false,
          reason: "You cannot move tasks into another MA's column",
        };
      }
    }
    return { allowed: true, mode: 'QUEUE', targetUserId };
  }

  if (targetColumnId === 'available-pool') {
    if (!isPmUser) {
      return {
        allowed: false,
        reason: 'Only Project Managers can move tasks to the Available column',
      };
    }
    return { allowed: true, mode: 'QUEUE', targetUserId: null };
  }

  return { allowed: false };
}

export function canStartInProgressSlot(params: {
  isPmUser: boolean;
  currentUserId?: string | null;
  columnUserId?: string | null;
}): boolean {
  const { currentUserId, columnUserId } = params;
  if (!currentUserId || !columnUserId) return false;
  return currentUserId === columnUserId;
}

export function canTransferTaskMapCard(isPmUser: boolean): boolean {
  return Boolean(isPmUser);
}

export function isColumnCollapsedByDefault(
  columnId: string,
  currentUserId?: string | null,
  isPmUser: boolean = false
): boolean {
  if (columnId === 'available') return false;
  if (isPmUser) return false;
  if (!currentUserId) return false;
  return columnId !== currentUserId;
}

export function resolveColumnCollapsedState(
  columnId: string,
  overrides: Record<string, boolean>,
  currentUserId?: string | null,
  isPmUser: boolean = false
): boolean {
  if (Object.prototype.hasOwnProperty.call(overrides, columnId)) {
    return Boolean(overrides[columnId]);
  }
  return isColumnCollapsedByDefault(columnId, currentUserId, isPmUser);
}

const OTHER_BOARD_STATUS_SET = new Set([
  'INREVIEW',
  'TOREVIEW',
  'REVIEW',
  'CHECKING',
  'INCHECKING',
  'WAITING',
  'CRM',
  'ASKCLIENT',
]);

/**
 * Returns true when a task belongs to another board workflow (Auditor Map or CRM Map),
 * checking both main `status` and `taskMap.statuses`.
 */
export function isOtherBoardWorkflowStatus(task?: {
  status?: string | null;
  taskMap?: { statuses?: string[] | null } | null;
} | null): boolean {
  if (!task) return false;
  const mainNorm = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (OTHER_BOARD_STATUS_SET.has(mainNorm)) return true;

  const mapStatuses = task.taskMap?.statuses || [];
  return mapStatuses.some((st) => {
    const norm = (st || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    return OTHER_BOARD_STATUS_SET.has(norm);
  });
}
