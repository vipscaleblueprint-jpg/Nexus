export interface CanDragTaskMapCardParams {
  isPmUser: boolean;
  currentUserId?: string | null;
  columnUserId?: string | null;
  isFromAvailable?: boolean;
  isAssumptionBlock?: boolean;
  isWaiting?: boolean;
}

export function canDragTaskMapCard(params: CanDragTaskMapCardParams): boolean {
  const {
    isPmUser,
    currentUserId,
    columnUserId,
    isFromAvailable = false,
    isAssumptionBlock = false,
    isWaiting = false,
  } = params;

  if (isAssumptionBlock) return false;
  if (isFromAvailable && isWaiting) return false;
  // Available tasks can be dragged by PMs or by any user to assign to themselves
  if (isFromAvailable) return true;
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
      return { allowed: true, mode: 'IN_PROGRESS', targetUserId };
    }
    const isTargetingSelf = Boolean(currentUserId && targetUserId === currentUserId);
    if (isFromAvailable) {
      if (isTargetingSelf) {
        return { allowed: true, mode: 'IN_PROGRESS', targetUserId };
      }
      return {
        allowed: false,
        reason: 'Only Project Managers and Admins can assign tasks from the Available column to other users',
      };
    }
    if (!isTargetingSelf || (sourceUserId && sourceUserId !== currentUserId)) {
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
      const isTargetingSelf = Boolean(currentUserId && targetUserId === currentUserId);
      if (isFromAvailable) {
        if (isTargetingSelf) {
          return { allowed: true, mode: 'QUEUE', targetUserId };
        }
        return {
          allowed: false,
          reason: 'Only Project Managers and Admins can assign tasks from the Available column to other users',
        };
      }
      if (!isTargetingSelf || (sourceUserId && sourceUserId !== currentUserId)) {
        return {
          allowed: false,
          reason: "You cannot move tasks into another MA's column",
        };
      }
    }
    return { allowed: true, mode: 'QUEUE', targetUserId };
  }

  if (targetColumnId === 'available-pool') {
    const isOwnColumnHandover = Boolean(
      currentUserId && sourceUserId && sourceUserId === currentUserId
    );
    if (!isPmUser && !isOwnColumnHandover) {
      return {
        allowed: false,
        reason: 'Only Project Managers can move tasks from other columns to the Available column',
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
  const { isPmUser, currentUserId, columnUserId } = params;
  if (isPmUser) return true;
  if (!currentUserId || !columnUserId) return false;
  return currentUserId === columnUserId;
}

export function canTransferTaskMapCard(isPmUser: boolean): boolean {
  return Boolean(isPmUser);
}

/**
 * For non-PM/non-Admin users, other team members' columns are hidden by default
 * (instead of rendered as collapsed vertical strips), keeping only Available Tasks
 * and the logged-in user's own column visible unless explicitly unhidden.
 */
export function isColumnHiddenByDefault(
  columnId: string,
  currentUserId?: string | null,
  isPmUser: boolean = false
): boolean {
  if (columnId === 'available' || columnId === 'instruction-live') return false;
  if (isPmUser) return false;
  if (!currentUserId) return false;
  return columnId !== currentUserId;
}

export function resolveColumnHiddenState(
  columnId: string,
  overrides: Record<string, boolean>,
  currentUserId?: string | null,
  isPmUser: boolean = false
): boolean {
  if (Object.prototype.hasOwnProperty.call(overrides, columnId)) {
    return Boolean(overrides[columnId]);
  }
  return isColumnHiddenByDefault(columnId, currentUserId, isPmUser);
}

export function isColumnCollapsedByDefault(
  _columnId: string,
  _currentUserId?: string | null,
  _isPmUser: boolean = false
): boolean {
  // Non-PM other-user columns are hidden by default via isColumnHiddenByDefault rather than collapsed.
  return false;
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
  'TOSEND',
  'TOFOLLOWUP',
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
