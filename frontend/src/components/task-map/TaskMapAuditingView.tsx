'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TaskMapItem, TaskMapOption, taskMapApi, hasUiUxOrDesignAudit, canPerformAudit } from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import { UserRoleBadge } from './UserRoleBadge';
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
} from 'lucide-react';
import { format } from 'date-fns';
import { isAuditorUser, canTransitionTaskStatus, canUserEditTask, canUserMoveTask } from '@/lib/permissions';
import { UncheckedAuditsModal } from '@/components/modals/UncheckedAuditsModal';
import { toast } from '@/lib/toast';
import {
  CardStatusDropdown,
  CardPriorityDropdown,
  ColumnPriorityDropdown,
  matchesPriorityFilter,
  matchesSearchFilter,
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
  tasks: TaskMapItem[];
  availablePool: TaskMapItem[];
  options: TaskMapOption[];
  allUsers?: any[];
  shiftUsers?: any[];
  onStatusChange: (taskId: string, newStatuses: string[]) => void;
  onOptionsUpdated: () => void;
  onOpenDetail: (task: TaskMapItem) => void;
  onDataRefresh: () => void;
  onTaskUpdate?: (taskId: string, fields: Partial<TaskMapItem>) => Promise<void> | void;
  auditorTypeFilter?: string;
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

  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={`touch-none transition-all duration-200 ease-out ${isDragging
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
  now: Date;
}

const TaskTimeProgressSlot: React.FC<TaskTimeProgressSlotProps> = ({ task, now }) => {
  const prog = task.progress;

  if (prog?.isMissingTime) {
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
  tasks = [],
  availablePool = [],
  options = [],
  allUsers = [],
  shiftUsers = [],
  onStatusChange,
  onOptionsUpdated,
  onOpenDetail,
  onDataRefresh,
  onTaskUpdate,
  auditorTypeFilter = 'ALL',
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
  const boardScrollRef = useRef<HTMLDivElement>(null);

  // Live ticking clock to update in-progress elapsed minutes and hours
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const cleanSearch = (search || '').trim().toLowerCase();
  const isAuditorSearchMatch = (u: any) => {
    if (!cleanSearch || !u) return false;
    const name = (u.name || '').trim().toLowerCase();
    const email = (u.email || '').trim().toLowerCase();
    return name.includes(cleanSearch) || email.includes(cleanSearch);
  };

  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  const currentUser = useAppStore((s) => s.currentUser);

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

  // 1. Discover all users with an Audit/Auditor role
  const auditorUsers = React.useMemo(() => {
    const map = new Map<string, any>();
    const candidates = [...(shiftUsers || []), ...(allUsers || [])];
    for (const u of candidates) {
      if (!u || !u.id) continue;
      if (map.has(u.id)) continue;
      if (isAuditorUser(u)) {
        map.set(u.id, u);
      }
    }
    const list = Array.from(map.values());
    // Sort auditors alphabetically by first name
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allUsers, shiftUsers]);

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

  // Check if a task is under Admin folder
  const isTaskUnderAdmin = (t: TaskMapItem) => {
    if (t.isAdminTask) return true;
    const fName = (t.list?.folder?.name || '').toLowerCase().trim();
    const lName = (t.list?.name || '').toLowerCase().trim();
    const ADMIN_LIST_NAMES = new Set([
      'admin | jenesia red',
      'harmony',
      'jenesia red',
      'jenesia red | personal',
      'snaply',
      'vip scale',
      'xfnite',
    ]);
    return fName === 'admin' || fName.includes('admin') || lName === 'admin' || ADMIN_LIST_NAMES.has(lName);
  };

  // All combined review candidates (admin & client filtering applied per column)
  const filteredReviewTasks = combinedTasks;

  // Check if a task has review or checking status
  const isReviewStatus = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );
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

  // Check if a task is assigned to a specific auditor
  const isTaskAssignedToAuditor = (task: TaskMapItem, auditor: any) => {
    // 1. Check taskMap.statuses for tag matching (e.g. initials CHE, PAU, HAN or auditor name)
    const mapStatuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
    const audNameUpper = (auditor.name || '').toUpperCase().trim();
    const firstName = audNameUpper.split(' ')[0];
    const shortInitials = audNameUpper.substring(0, 3);

    const hasAuditorTag =
      mapStatuses.includes(audNameUpper) ||
      (firstName && mapStatuses.includes(firstName)) ||
      (shortInitials && mapStatuses.includes(shortInitials)) ||
      mapStatuses.includes(auditor.id.toUpperCase());

    if (hasAuditorTag) return true;

    // 2. Direct assignee check: ONLY if the task has a review-related status!
    const isDirectAssignee =
      task.assignee?.id === auditor.id ||
      (task.assignees || []).some((u) => u.id === auditor.id);

    if (isDirectAssignee && isReviewStatus(task)) return true;

    return false;
  };

  // General "To Review" queue: tasks needing review that are not yet assigned to an auditor
  const isGeneralToReview = (t: TaskMapItem) => {
    // If it's already assigned to any discovered auditor, not general queue
    if (auditorUsers.some((a) => isTaskAssignedToAuditor(t, a))) return false;

    const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );

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
    const task = combinedTasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentStatuses = task.taskMap?.statuses || [];

    // Strip previous review & auditor tags and audit substatuses
    let updatedStatuses = currentStatuses.filter((s) => {
      const up = s.toUpperCase().trim();
      if (
        up === 'TO REVIEW' ||
        up === 'IN REVIEW' ||
        up === 'DESIGN AUDIT' ||
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
      updatedStatuses = [];
      toast.info('Task moved to General Review queue');
      onStatusChange(taskId, updatedStatuses);

      const targetStatus = hasUiUxOrDesignAudit(task) ? 'In Review' : 'Checking';
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { assigneeId: null, status: targetStatus });
      } else {
        await tasksApi
          .updateTask(taskId, { assigneeId: null, status: targetStatus } as any)
          .catch(console.error);
        onDataRefresh();
      }
    } else if (targetColumnId.startsWith('col-auditor-')) {
      const auditorId = targetColumnId.replace('col-auditor-', '');
      const auditor = auditorUsers.find((a) => a.id === auditorId);
      if (auditor) {
        const auditType = getDesignatedAuditType(auditor);

        // Enforce hierarchy before assigning to auditor!
        const permCheck = canPerformAudit(auditType, task);
        if (!permCheck.allowed) {
          toast.error(permCheck.reason || 'Cannot assign: prerequisites not completed.');
          return;
        }

        updatedStatuses = [auditType];
        toast.success(`Task assigned to ${auditor.name} (${auditType})`);
        onStatusChange(taskId, updatedStatuses);

        const targetStatus = (auditType === 'UI UX Audit' || auditType === 'Design Audit') ? 'In Review' : 'Checking';

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

  // Helper options for sub-status dropdown in Auditing
  const getAuditingOptions = (_task: TaskMapItem): TaskMapOption[] => [
    { id: 'opt-audit-design', label: 'Design Audit', color: '#ec4899', textColor: '#ffffff', order: 1 },
    { id: 'opt-audit-uiux', label: 'UI UX Audit', color: '#06b6d4', textColor: '#ffffff', order: 2 },
    { id: 'opt-audit-instruction', label: 'Instruction Audit', color: '#10b981', textColor: '#ffffff', order: 3 },
    { id: 'opt-audit-funnel', label: 'Funnel Audit', color: '#f59e0b', textColor: '#ffffff', order: 4 },
    { id: 'opt-audit-waiting', label: 'Waiting', color: '#ef4444', textColor: '#ffffff', order: 5 },
    { id: 'opt-audit-tosend', label: 'To Send', color: '#22A3AE', textColor: '#ffffff', order: 6 },
    { id: 'opt-audit-askclient', label: 'Ask Client', color: '#2dd4bf', textColor: '#ffffff', order: 7 },
    { id: 'opt-audit-revision', label: 'Revision', color: '#5B6BD6', textColor: '#ffffff', order: 8 },
  ];

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
      badgeClass: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
      dotColor: 'bg-blue-500',
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

  // Separate pinned and unpinned columns, moving search-matched auditor columns to the most left side
  const auditorSearchMatches = allColumns.filter((c) => c.isAuditor && isAuditorSearchMatch(c.auditorUser));
  const searchMatchedIds = new Set(auditorSearchMatches.map((c) => c.id));
  const otherPinnedCols = allColumns.filter((c) => pinnedColumns[c.id] && !searchMatchedIds.has(c.id));
  const otherUnpinnedCols = allColumns.filter((c) => !pinnedColumns[c.id] && !searchMatchedIds.has(c.id));

  const orderedColumns: AuditingColumnDef[] = cleanSearch && auditorSearchMatches.length > 0
    ? [
        allColumns[0], // col-to-review
        ...auditorSearchMatches,
        ...otherPinnedCols.filter((c) => c.id !== 'col-to-review'),
        ...otherUnpinnedCols.filter((c) => c.id !== 'col-to-review'),
      ]
    : [...otherPinnedCols, ...otherUnpinnedCols];

  return (
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
                    {col.tasks.length}
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
                      {col.tasks.length}
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

                {/* Cards List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 px-1.5 py-1">
                  {visibleTasks.length === 0 ? (
                    <div className="p-4 bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl min-h-[112px] flex flex-col items-center justify-center text-center transition-all hover:border-zinc-700/80">
                      <span className="text-xs font-semibold text-zinc-400">
                        No tasks to review
                      </span>
                      <span className="text-[11px] text-zinc-500 mt-1">
                        {searchQuery || activePriority !== 'ALL'
                          ? 'No tasks match filter'
                          : `Drop tasks here to assign to ${col.title}`}
                      </span>
                    </div>
                  ) : (
                    visibleTasks.map((task) => {
                      return (
                        <DraggableTaskCard key={task.id} task={task} disabled={false}>
                          <div className="p-3 bg-zinc-900 border border-border hover:border-zinc-700 rounded-xl shadow-md min-h-[112px] flex flex-col justify-between transition-all group">
                            <div className="flex items-stretch gap-3">
                              {/* Left: Task Info */}
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                              {/* Client / List Name */}
                              <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[170px] mb-1">
                                {task.list?.name || 'General'}
                              </div>

                              {/* Title */}
                              <h4
                                onClick={() => onOpenDetail(task)}
                                className="text-[13px] font-bold text-zinc-100 group-hover:text-white cursor-pointer line-clamp-2 leading-snug hover:underline my-0.5 h-[36px]"
                                title={task.title}
                              >
                                {task.title}
                              </h4>

                              {/* Controls row: circle dot left of bulletin, priority flag (Exact Task Map parity) */}
                              <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                                {/* Circle Dot Status Indicator */}
                                <CardStatusDropdown
                                  taskId={task.id}
                                  currentStatus={task.status || 'In progress'}
                                  onSelect={async (newStatus) => {
                                    const transitionCheck = canTransitionTaskStatus(task, newStatus);
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
                              <div className="flex justify-end items-center">
                                <TaskTimeProgressSlot task={task} now={currentTime} />
                              </div>

                              <div
                                className="w-full"
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                                  Sub-Status
                                </span>
                                <TaskMapStatusDropdown
                                  selectedStatuses={task.taskMap?.statuses || []}
                                  options={getAuditingOptions(task)}
                                  onToggleStatus={async (label, nextStatuses) => {
                                    const isSelecting = (nextStatuses || []).includes(label);
                                    const cleanNext = isSelecting ? [label] : [];
                                    const norm = label.toLowerCase().trim();
                                    
                                    if (norm === 'to send') {
                                      if (isSelecting) {
                                        const transitionCheck = canTransitionTaskStatus(task, 'CRM');
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

                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'CRM' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.success('Task marked To Send — transferred to CRM Map pool');
                                      } else {
                                        // User pressed 'To Send' AGAIN in Auditing -> revert back to last status
                                        const defaultRev = hasUiUxOrDesignAudit(task) ? 'In Review' : 'Checking';
                                        const revertStatus = (task as any)._previousStatus || defaultRev;
                                        onStatusChange(task.id, []);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: revertStatus });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info(`Reverted 'To Send' — returned to ${revertStatus}`);
                                      }
                                    } else if (norm === 'waiting') {
                                      if (isSelecting) {
                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'Waiting' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'Waiting' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.success('Task moved to Waiting — transferred to CRM Map');
                                      } else {
                                        const defaultRev = hasUiUxOrDesignAudit(task) ? 'In Review' : 'Checking';
                                        const revertStatus = (task as any)._previousStatus || defaultRev;
                                        onStatusChange(task.id, []);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: revertStatus });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info(`Reverted 'Waiting' — returned to ${revertStatus}`);
                                      }
                                    } else if (norm === 'ask client' || norm === 'askclient') {
                                      if (isSelecting) {
                                        onStatusChange(task.id, cleanNext);
                                        const targetRev = hasUiUxOrDesignAudit(task) ? 'In Review' : 'Checking';
                                        if (task.status !== targetRev) {
                                          if (onTaskUpdate) {
                                            await onTaskUpdate(task.id, { status: targetRev });
                                          } else {
                                            await tasksApi.updateTask(task.id, { status: targetRev } as any).catch(console.error);
                                          }
                                        }
                                        toast.info(`Task marked 'Ask Client' — transferred to CRM Map pool (stays ${targetRev})`);
                                      } else {
                                        onStatusChange(task.id, []);
                                        toast.info("Removed 'Ask Client'");
                                      }
                                    } else if (norm === 'revision') {
                                      if (isSelecting) {
                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'Revision', assigneeId: null } as any);
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'Revision', assigneeId: null } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.warning('Task marked for Revision — returned to Task Map available tasks');
                                      } else {
                                        const defaultRev = hasUiUxOrDesignAudit(task) ? 'In Review' : 'Checking';
                                        const revertStatus = (task as any)._previousStatus || defaultRev;
                                        onStatusChange(task.id, []);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: revertStatus });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info(`Reverted 'Revision' — returned to ${revertStatus}`);
                                      }
                                    } else {
                                      // Designated audit types: Design Audit, UI UX Audit, Instruction Audit, Funnel Audit
                                      onStatusChange(task.id, cleanNext);
                                      if (isSelecting) {
                                        toast.success(`Sub-status set to ${label}`);
                                      }
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
                              isQueueColumn={col.id === 'col-to-review'}
                              currentUser={currentUser}
                              onChecklistsUpdated={(updatedCls) => {
                                task.checklists = updatedCls;
                              }}
                            />
                          </div>
                        </DraggableTaskCard>
                      );
                    })
                  )}
                </div>
              </DroppableColumn>
            );
          })}
        </div>
      </div>

      {/* Drag Overlay Preview */}
      <DragOverlay>
        {activeDragTask ? (
          <div className="p-3.5 bg-card border border-amber-500/80 rounded-xl shadow-2xl w-[320px] pointer-events-none opacity-90">
            <span className="text-xs text-zinc-400 font-medium block mb-1">
              {activeDragTask.list?.name || 'General'}
            </span>
            <h4 className="text-sm font-bold text-white truncate">
              {activeDragTask.title}
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
    </DndContext>
  );
};
