import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  TaskMapItem,
  TaskMapOption,
  taskMapApi,
  getUserRoleDefinition,
  createEmptyUserBlock,
  hasUiUxOrDesignAudit,
  isProjectBasedUpwork,
  hasPmAssignmentForUser,
  isTaskHandedOver,
  getEffectiveTaskMapHandlerId,
  countNonOnHoldTasks,
  TASK_MAP_STATUS_COLORS,
  getTaskMapSubStatusStyle,
  getDefaultTaskMapSubStatuses,
  toCanonicalTaskStatus,
  matchesMarketingNameSearch,
  subscribeTaskMapSaving,
  isTaskSavingToDb,
  isProgressLoggedToday,
  isDeveloperUser,
  attachDragToScroll,
  isTaskUnderAdmin,
  hasSpreadsheetTaskInput,
  formatManilaTime,
  parseManilaTimeToIso,
  getManilaDateKey,
  extractTaskLinkIdentifiers,
  matchesTaskLinkOrId,
  SheetActivityLogRow,
  getSubStatusTransitionGuide,
  SubStatusTransitionGuide,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import { UserRoleBadge } from './UserRoleBadge';
import { ClientOtpModal } from '../modals/ClientOtpModal';
import { TaskDeliverablesModal } from '../modals/TaskDeliverablesModal';
import { InactiveMaConfirmModal } from '../modals/InactiveMaConfirmModal';
import { SubStatusChangeGuideModal } from '../modals/SubStatusChangeGuideModal';
import {
  CardStatusDropdown,
  CardPriorityDropdown,
  TaskEstimateLabel,
  TaskTimeProgressSlot,
  computeElapsed,
  isStaleLiveSession,
  isTaskUrgent,
  isTaskHigh,
  isTaskOnHold,
  sortAvailablePoolTasks,
  groupTasksWithSubtasks,
  resolveTaskStatusColor,
  hexToRgba,
  resolveSubStatusColor,
} from './TaskMapCardControls';
import { TaskMapInProgressDropCard } from './TaskMapInProgressDropCard';
import { ColumnClientDropdown } from './ColumnClientDropdown';
import { ColumnTaskTypeDropdown, matchesTaskTypeFilter } from './ColumnTaskTypeDropdown';
import { ColumnSubStatusDropdown, matchesSubStatusFilter } from './ColumnSubStatusDropdown';
import { InstructionLiveColumn } from './InstructionLiveColumn';
import { useHorizontalScroll } from '@/lib/useHorizontalScroll';

export function doesProgressMatchUser(progMaName?: string | null, userName?: string | null): boolean {
  if (!progMaName || !userName) return false;
  const cleanMa = progMaName.trim().toLowerCase();
  const cleanUser = userName.trim().toLowerCase();
  if (cleanMa === cleanUser) return true;
  const maParts = cleanMa.split(/\s+/);
  const userParts = cleanUser.split(/\s+/);
  if (maParts.some((p) => p.length >= 3 && userParts.includes(p))) return true;
  if (cleanUser.includes(cleanMa) || cleanMa.includes(cleanUser)) return true;
  return false;
}

export function findBestUserMatch<T extends { name?: string | null; email?: string | null }>(
  progMaName: string | null | undefined,
  users: T[],
  predicate?: (u: T) => boolean
): T | undefined {
  if (!progMaName) return undefined;
  const cleanMa = progMaName.trim().toLowerCase();
  if (!cleanMa) return undefined;
  const eligible = predicate ? users.filter(predicate) : users;

  // 1. Exact full-name match
  const exact = eligible.find((u) => (u.name || '').trim().toLowerCase() === cleanMa);
  if (exact) return exact;

  // 2. Exact email local-part match
  const emailExact = eligible.find((u) => {
    const local = (u.email || '').split('@')[0].trim().toLowerCase();
    return Boolean(local && local === cleanMa);
  });
  if (emailExact) return emailExact;

  // 3. Exact token / first-name match (prevents "Mae" matching "Ana Mae" before "Mae Santos")
  const firstToken = eligible.find((u) => {
    const parts = (u.name || '').trim().toLowerCase().split(/\s+/);
    return parts.some((p) => p === cleanMa);
  });
  if (firstToken) return firstToken;

  // 4. Fuzzy fallback
  return eligible.find((u) => doesProgressMatchUser(progMaName, u.name));
}

import { Flag, CheckCircle2, ChevronLeft, ChevronRight, ChevronsRight, ChevronDown, Check, Building2, Search, Shield, Pin, X, Infinity as InfinityIcon, Sparkles, CornerDownRight, RotateCcw, Loader2, ArrowRightLeft } from 'lucide-react';
import { format } from 'date-fns';
import { getCurrentLiveTime } from '@/lib/liveClock';
import { getPriorityConfig } from '@/lib/priority';
import { getAssigneeAvatarColor, CustomCircleDot, CustomCircleDotted, isSystemUser, isClosedStatus } from '@/lib/taskTokens';
import { isProjectManagerOrAdmin } from '@/lib/permissions';
import {
  canDragTaskMapCard,
  canDropTaskMapCard,
  canStartInProgressSlot,
  canTransferTaskMapCard,
  isOtherBoardWorkflowStatus,
  resolveColumnCollapsedState,
} from '@/lib/taskMapPermissions';
import { resolveUsersFromRoleRestrictions } from '@/lib/taskTokens';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { ActionErrorModal, ActionErrorInfo } from '@/components/modals/ActionErrorModal';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  CollisionDetection,
  useDndContext,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';

interface Props {
  tasks: TaskMapItem[];
  availablePool: TaskMapItem[];
  allAvailablePool?: TaskMapItem[];
  allTasks?: TaskMapItem[];
  options: TaskMapOption[];
  allUsers?: any[];
  shiftUsers?: any[];
  currentShift: string;
  onStatusChange: (taskId: string, newStatuses: string[]) => void;
  onOptionsUpdated: () => void;
  onOpenDetail: (task: TaskMapItem) => void;
  onDataRefresh: () => void;
  showAdminTasks?: boolean;
  onToggleAdminTasks?: () => void;
  selectedCustomMAs?: string[];
  clients?: Array<{ id: string; name: string; count: number }>;
  onTaskUpdate?: (taskId: string, fields: Partial<TaskMapItem>) => Promise<void> | void;
  onAssignTask?: (taskId: string, targetUserId: string | null, mode?: 'IN_PROGRESS' | 'QUEUE', assigneeRoleRestrictions?: string[], otp?: string, taskOverride?: TaskMapItem, preserveHandover?: boolean) => Promise<void> | void;
  onOptimisticClockOut?: (
    taskId: string,
    updates: {
      timeOut: string;
      targetStatus: string;
      targetMainStatus?: string;
      taskDeliverablesDescription?: string;
      taskUpdateAndDeliverables?: string;
      handedOver?: boolean;
      clearAssignee?: boolean;
    }
  ) => void;
  onTransferTask?: (taskId: string, targetUserId: string) => Promise<void> | void;
  currentDate?: string;
  isHistory?: boolean;
  search?: string;
  trackFilter?: 'ALL' | 'LIVE' | 'ACTIVE';
  maSortMode?: 'DEFAULT' | 'QUEUE_DESC' | 'QUEUE_ASC';
  superviseChecks?: any[];
  onSuperviseCheck?: (payload: {
    maName: string;
    dateKey?: string;
    timeIn: string;
    taskId?: string | null;
    taskTitle?: string | null;
    client?: string | null;
    note?: string | null;
  }) => Promise<void> | void;
  onSuperviseUncheck?: (sessionKey: string) => Promise<void> | void;
}

// Priority ranking for user columns:
// 1. Instruction -> 2. Designers -> 3. UI/UX -> 4. Funnel -> 5. Auditor -> 6. Other
export function getUserRolePriority(roles: string[] = [], isAudit = false): {
  priority: number;
  label: string;
  badgeClass: string;
} {
  const rolesLower = (roles || []).map((r) => (r || '').toLowerCase());

  // 1. Instruction
  if (rolesLower.some((r) => r.includes('instruction'))) {
    return {
      priority: 1,
      label: 'Instruction',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/60',
    };
  }

  // 2. Designers (Design, Motion Graphics) without UI/UX
  if (
    rolesLower.some((r) => r.includes('design') || r.includes('motion graphic')) &&
    !rolesLower.some((r) => r.includes('ui') || r.includes('ux'))
  ) {
    return {
      priority: 2,
      label: 'Designer',
      badgeClass: 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/70 dark:text-pink-300 dark:border-pink-800/60',
    };
  }

  // 3. UI/UX (UI UX Auditor, UI/UX Designer)
  if (rolesLower.some((r) => r.includes('ui') || r.includes('ux'))) {
    return {
      priority: 3,
      label: 'UI/UX',
      badgeClass: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/70 dark:text-cyan-300 dark:border-cyan-800/60',
    };
  }

  // 4. Funnel (Funnel Auditor, Funnel Builder, Funnel Strategist)
  if (rolesLower.some((r) => r.includes('funnel'))) {
    return {
      priority: 4,
      label: 'Funnel',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/60',
    };
  }

  // 5. Generic Auditor if marked isAudit
  if (isAudit) {
    return {
      priority: 5,
      label: 'Auditor',
      badgeClass: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800/60',
    };
  }

  // 6. Normal Team Members / Developers
  return {
    priority: 6,
    label: '',
    badgeClass: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700/60',
  };
}

// Sort helper: In progress on top -> Urgent tasks -> High priority -> Remaining tasks
export const isClosedTask = (task?: TaskMapItem | null): boolean => {
  if (!task) return false;
  if (task.isClosed) return true;
  const s = (task.status || '').toUpperCase().replace(/[\s_-]+/g, '');
  if (['CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED'].includes(s)) return true;
  const customStatuses = task.taskMap?.statuses || [];
  if (customStatuses.some((cs) => ['DONE', 'CLOSED', 'COMPLETE', 'COMPLETED', 'RESOLVED'].includes((cs || '').toUpperCase().replace(/[\s_-]+/g, '')))) return true;
  // A finished DailySheetLog session (progress.status === 'Completed') only means that time entry clocked out;
  // do NOT treat an open/paused task (e.g. PENDING + Paused) as closed!
  if (customStatuses.some((cs) => (cs || '').toUpperCase().replace(/[\s_-]+/g, '') === 'PAUSED')) return false;
  if (s && !['CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED'].includes(s)) return false;
  const progStatus = (task.progress?.status || '').toUpperCase().replace(/[\s_-]+/g, '');
  if (['CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED'].includes(progStatus)) return true;
  return false;
};

const isTaskInProgress = (task: TaskMapItem) => {
  if (isClosedTask(task)) return false;
  const customStatuses = task.taskMap?.statuses || [];
  return customStatuses.some(
    (cs) => cs.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS'
  );
};

export const isTaskLiveWorking = (task: TaskMapItem, userName?: string, now = new Date()): boolean => {
  if (isClosedTask(task)) return false;
  const isClosed =
    (task.status || '').toUpperCase() === 'CLOSED' || (task.status || '').toUpperCase() === 'DONE';
  if (isClosed) return false;
  // Handed over tasks can never be live working
  if (!task.isAssumptionBlock && isTaskHandedOver(task)) return false;
  const statuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
  if (statuses.includes('CLOSED') || statuses.includes('DONE')) return false;

  // Synthetic assumption block representing assistant's open shift input
  if (task.isAssumptionBlock && task.progress?.timeIn && !task.progress?.timeOut && !task.progress?.isMissingTime) {
    return !isStaleLiveSession(task.progress.timeIn, task.progress.date, now);
  }

  const isMyProg = doesProgressMatchUser(task.progress?.maName, userName);
  const prog = isMyProg ? task.progress : null;
  if (!prog?.timeIn || prog?.timeOut || prog?.isMissingTime) return false;
  if (isStaleLiveSession(prog.timeIn, prog.date, now)) return false;
  return true;
};

export const isTaskActiveInProgress = (task: TaskMapItem, userName?: string): boolean => {
  if (isClosedTask(task)) return false;
  const isClosed =
    (task.status || '').toUpperCase() === 'CLOSED' || (task.status || '').toUpperCase() === 'DONE';
  if (isClosed) return false;
  // On-hold or handed-over tasks can never be active in-progress
  if (!task.isAssumptionBlock && isTaskHandedOver(task)) return false;
  const statuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
  if (statuses.includes('CLOSED') || statuses.includes('DONE')) return false;

  // 0. Live synthetic assumption block strictly takes the In Progress slot (clocked-out held blocks sit below dropzone until 12 AM)
  if (task.isAssumptionBlock) {
    if (task.progress?.timeOut) return false;
    return Boolean(task.progress?.timeIn && !task.progress.timeOut && !task.progress.isMissingTime);
  }

  // On-hold or paused tasks belong out of In Progress unless live clocked in right now
  const hasPausedStatus = statuses.some((s) => s.replace(/[\s_-]+/g, '') === 'PAUSED');
  if (isTaskOnHold(task) || hasPausedStatus) return false;
  if (isTaskLiveWorking(task, userName)) return true;

  const isMyProg = doesProgressMatchUser(task.progress?.maName, userName);
  if (isMyProg && task.progress?.timeOut) return false;

  // 2. Active missing-time session for this user from daily schedule sheet (entered row without Time In)
  if (isMyProg && task.progress?.isMissingTime && !task.progress?.timeOut) {
    return true;
  }

  // 3. Task is explicitly set to In Progress for this user
  const isAssignedToUser = doesProgressMatchUser(task.assignee?.name, userName);
  const isStatusInProgress =
    (task.status || '').toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS' ||
    statuses.some((s) => s.replace(/[\s_-]+/g, '') === 'INPROGRESS');

  if (isAssignedToUser && isStatusInProgress) {
    return true;
  }

  return false;
};

const sortColumnTasks = (items: TaskMapItem[], userName?: string) => {
  const sorted = [...items].sort((a, b) => {
    // 0. Live synthetic assumption block strictly on top
    const isAssumpA = a.isAssumptionBlock && !a.progress?.timeOut ? 1 : 0;
    const isAssumpB = b.isAssumptionBlock && !b.progress?.timeOut ? 1 : 0;
    if (isAssumpA !== isAssumpB) return isAssumpB - isAssumpA;

    // 1. Live actively working task (Time In, no Time Out) strictly on top
    const isLiveA = isTaskLiveWorking(a, userName) ? 1 : 0;
    const isLiveB = isTaskLiveWorking(b, userName) ? 1 : 0;
    if (isLiveA !== isLiveB) return isLiveB - isLiveA;

    // 2. All On-Hold tasks strictly at the most bottom (even if Urgent or previously In Progress)
    const holdA = isTaskOnHold(a) ? 1 : 0;
    const holdB = isTaskOnHold(b) ? 1 : 0;
    if (holdA !== holdB) return holdA - holdB;

    // 3. Active in-progress task next (extracted into the top In Progress dropzone)
    const inProgA = isTaskActiveInProgress(a, userName) ? 1 : 0;
    const inProgB = isTaskActiveInProgress(b, userName) ? 1 : 0;
    if (inProgA !== inProgB) return inProgB - inProgA;

    // 4. Tasks logged in today's Sheets historical log sort ahead of unlogged queued tasks,
    //    ordered by most recent sheet submission / Time In for that day
    const hasSheetA = Boolean(a.progress?.dailySheetLogId || a.progress?.timeIn) ? 1 : 0;
    const hasSheetB = Boolean(b.progress?.dailySheetLogId || b.progress?.timeIn) ? 1 : 0;
    if (hasSheetA !== hasSheetB) return hasSheetB - hasSheetA;
    if (hasSheetA && hasSheetB) {
      const sheetTimeA = a.progress?.updatedAt
        ? new Date(a.progress.updatedAt).getTime()
        : a.progress?.startedAt
        ? new Date(a.progress.startedAt).getTime()
        : 0;
      const sheetTimeB = b.progress?.updatedAt
        ? new Date(b.progress.updatedAt).getTime()
        : b.progress?.startedAt
        ? new Date(b.progress.startedAt).getTime()
        : 0;
      if (sheetTimeA !== sheetTimeB) return sheetTimeB - sheetTimeA;
    }

    // 5. Always prioritize urgent tasks at the top among remaining queued tasks
    const urgentA = isTaskUrgent(a) ? 1 : 0;
    const urgentB = isTaskUrgent(b) ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;

    // 6. High priority
    const highA = isTaskHigh(a) ? 1 : 0;
    const highB = isTaskHigh(b) ? 1 : 0;
    if (highA !== highB) return highB - highA;

    // 7. Most recently updated progress
    const progTimeA = a.progress?.updatedAt ? new Date(a.progress.updatedAt).getTime() : 0;
    const progTimeB = b.progress?.updatedAt ? new Date(b.progress.updatedAt).getTime() : 0;
    if (progTimeA !== progTimeB) return progTimeB - progTimeA;

    // 8. Newer tasks
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
  return groupTasksWithSubtasks(sorted);
};

// ---------------------------------------------------------------------------
// Draggable Card Wrapper (Matches KanbanBoard animations & ghosting)
// ---------------------------------------------------------------------------
const DraggableTaskCard: React.FC<{
  task: TaskMapItem;
  sourceUserId?: string | null;
  disabled?: boolean;
  children: React.ReactNode;
}> = memo(({ task, sourceUserId = null, disabled = false, children }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task, sourceUserId },
    disabled,
  });

  const [isSaving, setIsSaving] = useState<boolean>(() => isTaskSavingToDb(task.id));
  useEffect(() => {
    return subscribeTaskMapSaving((savingIds) => {
      setIsSaving(savingIds.has(task.id));
    });
  }, [task.id]);

  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={`relative touch-none transition-opacity duration-150 ${isDragging
        ? 'opacity-25 scale-[0.98] border border-dashed border-zinc-700 rounded-xl bg-zinc-900/40 pointer-events-none'
        : disabled
          ? 'cursor-default'
          : 'cursor-grab active:cursor-grabbing'
        }`}
    >
      {children}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Droppable Column Wrapper (Matches KanbanBoard drop zone highlighting)
// ---------------------------------------------------------------------------
const DroppableColumn: React.FC<{
  id: string;
  children: React.ReactNode;
  className?: string;
}> = memo(({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      data-task-column={id}
      data-droppable-column="true"
      className={`${className || ''} cursor-default transition-colors duration-150 ${isOver ? 'ring-1 ring-zinc-600/80 bg-zinc-900/30' : ''
        }`}
    >
      {children}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Droppable wrapper for active In-Progress slot so dropping onto an occupied
// top slot still reliably triggers IN_PROGRESS mode
// ---------------------------------------------------------------------------
const DroppableInProgressSlot: React.FC<{
  userId: string;
  disabled?: boolean;
  children: React.ReactNode;
}> = memo(({ userId, disabled = false, children }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `in-progress-${userId}`,
    data: {
      type: 'in-progress-slot',
      userId,
    },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      data-in-progress-dropzone="true"
      data-no-drag-scroll="true"
      className={`rounded-xl transition-colors duration-150 ${
        isOver ? 'ring-2 ring-[#D04A7C] bg-[#D04A7C]/15 shadow-lg shadow-[#D04A7C]/20' : ''
      }`}
    >
      {children}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Card Cut-Out Snapping Placeholder
// Appears in target column when dragging a task across/different columns
// ---------------------------------------------------------------------------
const DragPreviewCard: React.FC<{
  item: TaskMapItem;
  fallbackListName?: string;
  isGhost?: boolean;
  getSubStatusStyle?: (status: string, item: TaskMapItem) => { color: string; textColor?: string };
}> = memo(({ item, fallbackListName, isGhost = false, getSubStatusStyle }) => {
  const priorityConfig = getPriorityConfig(item.priority);
  const isClosed =
    (item.status || '').toUpperCase() === 'CLOSED' ||
    (item.status || '').toUpperCase() === 'DONE';
  const primarySubStatus =
    (item.taskMap?.statuses || [])[0] ||
    getDefaultTaskMapSubStatuses(item.status)[0] ||
    'Sub-Status';
  const subStyle = getSubStatusStyle
    ? getSubStatusStyle(primarySubStatus, item)
    : getTaskMapSubStatusStyle(primarySubStatus, []);

  return (
    <div
      className={`p-3 rounded-xl flex items-stretch gap-3 min-h-[112px] ${
        isGhost
          ? 'bg-zinc-900/30 border border-dashed border-zinc-700/75 opacity-60'
          : 'bg-card border border-zinc-600/80 shadow-lg shadow-black/45'
      }`}
    >
      {/* Left: Task Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[190px] mb-1 flex items-center gap-1.5">
          {item.isSubtask && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 shrink-0">
              <CornerDownRight className="size-2.5" />
            </span>
          )}
          <span className="truncate">{item.list?.name || fallbackListName || 'General'}</span>
        </div>
        <h4 className="text-[13px] font-bold text-zinc-900 dark:text-white line-clamp-2 leading-snug my-0.5 h-[36px]">
          {item.isSubtask ? (item.title || '').replace(/^--\s*/, '') : item.title}
        </h4>
        <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
          <span className="shrink-0 flex items-center">
            {isClosed ? (
              <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
            ) : (
              <CustomCircleDot
                className="size-3.5 shrink-0"
                style={{
                  color: resolveTaskStatusColor(
                    item.status,
                    item.listId || item.list?.id,
                    item.list?.statuses
                  ),
                }}
              />
            )}
          </span>
          <TaskDescriptionButton
            description={item.description}
            taskTitle={item.title}
          />
          <span className="flex items-center gap-1 font-medium text-[11px]">
            <Flag className={`size-3 ${priorityConfig.iconColor}`} />
            <span className={priorityConfig.color}>{priorityConfig.label}</span>
          </span>
        </div>
      </div>

      {/* Separator */}
      <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

      {/* Right: Sub-Status snapshot */}
      <div className="w-[125px] shrink-0 flex flex-col justify-between py-0.5">
        <div className="flex flex-col items-end gap-0.5">
          <TaskTimeProgressSlot task={item} />
          <TaskEstimateLabel task={item} />
        </div>
        <div className="w-full">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
              Sub-Status
            </span>
          </div>
          <div
            className="on-solid px-2 py-1 text-xs rounded-md font-medium truncate border border-black/10 dark:border-white/10"
            style={{
              backgroundColor: subStyle.color,
              color: subStyle.textColor,
            }}
          >
            {primarySubStatus}
          </div>
        </div>
      </div>
    </div>
  );
});

const CardCutoutPlaceholder: React.FC<{
  task: TaskMapItem;
  targetName: string;
  isUnassign?: boolean;
  carriedSubtasks?: TaskMapItem[];
  getSubStatusStyle?: (status: string, item: TaskMapItem) => { color: string; textColor?: string };
}> = memo(({ task, carriedSubtasks = [], getSubStatusStyle }) => {
  return (
    <div className="my-1 pointer-events-none select-none space-y-2 animate-in fade-in slide-in-from-top-1 duration-150 ease-out">
      <DragPreviewCard item={task} isGhost getSubStatusStyle={getSubStatusStyle} />

      {carriedSubtasks.length > 0 && (
        <div className="pl-4 space-y-2 relative">
          <div className="absolute left-1.5 top-0 bottom-3 w-px bg-zinc-700/45" />
          {carriedSubtasks.slice(0, 3).map((sub) => (
            <DragPreviewCard
              key={sub.id}
              item={sub}
              fallbackListName={task.list?.name}
              isGhost
              getSubStatusStyle={getSubStatusStyle}
            />
          ))}
          {carriedSubtasks.length > 3 && (
            <div className="px-2.5 py-1 rounded-lg border border-dashed border-zinc-700/70 bg-zinc-900/25 text-[11px] font-medium text-zinc-500 text-center">
              +{carriedSubtasks.length - 3} more subtask{carriedSubtasks.length - 3 > 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const ColumnDropCutout: React.FC<{
  columnId: string;
  canShow: boolean;
  task: TaskMapItem | null;
  targetName: string;
  isUnassign?: boolean;
  carriedSubtasks?: TaskMapItem[];
  getSubStatusStyle?: (status: string, item: TaskMapItem) => { color: string; textColor?: string };
}> = memo(({ columnId, canShow, task, targetName, isUnassign, carriedSubtasks, getSubStatusStyle }) => {
  const { over } = useDndContext();
  if (!canShow || !task || over?.id !== columnId) return null;
  return (
    <CardCutoutPlaceholder
      task={task}
      targetName={targetName}
      isUnassign={isUnassign}
      carriedSubtasks={carriedSubtasks}
      getSubStatusStyle={getSubStatusStyle}
    />
  );
});

// ---------------------------------------------------------------------------
// Column Priority Filter Helpers & Dropdown
// ---------------------------------------------------------------------------
const matchesPriorityFilter = (task: TaskMapItem, filter: string) => {
  if (!filter || filter === 'ALL') return true;
  const p = (task.priority || '').toUpperCase();
  if (filter === 'URGENT') {
    return isTaskUrgent(task);
  }
  if (filter === 'HIGH') {
    return isTaskHigh(task);
  }
  if (filter === 'NORMAL') {
    return p === 'NORMAL' || p === 'MEDIUM';
  }
  if (filter === 'LOW') {
    return p === 'LOW';
  }
  return true;
};

const matchesSearchFilter = (task: TaskMapItem, query?: string) => {
  if (!query || !query.trim()) return true;
  if (matchesTaskLinkOrId(task, query)) return true;
  const q = query.trim().toLowerCase();
  const title = (task.title || '').toLowerCase();
  const clientName = (task.list?.name || '').toLowerCase();
  const folderName = (task.list?.folder?.name || '').toLowerCase();
  const desc = (task.description || '').toLowerCase();
  const statuses = (task.taskMap?.statuses || []).map((s: string) => (s || '').toLowerCase());

  const basicMatch =
    title.includes(q) ||
    clientName.includes(q) ||
    folderName.includes(q) ||
    desc.includes(q) ||
    statuses.some((s: string) => s.includes(q));

  if (basicMatch) return true;

  if (q.includes('admin') || q === 'adm') {
    return isTaskUnderAdmin(task);
  }

  if (q.includes('xfinite') || q.includes('xfnite')) {
    return (
      title.includes('xfnite') ||
      title.includes('xfinite') ||
      clientName.includes('xfnite') ||
      clientName.includes('xfinite')
    );
  }

  if (q.includes('vip')) {
    return title.includes('vip') || clientName.includes('vip');
  }

  return false;
};

const getColumnPriorityCounts = (items: TaskMapItem[]) => {
  const counts = { ALL: items.length, URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
  for (const t of items) {
    const p = (t.priority || '').toUpperCase();
    if (isTaskUrgent(t)) counts.URGENT++;
    else if (isTaskHigh(t)) counts.HIGH++;
    else if (p === 'NORMAL' || p === 'MEDIUM') counts.NORMAL++;
    else if (p === 'LOW') counts.LOW++;
  }
  return counts;
};

const ColumnPriorityDropdown: React.FC<{
  columnId: string;
  tasks: TaskMapItem[];
  activeFilter: string;
  onSelectFilter: (columnId: string, filter: string) => void;
}> = ({ columnId, tasks, activeFilter, onSelectFilter }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const counts = getColumnPriorityCounts(tasks);
  const currentKey = activeFilter || 'ALL';

  const calcPos = (rect: DOMRect) => {
    const width = 160;
    const height = 220;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - height - 4);
    }
    // Open to the right away from the sidebar!
    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - width - 10);
    }
    return { top, left };
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pos = calcPos(rect);
    setCoords(pos);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCoords(null);
      }
    };
    const handleScrollOrResize = (e?: Event) => {
      // Don't close if the scroll happened inside the portal dropdown itself
      if (e && dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
      setCoords(null);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const getDisplayDetails = () => {
    switch (currentKey) {
      case 'URGENT':
        return {
          label: 'Urgent',
          flagClass: 'text-red-500 dark:text-red-400',
          btnClass: 'bg-red-100 hover:bg-red-200 text-red-700 border-red-300 dark:bg-red-950/70 dark:hover:bg-red-950 dark:text-red-200 dark:border-red-700/80',
          badgeClass: 'bg-red-200/60 text-red-800 dark:bg-black/40 dark:text-red-300',
          count: counts.URGENT,
        };
      case 'HIGH':
        return {
          label: 'High',
          flagClass: 'text-amber-500 dark:text-amber-400',
          btnClass: 'bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:hover:bg-amber-950 dark:text-amber-200 dark:border-amber-700/80',
          badgeClass: 'bg-amber-200/60 text-amber-900 dark:bg-black/40 dark:text-amber-300',
          count: counts.HIGH,
        };
      case 'NORMAL':
        return {
          label: 'Normal',
          flagClass: 'text-blue-500 dark:text-blue-400',
          btnClass: 'bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 dark:bg-blue-950/70 dark:hover:bg-blue-950 dark:text-blue-200 dark:border-blue-700/80',
          badgeClass: 'bg-blue-200/60 text-blue-800 dark:bg-black/40 dark:text-blue-300',
          count: counts.NORMAL,
        };
      case 'LOW':
        return {
          label: 'Low',
          flagClass: 'text-zinc-500 dark:text-zinc-400',
          btnClass: 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 dark:border-zinc-700',
          badgeClass: 'bg-zinc-200 text-zinc-700 dark:bg-black/40 dark:text-zinc-300',
          count: counts.LOW,
        };
      default:
        return {
          label: '',
          flagClass: 'text-zinc-400',
          btnClass: 'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700',
          badgeClass: 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/60',
          count: counts.ALL,
        };
    }
  };

  const details = getDisplayDetails();

  return (
    <div
      className="relative inline-block text-left shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${details.btnClass}`}
        title={details.label ? `Filtered by ${details.label}` : "Filter by priority"}
      >
        <Flag className={`size-3 shrink-0 ${details.flagClass}`} />
        {details.label && <span className="font-semibold">{details.label}</span>}
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            className="w-40 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
          >
            {/* All */}
            <button
              type="button"
              onClick={() => {
                onSelectFilter(columnId, 'ALL');
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'ALL'
                ? 'bg-zinc-800 text-zinc-100 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-zinc-500 shrink-0" />
                <span className="truncate">All</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400">
                  {counts.ALL}
                </span>
                {currentKey === 'ALL' && <Check className="size-3.5 text-blue-400" />}
              </div>
            </button>

            {/* Urgent */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'URGENT' ? 'ALL' : 'URGENT';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'URGENT'
                ? 'bg-red-950/60 text-red-200 border border-red-700/60 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-red-400 shrink-0" />
                <span className="truncate">Urgent</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'URGENT'
                    ? 'bg-red-900/50 text-red-300'
                    : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.URGENT}
                </span>
                {currentKey === 'URGENT' && <Check className="size-3.5 text-red-400" />}
              </div>
            </button>

            {/* High */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'HIGH' ? 'ALL' : 'HIGH';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'HIGH'
                ? 'bg-amber-950/60 text-amber-200 border border-amber-700/60 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-amber-400 shrink-0" />
                <span className="truncate">High</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'HIGH'
                    ? 'bg-amber-900/50 text-amber-300'
                    : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.HIGH}
                </span>
                {currentKey === 'HIGH' && <Check className="size-3.5 text-amber-400" />}
              </div>
            </button>

            {/* Normal */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'NORMAL' ? 'ALL' : 'NORMAL';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'NORMAL'
                ? 'bg-blue-950/60 text-blue-200 border border-blue-700/60 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-blue-400 shrink-0" />
                <span className="truncate">Normal</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'NORMAL'
                    ? 'bg-blue-900/50 text-blue-300'
                    : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.NORMAL}
                </span>
                {currentKey === 'NORMAL' && <Check className="size-3.5 text-blue-400" />}
              </div>
            </button>

            {/* Low */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'LOW' ? 'ALL' : 'LOW';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'LOW'
                ? 'bg-zinc-800 text-zinc-200 border border-zinc-700 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-zinc-400 shrink-0" />
                <span className="truncate">Low</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'LOW'
                    ? 'bg-zinc-700 text-zinc-300'
                    : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.LOW}
                </span>
                {currentKey === 'LOW' && <Check className="size-3.5 text-zinc-400" />}
              </div>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};

const CardTransferDropdown: React.FC<{
  taskId: string;
  currentAssigneeId?: string | null;
  users: any[];
  onTransfer: (targetUserId: string) => Promise<void> | void;
}> = ({ currentAssigneeId, users, onTransfer }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const calcPos = (rect: DOMRect) => {
    const width = 232;
    const height = 280;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - height - 4);
    }
    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - width - 10);
    }
    return { top, left };
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      setSearchQuery('');
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords(calcPos(rect));
    setSearchQuery('');
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCoords(null);
      }
    };
    const handleScrollOrResize = (e?: Event) => {
      if (e && dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
      setCoords(null);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const filteredUsers = useMemo(() => {
    const clean = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (!u || !u.id || isSystemUser(u)) return false;
      if (!clean) return true;
      return (u.name || '').toLowerCase().includes(clean) || (u.email || '').toLowerCase().includes(clean);
    });
  }, [users, searchQuery]);

  return (
    <div
      className="relative inline-flex items-center shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={isSubmitting}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold border transition-all cursor-pointer select-none leading-none ${
          isOpen
            ? 'bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/30'
            : 'bg-blue-500/15 text-blue-300 border-blue-500/35 hover:bg-blue-500/25 hover:text-white hover:border-blue-400/70'
        }`}
        title="Transfer task to another MA (lands in To Do)"
        aria-label="Transfer to..."
      >
        <ArrowRightLeft className="size-2.5 shrink-0" />
        <span>Transfer</span>
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            className="w-58 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 text-zinc-200 animate-in fade-in zoom-in-95 duration-75"
          >
            <div className="px-2 pt-1 pb-1 border-b border-zinc-800/80 flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Transfer to...
              </span>
              <span className="text-[9px] text-zinc-500">Lands in To Do</span>
            </div>

            {users.length > 5 && (
              <div className="px-1 pt-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <Search className="size-3 text-zinc-500 shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search MA..."
                    className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                  />
                </div>
              </div>
            )}

            <div className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 p-0.5">
              {filteredUsers.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic text-center py-4">No matching MAs</p>
              ) : (
                filteredUsers.map((u) => {
                  const isCurrent = Boolean(currentAssigneeId && currentAssigneeId === u.id);
                  const initials = (u.name || 'U').substring(0, 2).toUpperCase();
                  const avatarBg = getAssigneeAvatarColor(u.name || 'U');
                  return (
                    <button
                      key={u.id}
                      type="button"
                      disabled={isCurrent || isSubmitting}
                      onClick={async () => {
                        setIsOpen(false);
                        setCoords(null);
                        setIsSubmitting(true);
                        try {
                          await onTransfer(u.id);
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                        isCurrent
                          ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed'
                          : 'text-zinc-200 hover:bg-zinc-800/80 hover:text-white cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {u.avatarUrl ? (
                          <img
                            src={u.avatarUrl}
                            alt={u.name}
                            className="size-5 rounded-full object-cover shrink-0 border border-zinc-700/80"
                          />
                        ) : (
                          <span
                            className={`size-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${avatarBg}`}
                          >
                            {initials}
                          </span>
                        )}
                        <span className="truncate font-medium">{u.name}</span>
                      </div>
                      {isCurrent && (
                        <span className="text-[9px] uppercase font-semibold text-zinc-500 shrink-0">
                          Current
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export const TaskMapBoardView: React.FC<Props> = ({
  tasks = [],
  availablePool = [],
  allAvailablePool,
  allTasks,
  options = [],
  allUsers = [],
  shiftUsers = [],
  currentShift,
  onStatusChange,
  onOptionsUpdated,
  onOpenDetail,
  onDataRefresh,
  showAdminTasks,
  onToggleAdminTasks,
  selectedCustomMAs = [],
  clients = [],
  onTaskUpdate,
  onAssignTask,
  onOptimisticClockOut,
  onTransferTask,
  currentDate,
  isHistory = false,
  search = '',
  trackFilter = 'ALL',
  maSortMode = 'DEFAULT',
  superviseChecks = [],
  onSuperviseCheck,
  onSuperviseUncheck,
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const workspaceUsers = useAppStore((s) => s.workspaceUsers) || [];
  const workspaceTeams = useAppStore((s) => s.workspaceTeams) || [];
  const workspaceRoles = useAppStore((s) => s.workspaceRoles) || [];
  const upworkClients = useAppStore((s) => s.upworkClients);
  const upworkProjectClients = useAppStore((s) => s.upworkProjectClients);
  const maActiveSessions = useAppStore((s) => s.maActiveSessions);
  const isPmUser = isProjectManagerOrAdmin(currentUser);

  const boardScrollRef = useRef<HTMLDivElement>(null);
  useHorizontalScroll(boardScrollRef);

  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    return attachDragToScroll(el);
  }, []);

  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);
  const remainingAvailableSubtasks = useMemo(() => {
    if (!activeDragTask || activeDragTask.isSubtask) return [];
    return availablePool.filter(
      (sub) =>
        sub.isSubtask &&
        sub.parentTaskId === activeDragTask.id &&
        !sub.isClosed &&
        !sub.assigneeId
    );
  }, [activeDragTask, availablePool]);
  const [localShowAdmin, setLocalShowAdmin] = useState(false);
  const [selectedClients, setSelectedClients] = useState<string[] | 'ALL'>('ALL');
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
  const [columnTaskTypeFilters, setColumnTaskTypeFilters] = useState<Record<string, string>>({});
  const [columnSubStatusFilters, setColumnSubStatusFilters] = useState<Record<string, string>>({});
  const [columnClientFilters, setColumnClientFilters] = useState<Record<string, string[] | 'ALL'>>({});
  const [columnShowAdmin, setColumnShowAdmin] = useState<Record<string, boolean>>({});
  const [columnSearches, setColumnSearches] = useState<Record<string, string>>({});
  const [columnSearchOpen, setColumnSearchOpen] = useState<Record<string, boolean>>({});
  const [pinnedColumns, setPinnedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_taskmap_pinned_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [clientOtpModal, setClientOtpModal] = useState<{
    isOpen: boolean;
    clientName: string;
    taskId: string;
    targetUserId: string | null;
    mode: 'IN_PROGRESS' | 'QUEUE';
    nextRoles?: string[];
    hoursLogged?: number;
    weeklyLimit?: number;
  }>({
    isOpen: false,
    clientName: '',
    taskId: '',
    targetUserId: null,
    mode: 'QUEUE',
  });

  const [deliverablesModalTarget, setDeliverablesModalTarget] = useState<{
    task: TaskMapItem;
    targetStatus: 'To Review' | 'Hand-over' | 'Paused' | string;
    user?: any;
    nextStatuses?: string[];
    realTaskId?: string;
    queueTargetUserId?: string;
  } | null>(null);
  const [inactiveMaModal, setInactiveMaModal] = useState<{
    isOpen: boolean;
    targetUserId: string;
    targetUserName: string;
    taskTitle: string;
    reason: string;
    elapsedLabel?: string | null;
    recentRows?: SheetActivityLogRow[];
    source?: 'GOOGLE_SHEET' | 'DAILY_SHEET_LOG' | 'NONE';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [subStatusGuideTarget, setSubStatusGuideTarget] = useState<{
    task: TaskMapItem;
    guide: SubStatusTransitionGuide;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const submittingDeliverablesRef = useRef<Set<string>>(new Set());
  const recentlyClockedOutRef = useRef<Map<string, number>>(new Map());
  const collapsedStorageKey = currentUser?.id
    ? `nexus_taskmap_collapsed_columns_v2_${currentUser.id}`
    : 'nexus_taskmap_collapsed_columns_v2';

  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const key = currentUser?.id
        ? `nexus_taskmap_collapsed_columns_v2_${currentUser.id}`
        : 'nexus_taskmap_collapsed_columns_v2';
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !currentUser?.id) return;
    try {
      const saved = localStorage.getItem(`nexus_taskmap_collapsed_columns_v2_${currentUser.id}`);
      setCollapsedColumns(saved ? JSON.parse(saved) : {});
    } catch {
      setCollapsedColumns({});
    }
  }, [currentUser?.id]);

  const [actionError, setActionError] = useState<ActionErrorInfo | null>(null);
  const [recentlyMovedToReviewByUser, setRecentlyMovedToReviewByUser] = useState<Record<string, TaskMapItem[]>>({});

  // Low-frequency heartbeat (every 5 minutes) for 14h staleness boundary checks; active elapsed timers self-update via liveClock
  const [stalenessTick, setStalenessTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStalenessTick((prev) => prev + 1), 300000);
    return () => clearInterval(timer);
  }, []);

  const boardTime = useMemo(() => getCurrentLiveTime(), [tasks, availablePool, stalenessTick]);

  const togglePinColumn = (columnId: string) => {
    setPinnedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_taskmap_pinned_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save pinned columns', e);
      }
      return next;
    });
  };

  const toggleCollapseColumn = (columnId: string) => {
    setCollapsedColumns((prev) => {
      const currentlyCollapsed = resolveColumnCollapsedState(
        columnId,
        prev,
        currentUser?.id,
        isPmUser
      );
      const next = { ...prev, [columnId]: !currentlyCollapsed };
      try {
        localStorage.setItem(collapsedStorageKey, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save collapsed columns', e);
      }
      return next;
    });
  };

  const handleResetColumn = async (colUserId: string, userName?: string) => {
    // 1. Find all tasks in this column that are not active live working
    const colTasks = tasks.filter((t) => t.assignee?.id === colUserId || (t.assignees || []).some((u) => u.id === colUserId));
    const tasksToReset = colTasks.filter((t) => {
      const s = (t.status || '').toUpperCase();
      if (s === 'CLOSED' || s === 'DONE') return false;
      return !isTaskLiveWorking(t, userName);
    });

    if (tasksToReset.length === 0) {
      toast.info(`No pending tasks to reset in ${userName || 'this'}'s column`);
      return;
    }

    // 2. Optimistically unassign and move to available pool
    for (const t of tasksToReset) {
      t.assignee = null;
      t.assigneeId = null;
      t.assignees = [];
      t.status = 'PENDING';
      if (t.taskMap) {
        t.taskMap.statuses = ['Available Task'];
      }
    }

    toast.success(`Reset ${userName || 'column'}: ${tasksToReset.length} pending task(s) returned to Available tasks`);

    // 3. Persist to backend
    try {
      await taskMapApi.resetColumnTasks(colUserId, 'BOARD');
      onDataRefresh();
    } catch (err: any) {
      console.error('Failed to reset column on server:', err);
      toast.error('Failed to reset column tasks on server');
    }
  };

  const toggleColumnSearch = (columnId: string) => {
    setColumnSearchOpen((prev) => {
      const nextOpen = !prev[columnId];
      if (!nextOpen) {
        setColumnSearches((s) => {
          if (!s[columnId]) return s;
          const copy = { ...s };
          delete copy[columnId];
          return copy;
        });
      }
      return { ...prev, [columnId]: nextOpen };
    });
  };

  const handleColumnSearchChange = (columnId: string, query: string) => {
    setColumnSearches((prev) => ({
      ...prev,
      [columnId]: query,
    }));
  };

  const handleSelectPriorityFilter = (columnId: string, filter: string) => {
    setColumnPriorityFilters((prev) => ({
      ...prev,
      [columnId]: filter,
    }));
  };

  const handleSelectTaskTypeFilter = (columnId: string, filter: string) => {
    setColumnTaskTypeFilters((prev) => ({
      ...prev,
      [columnId]: filter,
    }));
  };

  const handleSelectSubStatusFilter = (columnId: string, filter: string) => {
    setColumnSubStatusFilters((prev) => ({
      ...prev,
      [columnId]: filter,
    }));
  };

  const effectiveShowAdmin = showAdminTasks !== undefined ? showAdminTasks : localShowAdmin;

  // Filter tasks by Admin and Client visibility (default: both checked) and include Pending, Revision, Waiting, and On-hold statuses
  const displayPool = React.useMemo(() => {
    return availablePool.filter((t) => {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        x.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );

      // Exclude from available pool if routed to a specific handler via PM assignment or direct latest assignee (unless handed over)
      if (getEffectiveTaskMapHandlerId(t)) return false;

      // Exclude from available pool if task is actively live working right now on a user column
      const hasActiveWorker = Boolean(
        t.progress?.maName &&
        !t.progress?.timeOut &&
        isTaskLiveWorking(t, t.progress.maName, boardTime) &&
        (shiftUsers.some((u) => doesProgressMatchUser(t.progress?.maName, u.name)) ||
          (allUsers && allUsers.some((u) => doesProgressMatchUser(t.progress?.maName, u.name))))
      );
      if (hasActiveWorker) return false;

      // Exclude from available pool if task was explicitly queued/assigned to an active shift user by a PM (unless handed over)
      const isQueuedByPm =
        !isTaskHandedOver(t) &&
        Boolean(
          (shiftUsers && shiftUsers.some((u) => hasPmAssignmentForUser(t, u.id))) ||
          (allUsers && allUsers.some((u) => hasPmAssignmentForUser(t, u.id)))
        );
      if (isQueuedByPm) return false;

      const isExcluded =
        s === 'WAITING' ||
        s.includes('WAITING') ||
        s === 'CRM' ||
        s.includes('CRM') ||
        s === 'INREVIEW' ||
        s === 'TOREVIEW' ||
        s === 'REVIEW' ||
        s === 'CHECKING' ||
        s === 'INCHECKING' ||
        s === 'DAILY' ||
        s.includes('DAILY') ||
        s === 'WEEKLY' ||
        s.includes('WEEKLY') ||
        s === 'MONTHLY' ||
        s.includes('MONTHLY') ||
        s === 'RECURRING' ||
        s.includes('RECURRING') ||
        !!(t as any)?.recurringConfig ||
        mapStatuses.some((st: string) =>
          ['WAITING', 'CRM', 'ASKCLIENT', 'READYTOSEND', 'TOSEND', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(st) ||
          st.includes('WAITING') ||
          st.includes('CRM') ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING')
        );
      if (isExcluded) return false;

      // Admin task check
      const isAdmin = isTaskUnderAdmin(t);
      if (isAdmin) {
        return effectiveShowAdmin;
      }

      // Non-admin client task check
      if (selectedClients === 'ALL') return true;
      const clientId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
      const clientName = t.list?.name || 'General';
      return selectedClients.includes(clientId) || selectedClients.includes(clientName);
    });
  }, [availablePool, effectiveShowAdmin, selectedClients]);

  // DnD sensors (memoized so DndContext never re-binds sensors during drag)
  const pointerSensorOptions = useMemo(() => ({
    activationConstraint: {
      distance: 6,
    },
  }), []);
  const sensors = useSensors(
    useSensor(PointerSensor, pointerSensorOptions),
    useSensor(KeyboardSensor)
  );

  // Pointer-first collision detection: prioritizes nested in-progress-<userId> dropzones over parent user-<userId> columns
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      const inProgressHits = pointerCollisions.filter((c) => String(c.id).startsWith('in-progress-'));
      if (inProgressHits.length > 0) {
        return inProgressHits;
      }
      return pointerCollisions;
    }
    const rectCollisions = rectIntersection(args);
    if (rectCollisions.length > 0) {
      const inProgressHits = rectCollisions.filter((c) => String(c.id).startsWith('in-progress-'));
      if (inProgressHits.length > 0) {
        return inProgressHits;
      }
      return rectCollisions;
    }
    return closestCenter(args);
  }, []);

  // Helper to find full user profile
  const getUserProfile = (userId: string, fallbackUser?: any) => {
    const fromShift = shiftUsers.find((u) => u.id === userId);
    if (fromShift) return fromShift;
    const fromAll = allUsers.find((u) => u.id === userId);
    if (fromAll) return fromAll;
    const fromStore = workspaceUsers.find((u) => u.id === userId);
    if (fromStore) return fromStore;
    if (currentUser?.id === userId) return currentUser;
    return fallbackUser || { id: userId, name: fallbackUser?.name || 'User' };
  };

  // Helper to check if a task has an excluded cadence status for user shift columns:
  // User columns must not show daily, monthly, weekly, or recurring tasks UNLESS an MA is actively working on it or has logged progress!
  const isExcludedCadenceForUser = (task: TaskMapItem) => {
    const s = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (task.taskMap?.statuses || []).map((x: string) =>
      (x || '').trim().toUpperCase().replace(/[\s_-]+/g, '')
    );

    const isExcludedStatus = (str: string) => {
      return (
        str === 'DAILY' ||
        str.includes('DAILY') ||
        str === 'WEEKLY' ||
        str.includes('WEEKLY') ||
        str === 'MONTHLY' ||
        str.includes('MONTHLY') ||
        str === 'RECURRING' ||
        str.includes('RECURRING')
      );
    };

    return (
      isExcludedStatus(s) ||
      !!(task as any)?.recurringConfig ||
      mapStatuses.some((st: string) => isExcludedStatus(st))
    );
  };

  const isExcludedForUser = (task: TaskMapItem) => {
    if (isOtherBoardWorkflowStatus(task)) return true;
    if (task.progress?.timeIn || task.progress?.maName) {
      return false;
    }
    return isExcludedCadenceForUser(task);
  };

  const cleanSearch = (search || '').trim().toLowerCase();

  // Memoize column construction, progress attachment, and sorting so drag-over hover updates never recompute the entire board
  const { poolIds, sortedUserColumns } = useMemo(() => {
    const userColumnsMap: Record<string, { user: any; tasks: TaskMapItem[] }> = {};

    const isSystemAccount = (u: any) => {
      const email = (u?.email || '').toLowerCase();
      const name = (u?.name || '').toLowerCase();
      return (
        email.endsWith('@system.local') ||
        name === 'clickup' ||
        name === 'vip scale' ||
        name === 'vipscale'
      );
    };

    const shiftTokens = (currentShift || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const isAllShifts = shiftTokens.length === 0 || shiftTokens.includes('ALL');
    const isCustomShift = shiftTokens.includes('CUSTOM');
    const allowNonShiftColumns = isAllShifts || isCustomShift || trackFilter !== 'ALL';

    // When viewing All shifts, Custom, or filtering by Live/Active, include all non-system workspace users;
    // when viewing a specific Audit Shift (e.g. Morning, Afternoon, Night), strictly base columns on shiftUsers.
    const baseUsers =
      allowNonShiftColumns && allUsers && allUsers.length > 0 ? allUsers : shiftUsers;

    baseUsers.forEach((u) => {
      if (!u || !u.id || isSystemAccount(u)) return;
      userColumnsMap[u.id] = {
        user: getUserProfile(u.id, u),
        tasks: [],
      };
    });

    if (isAllShifts && allUsers) {
      allUsers.forEach((u) => {
        if (!u || !u.id || isSystemAccount(u)) return;
        if (!userColumnsMap[u.id]) {
          userColumnsMap[u.id] = {
            user: getUserProfile(u.id, u),
            tasks: [],
          };
        }
      });
    }

    // Ensure the logged-in user, live-working users, active sessions, and searched users from allUsers
    // are only injected when not strictly scoped to a specific Audit Shift.
    if (allowNonShiftColumns) {
      if (currentUser?.id && !isSystemAccount(currentUser) && !userColumnsMap[currentUser.id]) {
        userColumnsMap[currentUser.id] = {
          user: getUserProfile(currentUser.id, currentUser),
          tasks: [],
        };
      }

      [...tasks, ...availablePool].forEach((t) => {
        if (t.progress?.maName && !t.progress?.timeOut && isTaskLiveWorking(t, t.progress.maName, boardTime) && allUsers) {
          const matchingUser = findBestUserMatch(t.progress.maName, allUsers, (u) => !isSystemAccount(u));
          if (matchingUser && !userColumnsMap[matchingUser.id]) {
            userColumnsMap[matchingUser.id] = {
              user: getUserProfile(matchingUser.id, matchingUser),
              tasks: [],
            };
          }
        }
      });

      Object.values(maActiveSessions || {}).forEach((sess: any) => {
        if (sess?.maName && (sess?.active || sess?.timeIn || sess?.timeOut || sess?.client || sess?.taskName) && allUsers) {
          const matchingUser = findBestUserMatch(sess.maName, allUsers, (u) => !isSystemAccount(u));
          if (matchingUser && !userColumnsMap[matchingUser.id]) {
            userColumnsMap[matchingUser.id] = {
              user: getUserProfile(matchingUser.id, matchingUser),
              tasks: [],
            };
          }
        }
      });
    }

    const isUserSearchMatch = (u: any) => {
      if (!cleanSearch || !u) return false;
      return matchesMarketingNameSearch(u, cleanSearch);
    };

    if (allowNonShiftColumns && cleanSearch && allUsers && allUsers.length > 0) {
      allUsers.forEach((u) => {
        if (!u || !u.id || isSystemAccount(u)) return;
        if (isUserSearchMatch(u) && !userColumnsMap[u.id]) {
          userColumnsMap[u.id] = {
            user: getUserProfile(u.id, u),
            tasks: [],
          };
        }
      });
    }

    const colEntries = Object.entries(userColumnsMap);
    const findColumnForMa = (maName?: string | null) => {
      if (!maName) return undefined;
      const matchedUser = findBestUserMatch(
        maName,
        colEntries.map(([, c]) => c.user)
      );
      if (!matchedUser) return undefined;
      return colEntries.find(([, c]) => c.user.id === matchedUser.id);
    };

    const nextPoolIds = new Set(
      availablePool
        .filter((p) => {
          const workerCol = p.progress?.maName && !p.progress?.timeOut ? findColumnForMa(p.progress.maName) : undefined;
          const isLiveWorkingOnCol = Boolean(
            workerCol && isTaskLiveWorking(p, workerCol[1].user.name, boardTime)
          );
          const handlerId = getEffectiveTaskMapHandlerId(p);
          const isAssignedToCol = Boolean(handlerId && userColumnsMap[handlerId]);
          return !isLiveWorkingOnCol && !isAssignedToCol;
        })
        .map((p) => p.id)
    );

    const attachTaskToUserColumns = (task: TaskMapItem) => {
      // Tasks moved to Auditor Map (To Review / In Review / Checking) or CRM Map (Waiting / CRM / Ask Client)
      // must NEVER remain in Task Map user/PM columns, even if prior progress exists.
      if (!task.isAssumptionBlock && isOtherBoardWorkflowStatus(task)) return;

      // Handed-over tasks must NEVER remain in user columns or queues
      if (!task.isAssumptionBlock && isTaskHandedOver(task)) return;

      const effectiveHandlerId = isHistory
        ? (task.assignee?.id || task.assigneeId || getEffectiveTaskMapHandlerId(task))
        : getEffectiveTaskMapHandlerId(task);
      const targetUser = effectiveHandlerId && effectiveHandlerId !== 'unassigned'
        ? userColumnsMap[effectiveHandlerId]?.user
        : undefined;
      const isAdmin = isTaskUnderAdmin(task);
      const isDev = isDeveloperUser(targetUser, workspaceTeams);
      const hasSheetInput = hasSpreadsheetTaskInput(task, { isHistory, now: boardTime, targetDate: currentDate });
      const isPausedTask = (task.taskMap?.statuses || []).some(
        (s) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'PAUSED'
      );
      const hasExplicitQueueAssignment = Boolean(
        effectiveHandlerId &&
        effectiveHandlerId !== 'unassigned' &&
        hasPmAssignmentForUser(task, effectiveHandlerId)
      );
      if (!effectiveShowAdmin && isAdmin && !isDev && !hasSheetInput && !isPausedTask && !hasExplicitQueueAssignment) return;
      if (nextPoolIds.has(task.id)) return;
      const hasProgress = Boolean(task.progress?.timeIn || task.progress?.maName);
      if (isClosedTask(task)) return;
      if (!hasProgress && isExcludedForUser(task)) return;

      // For hidden-by-default admin/dormant/startups/HR tasks inputted from the spreadsheet,
      // attach strictly to the MA column matching the spreadsheet input IF not handed over.
      if (!effectiveShowAdmin && isAdmin && !isDev && hasSheetInput) {
        if (isTaskHandedOver(task)) return;
        const workerCol = findColumnForMa(task.progress?.maName);
        if (
          effectiveHandlerId &&
          effectiveHandlerId !== 'unassigned' &&
          userColumnsMap[effectiveHandlerId] &&
          doesProgressMatchUser(task.progress?.maName, targetUser?.name)
        ) {
          if (!userColumnsMap[effectiveHandlerId].tasks.some((t) => t.id === task.id)) {
            userColumnsMap[effectiveHandlerId].tasks.push(task);
          }
        } else if (workerCol && !workerCol[1].tasks.some((t) => t.id === task.id)) {
          workerCol[1].tasks.push(task);
        }
        return;
      }

      if (effectiveHandlerId && effectiveHandlerId !== 'unassigned' && userColumnsMap[effectiveHandlerId]) {
        if (!isTaskHandedOver(task) && !userColumnsMap[effectiveHandlerId].tasks.some((t) => t.id === task.id)) {
          userColumnsMap[effectiveHandlerId].tasks.push(task);
        }
      }

      if (!isTaskHandedOver(task) && task.progress?.maName && !task.progress?.timeOut && isTaskLiveWorking(task, task.progress.maName, boardTime)) {
        const workerCol = findColumnForMa(task.progress.maName);
        if (workerCol && (!effectiveHandlerId || effectiveHandlerId === workerCol[0]) && !workerCol[1].tasks.some((t) => t.id === task.id)) {
          workerCol[1].tasks.push(task);
        }
      }
    };

    tasks.forEach(attachTaskToUserColumns);
    availablePool.forEach(attachTaskToUserColumns);

    const findActiveSessionForUser = (userName?: string | null) => {
      if (!userName || !maActiveSessions) return null;
      const cleanUser = userName.trim().toLowerCase();
      const direct = maActiveSessions[cleanUser];
      if (direct) return direct;

      const entries = Object.entries(maActiveSessions);
      const exactEntry = entries.find(([key, s]) => {
        const k = key.trim().toLowerCase();
        const m = ((s as any)?.maName || '').trim().toLowerCase();
        return k === cleanUser || m === cleanUser;
      });
      if (exactEntry) return exactEntry[1];

      const userParts = cleanUser.split(/\s+/);
      const tokenEntry = entries.find(([key, s]) => {
        const candidate = ((s as any)?.maName || key || '').trim().toLowerCase();
        return Boolean(candidate && userParts.some((p) => p === candidate));
      });
      if (tokenEntry) return tokenEntry[1];

      const fuzzyEntry = entries.find(
        ([key, session]) =>
          doesProgressMatchUser(key, userName) ||
          doesProgressMatchUser((session as any)?.maName, userName)
      );
      return fuzzyEntry ? fuzzyEntry[1] : null;
    };

    // 2.5 Ensure user columns reflect their latest MA schedule sheet input
    Object.entries(userColumnsMap).forEach(([userId, col]) => {
      const activeSession = findActiveSessionForUser(col.user.name) as any;
      const sessionStatusNorm = (activeSession?.status || activeSession?.taskStatus || '').toUpperCase().replace(/[\s_-]+/g, '');
      const isSessionClosed =
        ['CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED'].includes(sessionStatusNorm) ||
        Boolean(activeSession?.cleared);
      const hasHeldSession = Boolean(
        activeSession &&
        !isSessionClosed &&
        (activeSession.active || activeSession.timeIn || activeSession.timeOut || activeSession.client || activeSession.taskName)
      );

      const rawClient = activeSession?.client;
      const effectiveClient = rawClient && rawClient.toLowerCase() !== 'general' ? rawClient : 'No client inputted';
      const rawTask = activeSession?.taskName;
      const effectiveTask = rawTask && rawTask.toLowerCase() !== 'general task' ? rawTask : 'No task inputted';

      const cleanSessionTask = effectiveTask.replace(/\.{3}$/, '').trim().toLowerCase();
      const cleanSessionClient = effectiveClient.trim().toLowerCase();

      // Check if col.tasks already has this task (so we don't synthesize duplicate assumption cards)
      const hasAlreadyInColumn = col.tasks.some((t) => {
        if (activeSession?.taskId && (t.id === activeSession.taskId || t.subtaskId === activeSession.taskId)) return true;
        if (activeSession?.subtaskId && t.subtaskId === activeSession.subtaskId) return true;
        if (cleanSessionTask && cleanSessionTask !== 'no task inputted') {
          const tTitle = (t.title || '').trim().toLowerCase();
          if (tTitle === cleanSessionTask) return true;
        }
        return false;
      });

      // Enrich existing card in col.tasks if it lacks live progress
      if (hasAlreadyInColumn && activeSession && (activeSession.timeIn || activeSession.timeOut)) {
        const existing = col.tasks.find((t) =>
          (activeSession?.taskId && (t.id === activeSession.taskId || t.subtaskId === activeSession.taskId)) ||
          (activeSession?.subtaskId && t.subtaskId === activeSession.subtaskId) ||
          (cleanSessionTask && cleanSessionTask !== 'no task inputted' && (t.title || '').trim().toLowerCase() === cleanSessionTask)
        );
        if (existing && !existing.progress) {
          existing.progress = {
            maName: col.user.name,
            timeIn: activeSession.timeIn || null,
            timeOut: activeSession.timeOut || null,
            date: activeSession.date || format(boardTime, 'yyyy-MM-dd'),
            client: activeSession.client || existing.list?.name || null,
            status: activeSession.status || null,
            sheetRow: activeSession.rowNumber ? Number(activeSession.rowNumber) : undefined,
            isMissingTime: false,
            isUpwork: Boolean(activeSession.isUpwork),
            timeTracker: null,
          };
        }
      }

      // Only suppress the fallback block if col.tasks ALREADY has a live card belonging to THIS user (not another MA's progress)
      const hasActiveAssignedTask = col.tasks.some((t) => {
        const isMyProg = doesProgressMatchUser(t.progress?.maName, col.user.name);
        if (!isMyProg || !t.progress?.timeIn || t.progress?.timeOut || t.progress?.isMissingTime) return false;
        if (isStaleLiveSession(t.progress.timeIn, t.progress.date, boardTime)) return false;
        if (activeSession?.rowNumber && t.progress?.sheetRow) {
          return Number(t.progress.sheetRow) === Number(activeSession.rowNumber);
        }
        return Boolean(activeSession?.taskId && t.id === activeSession.taskId);
      });

      if (hasHeldSession && !hasActiveAssignedTask && !hasAlreadyInColumn) {
        const matchedLocalTask = [...tasks, ...availablePool].find((t) => {
          if (activeSession?.taskId && (t.id === activeSession.taskId || t.subtaskId === activeSession.taskId)) {
            return true;
          }
          if (activeSession?.subtaskId && t.subtaskId === activeSession.subtaskId) {
            return true;
          }
          if (!cleanSessionTask || cleanSessionTask === 'no task inputted') return false;
          const tTitle = (t.title || '').trim().toLowerCase();
          if (!tTitle || (tTitle !== cleanSessionTask && !tTitle.includes(cleanSessionTask))) return false;
          if (!cleanSessionClient || cleanSessionClient === 'no client inputted') return tTitle === cleanSessionTask;
          const tClient = (t.list?.name || '').trim().toLowerCase();
          return tClient === cleanSessionClient || tClient.startsWith(cleanSessionClient);
        });

        const generalBlock = createEmptyUserBlock({
          userId,
          userName: col.user.name,
          client: effectiveClient,
          taskTitle: effectiveTask,
          day: activeSession?.date || format(boardTime, 'yyyy-MM-dd'),
          timeIn: activeSession?.timeIn || null,
          timeOut: activeSession?.timeOut || null,
          status: activeSession?.status || (activeSession?.timeOut ? 'CLOSED' : 'IN PROGRESS'),
          taskStatus: activeSession?.taskStatus || matchedLocalTask?.status || null,
          priority: activeSession?.priority || matchedLocalTask?.priority || null,
          subStatuses: Array.isArray(activeSession?.subStatuses)
            ? activeSession.subStatuses
            : (matchedLocalTask?.taskMap?.statuses ?? null),
          taskId: activeSession?.taskId || matchedLocalTask?.id || null,
          listId: activeSession?.listId || matchedLocalTask?.listId || matchedLocalTask?.list?.id || null,
          listStatuses: activeSession?.listStatuses || matchedLocalTask?.list?.statuses,
          isUpwork: Boolean(activeSession?.isUpwork),
          rowNumber: activeSession?.rowNumber,
        });

        col.tasks.unshift(generalBlock);
      }
    });

    // 2.7 Sanitize worker column progress
    Object.values(userColumnsMap).forEach((col) => {
      const workerName = col.user?.name;
      if (!workerName) return;

      const rowLatestMap = new Map<number, { taskId: string; updatedAt: number }>();
      col.tasks.forEach((t) => {
        if (t.progress?.sheetRow && doesProgressMatchUser(t.progress?.maName, workerName)) {
          const row = Number(t.progress.sheetRow);
          const time = t.progress.updatedAt ? new Date(t.progress.updatedAt).getTime() : 0;
          const cur = rowLatestMap.get(row);
          if (!cur || time > cur.updatedAt) {
            rowLatestMap.set(row, { taskId: t.id, updatedAt: time });
          }
        }
      });

      col.tasks = col.tasks.map((t) => {
        if (t.progress?.sheetRow && doesProgressMatchUser(t.progress?.maName, workerName)) {
          const row = Number(t.progress.sheetRow);
          const winner = rowLatestMap.get(row);
          if (winner && winner.taskId !== t.id) {
            return { ...t, progress: null };
          }
        }
        return t;
      });

      let maxCompletedRow = -1;
      col.tasks.forEach((t) => {
        if (t.progress?.sheetRow && t.progress?.timeOut && doesProgressMatchUser(t.progress?.maName, workerName)) {
          const row = Number(t.progress.sheetRow);
          if (row > maxCompletedRow) maxCompletedRow = row;
        }
      });

      const activeSession = findActiveSessionForUser(workerName) as any;
      const effectiveMaxRow = Math.max(
        maxCompletedRow,
        activeSession?.rowNumber ? Number(activeSession.rowNumber) : -1
      );

      if (effectiveMaxRow > 0) {
        col.tasks = col.tasks.map((t) => {
          if (
            t.progress?.sheetRow &&
            Number(t.progress.sheetRow) < effectiveMaxRow &&
            t.progress.timeIn &&
            !t.progress.timeOut &&
            doesProgressMatchUser(t.progress.maName, workerName)
          ) {
            return {
              ...t,
              progress: {
                ...t.progress,
                timeOut: '11:59 PM',
              },
            };
          }
          return t;
        });
      }
    });

    const curUserId = currentUser?.id;
    const curUserName = (currentUser?.name || '').trim().toLowerCase();

    const isCurrentViewer = (u: any) => {
      if (!u) return false;
      if (curUserId && u.id === curUserId) return true;
      if (curUserName && (u.name || '').trim().toLowerCase() === curUserName) return true;
      return false;
    };

    const nextSortedUserColumns = Object.entries(userColumnsMap)
      .filter(([id, col]) => {
        // The current viewing user's own column must ALWAYS show no matter what filter is active
        if (isCurrentViewer(col.user)) {
          return true;
        }
        if (cleanSearch) {
          return isUserSearchMatch(col.user);
        }
        if (trackFilter !== 'ALL') {
          const userName = col.user?.name;
          const allItems = [...col.tasks, ...tasks, ...availablePool];
          const activeSession = findActiveSessionForUser(userName) as any;
          if (trackFilter === 'LIVE') {
            const hasLiveTask = allItems.some((t) => isTaskLiveWorking(t, userName, boardTime));
            const hasLiveSession = Boolean(
              activeSession &&
              activeSession.timeIn &&
              !activeSession.timeOut &&
              !activeSession.isMissingTime &&
              !isStaleLiveSession(activeSession.timeIn, activeSession.date, boardTime)
            );
            return hasLiveTask || hasLiveSession;
          }
          const targetDateForTrack = currentDate || boardTime;
          const hasLoggedTaskToday = allItems.some(
            (t) => doesProgressMatchUser(t.progress?.maName, userName) && isProgressLoggedToday(t.progress, targetDateForTrack)
          );
          const hasLoggedSessionToday = Boolean(
            activeSession &&
            (activeSession.timeIn || activeSession.timeOut) &&
            isProgressLoggedToday(activeSession, targetDateForTrack)
          );
          return hasLoggedTaskToday || hasLoggedSessionToday;
        }
        const activeShifts = (currentShift || '').toUpperCase().split(',').map((s) => s.trim());
        if (activeShifts.includes('CUSTOM') && selectedCustomMAs.length > 0) {
          return selectedCustomMAs.includes(id);
        }
        return true;
      })
      .sort(([idA, colA], [idB, colB]) => {
        const matchA = isUserSearchMatch(colA.user);
        const matchB = isUserSearchMatch(colB.user);

        if (matchA && !matchB) return -1;
        if (!matchA && matchB) return 1;

        if (matchA && matchB) {
          const nameA = (colA.user?.name || '').trim().toLowerCase();
          const nameB = (colB.user?.name || '').trim().toLowerCase();
          const exactA = nameA === cleanSearch;
          const exactB = nameB === cleanSearch;
          if (exactA && !exactB) return -1;
          if (!exactA && exactB) return 1;

          const startA = nameA.startsWith(cleanSearch);
          const startB = nameB.startsWith(cleanSearch);
          if (startA && !startB) return -1;
          if (!startA && startB) return 1;

          const isPinnedA = !!pinnedColumns[idA];
          const isPinnedB = !!pinnedColumns[idB];
          if (isPinnedA && !isPinnedB) return -1;
          if (!isPinnedA && isPinnedB) return 1;

          return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
        }

        const isPinnedA = !!pinnedColumns[idA];
        const isPinnedB = !!pinnedColumns[idB];

        if (isPinnedA && !isPinnedB) return -1;
        if (!isPinnedA && isPinnedB) return 1;

        if (maSortMode === 'QUEUE_DESC' || maSortMode === 'QUEUE_ASC') {
          const countA = countNonOnHoldTasks(colA.tasks);
          const countB = countNonOnHoldTasks(colB.tasks);
          if (countA !== countB) {
            return maSortMode === 'QUEUE_DESC' ? countB - countA : countA - countB;
          }
        }

        const isCurA = isCurrentViewer(colA.user);
        const isCurB = isCurrentViewer(colB.user);

        if (isCurA && !isCurB) return -1;
        if (!isCurA && isCurB) return 1;

        return (colA.user.name || '').localeCompare(colB.user.name || '', undefined, { sensitivity: 'base' });
      });

    return { poolIds: nextPoolIds, sortedUserColumns: nextSortedUserColumns };
  }, [
    tasks,
    availablePool,
    allUsers,
    shiftUsers,
    currentShift,
    maActiveSessions,
    cleanSearch,
    trackFilter,
    selectedCustomMAs,
    pinnedColumns,
    currentUser?.id,
    currentUser?.name,
    effectiveShowAdmin,
    workspaceTeams,
    boardTime,
    isHistory,
    maSortMode,
  ]);

  // When search changes and matches an MA, auto-scroll to the far left so the user immediately sees the column
  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  const transferableUsers = useMemo(() => {
    const map = new Map<string, any>();
    for (const u of [...shiftUsers, ...allUsers, ...sortedUserColumns.map(([, c]) => c.user)]) {
      if (!u || !u.id || isSystemUser(u)) continue;
      if (!map.has(u.id)) map.set(u.id, u);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    );
  }, [shiftUsers, allUsers, sortedUserColumns]);

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    if (isHistory) {
      toast.info('Historical Journal is read-only. Return to today to make changes.');
      return;
    }
    const task = event.active.data.current?.task as TaskMapItem;
    if (!task) return;

    const isFromAvailable = poolIds.has(task.id);
    const activeSourceUserId = event.active.data.current?.sourceUserId as string | null | undefined;
    const sourceOwnerId = isFromAvailable ? null : (activeSourceUserId ?? getEffectiveTaskMapHandlerId(task));
    if (
      !canDragTaskMapCard({
        isPmUser,
        currentUserId: currentUser?.id,
        columnUserId: sourceOwnerId,
        isFromAvailable,
        isAssumptionBlock: task.isAssumptionBlock,
      })
    ) {
      toast.error(
        isFromAvailable
          ? 'Only Project Managers and Admins can assign tasks from the Available column'
          : 'You can only drag tasks within your own column'
      );
      return;
    }

    setActiveDragTask(task);
  };

  const handleDragCancel = () => {
    setActiveDragTask(null);
  };

  // Dynamically resolve and ensure role restrictions for the assigned user:
  // When a user is assigned (e.g. dragged to Nyrry), immediately add their specified role
  // (role first) to the task's assigneeRoleRestrictions so role matching is seamless and never blocked.
  const getResolvedRoleRestrictionsForUser = (task: TaskMapItem | null | undefined, targetUser: any): string[] => {
    const existingRoles: string[] = Array.isArray((task as any)?.assigneeRoleRestrictions)
      ? [...(task as any).assigneeRoleRestrictions]
      : [];
    if (!targetUser) return existingRoles;

    const directMatch = resolveUsersFromRoleRestrictions(existingRoles, [targetUser], workspaceTeams);
    if (directMatch.length > 0) {
      return existingRoles;
    }

    const roleDef = getUserRoleDefinition(targetUser, workspaceTeams, workspaceRoles);
    const targetRole = roleDef?.mainRole || (targetUser.roles && targetUser.roles[0]) || targetUser.team?.name;
    if (targetRole && !existingRoles.some((r) => r.toLowerCase().trim() === targetRole.toLowerCase().trim())) {
      return [...existingRoles, targetRole];
    }
    return existingRoles;
  };

  const canAssignUserToTask = (_task: TaskMapItem | null | undefined, _targetUser: any): boolean => {
    return true;
  };

  const executeWithInactiveCheck = async (
    targetUserId: string,
    targetUser: any,
    taskTitle: string,
    proceedFn: () => Promise<void>
  ) => {
    try {
      const activity = await taskMapApi.checkUserSheetActivity(targetUserId).catch(() => null);
      if (activity?.isInactive) {
        setInactiveMaModal({
          isOpen: true,
          targetUserId,
          targetUserName: targetUser?.name || activity.userName || 'Team Member',
          taskTitle,
          reason: activity.reason,
          elapsedLabel: activity.elapsedLabel,
          recentRows: activity.recentRows,
          source: activity.source,
          onConfirm: proceedFn,
        });
        return;
      }
    } catch {
      // If activity lookup fails, proceed normally rather than blocking workflow
    }
    await proceedFn();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const dragTask = activeDragTask;
    setActiveDragTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const targetColumnId = over.id as string;
    const isFromAvailable = poolIds.has(taskId);

    const currentTask = dragTask || tasks.find((t) => t.id === taskId) || availablePool.find((t) => t.id === taskId);
    const activeSourceUserId = active.data.current?.sourceUserId as string | null | undefined;
    const sourceOwnerId = isFromAvailable ? null : (activeSourceUserId ?? getEffectiveTaskMapHandlerId(currentTask));
    const currentAssigneeId =
      currentTask?.assigneeId ||
      currentTask?.assignee?.id ||
      (currentTask?.assignees && currentTask.assignees[0]?.id);

    const dropPerm = canDropTaskMapCard({
      isPmUser,
      currentUserId: currentUser?.id,
      sourceUserId: sourceOwnerId,
      isFromAvailable,
      targetColumnId,
    });
    if (!dropPerm.allowed) {
      if (dropPerm.reason) {
        toast.error(dropPerm.reason);
      }
      return;
    }

    // Dropped on an In Progress slot: assign task to that user AND set status to In Progress
    if (targetColumnId.startsWith('in-progress-')) {
      const targetUserId = targetColumnId.replace('in-progress-', '');
      const targetUser = getUserProfile(targetUserId);

      // If already assigned to this user and already live working, no-op!
      if (currentAssigneeId === targetUserId && isTaskLiveWorking(currentTask as any, targetUser?.name, boardTime)) {
        return;
      }

      const nextRoles = getResolvedRoleRestrictionsForUser(currentTask, targetUser);
      const isCadence = ['DAILY', 'WEEKLY', 'MONTHLY'].includes((currentTask?.status || '').toUpperCase().trim());
      const subSuffix =
        remainingAvailableSubtasks.length > 0
          ? ` (+${remainingAvailableSubtasks.length} available subtask${remainingAvailableSubtasks.length > 1 ? 's' : ''})`
          : '';

      const runInProgressAssign = async () => {
        toast.success(
          (isCadence
            ? `Task assigned to ${targetUser?.name || 'user'}`
            : `Task set In Progress for ${targetUser?.name || 'user'}`) + subSuffix
        );
        try {
          if (onAssignTask) {
            await onAssignTask(taskId, targetUserId, 'IN_PROGRESS', nextRoles);
            if (remainingAvailableSubtasks.length > 0) {
              await Promise.all(
                remainingAvailableSubtasks.map((sub) =>
                  onAssignTask(sub.id, targetUserId, 'QUEUE', getResolvedRoleRestrictionsForUser(sub, targetUser))
                )
              );
            }
          } else {
            const nextStatus = isCadence ? toCanonicalTaskStatus(currentTask!.status) : 'IN PROGRESS';
            await taskMapApi.assignTask(taskId, targetUserId, 'IN_PROGRESS', { assigneeRoleRestrictions: nextRoles });
            if (onTaskUpdate) {
              await onTaskUpdate(taskId, { status: nextStatus, assigneeId: targetUserId, assigneeRoleRestrictions: nextRoles });
            } else {
              await tasksApi.updateTask(taskId, { status: nextStatus, assigneeId: targetUserId, assigneeRoleRestrictions: nextRoles } as any).catch(console.error);
            }
            if (remainingAvailableSubtasks.length > 0) {
              await Promise.all(
                remainingAvailableSubtasks.map((sub) =>
                  taskMapApi.assignTask(sub.id, targetUserId, 'QUEUE', {
                    assigneeRoleRestrictions: getResolvedRoleRestrictionsForUser(sub, targetUser),
                  })
                )
              );
            }
            onDataRefresh();
          }
        } catch (err: any) {
          const errData = err?.response?.data || err?.data;
          const isClientLocked =
            err?.isClientLocked ||
            errData?.isClientLocked ||
            errData?.error === 'CLIENT_LOCKED' ||
            err?.error === 'CLIENT_LOCKED' ||
            err?.message?.includes('CLIENT_LOCKED') ||
            err?.message?.toLowerCase().includes('exceeded weekly');
          if (isClientLocked) {
            const hoursLogged = err?.hoursLogged ?? errData?.hoursLogged;
            const weeklyLimit = err?.weeklyLimit ?? errData?.weeklyLimit;
            const hoursInfo =
              typeof hoursLogged === 'number' && typeof weeklyLimit === 'number'
                ? ` (${hoursLogged.toFixed(1)} / ${weeklyLimit.toFixed(1)} hrs)`
                : '';
            const clientName = err?.clientName || errData?.clientName || (currentTask as any)?.list?.name || (currentTask as any)?.listName || 'Client';
            toast.error(errData?.message || err?.message || `Client "${clientName}" is locked: exceeded weekly limit${hoursInfo}. PM OTP required.`);
            setClientOtpModal({
              isOpen: true,
              clientName,
              taskId,
              targetUserId,
              mode: 'IN_PROGRESS',
              nextRoles,
              hoursLogged,
              weeklyLimit,
            });
          } else {
            toast.error(err.message || 'Failed to set task In Progress');
          }
        }
      };

      if (sourceOwnerId !== targetUserId) {
        await executeWithInactiveCheck(targetUserId, targetUser, currentTask?.title || 'Task', runInProgressAssign);
      } else {
        await runInProgressAssign();
      }
      return;
    }

    // Dropped on a user column: queue task for that user
    if (targetColumnId.startsWith('user-')) {
      const targetUserId = targetColumnId.replace('user-', '');
      const targetUser = getUserProfile(targetUserId);
      const sourceOwnerUser = sourceOwnerId ? getUserProfile(sourceOwnerId) : undefined;
      const isDraggedFromInProgress = Boolean(
        currentTask &&
        sourceOwnerId &&
        (isTaskActiveInProgress(currentTask as any, sourceOwnerUser?.name) ||
          isTaskLiveWorking(currentTask as any, sourceOwnerUser?.name))
      );

      // If dragged and dropped in the same user's column and already queued for this user: DO NOTHING!
      if (currentAssigneeId === targetUserId && hasPmAssignmentForUser(currentTask as any, targetUserId) && !isTaskActiveInProgress(currentTask as any, targetUser?.name)) {
        return;
      }

      // Dragging from In Progress to Queue opens the Deliverables & Time-Out modal;
      // timing out only happens once the user inputs and submits inside the modal.
      if (isDraggedFromInProgress && currentTask) {
        const openQueueTimeoutModal = async () => {
          setDeliverablesModalTarget({
            task: currentTask,
            targetStatus: 'Paused',
            user: sourceOwnerUser || targetUser,
            realTaskId: currentTask.id,
            queueTargetUserId: targetUserId,
          });
        };

        if (sourceOwnerId !== targetUserId) {
          await executeWithInactiveCheck(targetUserId, targetUser, currentTask?.title || 'Task', openQueueTimeoutModal);
        } else {
          openQueueTimeoutModal();
        }
        return;
      }

      const nextRoles = getResolvedRoleRestrictionsForUser(currentTask, targetUser);
      const subSuffix =
        remainingAvailableSubtasks.length > 0
          ? ` (+${remainingAvailableSubtasks.length} available subtask${remainingAvailableSubtasks.length > 1 ? 's' : ''})`
          : '';
      const preserveHandover = Boolean(
        isTaskHandedOver(currentTask) ||
        (sourceOwnerId && sourceOwnerId !== targetUserId)
      );

      const runQueueAssign = async () => {
        toast.success(`Task queued for ${targetUser?.name || 'user'}${subSuffix}`);
        try {
          if (onAssignTask) {
            await onAssignTask(taskId, targetUserId, 'QUEUE', nextRoles, undefined, currentTask, preserveHandover);
            if (remainingAvailableSubtasks.length > 0) {
              await Promise.all(
                remainingAvailableSubtasks.map((sub) =>
                  onAssignTask(
                    sub.id,
                    targetUserId,
                    'QUEUE',
                    getResolvedRoleRestrictionsForUser(sub, targetUser),
                    undefined,
                    sub,
                    preserveHandover
                  )
                )
              );
            }
          } else {
            await taskMapApi.assignTask(taskId, targetUserId, 'QUEUE', {
              assigneeRoleRestrictions: nextRoles,
              preserveHandover,
            });
            if (onTaskUpdate) {
              await onTaskUpdate(taskId, { assigneeId: targetUserId, assigneeRoleRestrictions: nextRoles });
            } else {
              await tasksApi.updateTask(taskId, { assigneeId: targetUserId, assigneeRoleRestrictions: nextRoles } as any).catch(console.error);
            }
            if (remainingAvailableSubtasks.length > 0) {
              await Promise.all(
                remainingAvailableSubtasks.map((sub) =>
                  taskMapApi.assignTask(sub.id, targetUserId, 'QUEUE', {
                    assigneeRoleRestrictions: getResolvedRoleRestrictionsForUser(sub, targetUser),
                    preserveHandover,
                  })
                )
              );
            }
            onDataRefresh();
          }
        } catch (err: any) {
          const errData = err?.response?.data || err?.data;
          const isClientLocked =
            err?.isClientLocked ||
            errData?.isClientLocked ||
            errData?.error === 'CLIENT_LOCKED' ||
            err?.error === 'CLIENT_LOCKED' ||
            err?.message?.includes('CLIENT_LOCKED') ||
            err?.message?.toLowerCase().includes('exceeded weekly');
          if (isClientLocked) {
            const hoursLogged = err?.hoursLogged ?? errData?.hoursLogged;
            const weeklyLimit = err?.weeklyLimit ?? errData?.weeklyLimit;
            const hoursInfo =
              typeof hoursLogged === 'number' && typeof weeklyLimit === 'number'
                ? ` (${hoursLogged.toFixed(1)} / ${weeklyLimit.toFixed(1)} hrs)`
                : '';
            const clientName = err?.clientName || errData?.clientName || (currentTask as any)?.list?.name || (currentTask as any)?.listName || 'Client';
            toast.error(errData?.message || err?.message || `Client "${clientName}" is locked: exceeded weekly limit${hoursInfo}. PM OTP required.`);
            setClientOtpModal({
              isOpen: true,
              clientName,
              taskId,
              targetUserId,
              mode: 'QUEUE',
              nextRoles,
              hoursLogged,
              weeklyLimit,
            });
          } else {
            toast.error(err.message || 'Failed to queue task');
          }
        }
      };

      if (sourceOwnerId !== targetUserId) {
        await executeWithInactiveCheck(targetUserId, targetUser, currentTask?.title || 'Task', runQueueAssign);
      } else {
        await runQueueAssign();
      }
    } else if (targetColumnId === 'available-pool') {
      // If already in available pool, do nothing!
      if (isFromAvailable) {
        return;
      }

      // If dragged by the column owner themselves ("user = user column"), mark as sign-out / Hand-over
      // and open the Deliverables & Task Update modal before returning to Available tasks.
      const isOwnColumnHandover = Boolean(
        sourceOwnerId && currentUser?.id && sourceOwnerId === currentUser.id
      );
      if (isOwnColumnHandover && currentTask) {
        const ownerUser = getUserProfile(sourceOwnerId!);
        setDeliverablesModalTarget({
          task: currentTask,
          targetStatus: 'Hand-over',
          user: ownerUser,
          realTaskId: currentTask.id,
        });
        return;
      }

      toast.success('Task moved to Available tasks');
      try {
        if (onAssignTask) {
          await onAssignTask(taskId, null, 'QUEUE');
        } else {
          await taskMapApi.assignTask(taskId, null);
          onDataRefresh();
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to move task');
      }
    }
  };

  const handleSelectInProgressTask = async (taskId: string, targetUserId: string, taskOverride?: TaskMapItem) => {
    if (!canStartInProgressSlot({ isPmUser, currentUserId: currentUser?.id, columnUserId: targetUserId })) {
      toast.error("Only the assigned MA or Project Managers can move tasks to In Progress");
      return;
    }
    const targetUser = getUserProfile(targetUserId);
    const allPoolAndTasks = [...(allTasks || tasks), ...(allAvailablePool || availablePool)];
    const existingTask = allPoolAndTasks.find((t) => t.id === taskId) || taskOverride;
    const nextRoles = getResolvedRoleRestrictionsForUser(existingTask, targetUser);
    const isCadence = ['DAILY', 'WEEKLY', 'MONTHLY'].includes((existingTask?.status || '').toUpperCase().trim());
    toast.success(isCadence ? `Task assigned to ${targetUser?.name || 'user'}` : `Task set In Progress for ${targetUser?.name || 'user'}`);
    try {
      if (onAssignTask) {
        await onAssignTask(taskId, targetUserId, 'IN_PROGRESS', nextRoles, undefined, existingTask);
      } else {
        const nextStatus = isCadence ? toCanonicalTaskStatus(existingTask?.status) : 'IN PROGRESS';
        await taskMapApi.assignTask(taskId, targetUserId, 'IN_PROGRESS', { assigneeRoleRestrictions: nextRoles });
        if (onTaskUpdate) {
          await onTaskUpdate(taskId, { status: nextStatus, assigneeId: targetUserId, assigneeRoleRestrictions: nextRoles });
        } else {
          await tasksApi.updateTask(taskId, { status: nextStatus, assigneeId: targetUserId, assigneeRoleRestrictions: nextRoles } as any).catch(console.error);
        }
        onDataRefresh();
      }
    } catch (err: any) {
      const errData = err?.response?.data || err?.data;
      const isClientLocked =
        err?.isClientLocked ||
        errData?.isClientLocked ||
        errData?.error === 'CLIENT_LOCKED' ||
        err?.error === 'CLIENT_LOCKED' ||
        err?.message?.includes('CLIENT_LOCKED') ||
        err?.message?.toLowerCase().includes('exceeded weekly');
      if (isClientLocked) {
        const hoursLogged = err?.hoursLogged ?? errData?.hoursLogged;
        const weeklyLimit = err?.weeklyLimit ?? errData?.weeklyLimit;
        const hoursInfo =
          typeof hoursLogged === 'number' && typeof weeklyLimit === 'number'
            ? ` (${hoursLogged.toFixed(1)} / ${weeklyLimit.toFixed(1)} hrs)`
            : '';
        const clientName = err?.clientName || errData?.clientName || (existingTask as any)?.list?.name || (existingTask as any)?.listName || 'Client';
        toast.error(errData?.message || err?.message || `Client "${clientName}" is locked: exceeded weekly limit${hoursInfo}. PM OTP required.`);
        setClientOtpModal({
          isOpen: true,
          clientName,
          taskId,
          targetUserId,
          mode: 'IN_PROGRESS',
          nextRoles,
          hoursLogged,
          weeklyLimit,
        });
      } else {
        toast.error(err.message || 'Failed to assign task');
      }
    }
  };

  const handleTransferTaskCard = async (task: TaskMapItem, targetUserId: string) => {
    if (!canTransferTaskMapCard(isPmUser)) {
      toast.error('Only Project Managers and Admins can transfer tasks');
      return;
    }
    const targetUser = getUserProfile(targetUserId);
    const nextRoles = getResolvedRoleRestrictionsForUser(task, targetUser);
    const runTransfer = async () => {
      toast.success(`Task transferred to ${targetUser?.name || 'MA'}'s To Do`);
      try {
        if (onTransferTask) {
          await onTransferTask(task.id, targetUserId);
        } else {
          await taskMapApi.transferTask(task.id, targetUserId, { assigneeRoleRestrictions: nextRoles });
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { assigneeRoleRestrictions: nextRoles });
          }
          onDataRefresh();
        }
      } catch (err: any) {
        const errData = err?.response?.data || err?.data;
        const isClientLocked =
          err?.isClientLocked ||
          errData?.isClientLocked ||
          errData?.error === 'CLIENT_LOCKED' ||
          err?.error === 'CLIENT_LOCKED' ||
          err?.message?.includes('CLIENT_LOCKED') ||
          err?.message?.toLowerCase().includes('exceeded weekly');
        if (isClientLocked) {
          const hoursLogged = err?.hoursLogged ?? errData?.hoursLogged;
          const weeklyLimit = err?.weeklyLimit ?? errData?.weeklyLimit;
          const hoursInfo =
            typeof hoursLogged === 'number' && typeof weeklyLimit === 'number'
              ? ` (${hoursLogged.toFixed(1)} / ${weeklyLimit.toFixed(1)} hrs)`
              : '';
          const clientName = err?.clientName || errData?.clientName || (task as any)?.list?.name || (task as any)?.listName || 'Client';
          toast.error(errData?.message || err?.message || `Client "${clientName}" is locked: exceeded weekly limit${hoursInfo}. PM OTP required.`);
          setClientOtpModal({
            isOpen: true,
            clientName,
            taskId: task.id,
            targetUserId,
            mode: 'QUEUE',
            nextRoles,
            hoursLogged,
            weeklyLimit,
          });
        } else {
          toast.error(err?.message || 'Failed to transfer task');
        }
      }
    };

    await executeWithInactiveCheck(targetUserId, targetUser, task.title, runTransfer);
  };

  // Unified Status Presets: pure workflow statuses for Task Map
  // Removed: 'Not started' (pending means not started) and 'In progress' (automated).
  // Stays at in-progress main status: Hand-over (transfers to Available tasks), Paused, Ask Client (transfers to CRM Map pool).
  // Changes main status: To Review -> IN REVIEW (Auditor Map), Waiting -> WAITING (CRM Map), On-hold -> ON-HOLD (Available tasks bottom, excluded from count).
  const getUnifiedTaskMapOptions = (task: TaskMapItem, _user?: any): TaskMapOption[] => {
    const list: TaskMapOption[] = [
      { id: 'opt-status-avail', label: 'Available Task', color: TASK_MAP_STATUS_COLORS.AVAILABLE_TASK, textColor: '#ffffff', order: 0 },
      { id: 'opt-status-handover', label: 'Hand-over', color: TASK_MAP_STATUS_COLORS.HAND_OVER, textColor: '#ffffff', order: 1 },
      { id: 'opt-status-paused', label: 'Paused', color: TASK_MAP_STATUS_COLORS.PAUSED, textColor: '#713f12', order: 2 },
      { id: 'opt-status-askclient', label: 'Ask Client', color: TASK_MAP_STATUS_COLORS.ASK_CLIENT, textColor: '#155e75', order: 3 },
      { id: 'opt-status-toreview', label: 'To Review', color: resolveSubStatusColor('To Review', TASK_MAP_STATUS_COLORS.TO_REVIEW, task.list?.id, task.list?.statuses), textColor: '#ffffff', order: 4 },
      { id: 'opt-status-waiting', label: 'Waiting', color: resolveSubStatusColor('Waiting', TASK_MAP_STATUS_COLORS.WAITING, task.list?.id, task.list?.statuses), textColor: '#fef2f2', order: 5 },
      { id: 'opt-status-onhold', label: 'On-hold', color: resolveSubStatusColor('On-hold', TASK_MAP_STATUS_COLORS.ON_HOLD, task.list?.id, task.list?.statuses), textColor: '#ffffff', order: 6 },
      { id: 'opt-status-revision', label: 'Revision', color: resolveSubStatusColor('Revision', TASK_MAP_STATUS_COLORS.REVISION, task.list?.id, task.list?.statuses), textColor: '#ffffff', order: 7 },
    ];

    const EXCLUDED_FROM_TASK_MAP = new Set([
      'NOT STARTED',
      'NOTSTARTED',
      'IN PROGRESS',
      'INPROGRESS',
      'TO SEND',
      'TOSEND',
      'READY TO SEND',
      'READYTOSEND',
      'SENT',
      'SENT BUT WAITING',
      'SENTBUTWAITING',
      'FOLLOW UP',
      'FOLLOWUP',
      'DONE REVIEW',
      'DONEREVIEW',
      'DONE',
    ]);

    // Ensure any currently selected statuses on this task are also present so user can toggle them off,
    // but strictly exclude To send, Sent, Follow up, Done Review, and Done from Task Map dropdown.
    (task.taskMap?.statuses || []).forEach((st: string) => {
      const up = (st || '').toUpperCase().trim();
      const norm = up.replace(/[\s_-]+/g, '');
      const isUpwork = up.startsWith('UPWORK');
      const isPmName = up === 'CHE' || up === 'PAU' || up === 'HAN' || up.includes('PM');
      const isUrgent = up === 'URGENT';
      const isExcluded = EXCLUDED_FROM_TASK_MAP.has(up) || EXCLUDED_FROM_TASK_MAP.has(norm);

      if (!isUpwork && !isPmName && !isUrgent && !isExcluded && !list.some((o) => o.label.toLowerCase() === st.toLowerCase())) {
        list.push({
          id: `opt-cur-${st}`,
          label: st,
          color: '#3f3f46',
          textColor: '#ffffff',
          order: 99,
        });
      }
    });

    return list;
  };

  const handleDeliverablesSubmit = async (data: {
    taskDeliverablesDescription: string;
    taskUpdateAndDeliverables: string;
    timeOut: string;
  }) => {
    if (!deliverablesModalTarget) return;
    const { task, targetStatus, user: modalUser, realTaskId } = deliverablesModalTarget;
    const compactTarget = targetStatus.toLowerCase().replace(/[\s_-]+/g, '');
    const isHandover = compactTarget === 'handover';
    const isToReview = compactTarget === 'toreview' || compactTarget === 'inreview';
    const isPaused = compactTarget === 'paused';
    const isAvailableTask = compactTarget === 'availabletask';
    const isAskClient = compactTarget === 'askclient';
    const isWaiting = compactTarget === 'waiting';
    const isOnHold = compactTarget === 'onhold' || compactTarget.includes('hold');
    const isRevision = compactTarget === 'revision' || compactTarget === 'revisions';
    const effectiveTaskId = realTaskId || task.id;
    const lockKey = `${effectiveTaskId}::${targetStatus}`;
    if (submittingDeliverablesRef.current.has(lockKey)) return;
    submittingDeliverablesRef.current.add(lockKey);
    recentlyClockedOutRef.current.set(task.id, Date.now());
    recentlyClockedOutRef.current.set(effectiveTaskId, Date.now());

    const nowTimeOut = data.timeOut || formatManilaTime(new Date());
    const hasActiveTimeIn = Boolean(task.progress?.timeIn && !task.progress?.timeOut);

    try {
      // 1. If it's an assumption block
      if (task.isAssumptionBlock) {
        const targetMainStatus = isToReview
          ? 'IN REVIEW'
          : isWaiting
            ? 'WAITING'
            : isOnHold
              ? 'ON-HOLD'
              : isRevision
                ? 'REVISION'
                : isPaused
                  ? 'PENDING'
                  : (toCanonicalTaskStatus(task.status || 'IN PROGRESS') || 'IN PROGRESS');
        task.status = targetMainStatus;
        task.taskMap = {
          ...task.taskMap,
          statuses: [targetStatus],
          ...(isHandover || isAvailableTask ? { handedOver: true } : {}),
        };
        if (task.progress) {
          task.progress.timeOut = nowTimeOut;
          task.progress.taskDeliverablesDescription = data.taskDeliverablesDescription;
          task.progress.taskUpdateAndDeliverables = data.taskUpdateAndDeliverables;
        }
        const uName = modalUser?.name || task.assignee?.name || currentUser?.name;
        if (uName) {
          useAppStore.getState().updateMaActiveSession(uName, null);
        }
        setDeliverablesModalTarget(null);

        const linkedId =
          task.linkedTaskId && !task.linkedTaskId.startsWith('general-slot-')
            ? task.linkedTaskId
            : null;

        const origTimeIn = task.progress?.timeIn;
        const origDate = task.progress?.date;
        let startDt: Date | undefined = undefined;
        if (origTimeIn) {
          try {
            const iso = parseManilaTimeToIso(origDate, origTimeIn);
            if (iso) startDt = new Date(iso);
          } catch (_) {}
        }

        if (hasActiveTimeIn || isHandover || isToReview) {
          // Persist sheet clock-out FIRST so any subsequent loadData(true) sees timeOut populated
          await taskMapApi.syncScheduleToSpreadsheet({
            taskId: linkedId || task.id,
            subtaskId: task.subtaskId || null,
            sheetRow: task.progress?.sheetRow,
            taskTitle: task.title,
            clientName: task.progress?.client || task.list?.name || 'General',
            status: targetStatus,
            mode: 'STOP',
            startedAt: startDt,
            stoppedAt: new Date(),
            taskDeliverablesDescription: data.taskDeliverablesDescription,
            taskUpdateAndDeliverables: data.taskUpdateAndDeliverables,
          }).catch(console.error);
        }

        if (linkedId) {
          await taskMapApi.updateTaskStatuses(linkedId, [targetStatus], {
            timeOut: hasActiveTimeIn ? nowTimeOut : undefined,
            taskDeliverablesDescription: data.taskDeliverablesDescription,
            taskUpdateAndDeliverables: data.taskUpdateAndDeliverables,
            sheetRow: task.progress?.sheetRow,
            timeIn: task.progress?.timeIn || undefined,
            skipN8nSync: true,
          }).catch(console.error);
          if (isPaused && modalUser?.id && onAssignTask) {
            onStatusChange(linkedId, ['Paused']);
            await onAssignTask(linkedId, modalUser.id, 'QUEUE', undefined, undefined, {
              ...task,
              id: linkedId,
              isAssumptionBlock: false,
              status: 'PENDING',
              taskMap: {
                ...task.taskMap,
                taskId: linkedId,
                statuses: ['Paused'],
                handedOver: false,
              },
            });
          } else if (onTaskUpdate) {
            const updateFields: Partial<TaskMapItem> = { status: targetMainStatus };
            if (isPmUser && (isHandover || isToReview || isAvailableTask || isAskClient || isWaiting || isOnHold)) {
              updateFields.assigneeId = null;
            }
            await onTaskUpdate(linkedId, updateFields);
          }
        }

        toast.success(
          isPaused
            ? `Task paused & stored in Queue — timed out at ${nowTimeOut}`
            : isHandover
              ? `Task handed over — clocked out at ${nowTimeOut}`
              : isToReview
                ? `Deliverables submitted to Review — clocked out at ${nowTimeOut}`
                : `Status updated to ${targetStatus} — timed out at ${nowTimeOut}`
        );
        setDeliverablesModalTarget(null);
        return;
      }

      // 2. Real task or subtask — clear live session & update React state immediately (0ms)
      const targetAssigneeUser = modalUser?.name ? modalUser : task.assignee;
      if (targetAssigneeUser?.name) {
        useAppStore.getState().updateMaActiveSession(targetAssigneeUser.name, null);
      }
      const optimisticMainStatus = isToReview
        ? 'IN REVIEW'
        : isWaiting
          ? 'WAITING'
          : isOnHold
            ? 'ON-HOLD'
            : isRevision
              ? 'REVISION'
              : isPaused
                ? (['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes((task.status || '').trim().toUpperCase())
                    ? task.status
                    : 'PENDING')
                : undefined;
      onOptimisticClockOut?.(effectiveTaskId, {
        timeOut: hasActiveTimeIn ? nowTimeOut : (task.progress?.timeOut || nowTimeOut),
        targetStatus,
        ...(optimisticMainStatus ? { targetMainStatus: optimisticMainStatus } : {}),
        taskDeliverablesDescription: data.taskDeliverablesDescription,
        taskUpdateAndDeliverables: data.taskUpdateAndDeliverables,
        ...(isHandover || isAvailableTask ? { handedOver: true } : isPaused ? { handedOver: false } : {}),
        clearAssignee: Boolean(
          isAvailableTask ||
            (isPmUser && (isHandover || isToReview || isAskClient || isWaiting || isOnHold))
        ),
      });
      setDeliverablesModalTarget(null);

      const origRealTimeIn = task.progress?.timeIn;
      const origRealDate = task.progress?.date;
      let realStartDt: Date | undefined = undefined;
      if (origRealTimeIn) {
        try {
          const iso = parseManilaTimeToIso(origRealDate, origRealTimeIn);
          if (iso) realStartDt = new Date(iso);
        } catch (_) {}
      }

      if (hasActiveTimeIn) {
        // Persist DailySheetLog & spreadsheet STOP BEFORE onTaskUpdate / onAssignTask triggers loadData(true)
        await taskMapApi.syncScheduleToSpreadsheet({
          taskId: effectiveTaskId,
          subtaskId: task.subtaskId || (task.isSubtask ? task.id : null),
          sheetRow: task.progress?.sheetRow,
          taskTitle: task.title,
          clientName: task.progress?.client || task.list?.name || 'General',
          status: targetStatus,
          mode: 'STOP',
          startedAt: realStartDt,
          stoppedAt: new Date(),
          taskDeliverablesDescription: data.taskDeliverablesDescription,
          taskUpdateAndDeliverables: data.taskUpdateAndDeliverables,
        }).catch(console.error);
      }

      const ownerId =
        modalUser?.id ||
        getEffectiveTaskMapHandlerId(task) ||
        task.assigneeId ||
        task.assignee?.id ||
        null;

      const statusPayloadExtra = {
        timeOut: hasActiveTimeIn ? nowTimeOut : undefined,
        taskDeliverablesDescription: data.taskDeliverablesDescription,
        taskUpdateAndDeliverables: data.taskUpdateAndDeliverables,
        sheetRow: task.progress?.sheetRow,
        timeIn: task.progress?.timeIn || undefined,
        skipN8nSync: true,
      };

      if (isPaused) {
        const queueDestinationUserId = deliverablesModalTarget.queueTargetUserId;
        const effectiveQueueUserId = queueDestinationUserId || ownerId;
        const isCrossUserQueueMove = Boolean(
          queueDestinationUserId && ownerId && queueDestinationUserId !== ownerId
        );
        const nextPausedStatuses = isCrossUserQueueMove ? ['Hand-over'] : ['Paused'];
        onStatusChange(effectiveTaskId, nextPausedStatuses);
        await taskMapApi.updateTaskStatuses(effectiveTaskId, nextPausedStatuses, statusPayloadExtra).catch(console.error);
        const pausedOverride: TaskMapItem = {
          ...task,
          status: ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes((task.status || '').trim().toUpperCase())
            ? task.status
            : 'PENDING',
          progress: task.progress
            ? {
                ...task.progress,
                timeOut: task.progress.timeOut || (hasActiveTimeIn ? nowTimeOut : null),
              }
            : task.progress,
          taskMap: {
            ...(task.taskMap || {
              taskId: effectiveTaskId,
              statuses: nextPausedStatuses,
              shift: 'DAY',
              stepOrder: 0,
              dontRollover: false,
            }),
            statuses: nextPausedStatuses,
            handedOver: false,
          },
        };
        if (effectiveQueueUserId) {
          if (onAssignTask) {
            await onAssignTask(
              effectiveTaskId,
              effectiveQueueUserId,
              'QUEUE',
              undefined,
              undefined,
              pausedOverride,
              isCrossUserQueueMove
            );
          } else {
            await taskMapApi.assignTask(effectiveTaskId, effectiveQueueUserId, 'QUEUE', {
              preserveHandover: isCrossUserQueueMove,
            });
            onDataRefresh();
          }
        } else {
          onDataRefresh();
        }
        toast.info(
          hasActiveTimeIn
            ? `Task paused & stored in Queue — timed out at ${nowTimeOut}`
            : 'Task paused & stored in Queue'
        );
      } else if (isHandover) {
        const preservedStatus = toCanonicalTaskStatus(task.status || 'IN PROGRESS') || 'IN PROGRESS';
        await taskMapApi.updateTaskStatuses(effectiveTaskId, ['Hand-over'], statusPayloadExtra).catch(console.error);
        if (isPmUser && onTaskUpdate) {
          await onTaskUpdate(effectiveTaskId, { assigneeId: null, status: preservedStatus });
        } else {
          onDataRefresh();
        }

        toast.info(
          hasActiveTimeIn
            ? `Task handed over — clocked out at ${nowTimeOut}`
            : 'Task handed over & signed out'
        );
      } else if (isToReview) {
        if (ownerId) {
          setRecentlyMovedToReviewByUser((prev) => {
            const existing = prev[ownerId] || [];
            if (existing.some((t) => t.id === effectiveTaskId)) return prev;
            return {
              ...prev,
              [ownerId]: [{ ...task, status: 'IN REVIEW', assigneeId: null }, ...existing],
            };
          });
        }
        await taskMapApi.updateTaskStatuses(effectiveTaskId, ['To Review'], statusPayloadExtra).catch(console.error);
        if (onTaskUpdate) {
          await onTaskUpdate(effectiveTaskId, isPmUser ? { status: 'IN REVIEW', assigneeId: null } : { status: 'IN REVIEW' });
        } else {
          await tasksApi.updateTask(effectiveTaskId, { status: 'IN REVIEW' } as any).catch(console.error);
          onDataRefresh();
        }
        if (!isPmUser) onDataRefresh();

        toast.info(`Task status changed to IN REVIEW — clocked out at ${nowTimeOut}`);
      } else if (isAvailableTask) {
        onStatusChange(effectiveTaskId, ['Available Task']);
        await taskMapApi.updateTaskStatuses(effectiveTaskId, ['Available Task'], statusPayloadExtra).catch(console.error);
        const isCadence = ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(
          (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '')
        );
        const curStatNorm = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
        const shouldResetToPending = !isCadence && (curStatNorm === 'INPROGRESS' || curStatNorm === 'INREVIEW');
        const nextPoolStatus = shouldResetToPending ? 'PENDING' : (task.status || 'PENDING');
        if (isPmUser && onAssignTask) {
          await onAssignTask(effectiveTaskId, null, 'QUEUE', undefined, undefined, {
            ...task,
            status: nextPoolStatus,
            taskMap: {
              ...(task.taskMap || {
                taskId: effectiveTaskId,
                statuses: ['Available Task'],
                shift: 'DAY',
                stepOrder: 0,
                dontRollover: false,
              }),
              statuses: ['Available Task'],
              handedOver: false,
            },
          });
          if (shouldResetToPending && onTaskUpdate) {
            await Promise.resolve(onTaskUpdate(effectiveTaskId, { status: 'PENDING', assigneeId: null })).catch(console.error);
          }
        } else {
          onDataRefresh();
        }
        toast.info(
          hasActiveTimeIn
            ? `Returned to Available Tasks — clocked out at ${nowTimeOut}`
            : 'Returned to Available Tasks'
        );
        toast.info(`Task returned to Available Tasks — timed out at ${nowTimeOut}`);
      } else if (isAskClient) {
        await taskMapApi.updateTaskStatuses(effectiveTaskId, ['Ask Client'], statusPayloadExtra).catch(console.error);
        if (isPmUser && onTaskUpdate) {
          await onTaskUpdate(effectiveTaskId, { assigneeId: null });
        } else {
          onDataRefresh();
        }
        toast.info(`Task marked 'Ask Client' — timed out at ${nowTimeOut}`);
      } else if (isWaiting) {
        await taskMapApi.updateTaskStatuses(effectiveTaskId, ['Waiting'], statusPayloadExtra).catch(console.error);
        if (onTaskUpdate) {
          await onTaskUpdate(effectiveTaskId, isPmUser ? { status: 'WAITING', assigneeId: null } : { status: 'WAITING' });
        } else {
          onDataRefresh();
        }
        if (!isPmUser) onDataRefresh();
        toast.info(`Task status changed to WAITING — timed out at ${nowTimeOut}`);
      } else if (isOnHold) {
        await taskMapApi.updateTaskStatuses(effectiveTaskId, ['On-hold'], statusPayloadExtra).catch(console.error);
        if (onTaskUpdate) {
          await onTaskUpdate(effectiveTaskId, isPmUser ? { status: 'ON-HOLD', assigneeId: null } : { status: 'ON-HOLD' });
        } else {
          onDataRefresh();
        }
        if (!isPmUser) onDataRefresh();
        toast.info(`Task status changed to ON-HOLD — timed out at ${nowTimeOut}`);
      } else if (isRevision) {
        await taskMapApi.updateTaskStatuses(effectiveTaskId, ['Revision'], statusPayloadExtra).catch(console.error);
        if (onTaskUpdate) {
          await onTaskUpdate(effectiveTaskId, { status: 'REVISION' });
        } else {
          onDataRefresh();
        }
        toast.info(`Task marked for Revision — timed out at ${nowTimeOut}`);
      } else {
        await taskMapApi.updateTaskStatuses(effectiveTaskId, [targetStatus], statusPayloadExtra).catch(console.error);
        if (ownerId && onAssignTask) {
          await onAssignTask(effectiveTaskId, ownerId, 'QUEUE', undefined, undefined, task);
        } else {
          onDataRefresh();
        }
        toast.info(`Sub-status updated to ${targetStatus} — timed out at ${nowTimeOut}`);
      }

      setDeliverablesModalTarget(null);
    } finally {
      submittingDeliverablesRef.current.delete(lockKey);
    }
  };

  const handleTaskMapSubStatusToggle = async (
    task: TaskMapItem,
    label: string,
    nextStatuses?: string[],
    user?: any
  ) => {
    const isSelecting = (nextStatuses || []).includes(label);
    const cleanNext = isSelecting ? [label] : [];
    const norm = label.trim().toLowerCase();
    const compactNorm = norm.replace(/[\s_-]+/g, '');
    const ownerNameForLive = user?.name || task.assignee?.name;
    const isTaskCurrentlyLive = Boolean(
      (task.progress?.timeIn && !task.progress?.timeOut && !task.progress?.isMissingTime) ||
      (!task.isAssumptionBlock && isTaskLiveWorking(task, ownerNameForLive, boardTime)) ||
      (!task.isAssumptionBlock && isTaskActiveInProgress(task, ownerNameForLive))
    );

    const shouldRequireTimeoutModal =
      (isSelecting &&
        (compactNorm === 'handover' ||
          compactNorm === 'toreview' ||
          compactNorm === 'inreview' ||
          compactNorm === 'paused')) ||
      isTaskCurrentlyLive;

    if (shouldRequireTimeoutModal) {
      const targetModalStatus = isSelecting ? label : 'Paused';
      const targetCompact = targetModalStatus.toLowerCase().replace(/[\s_-]+/g, '');
      const normalizedModalStatus =
        targetCompact === 'handover'
          ? 'Hand-over'
          : targetCompact === 'toreview' || targetCompact === 'inreview'
            ? 'To Review'
            : targetCompact === 'paused'
              ? 'Paused'
              : targetModalStatus;

      if (targetCompact === 'handover' || targetCompact === 'toreview') {
        const lastClockOut = recentlyClockedOutRef.current.get(task.id);
        if (lastClockOut && Date.now() - lastClockOut < 15000) {
          toast.info('Already clocked out — syncing spreadsheet...');
          return;
        }
      }

      if (targetCompact === 'availabletask') {
        const isAssigned =
          !poolIds.has(task.id) ||
          Boolean(getEffectiveTaskMapHandlerId(task)) ||
          Boolean(task.assigneeId) ||
          (task.assignees || []).length > 0;
        if (isAssigned && !isPmUser) {
          toast.error('Only Project Managers can move tasks to the Available column');
          return;
        }
      }

      setDeliverablesModalTarget({
        task,
        targetStatus: normalizedModalStatus,
        user,
        nextStatuses: isSelecting ? cleanNext : ['Paused'],
        realTaskId: task.isAssumptionBlock && task.linkedTaskId && !task.linkedTaskId.startsWith('general-slot-')
          ? task.linkedTaskId
          : task.id,
      });
      return;
    }

    if (task.isAssumptionBlock) {
      task.taskMap.statuses = cleanNext;
      if (user?.name) {
        const sKey = (user.name || '').trim().toLowerCase();
        const prevSess = useAppStore.getState().maActiveSessions[sKey] || {};
        useAppStore.getState().updateMaActiveSession(user.name, {
          ...prevSess,
          subStatuses: cleanNext,
          status: cleanNext[0] || prevSess.status,
        });
      }
      const linkedId =
        task.linkedTaskId && !task.linkedTaskId.startsWith('general-slot-')
          ? task.linkedTaskId
          : null;
      if (!linkedId) return;
      task = { ...task, id: linkedId, isAssumptionBlock: false };
    }

    // 0. Available Task: permission gate before opening guide modal
    if (norm === 'available task' || norm === 'availabletask') {
      const isAssigned =
        !poolIds.has(task.id) ||
        Boolean(getEffectiveTaskMapHandlerId(task)) ||
        Boolean(task.assigneeId) ||
        (task.assignees || []).length > 0;
      if (isAssigned && !isPmUser) {
        toast.error('Only Project Managers can move tasks to the Available column');
        return;
      }
    }

    const executeNonLiveSubStatusTransition = async () => {
      // 0. Available Task: unassigns the MA/PM (assigneeId = null), preserves main status, moves back to Available Tasks
      if (norm === 'available task' || norm === 'availabletask') {
        const isAssigned =
          !poolIds.has(task.id) ||
          Boolean(getEffectiveTaskMapHandlerId(task)) ||
          Boolean(task.assigneeId) ||
          (task.assignees || []).length > 0;
        if (isAssigned) {
          onStatusChange(task.id, ['Available Task']);
          try {
            if (onAssignTask) {
              await onAssignTask(task.id, null, 'QUEUE');
            } else {
              await taskMapApi.assignTask(task.id, null);
              onDataRefresh();
            }
            toast.info('Task returned to Available Tasks');
          } catch (err: any) {
            toast.error(err?.message || 'Failed to move task to Available Tasks');
            onDataRefresh();
          }
          return;
        }
        onStatusChange(task.id, isSelecting ? ['Available Task'] : cleanNext);
        return;
      }

      onStatusChange(task.id, cleanNext);

      // 1. Hand Over: stays at main status, transfers to Available Tasks so PMs can reassign to other MAs
      if (compactNorm === 'handover') {
        if (isSelecting) {
          const preservedStatus = toCanonicalTaskStatus(task.status || 'IN PROGRESS') || 'IN PROGRESS';
          if (task.progress && task.progress.timeIn && !task.progress.timeOut) {
            task.progress.timeOut = formatManilaTime(new Date());
          }
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { ...(isPmUser ? { assigneeId: null } : {}), status: preservedStatus });
          } else {
            await tasksApi.updateTask(task.id, { ...(isPmUser ? { assigneeId: null } : {}), status: preservedStatus } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info('Task handed over — transferred to Available Tasks for PM reassignment');
        }
        return;
      }

      // 1b. Revision: returns/keeps task in the original assigned MA's column with REVISION status
      if (compactNorm === 'revision' || compactNorm === 'revisions') {
        if (isSelecting) {
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: 'REVISION' });
          } else {
            await tasksApi.updateTask(task.id, { status: 'REVISION' } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info('Task marked for Revision');
        } else {
          const revertStatus = toCanonicalTaskStatus((task as any)._previousStatus || (task.assigneeId ? 'IN PROGRESS' : 'PENDING'));
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: revertStatus });
          } else {
            await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info(`Reverted 'Revision' — returned to ${revertStatus}`);
        }
        return;
      }

      // 2. Paused: stays at IN PROGRESS main status, stays in current MA Queue
      if (norm === 'paused') {
        if (isSelecting) {
          toast.info('Task marked Paused — stored in Queue');
        }
        return;
      }

      // 3. Ask Client: transfer to CRM Map pool, remove from MA/PM column
      if (norm === 'ask client' || norm === 'askclient') {
        if (isSelecting) {
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, isPmUser ? { assigneeId: null } : {});
          }
          toast.info("Task marked 'Ask Client' — transferred to CRM Map pool");
        }
        return;
      }

      // 4. To Review: changes main status to IN REVIEW
      // and removes from MA/PM column so it moves to the Auditor Map tab
      if (norm === 'to review' || norm === 'to_review') {
        const ownerId = getEffectiveTaskMapHandlerId(task) || task.assigneeId || task.assignee?.id;
        if (isSelecting) {
          const targetStatus = 'IN REVIEW';
          if (task.progress && task.progress.timeIn && !task.progress.timeOut) {
            task.progress.timeOut = formatManilaTime(new Date());
          }
          if (ownerId) {
            setRecentlyMovedToReviewByUser((prev) => {
              const existing = prev[ownerId] || [];
              if (existing.some((t) => t.id === task.id)) return prev;
              return {
                ...prev,
                [ownerId]: [{ ...task, status: targetStatus, assigneeId: null }, ...existing],
              };
            });
          }
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: targetStatus, ...(isPmUser ? { assigneeId: null } : {}) });
          } else {
            await tasksApi.updateTask(task.id, { status: targetStatus, ...(isPmUser ? { assigneeId: null } : {}) } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info(`Task status changed to ${targetStatus} — transferred to Auditor Map`);
        } else {
          if (ownerId) {
            setRecentlyMovedToReviewByUser((prev) => ({
              ...prev,
              [ownerId]: (prev[ownerId] || []).filter((t) => t.id !== task.id),
            }));
          }
          const revertStatus = toCanonicalTaskStatus((task as any)._previousStatus || (task.assigneeId ? 'IN PROGRESS' : 'PENDING'));
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: revertStatus });
          } else {
            await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info(`Reverted 'To Review' — returned to ${revertStatus}`);
        }
        return;
      }

      // 5. Waiting: changes main status to WAITING, removes from PM/MA column, and transfers to CRM Map
      if (norm === 'waiting') {
        if (isSelecting) {
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: 'WAITING', ...(isPmUser ? { assigneeId: null } : {}) });
          } else {
            await tasksApi.updateTask(task.id, { status: 'WAITING', ...(isPmUser ? { assigneeId: null } : {}) } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info('Task status changed to WAITING — transferred to CRM Map');
        } else {
          const revertStatus = toCanonicalTaskStatus((task as any)._previousStatus || (task.assigneeId ? 'IN PROGRESS' : 'PENDING'));
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: revertStatus });
          } else {
            await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info(`Reverted 'Waiting' — returned to ${revertStatus}`);
        }
        return;
      }

      // 6. On-hold: changes main status to ON-HOLD, transfers to Available Tasks at bottom, excluded from count
      if (norm === 'on-hold' || norm === 'onhold' || norm.includes('hold')) {
        if (isSelecting) {
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: 'ON-HOLD', ...(isPmUser ? { assigneeId: null } : {}) });
          } else {
            await tasksApi.updateTask(task.id, { status: 'ON-HOLD', ...(isPmUser ? { assigneeId: null } : {}) } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info('Task status changed to ON-HOLD — moved to Available Tasks (bottom)');
        } else {
          const revertStatus = toCanonicalTaskStatus((task as any)._previousStatus || 'PENDING');
          if (onTaskUpdate) {
            await onTaskUpdate(task.id, { status: revertStatus });
          } else {
            await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
            onDataRefresh();
          }
          toast.info(`Reverted 'On-hold' — returned to ${revertStatus}`);
        }
        return;
      }
    };

    const guide = getSubStatusTransitionGuide(label, 'TASK_MAP', {
      isSelecting,
      isLiveSession: false,
    });
    setSubStatusGuideTarget({
      task,
      guide,
      onConfirm: executeNonLiveSubStatusTransition,
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div ref={boardScrollRef} className="flex gap-5 px-6 pb-4 overflow-x-auto overflow-y-hidden custom-scrollbar h-full max-h-full min-h-0 select-none cursor-grab">
        {/* 1. Available Tasks Pool Column (Matches Image 1) */}
        {(() => {
          const isCollapsed = resolveColumnCollapsedState(
            'available',
            collapsedColumns,
            currentUser?.id,
            isPmUser
          );
          const isPinned = !!pinnedColumns['available'];
          const isSearchOpen = !!columnSearchOpen['available'];
          const searchQuery = columnSearches['available'] || '';
          const availableFilter = columnPriorityFilters['available'] || 'ALL';
          const availableTaskTypeFilter = columnTaskTypeFilters['available'] || 'ALL';
          const availableSubStatusFilter = columnSubStatusFilters['available'] || 'ALL';
          const isLinkQuery = extractTaskLinkIdentifiers(searchQuery).isLink;
          const baseAvailablePool = isLinkQuery ? availablePool : displayPool;
          const filteredDisplayPool = baseAvailablePool.filter((t) =>
            (isLinkQuery || (
              matchesPriorityFilter(t, availableFilter) &&
              matchesTaskTypeFilter(t, availableTaskTypeFilter) &&
              matchesSubStatusFilter(t, availableSubStatusFilter)
            )) &&
            matchesSearchFilter(t, searchQuery)
          );
          // Exclude On-hold tasks from the task number indicator per user requirement
          const availableActiveCount = countNonOnHoldTasks(displayPool);

          if (isCollapsed) {
            return (
              <DroppableColumn
                key="available-pool-collapsed"
                id="available-pool"
                className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-blue-500/50 ${isPinned ? 'sticky left-0 z-20 ring-1 ring-blue-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                  }`}
              >
                <button
                  type="button"
                  onClick={() => toggleCollapseColumn('available')}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
                  title="Expand Available tasks"
                >
                  <ChevronRight className="size-4 text-blue-400" />
                </button>
                {isPinned && (
                  <Pin className="size-3 text-blue-400 fill-blue-400/40 rotate-45 mb-2" />
                )}
                <span className="size-2.5 rounded-full bg-[#0099ff] mb-2 shrink-0" />
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 mb-4">
                  {availableActiveCount}
                </span>
                <span
                  onClick={() => toggleCollapseColumn('available')}
                  style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                  className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
                >
                  Available tasks
                </span>
              </DroppableColumn>
            );
          }

          const activeDragIsPool = Boolean(activeDragTask && poolIds.has(activeDragTask.id));
          const activeDragOwnerId = activeDragTask && !activeDragIsPool
            ? getEffectiveTaskMapHandlerId(activeDragTask)
            : null;
          const canShowAvailableCutout = Boolean(
            activeDragTask &&
            !activeDragIsPool &&
            (isPmUser || (currentUser?.id && activeDragOwnerId === currentUser.id))
          );

          return (
            <DroppableColumn
              id="available-pool"
              className={`w-[370px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${isPinned ? 'sticky left-0 z-20 ring-1 ring-blue-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                }`}
            >
              {/* Header Top Row: Left side has dot & title; Right side has Search, Pin, and Collapse */}
              <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2 h-7">
                  <span className="size-2 rounded-full bg-[#0099ff] shrink-0" />
                  <h3 className="text-sm font-bold text-zinc-100 truncate">Available tasks</h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">
                    {availableActiveCount}
                  </span>
                </div>

                {/* Top Right: Collapse, Pin, Search (Search on right side) */}
                <div className="flex items-center gap-1 shrink-0 h-7">
                  <button
                    type="button"
                    onClick={() => toggleCollapseColumn('available')}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                    title="Collapse column"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => togglePinColumn('available')}
                    className={`p-1 rounded-md transition-colors cursor-pointer ${isPinned
                      ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                      }`}
                    title={isPinned ? 'Unpin column' : 'Pin column'}
                  >
                    <Pin className={`size-3.5 rotate-45 ${isPinned ? 'fill-blue-400/40' : ''}`} />
                  </button>

                  {isSearchOpen ? (
                    <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-0.5 max-w-[130px] text-xs">
                      <Search className="size-3 text-zinc-400 shrink-0 mr-1" />
                      <input
                        autoFocus
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleColumnSearchChange('available', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') toggleColumnSearch('available');
                        }}
                        placeholder="Search..."
                        className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleColumnSearch('available')}
                        className="text-zinc-400 hover:text-zinc-200 ml-0.5 p-0.5 cursor-pointer"
                        title="Close search"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleColumnSearch('available')}
                      className={`p-1 rounded-md transition-colors cursor-pointer ${searchQuery
                        ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                        }`}
                      title={searchQuery ? `Searching "${searchQuery}"` : 'Search tasks in this column'}
                    >
                      <Search className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Next Line: Filters on the left side (description of available tasks removed) */}
              <div className="flex items-center gap-1.5 justify-start mb-3">
                <ColumnClientDropdown
                  tasks={availablePool}
                  clients={clients}
                  showAdmin={effectiveShowAdmin}
                  onToggleAdmin={() => {
                    if (onToggleAdminTasks) {
                      onToggleAdminTasks();
                    } else {
                      setLocalShowAdmin(!localShowAdmin);
                    }
                  }}
                  selectedClients={selectedClients}
                  onSelectClients={setSelectedClients}
                  isTaskUnderAdmin={isTaskUnderAdmin}
                />

                <ColumnPriorityDropdown
                  columnId="available"
                  tasks={displayPool}
                  activeFilter={availableFilter}
                  onSelectFilter={handleSelectPriorityFilter}
                />

                <ColumnTaskTypeDropdown
                  columnId="available"
                  tasks={displayPool}
                  activeFilter={availableTaskTypeFilter}
                  onSelectFilter={handleSelectTaskTypeFilter}
                />

                <ColumnSubStatusDropdown
                  columnId="available"
                  tasks={displayPool}
                  activeFilter={availableSubStatusFilter}
                  onSelectFilter={handleSelectSubStatusFilter}
                />

                {searchQuery && (
                  <span className="text-[10px] text-zinc-400 italic">
                    ({filteredDisplayPool.length} of {displayPool.length})
                  </span>
                )}
              </div>

              {/* Cards List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 px-1.5 py-1 min-h-0">
                <ColumnDropCutout
                  columnId="available-pool"
                  canShow={canShowAvailableCutout}
                  task={activeDragTask}
                  targetName="Available Tasks"
                  isUnassign
                  carriedSubtasks={remainingAvailableSubtasks}
                  getSubStatusStyle={(st, item) => getTaskMapSubStatusStyle(st, getUnifiedTaskMapOptions(item))}
                />
                {filteredDisplayPool.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic text-center py-12">
                    {displayPool.length > 0
                      ? 'No tasks match the selected priority filter.'
                      : 'No available tasks in the pool.'}
                  </p>
                ) : (
                  sortAvailablePoolTasks(filteredDisplayPool).map((task) => {
                    const priorityConfig = getPriorityConfig(task.priority);
                    const isClosed =
                      (task.status || '').toUpperCase() === 'CLOSED' ||
                      (task.status || '').toUpperCase() === 'DONE';
                    const isSubtask = Boolean(task.isSubtask);
                    const hasParentInColumn = Boolean(
                      isSubtask &&
                      task.parentTaskId &&
                      filteredDisplayPool.some((p) => !p.isSubtask && p.id === task.parentTaskId)
                    );
                    const isSeparatedSubtask = isSubtask && !hasParentInColumn;

                    const clientName = task.progress?.client || task.list?.name || '';
                    const isClientConfiguredUpwork = upworkClients.some(
                      (c) => c.toLowerCase() === clientName.toLowerCase()
                    );
                    const hasManualUpworkTag = (task.taskMap?.statuses || []).some((s) => s.toLowerCase().startsWith('upwork'));
                    const isProjectBased = isProjectBasedUpwork(clientName) ||
                      upworkProjectClients.some((c) => c.toLowerCase() === clientName.toLowerCase());
                    const isLauren = clientName.toLowerCase().includes('lauren');

                    // Upwork determination: Lauren is project-based (only Upwork if manually marked or in upworkClients); otherwise check configured list/tracker/tag
                    const isUpwork = isLauren && !hasManualUpworkTag && !isClientConfiguredUpwork
                      ? false
                      : Boolean(
                        isClientConfiguredUpwork ||
                        task.progress?.isUpwork ||
                        task.progress?.timeTracker?.toLowerCase().includes('upwork') ||
                        task.list?.name?.toLowerCase().includes('upwork') ||
                        hasManualUpworkTag
                      );
                    // Available pool tasks are unassigned/handed-over and never active live-working sessions with missing time
                    const isMissingTime = false;
                    // Only "live" when the MA actively clocked in (Time In) and has not clocked out
                    const isLive = Boolean(
                      task.progress?.timeIn &&
                      !task.progress?.timeOut &&
                      !task.progress?.isMissingTime &&
                      !isStaleLiveSession(task.progress?.timeIn, task.progress?.date, boardTime)
                    );

                    const taskStatusHex = resolveTaskStatusColor(
                      task.status || 'IN PROGRESS',
                      task.listId || task.list?.id,
                      task.list?.statuses
                    );
                    const isCustomLiveBorder = isLive && !(isUpwork && isLive) && !isMissingTime;
                    const cardBorderClass = isUpwork && isLive
                      ? 'border-indigo-500/70 ring-1 ring-indigo-500/20 shadow-[0_0_12px_rgba(99,102,241,0.15)] dark:border-white/60 dark:ring-white/20 dark:shadow-[0_0_12px_rgba(255,255,255,0.08)]'
                      : isMissingTime
                        ? 'border-red-500/60 ring-1 ring-red-500/25 shadow-[0_0_12px_rgba(239,68,68,0.12)]'
                        : isLive
                          ? ''
                          : isSubtask && hasParentInColumn
                            ? 'border-indigo-500/35 not-has-[[data-card-control]:hover]:hover:border-indigo-400/60 shadow-md'
                            : isSeparatedSubtask
                              ? 'border-amber-500/30 not-has-[[data-card-control]:hover]:hover:border-amber-400/55 shadow-md'
                              : 'border-border hover:border-zinc-700 shadow-md';

                    return (
                      <DraggableTaskCard
                        key={task.id}
                        task={task}
                        disabled={!isPmUser}
                      >
                        <div className={isSubtask && hasParentInColumn ? 'relative pl-4' : ''}>
                          {isSubtask && hasParentInColumn && (
                            <div
                              className="absolute left-1.5 top-0 bottom-2 w-2.5 border-l-2 border-b-2 border-indigo-500/50 rounded-bl-md pointer-events-none"
                              aria-hidden="true"
                            />
                          )}
                          <div
                            onClick={(e) => {
                              if (e.defaultPrevented || activeDragTask) return;
                              onOpenDetail(task);
                            }}
                            className={`p-3 bg-zinc-900 not-has-[[data-card-control]:hover]:hover:bg-zinc-800/80 not-has-[[data-card-control]:hover]:hover:border-zinc-600/80 not-has-[[data-card-control]:hover]:hover:shadow-md active:scale-[0.99] border rounded-xl min-h-[112px] flex items-stretch gap-3 transition-all group cursor-pointer ${cardBorderClass}`}
                            style={
                              isCustomLiveBorder
                                ? {
                                    borderColor: hexToRgba(taskStatusHex, 0.8),
                                    boxShadow: `0 0 0 1px ${hexToRgba(taskStatusHex, 0.3)}, 0 0 14px ${hexToRgba(taskStatusHex, 0.15)}`,
                                  }
                                : undefined
                            }
                          >
                            {/* Left: Task Info (Task title only in title line, circle dot beside bulletin below) */}
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                              {/* Client Name + Subtask Marker */}
                              <div className="text-[11px] font-medium truncate max-w-[170px] mb-1 flex items-center gap-1.5">
                                {isSubtask && hasParentInColumn && (
                                  <span
                                    className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 font-bold text-[10px] shrink-0"
                                    title={task.parentTaskTitle ? `Subtask of: ${task.parentTaskTitle}` : 'Subtask'}
                                  >
                                    <CornerDownRight className="size-2.5 shrink-0" />
                                  </span>
                                )}
                                {isSeparatedSubtask && (
                                  <span
                                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 font-mono font-bold text-[10px] shrink-0"
                                    title={task.parentTaskTitle ? `Separated subtask of: ${task.parentTaskTitle}` : 'Separated subtask'}
                                  >
                                    --
                                  </span>
                                )}
                                {isUpwork && isLive ? (
                                  <span className="text-indigo-600 dark:text-white font-bold uppercase tracking-wider flex items-center gap-1 truncate">
                                    <span className="size-1.5 rounded-full bg-indigo-500 dark:bg-white animate-pulse shrink-0" />
                                    {isProjectBased ? `[PROJ] ${task.progress?.client || task.list?.name || 'Upwork'}` : (task.progress?.client || task.list?.name || 'Upwork')}
                                  </span>
                                ) : isLive ? (
                                  <span
                                    className="font-semibold truncate flex items-center gap-1"
                                    style={{ color: taskStatusHex }}
                                  >
                                    <span
                                      className="size-1.5 rounded-full animate-ping shrink-0"
                                      style={{ backgroundColor: taskStatusHex }}
                                    />
                                    {task.progress?.client || task.list?.name || 'General'}
                                  </span>
                                ) : isMissingTime ? (
                                  <span className="text-red-400 font-semibold truncate flex items-center gap-1">
                                    <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                                    {task.progress?.client || task.list?.name || 'General'}
                                  </span>
                                ) : (
                                  <span className="text-zinc-400 truncate">
                                    {task.progress?.client || task.list?.name || 'General'}
                                  </span>
                                )}
                              </div>

                              {/* Title */}
                              <h4
                                className="text-[13px] font-bold text-zinc-100 group-hover:text-white line-clamp-2 leading-snug my-0.5 h-[36px]"
                                title={isSubtask && task.parentTaskTitle ? `${task.title} (Parent: ${task.parentTaskTitle})` : task.title}
                              >
                                {isSubtask ? (task.title || '').replace(/^--\s*/, '') : task.title}
                              </h4>

                              {/* Controls row: circle dot left of bulletin, priority flag */}
                              <div
                                className="flex items-center gap-2 text-xs text-zinc-500 pt-1"
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* Circle Dot Status Indicator */}
                                <CardStatusDropdown
                                  taskId={task.id}
                                  currentStatus={task.status || 'In progress'}
                                  listId={task.listId || task.list?.id}
                                  listStatuses={task.list?.statuses}
                                  onSelect={(newStatus: string) => {
                                    const normNew = newStatus.toLowerCase().replace(/[\s_-]+/g, '');
                                    if (normNew === 'toreview' || normNew === 'inreview' || normNew === 'handover') {
                                      setDeliverablesModalTarget({
                                        task,
                                        targetStatus: normNew === 'handover' ? 'Hand-over' : 'To Review',
                                        realTaskId: task.id,
                                      });
                                      return;
                                    }
                                    let effectiveStatus = newStatus;
                                    if (onTaskUpdate) {
                                      onTaskUpdate(task.id, { status: effectiveStatus });
                                    } else {
                                      tasksApi
                                        .updateTask(task.id, { status: effectiveStatus })
                                        .then(() => onDataRefresh())
                                        .catch((e: any) => toast.error(e.message));
                                    }
                                  }}
                                />

                                {/* Bulletin Icon - click shows task description */}
                                <TaskDescriptionButton
                                  description={task.description}
                                  taskTitle={task.title}
                                />

                                {/* Priority Flag and Label */}
                                <CardPriorityDropdown
                                  taskId={task.id}
                                  priority={task.priority || 'NORMAL'}
                                  onSelect={(newPriority: string) => {
                                    if (onTaskUpdate) {
                                      onTaskUpdate(task.id, { priority: newPriority });
                                    } else {
                                      tasksApi
                                        .updateTask(task.id, { priority: newPriority as any })
                                        .then(() => onDataRefresh())
                                        .catch((e: any) => toast.error(e.message));
                                    }
                                  }}
                                />
                              </div>
                            </div>

                            {/* Separator */}
                            <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                            {/* Right: Section where Sub-Status is (with Time Progress in top right corner) */}
                            <div className="w-[130px] sm:w-[145px] shrink-0 flex flex-col justify-between py-0.5">
                              <div className="flex flex-col items-end gap-0.5">
                                <TaskTimeProgressSlot task={task} isLive={false} />
                                <TaskEstimateLabel task={task} />
                              </div>

                              <div
                                className="w-full"
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-1 mb-1">
                                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider shrink-0">
                                    Sub-Status
                                  </span>
                                  {canTransferTaskMapCard(isPmUser) && !task.isAssumptionBlock && (
                                    <CardTransferDropdown
                                      taskId={task.id}
                                      currentAssigneeId={getEffectiveTaskMapHandlerId(task)}
                                      users={transferableUsers}
                                      onTransfer={(targetUserId) => handleTransferTaskCard(task, targetUserId)}
                                    />
                                  )}
                                </div>
                                <TaskMapStatusDropdown
                                  selectedStatuses={task.taskMap.statuses || []}
                                  options={getUnifiedTaskMapOptions(task)}
                                  onToggleStatus={(label, nextStatuses) =>
                                    handleTaskMapSubStatusToggle(task, label, nextStatuses)
                                  }
                                  onOptionsUpdated={onOptionsUpdated}
                                  readOnly={Boolean(task.isAssumptionBlock)}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </DraggableTaskCard>
                    );
                  })
                )}
              </div>
            </DroppableColumn>
          );
        })()}

        {/* 1.5 Supervise Column (PMs & Admins only; live progress >= 20 mins) */}
        {isPmUser && (
          <InstructionLiveColumn
            sortedUserColumns={sortedUserColumns}
            isCollapsed={resolveColumnCollapsedState(
              'instruction-live',
              collapsedColumns,
              currentUser?.id,
              isPmUser
            )}
            isPinned={!!pinnedColumns['instruction-live']}
            onToggleCollapse={() => toggleCollapseColumn('instruction-live')}
            onTogglePin={() => togglePinColumn('instruction-live')}
            onOpenDetail={onOpenDetail}
            isTaskLiveWorking={isTaskLiveWorking}
            upworkClients={upworkClients}
            upworkProjectClients={upworkProjectClients}
            currentDate={currentDate}
            superviseChecks={superviseChecks}
            onSuperviseCheck={onSuperviseCheck}
            onSuperviseUncheck={onSuperviseUncheck}
            onTaskUpdate={onTaskUpdate}
            onDataRefresh={onDataRefresh}
            onOpenDeliverables={(targetTask, targetStatus, targetUser, rTaskId) => {
              setDeliverablesModalTarget({
                task: targetTask,
                targetStatus,
                user: targetUser,
                realTaskId: rTaskId,
              });
            }}
          />
        )}

        {/* 2. User Shift Columns (Matches Image 1 & 4) */}
        {sortedUserColumns.map(([userId, { user, tasks: userTasks }]) => {
          const initials = (user.name || 'U').substring(0, 2).toUpperCase();
          const avatarBg = getAssigneeAvatarColor(user.name || 'U');
          const isCollapsed = resolveColumnCollapsedState(
            userId,
            collapsedColumns,
            currentUser?.id,
            isPmUser
          );
          const isPinned = !!pinnedColumns[userId];
          const isSearchOpen = !!columnSearchOpen[userId];
          const searchQuery = columnSearches[userId] || '';
          const userPriorityFilter = columnPriorityFilters[userId] || 'ALL';
          const userTaskTypeFilter = columnTaskTypeFilters[userId] || 'ALL';
          const userSubStatusFilter = columnSubStatusFilters[userId] || 'ALL';
          const userClientFilter = columnClientFilters[userId] || 'ALL';
          const userShowAdmin = columnShowAdmin[userId] ?? (isDeveloperUser(user, workspaceTeams) ? true : effectiveShowAdmin);

          const isColLinkQuery = extractTaskLinkIdentifiers(searchQuery).isLink;
          const filteredUserTasks = userTasks.filter((t) => {
            if (!matchesSearchFilter(t, searchQuery)) return false;
            if (isColLinkQuery) return true;
            if (!matchesPriorityFilter(t, userPriorityFilter)) return false;
            if (!matchesTaskTypeFilter(t, userTaskTypeFilter)) return false;
            if (!matchesSubStatusFilter(t, userSubStatusFilter)) return false;

            // Admin task check: hide all tasks that are for the admin by default,
            // except the General Task (assumption block), real tasks inputted by this MA from the spreadsheet,
            // or tasks paused in this user's column so they stay visible in Queue!
            const isAdmin = isTaskUnderAdmin(t);
            const hasUserSheetInput = Boolean(
              hasSpreadsheetTaskInput(t, { isHistory, now: boardTime, targetDate: currentDate }) &&
              doesProgressMatchUser(t.progress?.maName, user.name)
            );
            const isPausedInColumn = (t.taskMap?.statuses || []).some(
              (s) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'PAUSED'
            );
            if (isAdmin && !t.isAssumptionBlock && !userShowAdmin && !hasUserSheetInput && !isPausedInColumn && !searchQuery) return false;

            // Client filter check: the General Task representing the user's active schedule input is always shown in their column
            if (!t.isAssumptionBlock && userClientFilter !== 'ALL') {
              const clientId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
              const clientName = t.list?.name || 'General';
              if (!userClientFilter.includes(clientId) && !userClientFilter.includes(clientName)) {
                return false;
              }
            }
            return true;
          });
          const userActiveCount = countNonOnHoldTasks(userTasks);

          if (isCollapsed) {
            return (
              <DroppableColumn
                key={userId}
                id={`user-${userId}`}
                className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-zinc-800/80 rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-zinc-700 ${isPinned ? 'ring-1 ring-blue-500/40 border-blue-500/30' : ''
                  }`}
              >
                <button
                  type="button"
                  onClick={() => toggleCollapseColumn(userId)}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
                  title={`Expand ${user.name}`}
                >
                  <ChevronRight className="size-4 text-zinc-400" />
                </button>
                {isPinned && (
                  <Pin className="size-3 text-blue-400 fill-blue-400/40 rotate-45 mb-2" />
                )}
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="size-7 rounded-full object-cover border border-zinc-700/80 shrink-0 mb-2"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div
                    className={`size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0 mb-2 ${avatarBg}`}
                  >
                    {initials}
                  </div>
                )}
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 mb-4">
                  {userActiveCount}
                </span>
                <span
                  onClick={() => toggleCollapseColumn(userId)}
                  style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                  className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
                >
                  {user.name}
                </span>
              </DroppableColumn>
            );
          }

          return (
            <DroppableColumn
              key={userId}
              id={`user-${userId}`}
              className={`w-[370px] shrink-0 flex flex-col bg-card/90 border border-zinc-800/80 rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${isPinned ? 'ring-1 ring-blue-500/30 border-blue-500/40 shadow-blue-950/20' : ''
                }`}
            >
              {/* User Column Header */}
              {(() => {
                const roleInfo = getUserRolePriority(user.roles || [], user.isAudit);

                return (
                  <>
                    {/* Header Top Row: Left side has Avatar, Name, Role; Right side has Search, Pin, and Collapse */}
                    <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2 h-7">
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.name}
                            className="size-7 rounded-full object-cover border border-zinc-700/80 shrink-0"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div
                            className={`size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0 ${avatarBg}`}
                          >
                            {initials}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-bold text-zinc-100 truncate" title={user.name}>
                            {user.name}
                          </span>
                          <UserRoleBadge user={user} />
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 shrink-0">
                            {userActiveCount}
                          </span>
                        </div>
                      </div>

                      {/* Top Right: Reset, Collapse, Pin, Search (Search on right side) */}
                      <div className="flex items-center gap-1 shrink-0 h-7">
                        <button
                          type="button"
                          onClick={() => handleResetColumn(userId, user.name)}
                          className="p-1 text-zinc-400 hover:text-amber-400 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                          title={`Reset ${user.name}'s column (return pending tasks to Available tasks)`}
                        >
                          <RotateCcw className="size-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleCollapseColumn(userId)}
                          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                          title="Collapse column"
                        >
                          <ChevronLeft className="size-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => togglePinColumn(userId)}
                          className={`p-1 rounded-md transition-colors cursor-pointer ${isPinned
                            ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                            }`}
                          title={isPinned ? 'Unpin column' : 'Pin column'}
                        >
                          <Pin className={`size-3.5 rotate-45 ${isPinned ? 'fill-blue-400/40' : ''}`} />
                        </button>

                        {isSearchOpen ? (
                          <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-0.5 max-w-[130px] text-xs">
                            <Search className="size-3 text-zinc-400 shrink-0 mr-1" />
                            <input
                              autoFocus
                              type="text"
                              value={searchQuery}
                              onChange={(e) => handleColumnSearchChange(userId, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') toggleColumnSearch(userId);
                              }}
                              placeholder="Search..."
                              className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => toggleColumnSearch(userId)}
                              className="text-zinc-400 hover:text-zinc-200 ml-0.5 p-0.5 cursor-pointer"
                              title="Close search"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleColumnSearch(userId)}
                            className={`p-1 rounded-md transition-colors cursor-pointer ${searchQuery
                              ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                              }`}
                            title={searchQuery ? `Searching "${searchQuery}"` : 'Search tasks in this column'}
                          >
                            <Search className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Next Line: Filters on the left side (Both Client and Priority filters per user) */}
                    <div className="flex items-center gap-1.5 justify-start mb-3">
                      <ColumnClientDropdown
                        tasks={userTasks}
                        clients={clients}
                        showAdmin={userShowAdmin}
                        onToggleAdmin={() =>
                          setColumnShowAdmin((prev) => ({
                            ...prev,
                            [userId]: !userShowAdmin,
                          }))
                        }
                        selectedClients={userClientFilter}
                        onSelectClients={(nextClients) =>
                          setColumnClientFilters((prev) => ({
                            ...prev,
                            [userId]: nextClients,
                          }))
                        }
                        isTaskUnderAdmin={isTaskUnderAdmin}
                      />
                      <ColumnPriorityDropdown
                        columnId={userId}
                        tasks={userTasks}
                        activeFilter={userPriorityFilter}
                        onSelectFilter={handleSelectPriorityFilter}
                      />
                      <ColumnTaskTypeDropdown
                        columnId={userId}
                        tasks={userTasks}
                        activeFilter={userTaskTypeFilter}
                        onSelectFilter={handleSelectTaskTypeFilter}
                      />
                      <ColumnSubStatusDropdown
                        columnId={userId}
                        tasks={userTasks}
                        activeFilter={userSubStatusFilter}
                        onSelectFilter={handleSelectSubStatusFilter}
                      />
                      {searchQuery && (
                        <span className="text-[10px] text-zinc-400 italic">
                          ({filteredUserTasks.length} of {userTasks.length})
                        </span>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* Tasks in Step Order */}
              {(() => {
                const sorted = sortColumnTasks(filteredUserTasks, user.name);
                const activeInProgTask = sorted.find((t) => isTaskActiveInProgress(t, user.name));
                const queuedTasks = sorted.filter((t) => t.id !== activeInProgTask?.id && !isTaskHandedOver(t) && !isClosedTask(t));
                const reviewStatusSet = new Set(['INREVIEW', 'TOREVIEW', 'REVIEW', 'CHECKING', 'INCHECKING']);
                const activeAndQueuedIds = new Set(sorted.map((t) => t.id));
                const toReviewMap = new Map<string, TaskMapItem>();
                const isViewingToday = !currentDate || currentDate === getManilaDateKey(new Date());
                if (isViewingToday) {
                  for (const t of recentlyMovedToReviewByUser[userId] || []) {
                    if (!activeAndQueuedIds.has(t.id)) {
                      toReviewMap.set(t.id, t);
                    }
                  }
                }
                for (const t of tasks) {
                  if (activeAndQueuedIds.has(t.id) || toReviewMap.has(t.id)) continue;
                  const sNorm = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
                  if (!reviewStatusSet.has(sNorm)) continue;
                  const matchesWorker =
                    doesProgressMatchUser(t.progress?.maName, user.name) &&
                    hasSpreadsheetTaskInput(t, { isHistory, now: boardTime, targetDate: currentDate });
                  if (matchesWorker) {
                    toReviewMap.set(t.id, t);
                  }
                }
                const toReviewTasks = Array.from(toReviewMap.values());

                const renderCard = (task: TaskMapItem, cardOptions?: { forceNonDraggable?: boolean }) => {
                  const priorityConfig = getPriorityConfig(task.priority);
                  const isClosed =
                    (task.status || '').toUpperCase() === 'CLOSED' ||
                    (task.status || '').toUpperCase() === 'DONE';
                  const isSubtask = Boolean(task.isSubtask);
                  const hasParentInColumn = Boolean(
                    isSubtask &&
                    task.parentTaskId &&
                    sorted.some((p) => !p.isSubtask && p.id === task.parentTaskId)
                  );
                  const isSeparatedSubtask = isSubtask && !hasParentInColumn;

                  // Worker isolation: only display sheet progress if it was logged by THIS column's user!
                  const isMyProgress = Boolean(task.isAssumptionBlock || doesProgressMatchUser(task.progress?.maName, user.name));
                  const effectiveProgress = isMyProgress ? task.progress : null;

                  const clientName = effectiveProgress?.client || task.progress?.client || task.list?.name || '';
                  const isClientConfiguredUpwork = upworkClients.some(
                    (c) => c.toLowerCase() === clientName.toLowerCase()
                  );
                  const hasManualUpworkTag = (task.taskMap?.statuses || []).some((s) => s.toLowerCase().startsWith('upwork'));
                  const isProjectBased = isProjectBasedUpwork(clientName) ||
                    upworkProjectClients.some((c) => c.toLowerCase() === clientName.toLowerCase());
                  const isLauren = clientName.toLowerCase().includes('lauren');

                  // Upwork determination: Lauren is project-based (only Upwork if manually marked or in upworkClients); otherwise check configured list/tracker/tag
                  const isUpwork = isLauren && !hasManualUpworkTag && !isClientConfiguredUpwork
                    ? false
                    : Boolean(
                      isClientConfiguredUpwork ||
                      effectiveProgress?.isUpwork ||
                      effectiveProgress?.timeTracker?.toLowerCase().includes('upwork') ||
                      task.list?.name?.toLowerCase().includes('upwork') ||
                      hasManualUpworkTag
                    );
                  const isMissingTime = Boolean(effectiveProgress?.isMissingTime);
                  // Live working when the MA actively clocked in (Time In) and has not clocked out (and not stale)
                  // STRICT RULE: Only the single task in the In Progress slot (activeInProgTask) can EVER be Live Working!
                  const isLiveWorking = Boolean(
                    task.id === activeInProgTask?.id &&
                    effectiveProgress?.timeIn &&
                    !effectiveProgress?.timeOut &&
                    !effectiveProgress?.isMissingTime &&
                    (task.isAssumptionBlock || !isStaleLiveSession(effectiveProgress?.timeIn, effectiveProgress?.date, boardTime))
                  );
                  const taskStatusHex = resolveTaskStatusColor(
                    task.status || 'IN PROGRESS',
                    task.listId || task.list?.id,
                    task.list?.statuses
                  );
                  const isUpworkLiveWorking = Boolean(isUpwork && isLiveWorking);
                  const isCustomLiveWorkingBorder = isLiveWorking && !isUpworkLiveWorking && !isMissingTime;
                  // Only highlight tasks that are actively live working (with a counting timer);
                  // the breathing animation is rendered on a border-only overlay so card contents stay at full opacity.
                  const cardBorderClass = isUpworkLiveWorking
                    ? 'border-indigo-500/35 dark:border-white/35 shadow-sm'
                    : isMissingTime
                      ? 'border-red-500/60 ring-1 ring-red-500/25 shadow-[0_0_12px_rgba(239,68,68,0.12)]'
                      : isLiveWorking
                        ? 'shadow-sm'
                        : isSubtask && hasParentInColumn
                          ? 'border-indigo-500/35 not-has-[[data-card-control]:hover]:hover:border-indigo-400/60 shadow-sm'
                          : isSeparatedSubtask
                            ? 'border-amber-500/30 not-has-[[data-card-control]:hover]:hover:border-amber-400/55 shadow-sm'
                            : 'border-border dark:border-zinc-800/90 hover:border-zinc-700 shadow-sm';

                  const canDragThisCard = cardOptions?.forceNonDraggable
                    ? false
                    : canDragTaskMapCard({
                        isPmUser,
                        currentUserId: currentUser?.id,
                        columnUserId: userId,
                        isFromAvailable: false,
                        isAssumptionBlock: task.isAssumptionBlock,
                      });

                  const realTaskId =
                    task.linkedTaskId && !task.linkedTaskId.startsWith('general-slot-')
                      ? task.linkedTaskId
                      : (!task.isAssumptionBlock ? task.id : null);
                  const realListId =
                    task.listId && task.listId !== 'general'
                      ? task.listId
                      : (task.list?.id && task.list.id !== 'general' ? task.list.id : null);

                  const syncSessionPatch = (patch: Record<string, unknown>) => {
                    if (!user?.name) return;
                    const sKey = (user.name || '').trim().toLowerCase();
                    const prevSess = useAppStore.getState().maActiveSessions[sKey] || {};
                    useAppStore.getState().updateMaActiveSession(user.name, {
                      ...prevSess,
                      ...patch,
                    });
                  };

                  const openResolvedSubtaskOrTaskModal = async (targetId: string, fallbackListId?: string | null) => {
                    if (targetId.startsWith('subtask:')) {
                      const subId = targetId.slice('subtask:'.length);
                      const res = await tasksApi.getTask(subId).catch(() => null);
                      if (res?.task) {
                        onOpenDetail({
                          isSubtask: true,
                          parentTaskId: res.task.id,
                          parentTaskTitle: res.task.title,
                          subtaskId: res.subtask?.id || subId,
                          listId: res.task.listId || fallbackListId,
                          list: res.task.list || task.list,
                          priority: res.task.priority || task.priority,
                        } as any);
                        return true;
                      }
                      return false;
                    }
                    onOpenDetail({
                      ...task,
                      id: targetId,
                      isAssumptionBlock: false,
                      ...(fallbackListId ? { listId: fallbackListId } : {}),
                    });
                    return true;
                  };

                  const handleCardClick = async () => {
                    if (!task.isAssumptionBlock) {
                      onOpenDetail(task);
                      return;
                    }
                    if (realTaskId) {
                      const opened = await openResolvedSubtaskOrTaskModal(realTaskId, realListId);
                      if (opened) return;
                    }
                    try {
                      const resolved = await taskMapApi.getTaskDescription({
                        taskId: realTaskId,
                        title: task.title,
                        client: effectiveProgress?.client || task.list?.name || null,
                      });
                      if (resolved?.taskId || resolved?.listId) {
                        syncSessionPatch({
                          taskId: resolved.taskId || realTaskId,
                          listId: resolved.listId,
                          taskStatus: resolved.status || undefined,
                          priority: resolved.priority || undefined,
                          subStatuses: resolved.subStatuses,
                        });
                        if (resolved.taskId) {
                          const opened = await openResolvedSubtaskOrTaskModal(
                            resolved.taskId,
                            resolved.listId || realListId
                          );
                          if (opened) return;
                        }
                      }
                      toast.info('No matching task found for this session.');
                    } catch {
                      toast.error('Failed to resolve task for this session.');
                    }
                  };

                  return (
                    <DraggableTaskCard key={task.id} task={task} sourceUserId={userId} disabled={!canDragThisCard}>
                      <div className={isSubtask && hasParentInColumn ? 'relative pl-4' : ''}>
                        {isSubtask && hasParentInColumn && (
                          <div
                            className="absolute left-1.5 top-0 bottom-2 w-2.5 border-l-2 border-b-2 border-indigo-500/50 rounded-bl-md pointer-events-none"
                            aria-hidden="true"
                          />
                        )}
                        <div
                          onClick={(e) => {
                            if (e.defaultPrevented || activeDragTask) return;
                            void handleCardClick();
                          }}
                          className={`relative p-3 bg-zinc-900 not-has-[[data-card-control]:hover]:hover:bg-zinc-800/80 not-has-[[data-card-control]:hover]:hover:border-zinc-600/80 not-has-[[data-card-control]:hover]:hover:shadow-md active:scale-[0.99] border rounded-xl min-h-[112px] flex items-stretch gap-3 transition-all group cursor-pointer ${cardBorderClass}`}
                          style={
                            isCustomLiveWorkingBorder
                              ? { borderColor: hexToRgba(taskStatusHex, 0.35) }
                              : undefined
                          }
                        >
                          {(isUpworkLiveWorking || isCustomLiveWorkingBorder) && (
                            <div
                              aria-hidden="true"
                              className={
                                isUpworkLiveWorking
                                  ? 'pointer-events-none absolute -inset-[1px] rounded-xl border border-indigo-500/80 ring-2 ring-indigo-500/30 shadow-[0_0_18px_rgba(99,102,241,0.25)] dark:border-white/80 dark:ring-2 dark:ring-white/30 dark:shadow-[0_0_18px_rgba(255,255,255,0.24)] animate-border-glow-breathe'
                                  : 'pointer-events-none absolute -inset-[1px] rounded-xl border animate-border-glow-breathe'
                              }
                              style={
                                isCustomLiveWorkingBorder
                                  ? {
                                      borderColor: taskStatusHex,
                                      boxShadow: `0 0 0 2px ${hexToRgba(taskStatusHex, 0.5)}, 0 0 20px ${hexToRgba(taskStatusHex, 0.35)}`,
                                    }
                                  : undefined
                              }
                            />
                          )}
                          {/* LEFT: Task Info (Title only in title line, circle dot beside bulletin below) */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                            {/* Client Name + Subtask Marker */}
                            {(() => {
                              const rawClientName = effectiveProgress?.client || task.list?.name || '';
                              const displayClientName = (rawClientName && rawClientName.toLowerCase() !== 'general')
                                ? rawClientName
                                : (task.isAssumptionBlock ? 'No client inputted' : 'General');
                              return (
                                <div className="text-[11px] font-medium truncate max-w-[170px] mb-1 flex items-center gap-1.5">
                                  {isSubtask && hasParentInColumn && (
                                    <span
                                      className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 font-bold text-[10px] shrink-0"
                                      title={task.parentTaskTitle ? `Subtask of: ${task.parentTaskTitle}` : 'Subtask'}
                                    >
                                      <CornerDownRight className="size-2.5 shrink-0" />
                                    </span>
                                  )}
                                  {isSeparatedSubtask && (
                                    <span
                                      className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 font-mono font-bold text-[10px] shrink-0"
                                      title={task.parentTaskTitle ? `Separated subtask of: ${task.parentTaskTitle}` : 'Separated subtask'}
                                    >
                                      --
                                    </span>
                                  )}
                                  {isUpwork && isLiveWorking ? (
                                    <span className="text-indigo-600 dark:text-white font-bold uppercase tracking-wider flex items-center gap-1.5 truncate">
                                      <span className="size-2 rounded-full bg-indigo-500 dark:bg-white animate-pulse shrink-0" />
                                      {isProjectBased ? `[PROJ] ${displayClientName}` : displayClientName}
                                    </span>
                                  ) : isLiveWorking ? (
                                    <span
                                      className="font-bold uppercase tracking-wider flex items-center gap-1.5 truncate"
                                      style={{ color: taskStatusHex }}
                                    >
                                      <span className="relative flex size-2 shrink-0">
                                        <span
                                          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                                          style={{ backgroundColor: taskStatusHex }}
                                        />
                                        <span
                                          className="relative inline-flex rounded-full size-2"
                                          style={{ backgroundColor: taskStatusHex }}
                                        />
                                      </span>
                                      {displayClientName}
                                    </span>
                                  ) : isMissingTime ? (
                                    <span className="text-red-400 font-semibold truncate flex items-center gap-1">
                                      <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                                      {displayClientName}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-400 truncate">
                                      {displayClientName}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Title */}
                            <h4
                              className="text-[13px] font-bold text-zinc-100 group-hover:text-white line-clamp-2 leading-snug my-0.5 h-[36px]"
                              title={isSubtask && task.parentTaskTitle ? `${task.title} (Parent: ${task.parentTaskTitle})` : task.title}
                            >
                              {isSubtask ? (task.title || '').replace(/^--\s*/, '') : task.title}
                            </h4>

                            {/* Controls row: circle dot left of bulletin, priority flag */}
                            <div
                              className="flex items-center gap-2 text-xs text-zinc-500 pt-1"
                              onPointerDown={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* Circle Dot Status Indicator */}
                              <CardStatusDropdown
                                taskId={realTaskId || task.id}
                                currentStatus={task.status || 'In progress'}
                                listId={realListId || undefined}
                                listStatuses={task.list?.statuses}
                                onSelect={(newStatus: string) => {
                                  const normNew = newStatus.toLowerCase().replace(/[\s_-]+/g, '');
                                  if (normNew === 'toreview' || normNew === 'inreview' || normNew === 'handover') {
                                    setDeliverablesModalTarget({
                                      task,
                                      targetStatus: normNew === 'handover' ? 'Hand-over' : 'To Review',
                                      user,
                                      realTaskId: realTaskId || task.id,
                                    });
                                    return;
                                  }
                                  if (normNew === 'inprogress' && !task.isAssumptionBlock && !isTaskLiveWorking(task, user.name, boardTime)) {
                                    void handleSelectInProgressTask(task.id, userId, task);
                                    return;
                                  }
                                  let effectiveStatus = newStatus;
                                  const isClosing = isClosedStatus(effectiveStatus);
                                  if (task.isAssumptionBlock) {
                                    task.status = effectiveStatus;
                                    if (isClosing) {
                                      useAppStore.getState().updateMaActiveSession(user.name, null);
                                    }
                                    syncSessionPatch({
                                      taskStatus: effectiveStatus,
                                      status: effectiveStatus,
                                      ...(isClosing ? { cleared: true } : {}),
                                    });
                                    if (!realTaskId) {
                                      toast.success(`Status updated to ${effectiveStatus}`);
                                      return;
                                    }
                                  }
                                  const targetId = realTaskId || task.id;
                                  const leavesUserColumn = isOtherBoardWorkflowStatus({ status: effectiveStatus }) || isClosing;
                                  const updatePayload: Partial<TaskMapItem> = leavesUserColumn
                                    ? { status: effectiveStatus, assigneeId: null }
                                    : { status: effectiveStatus };
                                  if (onTaskUpdate) {
                                    onTaskUpdate(targetId, updatePayload);
                                  } else {
                                    tasksApi
                                      .updateTask(targetId, updatePayload as any)
                                      .then(() => onDataRefresh())
                                      .catch((e: any) => toast.error(e.message));
                                  }
                                }}
                              />

                              {/* Bulletin Icon - click shows task description (lazy-fetched on press for session blocks) */}
                              <TaskDescriptionButton
                                description={task.description}
                                taskTitle={task.title}
                                taskId={realTaskId}
                                clientName={effectiveProgress?.client || task.list?.name || null}
                                lazyFetch={Boolean(task.isAssumptionBlock)}
                                onResolvedTaskMeta={(meta) => {
                                  if (!task.isAssumptionBlock) return;
                                  syncSessionPatch({
                                    ...(meta.taskId ? { taskId: meta.taskId } : {}),
                                    ...(meta.listId ? { listId: meta.listId } : {}),
                                    ...(meta.status ? { taskStatus: meta.status } : {}),
                                    ...(meta.priority ? { priority: meta.priority } : {}),
                                    ...(Array.isArray(meta.subStatuses) ? { subStatuses: meta.subStatuses } : {}),
                                  });
                                }}
                              />

                              {/* Priority Flag and Label */}
                              <CardPriorityDropdown
                                taskId={realTaskId || task.id}
                                priority={task.priority || 'NORMAL'}
                                onSelect={(newPriority: string) => {
                                  if (task.isAssumptionBlock) {
                                    task.priority = newPriority as any;
                                    syncSessionPatch({ priority: newPriority });
                                    if (!realTaskId) {
                                      toast.success(`Priority updated to ${newPriority}`);
                                      return;
                                    }
                                  }
                                  const targetId = realTaskId || task.id;
                                  if (onTaskUpdate) {
                                    onTaskUpdate(targetId, { priority: newPriority });
                                  } else {
                                    tasksApi
                                      .updateTask(targetId, { priority: newPriority as any })
                                      .then(() => onDataRefresh())
                                      .catch((e: any) => toast.error(e.message));
                                  }
                                }}
                              />
                            </div>
                          </div>

                          {/* SEPARATOR: Vertical line between task info and statuses */}
                          <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                          {/* RIGHT: Section where Sub-Status is (with Time Progress in top right corner) */}
                          <div className="w-[130px] sm:w-[145px] shrink-0 flex flex-col justify-between py-0.5">
                            <div className="flex flex-col items-end gap-0.5">
                              <TaskTimeProgressSlot task={{ ...task, progress: effectiveProgress }} isLive={isLiveWorking} />
                              <TaskEstimateLabel task={task} />
                            </div>

                            <div
                              className="w-full"
                              onPointerDown={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider shrink-0">
                                  Sub-Status
                                </span>
                                {canTransferTaskMapCard(isPmUser) && !task.isAssumptionBlock && (
                                  <CardTransferDropdown
                                    taskId={task.id}
                                    currentAssigneeId={getEffectiveTaskMapHandlerId(task) || userId}
                                    users={transferableUsers}
                                    onTransfer={(targetUserId) => handleTransferTaskCard(task, targetUserId)}
                                  />
                                )}
                              </div>
                              <TaskMapStatusDropdown
                                selectedStatuses={
                                  isLiveWorking
                                    ? ['In progress']
                                    : (task.taskMap.statuses || []).filter(
                                        (s) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') !== 'INPROGRESS'
                                      )
                                }
                                options={getUnifiedTaskMapOptions(task, user)}
                                onToggleStatus={(label, nextStatuses) =>
                                  handleTaskMapSubStatusToggle(task, label, nextStatuses, user)
                                }
                                onOptionsUpdated={onOptionsUpdated}
                                readOnly={Boolean(cardOptions?.forceNonDraggable || task.isAssumptionBlock)}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </DraggableTaskCard>
                  );
                };

                const activeDragIsFromPool = Boolean(activeDragTask && poolIds.has(activeDragTask.id));
                const activeDragSourceOwnerId = activeDragTask && !activeDragIsFromPool
                  ? getEffectiveTaskMapHandlerId(activeDragTask)
                  : null;
                const canShowColumnCutout = Boolean(
                  activeDragTask &&
                  canDropTaskMapCard({
                    isPmUser,
                    currentUserId: currentUser?.id,
                    sourceUserId: activeDragSourceOwnerId,
                    isFromAvailable: activeDragIsFromPool,
                    targetColumnId: `user-${userId}`,
                  }).allowed &&
                  (activeDragIsFromPool || !activeDragTask.assigneeId || activeDragTask.assigneeId !== userId)
                );
                const allowStartInProgress = canStartInProgressSlot({
                  isPmUser,
                  currentUserId: currentUser?.id,
                  columnUserId: userId,
                });

                return (
                  <div data-column-body="true" className="flex-1 overflow-y-auto custom-scrollbar space-y-2 px-1.5 py-1 min-h-0">
                    {/* IN PROGRESS SLOT / CARD */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between px-1">
                        {(() => {
                          const isColumnLiveWorking = Boolean(
                            activeInProgTask && isTaskLiveWorking(activeInProgTask, user.name, boardTime)
                          );
                          const liveSlotLabel =
                            isColumnLiveWorking && activeInProgTask
                              ? (toCanonicalTaskStatus(activeInProgTask.status) || activeInProgTask.status || 'In Progress')
                              : 'In Progress';
                          const liveSlotColor =
                            isColumnLiveWorking && activeInProgTask
                              ? resolveTaskStatusColor(
                                  liveSlotLabel,
                                  activeInProgTask.listId || activeInProgTask.list?.id,
                                  activeInProgTask.list?.statuses
                                )
                              : '#D04A7C';
                          return (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`size-2 rounded-full ${isColumnLiveWorking ? 'animate-pulse' : 'bg-zinc-600'}`}
                                  style={isColumnLiveWorking ? { backgroundColor: liveSlotColor } : undefined}
                                />
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider ${isColumnLiveWorking ? '' : 'text-zinc-400'}`}
                                  style={isColumnLiveWorking ? { color: liveSlotColor } : undefined}
                                >
                                  {liveSlotLabel}
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {activeInProgTask ? (
                        <DroppableInProgressSlot userId={userId} disabled={false}>
                          {renderCard(activeInProgTask)}
                        </DroppableInProgressSlot>
                      ) : (
                        <TaskMapInProgressDropCard
                          userId={userId}
                          userName={user.name}
                          availableTasks={sortAvailablePoolTasks(availablePool)}
                          allAvailableTasks={allAvailablePool ? sortAvailablePoolTasks(allAvailablePool) : undefined}
                          allTasks={allTasks || tasks}
                          queuedTasks={queuedTasks}
                          onSelectTask={(taskId, task) => handleSelectInProgressTask(taskId, userId, task)}
                          disabled={false}
                          canBrowse={allowStartInProgress}
                        />
                      )}
                    </div>

                    {/* QUEUE SECTION */}
                    <div className="mt-2.5 pt-2.5 border-t border-border/80 space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                          Queue ({countNonOnHoldTasks(queuedTasks)})
                        </span>
                      </div>
                      <div className="space-y-2.5">
                        <ColumnDropCutout
                          columnId={`user-${userId}`}
                          canShow={canShowColumnCutout}
                          task={activeDragTask}
                          targetName={user.name}
                          carriedSubtasks={remainingAvailableSubtasks}
                          getSubStatusStyle={(st, item) => getTaskMapSubStatusStyle(st, getUnifiedTaskMapOptions(item))}
                        />
                        {queuedTasks.length > 0 ? (
                          queuedTasks.map((t) => renderCard(t))
                        ) : !canShowColumnCutout ? (
                          <div className="rounded-xl border border-dashed border-zinc-800/80 bg-zinc-950/30 px-3 py-3 text-center">
                            <p className="text-[11px] text-zinc-500">
                              {userTasks.some((t) => t.id !== activeInProgTask?.id && !isTaskHandedOver(t) && !isClosedTask(t))
                                ? 'Queued tasks hidden by active column filters'
                                : 'No tasks in queue — paused or assigned tasks appear here'}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* TO REVIEW SECTION (transparent, non-draggable) */}
                    {toReviewTasks.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-border/80 space-y-1.5">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            To Review ({toReviewTasks.length})
                          </span>
                        </div>
                        <div className="space-y-2.5 opacity-50">
                          {toReviewTasks.map((t) => renderCard(t, { forceNonDraggable: true }))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </DroppableColumn>
          );
        })}
      </div>

      {/* Drag Overlay Preview (1:1 card & carried subtasks, lightweight lift) */}
      <DragOverlay
        zIndex={100}
        className="will-change-transform transform-gpu"
        dropAnimation={{
          duration: 150,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        {activeDragTask ? (
          <div className="w-[340px] pointer-events-none cursor-grabbing transform-gpu will-change-transform animate-in fade-in zoom-in-[0.98] duration-100 ease-out">
            <DragPreviewCard
              item={activeDragTask}
              getSubStatusStyle={(st, item) => getTaskMapSubStatusStyle(st, getUnifiedTaskMapOptions(item))}
            />

            {remainingAvailableSubtasks.length > 0 && (
              <div className="pl-4 mt-2 space-y-2 relative">
                <div className="absolute left-1.5 top-0 bottom-3 w-px bg-zinc-700/60" />
                {remainingAvailableSubtasks.slice(0, 3).map((sub) => (
                  <DragPreviewCard
                    key={sub.id}
                    item={sub}
                    fallbackListName={activeDragTask.list?.name}
                    getSubStatusStyle={(st, item) => getTaskMapSubStatusStyle(st, getUnifiedTaskMapOptions(item))}
                  />
                ))}
                {remainingAvailableSubtasks.length > 3 && (
                  <div className="px-2.5 py-1 rounded-lg bg-zinc-900/90 border border-zinc-700/80 text-[11px] font-medium text-zinc-300 text-center shadow-md">
                    +{remainingAvailableSubtasks.length - 3} more available subtask{remainingAvailableSubtasks.length - 3 > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </DragOverlay>

      {/* Action Error Modal for role restriction failures & permission issues */}
      <ActionErrorModal
        isOpen={!!actionError}
        onClose={() => setActionError(null)}
        error={actionError}
      />

      {/* Client Overtime Lock OTP Authorization Modal */}
      <ClientOtpModal
        isOpen={clientOtpModal.isOpen}
        onClose={() => setClientOtpModal(prev => ({ ...prev, isOpen: false }))}
        clientName={clientOtpModal.clientName}
        hoursLogged={clientOtpModal.hoursLogged}
        weeklyLimit={clientOtpModal.weeklyLimit}
        onSuccess={async (otp, pmName) => {
          if (!clientOtpModal.taskId || !clientOtpModal.targetUserId) return;
          try {
            if (onAssignTask) {
              await onAssignTask(
                clientOtpModal.taskId,
                clientOtpModal.targetUserId,
                clientOtpModal.mode,
                clientOtpModal.nextRoles,
                otp
              );
            } else {
              await taskMapApi.assignTask(
                clientOtpModal.taskId,
                clientOtpModal.targetUserId,
                clientOtpModal.mode,
                { assigneeRoleRestrictions: clientOtpModal.nextRoles, otp }
              );
              onDataRefresh();
            }
            toast.success(`Task assigned under authorization from PM ${pmName}!`);
          } catch (err: any) {
            toast.error(err.message || 'Failed to assign task after authorization');
          }
        }}
      />

      {/* Task Deliverables & Clock-Out Submission Modal */}
      {deliverablesModalTarget && (
        <TaskDeliverablesModal
          isOpen={!!deliverablesModalTarget}
          onClose={() => setDeliverablesModalTarget(null)}
          onSubmit={handleDeliverablesSubmit}
          taskTitle={deliverablesModalTarget.task.title}
          clientName={deliverablesModalTarget.task.progress?.client || deliverablesModalTarget.task.list?.name || ''}
          isAdminTask={isTaskUnderAdmin(deliverablesModalTarget.task)}
          targetStatus={deliverablesModalTarget.targetStatus}
          initialDeliverables={deliverablesModalTarget.task.progress?.taskDeliverablesDescription || deliverablesModalTarget.task.title}
          initialUpdate={deliverablesModalTarget.task.progress?.taskUpdateAndDeliverables || ''}
          userName={deliverablesModalTarget.user?.name || deliverablesModalTarget.task.assignee?.name}
          timeIn={deliverablesModalTarget.task.progress?.timeIn || ''}
        />
      )}

      {/* Inactive MA Confirmation Modal */}
      {inactiveMaModal && (
        <InactiveMaConfirmModal
          isOpen={inactiveMaModal.isOpen}
          onClose={() => setInactiveMaModal(null)}
          onConfirm={inactiveMaModal.onConfirm}
          targetUserName={inactiveMaModal.targetUserName}
          taskTitle={inactiveMaModal.taskTitle}
          reason={inactiveMaModal.reason}
          elapsedLabel={inactiveMaModal.elapsedLabel}
          recentRows={inactiveMaModal.recentRows}
          source={inactiveMaModal.source}
        />
      )}

      {/* Sub-Status Change Guide Modal */}
      {subStatusGuideTarget && (
        <SubStatusChangeGuideModal
          isOpen={true}
          onClose={() => setSubStatusGuideTarget(null)}
          onConfirm={subStatusGuideTarget.onConfirm}
          guide={subStatusGuideTarget.guide}
          taskTitle={subStatusGuideTarget.task.title}
          clientName={subStatusGuideTarget.task.progress?.client || subStatusGuideTarget.task.list?.name || ''}
          currentSubStatuses={subStatusGuideTarget.task.taskMap?.statuses || []}
          currentMainStatus={subStatusGuideTarget.task.status}
        />
      )}
    </DndContext>
  );
};
