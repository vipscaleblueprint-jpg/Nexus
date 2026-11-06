'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TaskMapItem, TaskMapOption } from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import {
  UserCheck,
  Pin,
  PinOff,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Lock,
  ArrowLeft,
} from 'lucide-react';
import { format } from 'date-fns';
import { isCrmUser, hasCrmAccess } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
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
  onSwitchToBoard?: () => void;
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
      className={`touch-none transition-all duration-200 ease-out ${
        isDragging
          ? 'opacity-25 scale-[0.98] border border-dashed border-[#22A3AE] rounded-xl bg-zinc-900/40 pointer-events-none'
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
      className={`${className || ''} transition-all duration-200 ${
        isOver ? 'ring-2 ring-[#22A3AE]/70 bg-cyan-950/25 shadow-xl shadow-cyan-950/40 scale-[1.005]' : ''
      }`}
    >
      {children}
    </div>
  );
};

export const TaskMapCrmView: React.FC<Props> = ({
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
  onSwitchToBoard,
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const userHasAccess = hasCrmAccess(currentUser);

  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);
  const [showAdminTasks, setShowAdminTasks] = useState(false);

  // Column controls: Priority filter, search, pin, collapse
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
  const [columnSearches, setColumnSearches] = useState<Record<string, string>>({});
  const [columnSearchOpen, setColumnSearchOpen] = useState<Record<string, boolean>>({});

  const [pinnedColumns, setPinnedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_crm_pinned_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_crm_collapsed_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const togglePinColumn = (columnId: string) => {
    setPinnedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_crm_pinned_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save pinned crm columns', e);
      }
      return next;
    });
  };

  const toggleCollapseColumn = (columnId: string) => {
    setCollapsedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_crm_collapsed_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save collapsed crm columns', e);
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

  // Discover all users who hold a CRM role
  const crmUsers = React.useMemo(() => {
    const map = new Map<string, any>();
    const candidates = [...(allUsers || []), ...(shiftUsers || [])];
    for (const u of candidates) {
      if (!u || !u.id) continue;
      if (map.has(u.id)) continue;
      if (isCrmUser(u)) {
        map.set(u.id, u);
      }
    }
    const list = Array.from(map.values());
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allUsers, shiftUsers]);

  // Combined tasks
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
  const filteredCrmTasks = React.useMemo(() => {
    return combinedTasks.filter((t) => {
      if (!showAdminTasks && isTaskUnderAdmin(t)) return false;
      return true;
    });
  }, [combinedTasks, showAdminTasks]);

  // Check if task is CRM completed
  const isCrmCompleted = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().trim();
    const mapStatuses = (t.taskMap?.statuses || []).map((x) => x.toUpperCase().trim());
    return (
      s === 'DONE' ||
      s === 'CLOSED' ||
      s === 'SENT' ||
      s === 'OUTREACH SENT' ||
      mapStatuses.includes('OUTREACH SENT') ||
      mapStatuses.includes('CLIENT SENT')
    );
  };

  // Check if task is assigned to a specific CRM member
  const isTaskAssignedToCrmMember = (task: TaskMapItem, crmMember: any) => {
    if (isCrmCompleted(task)) return false;

    // Direct assignee check
    if (task.assignee?.id === crmMember.id) return true;
    if ((task.assignees || []).some((u) => u.id === crmMember.id)) return true;

    // Tag match
    const mapStatuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
    const memberNameUpper = (crmMember.name || '').toUpperCase().trim();
    const first = memberNameUpper.split(' ')[0];
    if (mapStatuses.includes(memberNameUpper)) return true;
    if (first && mapStatuses.includes(first)) return true;

    return false;
  };

  // General CRM Pool: tasks needing client outreach / CRM that are not yet assigned to a specific CRM member
  const isGeneralCrmPool = (t: TaskMapItem) => {
    if (isCrmCompleted(t)) return false;
    if (crmUsers.some((u) => isTaskAssignedToCrmMember(t, u))) return false;

    const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );

    return (
      s === 'CRM' ||
      s === 'TOCONTACT' ||
      s === 'OUTREACH' ||
      s === 'FOLLOWUP' ||
      mapStatuses.includes('CRM') ||
      mapStatuses.includes('TOSEND') ||
      mapStatuses.includes('FOLLOWUP') ||
      mapStatuses.includes('OUTREACH')
    );
  };

  const poolTasks = filteredCrmTasks.filter(isGeneralCrmPool);
  const completedTasks = filteredCrmTasks.filter(
    (t) =>
      isCrmCompleted(t) &&
      ((t.status || '').toUpperCase() === 'CRM' ||
        (t.taskMap?.statuses || []).some((s) => s.toUpperCase().includes('CRM')))
  );

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

    // Strip old CRM member tags
    let updatedStatuses = currentStatuses.filter((s) => {
      const up = s.toUpperCase().trim();
      return !crmUsers.some((u) => {
        const nameUp = (u.name || '').toUpperCase().trim();
        const first = nameUp.split(' ')[0];
        return up === nameUp || up === first || up === u.id.toUpperCase();
      });
    });

    if (targetColumnId === 'col-crm-pool') {
      if (!updatedStatuses.includes('CRM')) updatedStatuses.push('CRM');
      toast.info('Task moved to General CRM Pool');
      onStatusChange(taskId, updatedStatuses);
    } else if (targetColumnId === 'col-crm-completed') {
      if (!updatedStatuses.includes('Outreach Sent')) updatedStatuses.push('Outreach Sent');
      toast.success('Task marked Outreach Sent / Done');
      onStatusChange(taskId, updatedStatuses);
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { status: 'Closed' });
      } else {
        await tasksApi.updateTask(taskId, { status: 'Closed' } as any).catch(console.error);
      }
    } else if (targetColumnId.startsWith('col-crm-member-')) {
      const memberId = targetColumnId.replace('col-crm-member-', '');
      const member = crmUsers.find((u) => u.id === memberId);
      if (member) {
        const first = (member.name || '').split(' ')[0].toUpperCase();
        updatedStatuses.push(first);
        if (!updatedStatuses.includes('CRM')) updatedStatuses.push('CRM');
        toast.success(`Task assigned to ${member.name} for CRM outreach`);
        onStatusChange(taskId, updatedStatuses);

        if (onTaskUpdate) {
          await onTaskUpdate(taskId, { assigneeId: member.id, status: 'CRM' });
        } else {
          await tasksApi
            .updateTask(taskId, { assigneeId: member.id, status: 'CRM' } as any)
            .catch(console.error);
        }
      }
    }
  };

  // Helper options for sub-status dropdown in CRM
  const getCrmOptions = (task: TaskMapItem): TaskMapOption[] => {
    const base: TaskMapOption[] = [
      { id: 'opt-crm-active', label: 'CRM', color: '#22A3AE', textColor: '#ffffff', order: 1 },
      { id: 'opt-crm-sent', label: 'Outreach Sent', color: '#10b981', textColor: '#ffffff', order: 2 },
      { id: 'opt-crm-followup', label: 'Follow up', color: '#f59e0b', textColor: '#ffffff', order: 3 },
      { id: 'opt-crm-waiting', label: 'Waiting Client', color: '#8b5cf6', textColor: '#ffffff', order: 4 },
    ];

    crmUsers.forEach((u, idx) => {
      const first = (u.name || '').split(' ')[0].toUpperCase();
      base.push({
        id: `opt-crm-${u.id}`,
        label: first,
        color: '#22A3AE',
        textColor: '#ffffff',
        order: 10 + idx,
      });
    });

    return base;
  };

  // Assemble full columns array
  interface CrmColumnDef {
    id: string;
    title: string;
    subtitle: string;
    badgeLabel?: string;
    badgeClass?: string;
    dotColor: string;
    tasks: TaskMapItem[];
    isMember?: boolean;
    memberUser?: any;
  }

  const allColumns: CrmColumnDef[] = [
    {
      id: 'col-crm-pool',
      title: 'CRM Pool',
      subtitle: 'Incoming client outreach & communication pool',
      badgeLabel: 'Pool',
      badgeClass: 'bg-[#22A3AE]/20 text-[#22A3AE] border-[#22A3AE]/30',
      dotColor: 'bg-[#22A3AE]',
      tasks: poolTasks,
    },
    ...crmUsers.map((member) => {
      const memberTasks = filteredCrmTasks.filter((t) => isTaskAssignedToCrmMember(t, member));
      return {
        id: `col-crm-member-${member.id}`,
        title: member.name || 'CRM',
        subtitle: `Client outreach queue for ${member.name}`,
        badgeLabel: 'CRM',
        badgeClass: 'bg-[#22A3AE]/20 text-[#22A3AE] border-[#22A3AE]/30',
        dotColor: 'bg-[#22A3AE]',
        tasks: memberTasks,
        isMember: true,
        memberUser: member,
      };
    }),
    {
      id: 'col-crm-completed',
      title: 'Outreach Completed',
      subtitle: 'Communications sent & verified',
      badgeLabel: 'Sent',
      badgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-800',
      dotColor: 'bg-emerald-500',
      tasks: completedTasks,
    },
  ];

  // Separate pinned and unpinned columns
  const pinnedCols = allColumns.filter((c) => pinnedColumns[c.id]);
  const unpinnedCols = allColumns.filter((c) => !pinnedColumns[c.id]);
  const orderedColumns = [...pinnedCols, ...unpinnedCols];

  // If user does not have permission, show access restricted screen
  if (!userHasAccess) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 h-full bg-background select-none">
        <div className="max-w-md w-full bg-card border border-zinc-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
          <div className="size-12 rounded-full bg-cyan-950/80 border border-[#22A3AE]/40 flex items-center justify-center mb-4 text-[#22A3AE]">
            <Lock className="size-6" />
          </div>
          <h2 className="text-lg font-bold text-zinc-100 mb-1.5">
            Restricted Access: CRM Board
          </h2>
          <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
            This board is exclusively accessible to Client Relationship Managers (CRM) and Administrators. You do not currently hold permission to access client communication workflows.
          </p>
          {onSwitchToBoard && (
            <button
              type="button"
              onClick={onSwitchToBoard}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <ArrowLeft className="size-3.5" />
              <span>Return to Task Map</span>
            </button>
          )}
        </div>
      </div>
    );
  }

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
                <div
                  key={col.id}
                  className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/80 border border-zinc-800 rounded-2xl shadow-md h-[calc(100vh-130px)] transition-all ${
                    isPinned ? 'border-[#22A3AE]/50 ring-1 ring-[#22A3AE]/30' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapseColumn(col.id)}
                    className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer mb-3"
                    title="Expand column"
                  >
                    <ChevronRight className="size-4" />
                  </button>

                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border mb-4 ${
                      col.badgeClass || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                    }`}
                  >
                    {col.tasks.length}
                  </span>

                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-xs font-bold text-zinc-300 tracking-wider [writing-mode:vertical-lr] rotate-180 truncate max-h-[300px]">
                      {col.title}
                    </span>
                  </div>

                  {isPinned && (
                    <Pin className="size-3 text-[#22A3AE] mt-2 shrink-0 fill-[#22A3AE]/30" />
                  )}
                </div>
              );
            }

            // Normal Expanded Column
            return (
              <DroppableColumn
                key={col.id}
                id={col.id}
                className={`w-[340px] shrink-0 flex flex-col bg-card/90 border rounded-2xl p-3.5 shadow-xl h-[calc(100vh-130px)] transition-all ${
                  isPinned
                    ? 'border-[#22A3AE]/40 ring-1 ring-[#22A3AE]/20 bg-card'
                    : 'border-border'
                }`}
              >
                {/* Column Header */}
                <div className="pb-2 border-b border-zinc-800/80 mb-2">
                  <div className="flex items-center justify-between gap-1">
                    {/* Left: Avatar/Dot + Title + Role Badge */}
                    <div className="flex items-center gap-2 min-w-0">
                      {col.memberUser ? (
                        col.memberUser.avatarUrl ? (
                          <img
                            src={col.memberUser.avatarUrl}
                            alt={col.title}
                            className="size-6 rounded-full object-cover shrink-0 ring-1 ring-[#22A3AE]/40"
                          />
                        ) : (
                          <div className="size-6 rounded-full bg-cyan-950/80 border border-[#22A3AE]/40 text-[#22A3AE] flex items-center justify-center text-[10px] font-bold shrink-0">
                            {(col.title || 'U').charAt(0).toUpperCase()}
                          </div>
                        )
                      ) : (
                        <span className={`size-2.5 rounded-full ${col.dotColor} shrink-0`} />
                      )}

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-xs font-bold text-zinc-100 truncate" title={col.title}>
                            {col.title}
                          </h3>
                          <span
                            className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border truncate ${
                              col.badgeClass || 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {col.badgeLabel || 'CRM'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Task Count Badge */}
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                        col.badgeClass || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      {visibleTasks.length !== col.tasks.length
                        ? `${visibleTasks.length}/${col.tasks.length}`
                        : col.tasks.length}
                    </span>
                  </div>

                  {/* Column Controls Row: Priority Filter on Left, [Collapse] [Pin] [Search] on Right */}
                  <div className="flex items-center justify-between gap-1 pt-2">
                    {/* Left: Priority Filter */}
                    <ColumnPriorityDropdown
                      columnId={col.id}
                      tasks={col.tasks}
                      activeFilter={activePriority}
                      onSelectFilter={(cId, filter) =>
                        setColumnPriorityFilters((prev) => ({ ...prev, [cId]: filter }))
                      }
                    />

                    {/* Right: Controls in requested order: Collapse, Pin, Search */}
                    <div className="flex items-center gap-1">
                      {/* 1. Collapse */}
                      <button
                        type="button"
                        onClick={() => toggleCollapseColumn(col.id)}
                        className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Collapse column"
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>

                      {/* 2. Pin */}
                      <button
                        type="button"
                        onClick={() => togglePinColumn(col.id)}
                        className={`p-1 rounded-lg transition-colors cursor-pointer ${
                          isPinned
                            ? 'text-[#22A3AE] bg-cyan-950/50 hover:bg-cyan-950'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                        title={isPinned ? 'Unpin column' : 'Pin column to left'}
                      >
                        {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                      </button>

                      {/* 3. Search */}
                      <button
                        type="button"
                        onClick={() =>
                          setColumnSearchOpen((prev) => ({ ...prev, [col.id]: !prev[col.id] }))
                        }
                        className={`p-1 rounded-lg transition-colors cursor-pointer ${
                          isSearchOpen || searchQuery
                            ? 'text-blue-400 bg-blue-950/50 hover:bg-blue-950'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                        title="Search tasks in this column"
                      >
                        <Search className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Expandable Search Bar */}
                  {(isSearchOpen || searchQuery) && (
                    <div className="mt-2 relative">
                      <Search className="size-3 text-zinc-500 absolute left-2.5 top-2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) =>
                          setColumnSearches((prev) => ({ ...prev, [col.id]: e.target.value }))
                        }
                        placeholder="Filter in column..."
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-7 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-[#22A3AE]"
                        autoFocus={isSearchOpen && !searchQuery}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setColumnSearches((prev) => ({ ...prev, [col.id]: '' }));
                            setColumnSearchOpen((prev) => ({ ...prev, [col.id]: false }));
                          }}
                          className="absolute right-2 top-1.5 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Cards List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-1">
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

                            {/* Right: Section where Sub-Status is (with Posted date in top right corner) */}
                            <div className="w-[125px] sm:w-[135px] shrink-0 flex flex-col justify-between py-0.5">
                              <div className="flex justify-end items-center">
                                <span className="text-[10px] font-medium text-zinc-500">
                                  Posted {format(new Date(task.createdAt), 'MMM d')}
                                </span>
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
                                  options={getCrmOptions(task)}
                                  onToggleStatus={(label, nextStatuses) => {
                                    const next =
                                      nextStatuses ||
                                      ((task.taskMap?.statuses || []).includes(label)
                                        ? (task.taskMap?.statuses || []).filter((s) => s !== label)
                                        : [...(task.taskMap?.statuses || []), label]);
                                    onStatusChange(task.id, next);
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
          <div className="p-3.5 bg-card border border-[#22A3AE]/80 rounded-xl shadow-2xl w-[320px] pointer-events-none opacity-90">
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

