'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TaskMapItem, TaskMapOption } from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import {
  ShieldCheck,
  Pin,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  User,
  Infinity as InfinityIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import { isAuditorUser } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import {
  CardStatusDropdown,
  CardPriorityDropdown,
  ColumnPriorityDropdown,
  matchesPriorityFilter,
  matchesSearchFilter,
} from './TaskMapCardControls';
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
const getAuditorBadge = (user: any) => {
  const roles = (user.roles || []).map((r: string) => (r || '').toLowerCase());
  if (roles.some((r: string) => r.includes('ui') || r.includes('ux'))) {
    return { label: 'UI/UX Auditor', color: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60' };
  }
  if (roles.some((r: string) => r.includes('design'))) {
    return { label: 'Design Auditor', color: 'bg-pink-950/80 text-pink-300 border-pink-800/60' };
  }
  if (roles.some((r: string) => r.includes('funnel'))) {
    return { label: 'Funnel Auditor', color: 'bg-amber-950/80 text-amber-300 border-amber-800/60' };
  }
  if (roles.some((r: string) => r.includes('instruction'))) {
    return { label: 'Instruction Auditor', color: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60' };
  }
  return { label: 'Auditor', color: 'bg-purple-950/80 text-purple-300 border-purple-800/60' };
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
}) => {
  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);

  // Live ticking clock to update in-progress elapsed minutes and hours
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);
  const [showAdminTasks, setShowAdminTasks] = useState(false);

  // Column controls: Priority filter, search, pin, collapse
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
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
    const fName = (t.list?.folder?.name || '').toLowerCase();
    const lName = (t.list?.name || '').toLowerCase();
    return fName === 'admin' || fName.includes('admin') || lName === 'admin';
  };

  // Filter out Admin tasks if toggled off
  const filteredReviewTasks = React.useMemo(() => {
    return combinedTasks.filter((t) => {
      if (!showAdminTasks && isTaskUnderAdmin(t)) return false;
      return true;
    });
  }, [combinedTasks, showAdminTasks]);

  // Categorize tasks
  const isDoneReview = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase();
    const mapStatuses = (t.taskMap?.statuses || []).map((x) => x.toUpperCase().trim());
    return (
      s === 'DONE REVIEW' ||
      s === 'DONEREVIEW' ||
      mapStatuses.includes('DONE REVIEW') ||
      mapStatuses.includes('DONEREVIEW')
    );
  };

  // Check if a task has review status
  const isReviewStatus = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );
    return (
      s === 'TOREVIEW' ||
      s === 'INREVIEW' ||
      s === 'REVIEW' ||
      s === 'DONEREVIEW' ||
      mapStatuses.includes('TOREVIEW') ||
      mapStatuses.includes('INREVIEW') ||
      mapStatuses.includes('REVIEW') ||
      mapStatuses.includes('DONEREVIEW')
    );
  };

  // Check if a task is assigned to a specific auditor
  const isTaskAssignedToAuditor = (task: TaskMapItem, auditor: any) => {
    if (isDoneReview(task)) return false;

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
    if (isDoneReview(t)) return false;
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
      mapStatuses.includes('TOREVIEW') ||
      mapStatuses.includes('INREVIEW') ||
      mapStatuses.includes('REVIEW')
    );
  };

  // Build the list of columns
  const toReviewTasks = filteredReviewTasks.filter(isGeneralToReview);
  const doneReviewTasks = filteredReviewTasks.filter(isDoneReview);

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

    // Strip previous review & auditor tags
    let updatedStatuses = currentStatuses.filter((s) => {
      const up = s.toUpperCase().trim();
      if (up === 'TO REVIEW' || up === 'DONE REVIEW' || up === 'IN REVIEW') return false;
      return !auditorUsers.some((a) => {
        const nameUp = (a.name || '').toUpperCase().trim();
        const first = nameUp.split(' ')[0];
        const shortInitials = nameUp.substring(0, 3);
        return up === nameUp || up === first || up === shortInitials || up === a.id.toUpperCase();
      });
    });

    if (targetColumnId === 'col-to-review') {
      updatedStatuses = ['To review'];
      toast.info('Task moved to General Review queue');
      onStatusChange(taskId, updatedStatuses);
    } else if (targetColumnId === 'col-done-review') {
      updatedStatuses = ['Done Review'];
      toast.success('Task marked Done Review');
      onStatusChange(taskId, updatedStatuses);
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { status: 'Done Review' });
      } else {
        await tasksApi.updateTask(taskId, { status: 'Done Review' } as any).catch(console.error);
      }
    } else if (targetColumnId.startsWith('col-auditor-')) {
      const auditorId = targetColumnId.replace('col-auditor-', '');
      const auditor = auditorUsers.find((a) => a.id === auditorId);
      if (auditor) {
        updatedStatuses = ['To review'];
        toast.success(`Task assigned to ${auditor.name} for review`);
        onStatusChange(taskId, updatedStatuses);

        if (onTaskUpdate) {
          await onTaskUpdate(taskId, { assigneeId: auditor.id, status: 'In Review' });
        } else {
          await tasksApi
            .updateTask(taskId, { assigneeId: auditor.id, status: 'In Review' } as any)
            .catch(console.error);
        }
      }
    }
  };

  // Helper options for sub-status dropdown in Auditing
  const getAuditingOptions = (task: TaskMapItem): TaskMapOption[] => [
    { id: 'opt-audit-tosend', label: 'To send', color: '#22A3AE', textColor: '#ffffff', order: 1 },
    { id: 'opt-audit-revision', label: 'Revision', color: '#5B6BD6', textColor: '#ffffff', order: 2 },
    { id: 'opt-audit-donereview', label: 'Done Review', color: '#2dd4bf', textColor: '#134e4a', order: 3 },
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
      badgeClass: 'bg-blue-950 text-blue-300 border-blue-800',
      dotColor: 'bg-blue-500',
      tasks: toReviewTasks,
    },
    ...auditorUsers.map((auditor) => {
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
    {
      id: 'col-done-review',
      title: 'Done Review',
      subtitle: 'Approved & verified reviews',
      badgeLabel: 'Verified',
      badgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-800',
      dotColor: 'bg-emerald-500',
      tasks: doneReviewTasks,
    },
  ];

  // Separate pinned and unpinned columns
  const pinnedCols = allColumns.filter((c) => pinnedColumns[c.id]);
  const unpinnedCols = allColumns.filter((c) => !pinnedColumns[c.id]);
  const orderedColumns = [...pinnedCols, ...unpinnedCols];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full bg-background select-none">
        {/* Board Columns Horizontal Scroll */}
        <div className="flex-1 flex gap-4 px-6 py-4 overflow-x-auto custom-scrollbar select-none">
          {orderedColumns.map((col) => {
            const isPinned = !!pinnedColumns[col.id];
            const isCollapsed = !!collapsedColumns[col.id];
            const activePriority = columnPriorityFilters[col.id] || 'ALL';
            const searchQuery = columnSearches[col.id] || '';
            const isSearchOpen = !!columnSearchOpen[col.id];

            // Apply priority & search filter inside column
            const visibleTasks = col.tasks.filter((t) => {
              if (!matchesPriorityFilter(t, activePriority)) return false;
              if (!matchesSearchFilter(t, searchQuery)) return false;
              return true;
            });

            // Collapsed Column Bar
            if (isCollapsed) {
              return (
                <DroppableColumn
                  key={`${col.id}-collapsed`}
                  id={col.id}
                  className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-[calc(100vh-130px)] transition-all cursor-pointer hover:border-amber-500/50 ${isPinned ? 'ring-1 ring-amber-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
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
                className={`w-[370px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-[calc(100vh-130px)] ${isPinned ? 'ring-1 ring-amber-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                  }`}
              >
                {/* Header Top Row: Left side has dot/avatar & title & badge & count; Right side has Collapse, Pin, Search */}
                <div className="flex items-center justify-between pb-2 border-b border-border/80 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
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

                    {col.badgeLabel && (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 truncate ${col.badgeClass || 'bg-zinc-800 text-zinc-400 border-zinc-700'
                          }`}
                      >
                        {col.badgeLabel}
                      </span>
                    )}

                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${col.badgeClass || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                        }`}
                    >
                      {col.tasks.length}
                    </span>
                  </div>

                  {/* Top Right: Collapse, Pin, Search (Search on right side) */}
                  <div className="flex items-center gap-1 shrink-0">
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
                  <ColumnPriorityDropdown
                    columnId={col.id}
                    tasks={col.tasks}
                    activeFilter={activePriority}
                    onSelectFilter={(cId, filter) =>
                      setColumnPriorityFilters((prev) => ({ ...prev, [cId]: filter }))
                    }
                  />
                  {searchQuery && (
                    <span className="text-[10px] text-zinc-400 italic">
                      ({visibleTasks.length} of {col.tasks.length})
                    </span>
                  )}
                </div>

                {/* Cards List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                  {visibleTasks.length === 0 ? (
                    <p className="text-xs text-zinc-600 italic text-center py-12">
                      {searchQuery || activePriority !== 'ALL'
                        ? 'No tasks match filter'
                        : `No tasks in ${col.title}`}
                    </p>
                  ) : (
                    visibleTasks.map((task) => {
                      return (
                        <DraggableTaskCard key={task.id} task={task} disabled={false}>
                          <div className="p-3 bg-zinc-900 border border-border hover:border-zinc-700 rounded-xl shadow-md min-h-[94px] flex items-stretch gap-3 transition-all group">
                            {/* Left: Task Info */}
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                              {/* Client / List Name */}
                              <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[170px] mb-1">
                                {task.list?.name || 'General'}
                              </div>

                              {/* Title */}
                              <h4
                                onClick={() => onOpenDetail(task)}
                                className="text-[13px] font-bold text-zinc-100 group-hover:text-white cursor-pointer line-clamp-2 leading-snug hover:underline my-0.5"
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
                                    
                                    if (label === 'To send') {
                                      if (isSelecting) {
                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'CRM' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.success('Task marked To send — passed to CRM');
                                      } else {
                                        // User pressed 'To send' AGAIN in Auditing -> revert back to last status
                                        const revertStatus = (task as any)._previousStatus || (task.assigneeId ? 'In Review' : 'To review');
                                        onStatusChange(task.id, []);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: revertStatus });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info(`Reverted 'To send' — returned to ${revertStatus}`);
                                      }
                                    } else if (label === 'Revision') {
                                      if (isSelecting) {
                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'Revision' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'Revision' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.warning('Task marked for Revision');
                                      } else {
                                        const revertStatus = (task as any)._previousStatus || (task.assigneeId ? 'In Review' : 'To review');
                                        onStatusChange(task.id, []);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: revertStatus });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info(`Reverted 'Revision' — returned to ${revertStatus}`);
                                      }
                                    } else if (label === 'Done Review') {
                                      if (isSelecting) {
                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'Done Review' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'Done Review' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.success('Task marked Done Review');
                                      } else {
                                        const revertStatus = (task as any)._previousStatus || (task.assigneeId ? 'In Review' : 'To review');
                                        onStatusChange(task.id, []);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: revertStatus });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info(`Reverted 'Done Review' — returned to ${revertStatus}`);
                                      }
                                    } else {
                                      onStatusChange(task.id, cleanNext);
                                    }
                                  }}
                                  onOptionsUpdated={onOptionsUpdated}
                                  readOnly={false}
                                />
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
    </DndContext>
  );
};
