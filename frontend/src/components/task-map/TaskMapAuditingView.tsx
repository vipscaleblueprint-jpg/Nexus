'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  TaskMapItem,
  TaskMapOption,
  taskMapApi,
  hasUiUxOrDesignAudit,
  canPerformAudit,
  getCompletedAuditActorIds,
  getTaskAuditStatus,
  isUiUxAudit,
  isFunnelAudit,
  getEffectiveTaskMapHandlerId,
  isTaskMapItemOnHold,
  isTaskHandedOver,
  countNonOnHoldTasks,
  TASK_MAP_STATUS_COLORS,
  toCanonicalTaskStatus,
  matchesMarketingNameSearch,
  subscribeTaskMapSaving,
  isTaskSavingToDb,
  isTaskUnderAdmin,
  formatManilaTime,
  getSubStatusTransitionGuide,
  SubStatusTransitionGuide,
  findSearchedTaskLocations,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { auditShiftsApi } from '@/api/auditShifts';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';
import { useLiveClock } from '@/lib/liveClock';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import { UserRoleBadge } from './UserRoleBadge';
import { TaskMapInProgressDropCard } from './TaskMapInProgressDropCard';
import { isTaskActiveInProgress, isTaskLiveWorking } from './TaskMapBoardView';
import {
  ShieldCheck,
  Pin,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  User,
  Infinity as InfinityIcon,
  RotateCcw,
  Loader2,
  Scale,
  CornerDownRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { isAuditorUser, isProjectManagerOrAdmin, canTransitionTaskStatus, canUserEditTask, canUserMoveTask } from '@/lib/permissions';
import { UncheckedAuditsModal } from '@/components/modals/UncheckedAuditsModal';
import { SubStatusChangeGuideModal } from '@/components/modals/SubStatusChangeGuideModal';
import { toast } from '@/lib/toast';
import { isClosedStatus } from '@/lib/taskTokens';
import { isDesignAudit, isProductionAudit, isInstructionAudit } from '@/lib/auditChecklist';
import { useHorizontalScroll } from '@/lib/useHorizontalScroll';
import {
  CardStatusDropdown,
  CardPriorityDropdown,
  ColumnPriorityDropdown,
  matchesPriorityFilter,
  matchesSearchFilter,
  sortTasksUrgentFirst,
  hexToRgba,
  resolveSubStatusColor,
  resolveTaskStatusColor,
  TaskEstimateLabel,
} from './TaskMapCardControls';
import { ColumnClientDropdown } from './ColumnClientDropdown';
import { ColumnSubStatusDropdown, matchesSubStatusFilter } from './ColumnSubStatusDropdown';
import { TaskCardAuditChecklist } from './TaskCardAuditChecklist';
import { useAppStore } from '@/lib/store';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';

interface Props {
  /** Header slot (PMs/Admins, today's board) the Distribute button renders into, like the Task Map's. */
  headerActionsSlot?: HTMLElement | null;
  tasks: TaskMapItem[];
  availablePool: TaskMapItem[];
  allAvailablePool?: TaskMapItem[];
  allTasks?: TaskMapItem[];
  options: TaskMapOption[];
  allUsers?: any[];
  shiftUsers?: any[];
  onStatusChange: (taskId: string, newStatuses: string[]) => void;
  onOptionsUpdated: () => void;
  onOpenDetail: (task: TaskMapItem) => void;
  onDataRefresh: () => void;
  onTaskUpdate?: (taskId: string, fields: Partial<TaskMapItem>) => Promise<void> | void;
  auditorTypeFilter?: string;
  currentShift?: string;
  selectedCustomMAs?: string[];
  clients?: Array<{ id: string; name: string; count?: number }>;
  showAdminTasks?: boolean;
  onToggleAdminTasks?: () => void;
  search?: string;
}

// Draggable Card Wrapper
const DraggableTaskCard: React.FC<{
  task: TaskMapItem;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ task, disabled = false, children }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled,
  });

  const [isSaving, setIsSaving] = useState<boolean>(() => isTaskSavingToDb(task.id));
  useEffect(() => {
    setIsSaving(isTaskSavingToDb(task.id));
    return subscribeTaskMapSaving(() => {
      setIsSaving(isTaskSavingToDb(task.id));
    });
  }, [task.id]);

  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={`relative touch-none transition-all duration-200 ease-out ${isDragging
          ? 'opacity-25 scale-[0.98] border border-dashed border-amber-600 rounded-xl bg-zinc-900/40 pointer-events-none'
          : disabled
            ? 'cursor-default'
            : 'cursor-grab active:cursor-grabbing hover:scale-[1.01]'
        }`}
    >
      {children}
    </div>
  );
};

// Droppable Column Wrapper
const DroppableColumn: React.FC<{
  id: string;
  children: React.ReactNode;
  className?: string;
}> = ({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`${className || ''} transition-all duration-200 ${isOver ? 'ring-2 ring-amber-500/70 bg-amber-950/25 shadow-xl shadow-amber-950/40 scale-[1.005]' : ''
        }`}
    >
      {children}
    </div>
  );
};

const DroppableInProgressSlot: React.FC<{
  userId: string;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ userId, children, disabled }) => {
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
        isOver ? 'ring-2 ring-amber-500 bg-amber-500/15 shadow-lg shadow-amber-500/20' : ''
      }`}
    >
      {children}
    </div>
  );
};

// Helper: Determine auditor specialization badge label & color
// Helper: Determine auditor specialization badge label & color
const getAuditorBadge = (user: any) => {
  const roles = [
    ...(user.roles || []),
    user.role || '',
    user.title || '',
    user.department || '',
    user.name || '',
  ].map((r: string) => (r || '').toLowerCase());

  if (roles.some((r: string) => r.includes('funnel'))) {
    return { label: 'Funnel Auditor', color: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800/60' };
  }
  if (roles.some((r: string) => r.includes('ui') || r.includes('ux'))) {
    return { label: 'UI/UX Auditor', color: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/80 dark:text-cyan-300 dark:border-cyan-800/60' };
  }
  if (roles.some((r: string) => r.includes('production') || /\bprod\b/.test(r))) {
    return { label: 'Production Auditor', color: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/80 dark:text-orange-300 dark:border-orange-800/60' };
  }
  if (roles.some((r: string) => r.includes('design') || r.includes('graphic'))) {
    return { label: 'Design Auditor', color: 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/80 dark:text-pink-300 dark:border-pink-800/60' };
  }
  if (roles.some((r: string) => r.includes('instruction') || r.includes('copy'))) {
    return { label: 'Instruction Auditor', color: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/60' };
  }
  return { label: 'Auditor', color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800/60' };
};

// Helper: Determine designated audit type when dragging task to this auditor
export const getDesignatedAuditType = (user: any): string => {
  if (!user) return 'Instruction Audit';
  const roles = [
    ...(user.roles || []),
    user.role || '',
    user.title || '',
    user.department || '',
    user.name || '',
  ].map((r: string) => (r || '').toLowerCase());

  if (roles.some((r: string) => r.includes('funnel'))) {
    return 'Funnel Audit';
  }
  if (roles.some((r: string) => r.includes('ui') || r.includes('ux'))) {
    return 'UI UX Audit';
  }
  if (roles.some((r: string) => r.includes('production') || /\bprod\b/.test(r))) {
    return 'Production Audit';
  }
  if (roles.some((r: string) => r.includes('design') || r.includes('graphic'))) {
    return 'Design Audit';
  }
  if (roles.some((r: string) => r.includes('instruction') || r.includes('copy'))) {
    return 'Instruction Audit';
  }
  return 'Instruction Audit';
};

function computeElapsed(timeInStr?: string | null, dateStr?: string | null, now = new Date()): string {
  if (!timeInStr) return '';
  const m = timeInStr.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return '';

  let hrs = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hrs < 12) hrs += 12;
  if (ampm === 'AM' && hrs === 12) hrs = 0;

  const start = dateStr ? new Date(dateStr) : new Date(now);
  start.setHours(hrs, mins, 0, 0);

  let diffMs = now.getTime() - start.getTime();
  if (diffMs < 0) diffMs = 0;

  const totalMins = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMins / 60);
  const remM = totalMins % 60;

  if (h > 0) {
    return `${h}h ${remM}m`;
  }
  return `${Math.max(1, remM)}m`;
}

interface TaskTimeProgressSlotProps {
  task: TaskMapItem;
  now?: Date;
  isLive?: boolean;
}

const TaskTimeProgressSlot: React.FC<TaskTimeProgressSlotProps> = ({ task, now: propNow, isLive = true }) => {
  const prog = task.progress;
  const isCountingLive = Boolean(isLive && prog?.timeIn && !prog?.timeOut);
  const liveClockNow = useLiveClock(isCountingLive && !propNow);
  const now = propNow || liveClockNow;

  if (prog?.isMissingTime && !isTaskHandedOver(task)) {
    return (
      <div
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-400 font-bold text-[10px] shadow-xs select-none"
        title="Missing Time! Status/Client entered without Time In"
      >
        <InfinityIcon className="size-3 text-red-500 animate-pulse shrink-0" />
        <span className="font-mono">∞</span>
      </div>
    );
  }

  if (prog?.timeIn && prog?.timeOut) {
    return (
      <div
        className="text-[10px] font-mono text-zinc-400 font-medium truncate max-w-[125px]"
        title={`Logged time: ${prog.timeIn} - ${prog.timeOut}${prog.maName ? ` (${prog.maName})` : ''}`}
      >
        {prog.timeIn} - {prog.timeOut}
      </div>
    );
  }

  if (prog?.timeIn && !prog?.timeOut) {
    const elapsed = computeElapsed(prog.timeIn, prog.date, now);
    return (
      <div
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-bold text-[10px] shadow-xs select-none"
        title={`In progress since ${prog.timeIn} (${elapsed || '0m'} elapsed)`}
      >
        <span className="relative flex size-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full size-1.5 bg-emerald-500" />
        </span>
        <span className="font-mono">{elapsed || '0m'}</span>
      </div>
    );
  }

  return (
    <span className="text-[10px] font-medium text-zinc-500">
      Posted {format(new Date(task.createdAt), 'MMM d')}
    </span>
  );
};

export const TaskMapAuditingView: React.FC<Props> = ({
  headerActionsSlot,
  tasks = [],
  availablePool = [],
  allAvailablePool,
  allTasks,
  options = [],
  allUsers = [],
  shiftUsers = [],
  onStatusChange,
  onOptionsUpdated,
  onOpenDetail,
  onDataRefresh,
  onTaskUpdate,
  auditorTypeFilter = 'ALL',
  currentShift = 'ALL',
  selectedCustomMAs = [],
  clients = [],
  showAdminTasks = false,
  onToggleAdminTasks,
  search = '',
}) => {
  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);
  const [blockedAuditAlert, setBlockedAuditAlert] = useState<{
    isOpen: boolean;
    task: TaskMapItem | null;
    targetStatus: string;
    uncheckedAudits: string[];
    openSubtasks: string[];
  }>({
    isOpen: false,
    task: null,
    targetStatus: '',
    uncheckedAudits: [],
    openSubtasks: [],
  });
  const [subStatusGuideTarget, setSubStatusGuideTarget] = useState<{
    task: TaskMapItem;
    guide: SubStatusTransitionGuide;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  useHorizontalScroll(boardScrollRef);

  const cleanSearch = (search || '').trim().toLowerCase();
  const isAuditorSearchMatch = (u: any) => {
    if (!cleanSearch || !u) return false;
    return matchesMarketingNameSearch(u, cleanSearch);
  };

  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  const currentUser = useAppStore((s) => s.currentUser);
  const boardLiveClock = useLiveClock(true);
  const isPmUser = isProjectManagerOrAdmin(currentUser);

  // Column controls: Priority filter, Sub-status filter, Client filter, Admin toggle, search, pin, collapse
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
  const [columnSubStatusFilters, setColumnSubStatusFilters] = useState<Record<string, string>>({});
  const [columnClientFilters, setColumnClientFilters] = useState<Record<string, string[] | 'ALL'>>({});
  const [columnShowAdmin, setColumnShowAdmin] = useState<Record<string, boolean>>({});
  const [columnSearches, setColumnSearches] = useState<Record<string, string>>({});
  const [columnSearchOpen, setColumnSearchOpen] = useState<Record<string, boolean>>({});

  const [pinnedColumns, setPinnedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_auditing_pinned_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_auditing_collapsed_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const togglePinColumn = (columnId: string) => {
    setPinnedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_auditing_pinned_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save pinned auditing columns', e);
      }
      return next;
    });
  };

  const toggleCollapseColumn = (columnId: string) => {
    setCollapsedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_auditing_collapsed_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save collapsed auditing columns', e);
      }
      return next;
    });
  };

  const handleResetAuditorColumn = async (columnId: string, auditorName: string, colTasks: TaskMapItem[]) => {
    const auditorId = columnId.replace(/^col-auditor-/, '');
    if (!colTasks || colTasks.length === 0) {
      toast.info(`No review tasks to reset in ${auditorName}'s column`);
      return;
    }

    // Optimistically unassign and set status to To review
    for (const t of colTasks) {
      t.assignee = null;
      t.assigneeId = null;
      t.assignees = [];
      t.status = 'To review';
      if (t.taskMap) t.taskMap.statuses = [];
    }
    toast.success(`Reset ${auditorName}'s column: ${colTasks.length} task(s) returned to Review queue`);

    try {
      await taskMapApi.resetColumnTasks(auditorId, 'AUDIT');
      onDataRefresh();
    } catch (err: any) {
      console.error('Failed to reset auditor column on server:', err);
      toast.error('Failed to reset auditor column');
    }
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // 1. Discover users with an Audit/Auditor role, respecting selected shift or custom member filter
  const auditorUsers = React.useMemo(() => {
    const map = new Map<string, any>();
    const isAllShifts =
      !currentShift ||
      currentShift === 'ALL' ||
      currentShift
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .includes('ALL');
    const isCustomShift = currentShift === 'CUSTOM';

    let candidates: any[];
    if (isCustomShift && selectedCustomMAs.length > 0) {
      const pool = [...(allUsers || []), ...(shiftUsers || [])];
      candidates = pool.filter((u) => u && selectedCustomMAs.includes(u.id));
    } else if (!isAllShifts && !isCustomShift) {
      candidates = [
        ...(currentUser?.id && isAuditorUser(currentUser) ? [currentUser] : []),
        ...(shiftUsers || []),
      ];
    } else {
      candidates = [
        ...(currentUser ? [currentUser] : []),
        ...(shiftUsers || []),
        ...(allUsers || []),
      ];
    }

    for (const u of candidates) {
      if (!u || !u.id) continue;
      if (map.has(u.id)) continue;
      if (
        isAuditorUser(u) ||
        (isCustomShift && selectedCustomMAs.includes(u.id)) ||
        (isAllShifts && currentUser?.id === u.id)
      ) {
        map.set(u.id, u);
      }
    }
    const list = Array.from(map.values());
    // Sort auditors alphabetically by first name
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allUsers, shiftUsers, currentUser, currentShift, selectedCustomMAs]);

  // Filter auditors by selected auditor type (based on real team roles from DB)
  const filteredAuditorUsers = React.useMemo(() => {
    if (!auditorTypeFilter || auditorTypeFilter === 'ALL') {
      return auditorUsers;
    }
    const filterTokens = auditorTypeFilter
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (filterTokens.length === 0 || filterTokens.includes('all')) {
      return auditorUsers;
    }

    if (filterTokens.includes('none')) {
      return [];
    }

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normTokens = filterTokens.map(normalize);

    return auditorUsers.filter((auditor) => {
      const userRoles = (auditor.roles || []).map((r: string) => (r || '').toLowerCase().trim());
      const normUserRoles = userRoles.map(normalize);

      return normTokens.some((targetNorm: string) => {
        return normUserRoles.some((rNorm: string) => {
          return rNorm === targetNorm || rNorm.includes(targetNorm) || targetNorm.includes(rNorm);
        });
      });
    });
  }, [auditorUsers, auditorTypeFilter]);

  // Combine tasks to search for review/auditing candidates
  const combinedTasks = React.useMemo(() => {
    const map = new Map<string, TaskMapItem>();
    for (const t of [...tasks, ...availablePool]) {
      if (!map.has(t.id)) map.set(t.id, t);
    }
    return Array.from(map.values());
  }, [tasks, availablePool]);

  // All combined review candidates (admin & client filtering applied per column)
  const filteredReviewTasks = combinedTasks;

  // Check if a task has review or checking status (exclude tasks transferred to CRM via Ask Client)
  const isReviewStatus = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );
    if (
      s === 'REVISION' ||
      s === 'REVISIONS' ||
      mapStatuses.includes('REVISION') ||
      mapStatuses.includes('REVISIONS') ||
      mapStatuses.includes('ASKCLIENT') ||
      mapStatuses.includes('READYTOSEND') ||
      mapStatuses.includes('TOSEND')
    ) {
      return false;
    }
    return (
      s === 'TOREVIEW' ||
      s === 'INREVIEW' ||
      s === 'REVIEW' ||
      s === 'CHECKING' ||
      s === 'INCHECKING' ||
      mapStatuses.includes('TOREVIEW') ||
      mapStatuses.includes('INREVIEW') ||
      mapStatuses.includes('REVIEW') ||
      mapStatuses.includes('CHECKING') ||
      mapStatuses.includes('INCHECKING')
    );
  };

  // Check if a task is assigned to a specific auditor (latest assignee only; never duplicate across assignees[])
  const isTaskAssignedToAuditor = (task: TaskMapItem, auditor: any) => {
    if (isTaskHandedOver(task)) return false;

    const statusNorm = (task.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const normMapStatuses = (task.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );
    if (
      statusNorm === 'REVISION' ||
      statusNorm === 'REVISIONS' ||
      normMapStatuses.includes('REVISION') ||
      normMapStatuses.includes('REVISIONS')
    ) {
      return false;
    }

    const effectiveHandlerId = getEffectiveTaskMapHandlerId(task);
    if (effectiveHandlerId) {
      const hasPmTag = (task.taskMap?.statuses || []).some((s) => s.startsWith('PM_ASSIGNMENT:'));
      return effectiveHandlerId === auditor.id && (isReviewStatus(task) || hasPmTag);
    }

    // Legacy fallback: check taskMap.statuses for auditor name/initials tag when no assigneeId/PM_ASSIGNMENT is set
    const mapStatuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
    const audNameUpper = (auditor.name || '').toUpperCase().trim();
    const firstName = audNameUpper.split(' ')[0];
    const shortInitials = audNameUpper.substring(0, 3);

    return Boolean(
      mapStatuses.includes(audNameUpper) ||
      (firstName && mapStatuses.includes(firstName)) ||
      (shortInitials && mapStatuses.includes(shortInitials)) ||
      mapStatuses.includes(auditor.id.toUpperCase())
    );
  };

  // General "To Review" queue: tasks needing review that are not yet assigned to an auditor (across shifts)
  const isGeneralToReview = (t: TaskMapItem) => {
    // If it's already assigned to any auditor (active shift or another shift), not general queue
    if (
      auditorUsers.some((a) => isTaskAssignedToAuditor(t, a)) ||
      (allUsers || []).some((a) => isAuditorUser(a) && isTaskAssignedToAuditor(t, a))
    ) {
      return false;
    }

    const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );
    if (
      s === 'REVISION' ||
      s === 'REVISIONS' ||
      mapStatuses.includes('REVISION') ||
      mapStatuses.includes('REVISIONS') ||
      mapStatuses.includes('ASKCLIENT') ||
      mapStatuses.includes('READYTOSEND') ||
      mapStatuses.includes('TOSEND')
    ) {
      return false;
    }

    return (
      s === 'TOREVIEW' ||
      s === 'INREVIEW' ||
      s === 'REVIEW' ||
      s === 'CHECKING' ||
      s === 'INCHECKING' ||
      mapStatuses.includes('TOREVIEW') ||
      mapStatuses.includes('INREVIEW') ||
      mapStatuses.includes('REVIEW') ||
      mapStatuses.includes('CHECKING') ||
      mapStatuses.includes('INCHECKING')
    );
  };

  // Build the list of columns
  const toReviewTasks = filteredReviewTasks.filter(isGeneralToReview);

  /**
   * Resolves the appropriate audit sub-status when dragging/assigning a task to an auditor.
   * - If the task has unchecked audits, the target auditor MUST hold the role for at least one
   *   needed audit; otherwise returns an error flashing the missing audit name(s).
   * - Enforces audit hierarchy (Design Audit before UI/UX Audit, Level 1 before Instruction/Funnel)
   *   and UI/UX vs Funnel different-auditor separation.
   */
  const resolveAuditorAssignmentForTask = (
    task: TaskMapItem,
    auditor: any
  ): { allowed: true; auditType: string } | { allowed: false; reason: string } => {
    const auditorRolesLower = [
      ...(auditor.roles || []),
      auditor.role || '',
      auditor.title || '',
    ].map((r: string) => (r || '').toLowerCase());

    const hasDesignRole = auditorRolesLower.some((r) => r.includes('design') || r.includes('graphic'));
    const hasProdRole = auditorRolesLower.some((r) => r.includes('production') || /\bprod\b/.test(r));
    const hasUiUxRole = auditorRolesLower.some((r) => r.includes('ui') || r.includes('ux'));
    const hasInstrRole = auditorRolesLower.some((r) => r.includes('instruction') || r.includes('copy'));
    const hasFunnelRole = auditorRolesLower.some((r) => r.includes('funnel'));

    const auditStatus = getTaskAuditStatus(task);
    const unchecked = auditStatus.uncheckedAudits || [];

    const needsDesign = unchecked.some((a) => isDesignAudit(a));
    const needsProd = unchecked.some((a) => isProductionAudit(a));
    const needsUiUx = unchecked.some((a) => isUiUxAudit(a));
    const needsInstr = unchecked.some((a) => isInstructionAudit(a));
    const needsFunnel = unchecked.some((a) => isFunnelAudit(a));

    const formatNeededLabel = (raw: string) => {
      if (isDesignAudit(raw)) return 'Design Audit';
      if (isProductionAudit(raw)) return 'Production Audit';
      if (isUiUxAudit(raw)) return 'UI/UX Audit';
      if (isInstructionAudit(raw)) return 'Instruction Audit';
      if (isFunnelAudit(raw)) return 'Funnel Audit';
      return raw;
    };

    // Build candidate audit types in strict hierarchy order: Design -> Production -> UI UX -> Instruction -> Funnel
    const matchedCandidates: string[] = [];
    if (needsDesign && hasDesignRole) matchedCandidates.push('Design Audit');
    if (needsProd && hasProdRole) matchedCandidates.push('Production Audit');
    if (needsUiUx && hasUiUxRole) matchedCandidates.push('UI UX Audit');
    if (needsInstr && hasInstrRole) matchedCandidates.push('Instruction Audit');
    if (needsFunnel && hasFunnelRole) matchedCandidates.push('Funnel Audit');

    if (unchecked.length > 0 && matchedCandidates.length === 0) {
      const neededLabels = Array.from(new Set(unchecked.map(formatNeededLabel))).join(', ');
      return {
        allowed: false,
        reason: `${auditor.name} doesn't have the necessary audit role (${neededLabels}).`,
      };
    }

    const candidatesToCheck =
      matchedCandidates.length > 0 ? matchedCandidates : [getDesignatedAuditType(auditor)];

    let firstFailureReason = 'Cannot assign: prerequisites not completed.';
    for (const candidateType of candidatesToCheck) {
      const permCheck = canPerformAudit(candidateType, task, undefined, auditor.id);
      if (!permCheck.allowed) {
        firstFailureReason = permCheck.reason || firstFailureReason;
        continue;
      }
      if (isFunnelAudit(candidateType)) {
        const uiUxActors = getCompletedAuditActorIds(isUiUxAudit, task);
        if (uiUxActors.actorIds.includes(auditor.id)) {
          firstFailureReason = `${auditor.name} already completed the UI/UX Audit for this task — Funnel Audit must be assigned to a different Funnel Auditor.`;
          continue;
        }
      }
      if (isUiUxAudit(candidateType)) {
        const funnelActors = getCompletedAuditActorIds(isFunnelAudit, task);
        if (funnelActors.actorIds.includes(auditor.id)) {
          firstFailureReason = `${auditor.name} already completed the Funnel Audit for this task — UI/UX Audit must be assigned to a different UI/UX Auditor.`;
          continue;
        }
      }
      return { allowed: true, auditType: candidateType };
    }

    return { allowed: false, reason: firstFailureReason };
  };

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskMapItem;
    if (!task) return;
    setActiveDragTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const targetColumnId = over.id as string;
    const task = (allTasks || tasks).find((t) => t.id === taskId) || combinedTasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentStatuses = task.taskMap?.statuses || [];

    // Strip previous review & auditor tags and audit substatuses
    let updatedStatuses = currentStatuses.filter((s) => {
      const up = s.toUpperCase().trim();
      if (
        up === 'TO REVIEW' ||
        up === 'IN REVIEW' ||
        up === 'DESIGN AUDIT' ||
        up === 'PRODUCTION AUDIT' ||
        up === 'UI UX AUDIT' ||
        up === 'UI/UX AUDIT' ||
        up === 'INSTRUCTION AUDIT' ||
        up === 'INSTRUCTIONS AUDIT' ||
        up === 'FUNNEL AUDIT'
      ) return false;
      return !auditorUsers.some((a) => {
        const nameUp = (a.name || '').toUpperCase().trim();
        const first = nameUp.split(' ')[0];
        const shortInitials = nameUp.substring(0, 3);
        return up === nameUp || up === first || up === shortInitials || up === a.id.toUpperCase();
      });
    });

    if (targetColumnId === 'col-to-review') {
      updatedStatuses = ['To Review'];
      toast.info('Task moved to Audit Pool (To Review)');
      onStatusChange(taskId, updatedStatuses);

      const targetStatus = 'IN REVIEW';
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { assigneeId: null, status: targetStatus });
      } else {
        await tasksApi
          .updateTask(taskId, { assigneeId: null, status: targetStatus } as any)
          .catch(console.error);
        onDataRefresh();
      }
    } else if (targetColumnId.startsWith('col-auditor-') || targetColumnId.startsWith('in-progress-')) {
      const auditorId = targetColumnId.replace('col-auditor-', '').replace('in-progress-', '');
      const auditor = auditorUsers.find((a) => a.id === auditorId);
      if (auditor) {
        const assignmentCheck = resolveAuditorAssignmentForTask(task, auditor);
        if (!assignmentCheck.allowed) {
          toast.error(assignmentCheck.reason);
          return;
        }
        const auditType = assignmentCheck.auditType;

        if (await isCollaboratorOnTask(task.id, auditor.id)) {
          toast.error(`${auditor.name} is a collaborator on this task and can't audit it. Assign another auditor.`);
          return;
        }

        updatedStatuses = [auditType];
        if (targetColumnId.startsWith('in-progress-')) {
          if (!updatedStatuses.includes('In progress')) {
            updatedStatuses.push('In progress');
          }
        }
        toast.success(`Task assigned to ${auditor.name} (${auditType})`);
        onStatusChange(taskId, updatedStatuses);

        const targetStatus = 'IN REVIEW';

        if (onTaskUpdate) {
          await onTaskUpdate(taskId, { assigneeId: auditor.id, status: targetStatus });
        } else {
          await tasksApi
            .updateTask(taskId, { assigneeId: auditor.id, status: targetStatus } as any)
            .catch(console.error);
          onDataRefresh();
        }
      }
    }
  };

  /** True when the auditor worked on the task (MA daily tracker collaborator), so may not audit it. */
  const isCollaboratorOnTask = async (taskId: string, auditorId: string): Promise<boolean> => {
    try {
      const res = await auditShiftsApi.getEligibility([taskId]);
      return (res.blocked?.[taskId] || []).includes(auditorId);
    } catch (err) {
      console.error('Collaborator check failed:', err);
      return false;
    }
  };

  const handleSelectInProgressTask = async (taskId: string, targetAuditorId: string, taskOverride?: TaskMapItem) => {
    const auditor = auditorUsers.find((a) => a.id === targetAuditorId);
    if (!auditor) return;
    const task = (allTasks || tasks).find((t) => t.id === taskId) || combinedTasks.find((t) => t.id === taskId) || taskOverride;
    if (!task) return;

    const assignmentCheck = resolveAuditorAssignmentForTask(task, auditor);
    if (!assignmentCheck.allowed) {
      toast.error(assignmentCheck.reason);
      return;
    }
    const auditType = assignmentCheck.auditType;

    if (await isCollaboratorOnTask(task.id, auditor.id)) {
      toast.error(`${auditor.name} is a collaborator on this task and can't audit it. Assign another auditor.`);
      return;
    }

    const updatedStatuses = [auditType, 'In progress'];
    toast.success(`Task set In Progress for ${auditor.name} (${auditType})`);
    onStatusChange(taskId, updatedStatuses);

    const targetStatus = 'IN REVIEW';
    if (onTaskUpdate) {
      await onTaskUpdate(taskId, { assigneeId: auditor.id, status: targetStatus });
    } else {
      await tasksApi
        .updateTask(taskId, { assigneeId: auditor.id, status: targetStatus } as any)
        .catch(console.error);
      onDataRefresh();
    }
  };

  // ---------------------------------------------------------------------------
  // Auto Distribute: hands To Review tasks to on-shift auditors. Each task goes to an auditor
  // whose role matches an audit it still needs (prerequisites and the UI/UX vs Funnel rule
  // enforced, same as a drag), picking whoever has the fewest queued tasks on the Task Map.
  // ---------------------------------------------------------------------------
  const MAX_AUTO_AUDIT_QUEUE = 5;
  const [isDistributing, setIsDistributing] = useState(false);

  /** The audit `auditor` would do on `task`, or null if their roles match nothing it needs now. */
  const pickAuditTypeFor = (task: TaskMapItem, auditor: any): string | null => {
    const roles = [...(auditor.roles || []), auditor.role || '', auditor.title || ''].map((r: string) =>
      (r || '').toLowerCase()
    );
    const unchecked = getTaskAuditStatus(task).uncheckedAudits || [];
    const candidates: string[] = [];
    if (roles.some((r) => r.includes('design') || r.includes('graphic')) && unchecked.some((a) => isDesignAudit(a))) candidates.push('Design Audit');
    if (roles.some((r) => r.includes('production') || /\bprod\b/.test(r)) && unchecked.some((a) => isProductionAudit(a))) candidates.push('Production Audit');
    if (roles.some((r) => r.includes('ui') || r.includes('ux')) && unchecked.some((a) => isUiUxAudit(a))) candidates.push('UI UX Audit');
    if (roles.some((r) => r.includes('instruction') || r.includes('copy')) && unchecked.some((a) => isInstructionAudit(a))) candidates.push('Instruction Audit');
    if (roles.some((r) => r.includes('funnel')) && unchecked.some((a) => isFunnelAudit(a))) candidates.push('Funnel Audit');
    return candidates.find((type) => canPerformAudit(type, task, undefined, auditor.id).allowed) || null;
  };

  const handleAutoDistribute = async () => {
    if (isDistributing) return;
    const pending = sortTasksUrgentFirst(toReviewTasks.filter((t) => !isTaskMapItemOnHold(t)));
    if (pending.length === 0) {
      toast.info('No tasks waiting in To Review.');
      return;
    }
    setIsDistributing(true);
    let eligibility: Awaited<ReturnType<typeof auditShiftsApi.getEligibility>>;
    try {
      eligibility = await auditShiftsApi.getEligibility(pending.map((t) => t.id));
    } catch (err) {
      console.error('Audit eligibility failed:', err);
      toast.error('Could not load the audit shift schedule. Try again.');
      setIsDistributing(false);
      return;
    }
    // Only auditors scheduled on the current audit shift, whatever shift the map is showing.
    const onShift = new Set(eligibility.onShiftUserIds || []);
    const scheduledAuditors = Array.from(
      new Map(
        [...(allUsers || []), ...(shiftUsers || []), ...auditorUsers]
          .filter((u: any) => u?.id && onShift.has(u.id) && isAuditorUser(u))
          .map((u: any) => [u.id, u])
      ).values()
    );
    if (scheduledAuditors.length === 0) {
      setIsDistributing(false);
      toast.error(`No auditors are scheduled on the current audit shift (${eligibility.activeShift}).`);
      return;
    }

    // Queued load per auditor: open Task Map tasks they currently hold.
    const load = new Map<string, number>(scheduledAuditors.map((a: any) => [a.id, 0]));
    for (const t of allTasks || tasks) {
      const ownerId = getEffectiveTaskMapHandlerId(t);
      if (ownerId && load.has(ownerId) && !isClosedStatus(t.status)) load.set(ownerId, (load.get(ownerId) || 0) + 1);
    }

    let assigned = 0;
    try {
      for (const task of pending) {
        const collaborators = eligibility.blocked?.[task.id] || [];
        const options = scheduledAuditors
          .filter((auditor: any) => !collaborators.includes(auditor.id))
          .map((auditor: any) => ({ auditor, auditType: pickAuditTypeFor(task, auditor), load: load.get(auditor.id) || 0 }))
          .filter((o): o is { auditor: any; auditType: string; load: number } => Boolean(o.auditType) && o.load < MAX_AUTO_AUDIT_QUEUE)
          .sort((a, b) => a.load - b.load || (a.auditor.name || '').localeCompare(b.auditor.name || ''));
        const best = options[0];
        if (!best) continue;

        onStatusChange(task.id, [best.auditType]);
        const targetStatus = 'IN REVIEW';
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { assigneeId: best.auditor.id, status: targetStatus });
        } else {
          await tasksApi.updateTask(task.id, { assigneeId: best.auditor.id, status: targetStatus } as any).catch(console.error);
        }
        load.set(best.auditor.id, best.load + 1);
        assigned++;
      }
    } finally {
      setIsDistributing(false);
      if (!onTaskUpdate) onDataRefresh();
    }

    const left = pending.length - assigned;
    if (assigned === 0) {
      toast.info(`No matching auditor with room (under ${MAX_AUTO_AUDIT_QUEUE} queued tasks) for the ${pending.length} task(s) in To Review.`);
    } else {
      toast.success(`Distributed ${assigned} task(s) to auditors${left > 0 ? ` · ${left} left in To Review (no matching auditor with room)` : ''}.`);
    }
  };

  // Helper options for sub-status dropdown in Auditing (audit tags are assigned automatically via drag/drop)
  const getAuditingOptions = (task: TaskMapItem): TaskMapOption[] => {
    const ls = task.list?.statuses;
    return [
      { id: 'opt-audit-readytosend', label: 'Ready to Send', color: resolveSubStatusColor('Ready to Send', TASK_MAP_STATUS_COLORS.TO_SEND, task.list?.id, ls), textColor: '#ffffff', order: 1 },
      { id: 'opt-audit-askclient', label: 'Ask Client', color: TASK_MAP_STATUS_COLORS.ASK_CLIENT, textColor: '#ffffff', order: 2 },
      { id: 'opt-audit-revision', label: 'Revision', color: resolveSubStatusColor('Revision', TASK_MAP_STATUS_COLORS.REVISION, task.list?.id, ls), textColor: '#ffffff', order: 3 },
      { id: 'opt-audit-handover', label: 'Hand-over', color: TASK_MAP_STATUS_COLORS.HAND_OVER, textColor: '#ffffff', order: 4 },
      { id: 'opt-audit-toreview', label: 'To Review', color: TASK_MAP_STATUS_COLORS.TO_REVIEW, textColor: '#ffffff', order: 5 },
    ];
  };

  const renderAuditorCard = (
    task: TaskMapItem,
    isQueueColumn: boolean = false,
    isLiveWorking: boolean = false
  ) => {
    const liveColor = resolveTaskStatusColor(
      task.status || 'In Progress',
      task.listId || task.list?.id,
      task.list?.statuses
    ) || '#f59e0b';

    return (
      <DraggableTaskCard key={task.id} task={task} disabled={false}>
        <div
          onClick={(e) => {
            if (e.defaultPrevented) return;
            onOpenDetail(task);
          }}
          className={`relative p-3 bg-zinc-900 not-has-[[data-card-control]:hover]:hover:bg-zinc-800/80 not-has-[[data-card-control]:hover]:hover:shadow-md active:scale-[0.99] border rounded-xl shadow-md min-h-[112px] flex flex-col justify-between transition-all group cursor-pointer ${
            isLiveWorking
              ? 'border-transparent shadow-md'
              : 'border-border not-has-[[data-card-control]:hover]:hover:border-zinc-600/80'
          }`}
          style={isLiveWorking ? { borderColor: hexToRgba(liveColor, 0.4) } : undefined}
        >
          {isLiveWorking && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-[1px] rounded-xl border animate-border-glow-breathe"
              style={{
                borderColor: liveColor,
                boxShadow: `0 0 0 2px ${hexToRgba(liveColor, 0.42)}, 0 0 18px ${hexToRgba(liveColor, 0.28)}`,
              }}
            />
          )}
          <div className="flex items-stretch gap-3">
            {/* Left: Task Info */}
            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              {/* Client / List Name */}
              {isLiveWorking ? (
                <span
                  className="font-bold uppercase tracking-wider flex items-center gap-1.5 truncate text-[11px] mb-1"
                  style={{ color: liveColor }}
                >
                  {task.isSubtask && (
                    <span
                      className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 font-bold text-[10px] shrink-0"
                      title={task.parentTaskTitle ? `Subtask of: ${task.parentTaskTitle}` : 'Subtask'}
                    >
                      <CornerDownRight className="size-2.5 shrink-0" />
                    </span>
                  )}
                  <span className="relative flex size-2 shrink-0">
                    <span
                      className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                      style={{ backgroundColor: liveColor }}
                    />
                    <span
                      className="relative inline-flex rounded-full size-2"
                      style={{ backgroundColor: liveColor }}
                    />
                  </span>
                  {task.list?.name || 'General'}
                </span>
              ) : (
                <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[170px] mb-1 flex items-center gap-1.5">
                  {task.isSubtask && (
                    <span
                      className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 font-bold text-[10px] shrink-0"
                      title={task.parentTaskTitle ? `Subtask of: ${task.parentTaskTitle}` : 'Subtask'}
                    >
                      <CornerDownRight className="size-2.5 shrink-0" />
                    </span>
                  )}
                  <span className="truncate">{task.list?.name || 'General'}</span>
                </div>
              )}

              {/* Title */}
              <h4
                className="text-[13px] font-bold text-zinc-100 group-hover:text-white line-clamp-2 leading-snug my-0.5 h-[36px]"
                title={task.isSubtask && task.parentTaskTitle ? `${task.title} (Parent: ${task.parentTaskTitle})` : task.title}
              >
                {task.isSubtask ? (task.title || '').replace(/^--\s*/, '') : task.title}
              </h4>

              {/* Controls row: circle dot left of bulletin, priority flag (Exact Task Map parity) */}
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
                  onSelect={async (newStatus) => {
                    const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
                    const transitionCheck = canTransitionTaskStatus(currentTask, newStatus);
                    if (!transitionCheck.allowed) {
                      if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                        window.dispatchEvent(
                          new CustomEvent('task:highlight-audits', {
                            detail: {
                              taskId: task.id,
                              targetStatus: newStatus,
                              uncheckedAudits: transitionCheck.uncheckedAudits,
                              openSubtasks: transitionCheck.openSubtasks,
                            },
                          })
                        );
                      }
                      setBlockedAuditAlert({
                        isOpen: true,
                        task,
                        targetStatus: newStatus,
                        uncheckedAudits: transitionCheck.uncheckedAudits,
                        openSubtasks: transitionCheck.openSubtasks,
                      });
                      toast.error(transitionCheck.reason || `Cannot move task to ${newStatus}`);
                      return;
                    }

                    if (onTaskUpdate) {
                      await onTaskUpdate(task.id, { status: newStatus });
                    } else {
                      await tasksApi
                        .updateTask(task.id, { status: newStatus } as any)
                        .catch(console.error);
                      onDataRefresh();
                    }
                    toast.success(`Status updated to ${newStatus}`);
                  }}
                />

                <TaskDescriptionButton
                  description={task.description}
                  taskTitle={task.title}
                  taskId={task.id}
                  clientName={task.list?.name || null}
                  lazyFetch={!task.description}
                />

                {/* Clickable Priority Flag */}
                <CardPriorityDropdown
                  taskId={task.id}
                  priority={task.priority || 'NORMAL'}
                  onSelect={async (newPriority) => {
                    if (onTaskUpdate) {
                      await onTaskUpdate(task.id, { priority: newPriority as any });
                    } else {
                      await tasksApi
                        .updateTask(task.id, { priority: newPriority as any })
                        .catch(console.error);
                      onDataRefresh();
                    }
                    toast.success(`Priority set to ${newPriority}`);
                  }}
                />
              </div>
            </div>

            {/* Separator */}
            <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

            {/* Right: Section where Sub-Status is (with Time Progress in top right corner) */}
            <div className="w-[125px] sm:w-[135px] shrink-0 flex flex-col justify-between py-0.5">
              <div className="flex flex-col items-end gap-0.5">
                <TaskTimeProgressSlot task={task} isLive={isLiveWorking} />
                <TaskEstimateLabel task={task} />
              </div>

              <div
                className="w-full"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                  Sub-Status
                </span>
                <TaskMapStatusDropdown
                  selectedStatuses={isQueueColumn ? ['To Review'] : (task.taskMap?.statuses || [])}
                  options={getAuditingOptions(task)}
                  onToggleStatus={async (label, nextStatuses) => {
                    const isSelecting = (nextStatuses || []).includes(label);
                    const cleanNext = isSelecting ? [label] : [];
                    const norm = label.toLowerCase().trim();

                    if ((norm === 'ready to send' || norm === 'readytosend' || norm === 'to send') && isSelecting) {
                      const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
                      let transitionCheck = canTransitionTaskStatus(currentTask, 'CRM');
                      if (!transitionCheck.allowed && transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                        try {
                          const targetApiTaskId = task.isSubtask && task.parentTaskId ? task.parentTaskId : task.id;
                          const fresh = await tasksApi.getTask(targetApiTaskId);
                          if (fresh?.task) {
                            const freshTarget = task.isSubtask
                              ? (fresh.task.subtasks || []).find((st: any) => st.id === task.subtaskId) || fresh.task
                              : fresh.task;
                            const freshCheck = canTransitionTaskStatus(freshTarget, 'CRM');
                            if (freshCheck.allowed) {
                              transitionCheck = freshCheck;
                              useAppStore.getState().updateTask(fresh.task);
                            }
                          }
                        } catch {
                          // fallback
                        }
                      }
                      if (!transitionCheck.allowed) {
                        if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                          window.dispatchEvent(
                            new CustomEvent('task:highlight-audits', {
                              detail: {
                                taskId: task.id,
                                targetStatus: 'CRM',
                                uncheckedAudits: transitionCheck.uncheckedAudits,
                                openSubtasks: transitionCheck.openSubtasks,
                              },
                            })
                          );
                        }
                        setBlockedAuditAlert({
                          isOpen: true,
                          task,
                          targetStatus: 'CRM',
                          uncheckedAudits: transitionCheck.uncheckedAudits,
                          openSubtasks: transitionCheck.openSubtasks,
                        });
                        toast.error(transitionCheck.reason || 'Cannot move task to CRM');
                        return;
                      }
                    }

                    const executeAuditingSubStatusTransition = async () => {
                      if (norm === 'ready to send' || norm === 'readytosend' || norm === 'to send') {
                        if (isSelecting) {
                          onStatusChange(task.id, ['Ready to Send']);
                          if (onTaskUpdate) {
                            await onTaskUpdate(task.id, { status: 'CRM' });
                          } else {
                            await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                            onDataRefresh();
                          }
                          toast.success('Task marked Ready to Send — transferred to CRM Map');
                        } else {
                          // User pressed 'Ready to Send' AGAIN in Auditing -> revert back to last status
                          const defaultRev = 'IN REVIEW';
                          const revertStatus = toCanonicalTaskStatus((task as any)._previousStatus || defaultRev);
                          onStatusChange(task.id, []);
                          if (onTaskUpdate) {
                            await onTaskUpdate(task.id, { status: revertStatus });
                          } else {
                            await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                            onDataRefresh();
                          }
                          toast.info(`Reverted 'Ready to Send' — returned to ${revertStatus}`);
                        }
                      } else if (norm === 'ask client' || norm === 'askclient') {
                        if (isSelecting) {
                          onStatusChange(task.id, ['Ask Client']);
                          toast.info("Task marked 'Ask Client' — transferred to CRM Map pool");
                        } else {
                          onStatusChange(task.id, []);
                          toast.info("Removed 'Ask Client'");
                        }
                      } else if (norm === 'revision' || norm === 'revisions') {
                        if (isSelecting) {
                          onStatusChange(task.id, ['Revision']);
                          if (onTaskUpdate) {
                            await onTaskUpdate(task.id, { status: 'REVISION' } as any);
                          } else {
                            await tasksApi.updateTask(task.id, { status: 'REVISION' } as any).catch(console.error);
                            onDataRefresh();
                          }
                          toast.warning('Task marked for Revision — returned to original MA on Task Map');
                        } else {
                          const defaultRev = 'IN REVIEW';
                          const revertStatus = toCanonicalTaskStatus((task as any)._previousStatus || defaultRev);
                          onStatusChange(task.id, []);
                          if (onTaskUpdate) {
                            await onTaskUpdate(task.id, { status: revertStatus });
                          } else {
                            await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                            onDataRefresh();
                          }
                          toast.info(`Reverted 'Revision' — returned to ${revertStatus}`);
                        }
                      } else if (norm === 'handover' || norm === 'hand-over' || norm === 'to review' || norm === 'to_review') {
                        if (isSelecting) {
                          if (task.progress && task.progress.timeIn && !task.progress.timeOut) {
                            task.progress.timeOut = formatManilaTime(new Date());
                          }
                          onStatusChange(task.id, ['To Review']);
                          if (onTaskUpdate) {
                            await onTaskUpdate(task.id, { assigneeId: null, status: 'IN REVIEW' });
                          } else {
                            await tasksApi.updateTask(task.id, { assigneeId: null, status: 'IN REVIEW' } as any).catch(console.error);
                            onDataRefresh();
                          }
                          toast.info('Task returned to Audit Pool (To Review)');
                        }
                      } else {
                        // Designated audit types: Design Audit, UI UX Audit, Instruction Audit, Funnel Audit
                        onStatusChange(task.id, cleanNext);
                        if (isSelecting) {
                          toast.success(`Sub-status set to ${label}`);
                        }
                      }
                    };

                    const guide = getSubStatusTransitionGuide(label, 'AUDITOR_MAP', { isSelecting });
                    if (guide.requiresConfirmModal) {
                      setSubStatusGuideTarget({
                        task,
                        guide,
                        onConfirm: executeAuditingSubStatusTransition,
                      });
                    } else {
                      void executeAuditingSubStatusTransition();
                    }
                  }}
                  onOptionsUpdated={onOptionsUpdated}
                  readOnly={false}
                />
              </div>
            </div>
          </div>

          {/* Under-the-card Audit Checklist */}
          <TaskCardAuditChecklist
            task={task}
            isQueueColumn={isQueueColumn}
            currentUser={currentUser}
            onChecklistsUpdated={(updatedCls) => {
              task.checklists = updatedCls;
            }}
          />
        </div>
      </DraggableTaskCard>
    );
  };

  // Assemble full columns array
  interface AuditingColumnDef {
    id: string;
    title: string;
    subtitle: string;
    badgeLabel?: string;
    badgeClass?: string;
    dotColor: string;
    tasks: TaskMapItem[];
    isAuditor?: boolean;
    auditorUser?: any;
  }

  const allColumns: AuditingColumnDef[] = [
    {
      id: 'col-to-review',
      title: 'To Review',
      subtitle: 'Incoming tasks awaiting auditor assignment',
      badgeLabel: 'Queue',
      badgeClass: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800',
      dotColor: 'bg-[#D97B3A]',
      tasks: toReviewTasks,
    },
    ...filteredAuditorUsers.map((auditor) => {
      const audBadge = getAuditorBadge(auditor);
      const audTasks = filteredReviewTasks.filter((t) => isTaskAssignedToAuditor(t, auditor));
      return {
        id: `col-auditor-${auditor.id}`,
        title: auditor.name || 'Auditor',
        subtitle: `Auditing queue for ${auditor.name}`,
        badgeLabel: audBadge.label,
        badgeClass: audBadge.color,
        dotColor: 'bg-amber-500',
        tasks: audTasks,
        isAuditor: true,
        auditorUser: auditor,
      };
    }),
  ];

  // Priority ranking & sorting for auditor columns:
  // 1. Search-matching auditor columns move to the front
  // 2. Pinned columns come next
  // 3. Current viewing user column next (showing on the right side of To Review)
  // 4. Audit specialization order: Design -> UI/UX -> Funnel -> Instruction -> Other
  // 5. Alphabetical order (A-Z)
  const getAuditorTypeOrder = (user: any): number => {
    const label = getAuditorBadge(user).label;
    if (label === 'Design Auditor') return 0;
    if (label === 'UI/UX Auditor') return 1;
    if (label === 'Funnel Auditor') return 2;
    if (label === 'Instruction Auditor') return 3;
    return 4;
  };

  const curUserId = currentUser?.id;
  const curUserName = (currentUser?.name || '').trim().toLowerCase();

  const isCurrentViewer = (u: any) => {
    if (!u) return false;
    if (curUserId && u.id === curUserId) return true;
    if (curUserName && (u.name || '').trim().toLowerCase() === curUserName) return true;
    return false;
  };

  const toReviewCol = allColumns.find((c) => c.id === 'col-to-review') || allColumns[0];
  const auditorCols = allColumns.filter((c) => c.isAuditor);

  const sortedAuditorCols = [...auditorCols]
    .filter((col) => {
      if (isCurrentViewer(col.auditorUser)) return true;
      if (!cleanSearch) return true;
      return isAuditorSearchMatch(col.auditorUser);
    })
    .sort((colA, colB) => {
    const matchA = isAuditorSearchMatch(colA.auditorUser);
    const matchB = isAuditorSearchMatch(colB.auditorUser);

    // 1. Search-matching auditor columns move to the most left side
    if (matchA && !matchB) return -1;
    if (!matchA && matchB) return 1;

    // 2. Pinned columns come next
    const isPinnedA = !!pinnedColumns[colA.id];
    const isPinnedB = !!pinnedColumns[colB.id];
    if (isPinnedA && !isPinnedB) return -1;
    if (!isPinnedA && isPinnedB) return 1;

    // 3. Current viewer column next (showing on the right side of To Review)
    const isCurA = isCurrentViewer(colA.auditorUser);
    const isCurB = isCurrentViewer(colB.auditorUser);
    if (isCurA && !isCurB) return -1;
    if (!isCurA && isCurB) return 1;

    // 4. Audit specialization order: Design First, then UI/UX, then Funnel
    const typeOrderA = getAuditorTypeOrder(colA.auditorUser);
    const typeOrderB = getAuditorTypeOrder(colB.auditorUser);
    if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;

    // 5. Alphabetical order (A-Z)
    return (colA.title || '').localeCompare(colB.title || '', undefined, { sensitivity: 'base' });
  });

  const orderedColumns: AuditingColumnDef[] = [
    toReviewCol,
    ...sortedAuditorCols,
  ].filter(Boolean) as AuditingColumnDef[];

  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  const distributeButton =
    headerActionsSlot && isPmUser
      ? createPortal(
          <button
            type="button"
            onClick={handleAutoDistribute}
            disabled={isDistributing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-zinc-800/80 hover:border-zinc-700 rounded-xl text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
            title="Auto distribute: give each To Review task to an on-shift auditor with the matching audit role and the fewest queued tasks"
          >
            {isDistributing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Scale className="size-3.5 text-emerald-400" />
            )}
            <span className="hidden sm:inline">Distribute</span>
          </button>,
          headerActionsSlot
        )
      : null;

  return (
    <>
    {distributeButton}
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full bg-background select-none">
        {/* Board Columns Horizontal Scroll */}
        <div ref={boardScrollRef} className="flex-1 flex gap-5 px-6 pb-4 overflow-x-auto overflow-y-hidden min-h-0 custom-scrollbar select-none">
          {orderedColumns.map((col) => {
            const isPinned = !!pinnedColumns[col.id];
            const isCollapsed = !!collapsedColumns[col.id];
            const activePriority = columnPriorityFilters[col.id] || 'ALL';
            const activeSubStatus = columnSubStatusFilters[col.id] || 'ALL';
            const colClientFilter = columnClientFilters[col.id] || 'ALL';
            const colShowAdmin = columnShowAdmin[col.id] ?? showAdminTasks;
            const searchQuery = columnSearches[col.id] || '';
            const isSearchOpen = !!columnSearchOpen[col.id];

            // Apply priority, sub-status, search, admin, and client filter inside column
            const visibleTasks = col.tasks.filter((t) => {
              if (!matchesPriorityFilter(t, activePriority)) return false;
              if (!matchesSubStatusFilter(t, activeSubStatus)) return false;
              if (!matchesSearchFilter(t, searchQuery)) return false;

              // Admin task check
              const isAdmin = isTaskUnderAdmin(t);
              if (isAdmin && !colShowAdmin) return false;

              // Client filter check
              if (colClientFilter !== 'ALL') {
                const clientId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
                const clientName = t.list?.name || 'General';
                if (!colClientFilter.includes(clientId) && !colClientFilter.includes(clientName)) {
                  return false;
                }
              }

              return true;
            });

            // Collapsed Column Bar
            if (isCollapsed) {
              return (
                <DroppableColumn
                  key={`${col.id}-collapsed`}
                  id={col.id}
                  className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-amber-500/50 ${isPinned ? 'ring-1 ring-amber-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                    }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapseColumn(col.id)}
                    className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
                    title="Expand column"
                  >
                    <ChevronRight className="size-4 text-amber-400" />
                  </button>

                  {isPinned && (
                    <Pin className="size-3 text-amber-400 fill-amber-400/40 rotate-45 mb-2" />
                  )}

                  <span className={`size-2.5 rounded-full ${col.dotColor} mb-2 shrink-0`} />

                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 mb-4">
                    {countNonOnHoldTasks(col.tasks)}
                  </span>

                  <span
                    onClick={() => toggleCollapseColumn(col.id)}
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                    className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
                  >
                    {col.title}
                  </span>
                </DroppableColumn>
              );
            }

            // Normal Expanded Column
            return (
              <DroppableColumn
                key={col.id}
                id={col.id}
                className={`w-[370px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${isPinned ? 'ring-1 ring-amber-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                  }`}
              >
                {/* Header Top Row: Left side has dot/avatar & title & badge & count; Right side has Collapse, Pin, Search */}
                <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2 h-7">
                    {col.auditorUser ? (
                      col.auditorUser.avatarUrl ? (
                        <img
                          src={col.auditorUser.avatarUrl}
                          alt={col.title}
                          className="size-6 rounded-full object-cover shrink-0 ring-1 ring-amber-500/40"
                        />
                      ) : (
                        <div className="size-6 rounded-full bg-amber-950/80 border border-amber-600/40 text-amber-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(col.title || 'U').charAt(0).toUpperCase()}
                        </div>
                      )
                    ) : (
                      <span className={`size-2 rounded-full ${col.dotColor} shrink-0`} />
                    )}

                    <h3 className="text-sm font-bold text-zinc-100 truncate" title={col.title}>
                      {col.title}
                    </h3>

                    {col.auditorUser ? (
                      <UserRoleBadge user={col.auditorUser} />
                    ) : col.badgeLabel ? (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 truncate ${
                          col.badgeClass || 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        }`}
                      >
                        {col.badgeLabel}
                      </span>
                    ) : null}

                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${col.badgeClass || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                        }`}
                    >
                      {countNonOnHoldTasks(col.tasks)}
                    </span>
                  </div>

                  {/* Top Right: Reset (for auditor columns), Collapse, Pin, Search (Search on right side) */}
                  <div className="flex items-center gap-1 shrink-0 h-7">
                    {col.isAuditor && (
                      <button
                        type="button"
                        onClick={() => handleResetAuditorColumn(col.id, col.title, col.tasks)}
                        className="p-1 text-zinc-400 hover:text-amber-400 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                        title={`Reset ${col.title}'s column (return review tasks to Queue)`}
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleCollapseColumn(col.id)}
                      className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                      title="Collapse column"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => togglePinColumn(col.id)}
                      className={`p-1 rounded-md transition-colors cursor-pointer ${isPinned
                          ? 'text-amber-400 bg-amber-500/15 border border-amber-500/30'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                        }`}
                      title={isPinned ? 'Unpin column' : 'Pin column'}
                    >
                      <Pin className={`size-3.5 rotate-45 ${isPinned ? 'fill-amber-400/40' : ''}`} />
                    </button>

                    {isSearchOpen ? (
                      <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-0.5 max-w-[130px] text-xs">
                        <Search className="size-3 text-zinc-400 shrink-0 mr-1" />
                        <input
                          autoFocus
                          type="text"
                          value={searchQuery}
                          onChange={(e) =>
                            setColumnSearches((prev) => ({ ...prev, [col.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setColumnSearchOpen((prev) => ({ ...prev, [col.id]: false }));
                            }
                          }}
                          placeholder="Search..."
                          className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setColumnSearches((prev) => ({ ...prev, [col.id]: '' }));
                            setColumnSearchOpen((prev) => ({ ...prev, [col.id]: false }));
                          }}
                          className="text-zinc-400 hover:text-zinc-200 ml-0.5 p-0.5 cursor-pointer"
                          title="Close search"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setColumnSearchOpen((prev) => ({ ...prev, [col.id]: true }))
                        }
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

                {/* Next Line: Filters on the left side */}
                <div className="flex items-center gap-1.5 justify-start mb-3">
                  <ColumnClientDropdown
                    tasks={col.tasks}
                    clients={clients}
                    showAdmin={colShowAdmin}
                    onToggleAdmin={() =>
                      setColumnShowAdmin((prev) => ({
                        ...prev,
                        [col.id]: !colShowAdmin,
                      }))
                    }
                    selectedClients={colClientFilter}
                    onSelectClients={(nextClients) =>
                      setColumnClientFilters((prev) => ({
                        ...prev,
                        [col.id]: nextClients,
                      }))
                    }
                    isTaskUnderAdmin={isTaskUnderAdmin}
                  />

                  <ColumnPriorityDropdown
                    columnId={col.id}
                    tasks={col.tasks}
                    activeFilter={activePriority}
                    onSelectFilter={(cId, filter) =>
                      setColumnPriorityFilters((prev) => ({ ...prev, [cId]: filter }))
                    }
                  />

                  <ColumnSubStatusDropdown
                    columnId={col.id}
                    tasks={col.tasks}
                    activeFilter={activeSubStatus}
                    onSelectFilter={(cId, filter) =>
                      setColumnSubStatusFilters((prev) => ({ ...prev, [cId]: filter }))
                    }
                  />

                  {(searchQuery || activePriority !== 'ALL' || activeSubStatus !== 'ALL' || colClientFilter !== 'ALL') && (
                    <span className="text-[10px] text-zinc-400 italic">
                      ({visibleTasks.length} of {col.tasks.length})
                    </span>
                  )}
                </div>

                {/* Cards List / In Progress & Queue */}
                {col.isAuditor && col.auditorUser ? (
                  <div data-column-body="true" className="flex-1 overflow-y-auto custom-scrollbar space-y-2 px-1.5 py-1 min-h-0">
                    {(() => {
                      const activeInProgTask = visibleTasks.find(
                        (t) =>
                          isTaskActiveInProgress(t, col.auditorUser.name) ||
                          (t.progress?.timeIn && !t.progress?.timeOut && !t.progress?.isMissingTime) ||
                          (t.taskMap?.statuses || []).some((s) => s.trim().toUpperCase() === 'IN PROGRESS')
                      );
                      const queuedTasks = visibleTasks.filter((t) => t.id !== activeInProgTask?.id);
                      const isColumnLiveWorking = Boolean(
                        activeInProgTask &&
                        (isTaskLiveWorking(activeInProgTask, col.auditorUser.name, boardLiveClock) ||
                          (activeInProgTask.progress?.timeIn && !activeInProgTask.progress?.timeOut && !activeInProgTask.progress?.isMissingTime))
                      );
                      const liveSlotLabel = isColumnLiveWorking && activeInProgTask
                        ? (toCanonicalTaskStatus(activeInProgTask.status) || activeInProgTask.status || 'In Progress')
                        : 'In Progress';
                      const liveSlotColor = isColumnLiveWorking && activeInProgTask
                        ? resolveTaskStatusColor(
                            liveSlotLabel,
                            activeInProgTask.listId || activeInProgTask.list?.id,
                            activeInProgTask.list?.statuses
                          )
                        : '#f59e0b';
                      const isAuditorOrPm = Boolean(isPmUser || (currentUser?.id && currentUser.id === col.auditorUser.id));

                      return (
                        <>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between px-1">
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
                            </div>

                            {activeInProgTask ? (
                              <DroppableInProgressSlot userId={col.auditorUser.id} disabled={false}>
                                {renderAuditorCard(activeInProgTask, false, isColumnLiveWorking)}
                              </DroppableInProgressSlot>
                            ) : (
                              <TaskMapInProgressDropCard
                                userId={col.auditorUser.id}
                                userName={col.auditorUser.name}
                                availableTasks={toReviewTasks}
                                allAvailableTasks={allAvailablePool}
                                allTasks={allTasks || tasks}
                                queuedTasks={queuedTasks}
                                onSelectTask={(taskId, task) => handleSelectInProgressTask(taskId, col.auditorUser.id, task)}
                                disabled={false}
                                canBrowse={isAuditorOrPm}
                                roleLabel="Auditor"
                              />
                            )}
                          </div>

                          {/* QUEUE SECTION */}
                          {queuedTasks.length > 0 && (
                            <div className="mt-2.5 pt-2.5 border-t border-border/80 space-y-1.5">
                              <div className="flex items-center justify-between px-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                  Queue ({queuedTasks.length})
                                </span>
                              </div>
                              {sortTasksUrgentFirst(queuedTasks).map((t) => renderAuditorCard(t, false))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div data-column-body="true" className="flex-1 overflow-y-auto custom-scrollbar space-y-3 px-1.5 py-1 min-h-0">
                    {visibleTasks.length === 0 ? (
                      (() => {
                        const searchMatches = searchQuery.trim()
                          ? findSearchedTaskLocations(searchQuery, combinedTasks, allUsers)
                          : [];
                        return (
                          <div className="p-4 bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl min-h-[112px] flex flex-col items-center justify-center text-center transition-all hover:border-zinc-700/80 space-y-2">
                            <span className="text-xs font-semibold text-zinc-400">
                              No tasks to review
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              {searchQuery || activePriority !== 'ALL'
                                ? 'No tasks match filter'
                                : `Drop tasks here to assign to ${col.title}`}
                            </span>
                            {searchMatches.length > 0 && (
                              <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 p-2 text-left space-y-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                  Found elsewhere:
                                </p>
                                {searchMatches.map((m) => (
                                  <div key={m.taskId} className="text-[11px] leading-snug text-zinc-300">
                                    <span className="font-medium text-white">{m.title}</span>
                                    <span className="text-zinc-400"> — {m.locationText}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      sortTasksUrgentFirst(visibleTasks).map((task) => renderAuditorCard(task, true))
                    )}
                  </div>
                )}
              </DroppableColumn>
            );
          })}
        </div>
      </div>

      {/* Drag Overlay Preview */}
      <DragOverlay>
        {activeDragTask ? (
          <div className="p-3.5 bg-card border border-amber-500/80 rounded-xl shadow-2xl w-[320px] pointer-events-none opacity-90">
            <div className="text-xs text-zinc-400 font-medium flex items-center gap-1.5 mb-1">
              {activeDragTask.isSubtask && (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 font-bold text-[10px] shrink-0">
                  <CornerDownRight className="size-2.5 shrink-0" />
                </span>
              )}
              <span className="truncate">{activeDragTask.list?.name || 'General'}</span>
            </div>
            <h4 className="text-sm font-bold text-white truncate">
              {activeDragTask.isSubtask ? (activeDragTask.title || '').replace(/^--\s*/, '') : activeDragTask.title}
            </h4>
          </div>
        ) : null}
      </DragOverlay>

      {/* Blocked Audits / Subtasks Modal */}
      <UncheckedAuditsModal
        isOpen={blockedAuditAlert.isOpen}
        onClose={() => setBlockedAuditAlert((prev) => ({ ...prev, isOpen: false }))}
        taskTitle={blockedAuditAlert.task?.title || ''}
        targetStatus={blockedAuditAlert.targetStatus}
        uncheckedAudits={blockedAuditAlert.uncheckedAudits}
        openSubtasks={blockedAuditAlert.openSubtasks}
        onReviewAudits={() => {
          if (blockedAuditAlert.task) {
            onOpenDetail(blockedAuditAlert.task);
            if (blockedAuditAlert.uncheckedAudits && blockedAuditAlert.uncheckedAudits.length > 0) {
              const pendingHighlight = {
                taskId: blockedAuditAlert.task.id,
                targetStatus: blockedAuditAlert.targetStatus,
                uncheckedAudits: blockedAuditAlert.uncheckedAudits,
                openSubtasks: blockedAuditAlert.openSubtasks,
              };
              if (typeof window !== 'undefined') {
                (window as any).__pendingAuditHighlight = pendingHighlight;
              }
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent('task:highlight-audits', { detail: pendingHighlight })
                );
              }, 350);
            }
          }
        }}
        reviewButtonText={
          blockedAuditAlert.uncheckedAudits.length > 0
            ? 'Open Task & Review Audits'
            : 'Open Task & Review Subtasks'
        }
      />

      {/* Sub-Status Change Guide Modal */}
      {subStatusGuideTarget && (
        <SubStatusChangeGuideModal
          isOpen={Boolean(subStatusGuideTarget)}
          onClose={() => setSubStatusGuideTarget(null)}
          onConfirm={subStatusGuideTarget.onConfirm}
          guide={subStatusGuideTarget.guide}
          taskTitle={subStatusGuideTarget.task.title}
          clientName={subStatusGuideTarget.task.progress?.client || subStatusGuideTarget.task.list?.name || ''}
          currentSubStatuses={subStatusGuideTarget.task.taskMap?.statuses || []}
          currentMainStatus={subStatusGuideTarget.task.status || ''}
        />
      )}
    </DndContext>
    </>
  );
};
