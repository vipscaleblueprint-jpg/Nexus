import { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import {
  DndContext,
  DragOverlay,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, WorkspaceRole } from '@/lib/types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { Plus, ChevronDown, ChevronRight, X, GripVertical } from 'lucide-react';
import { getRoles } from '@/api/roles';
import { canUserMoveTask } from '@/lib/permissions';
import { useAppStore } from '@/lib/store';
import { toast } from '@/lib/toast';

interface Props {
  tasks: Task[];
  onTaskMove: (taskId: string, newStatus: string) => Promise<void>;
  onTaskReorder?: (activeId: string, overId: string) => void;
  onAddTaskClick?: (status: string) => void;
  onTaskClick?: (task: Task) => void;
  customGroups: string[];
  onAddGroup: (group: string) => void;
  onGroupReorder?: (newGroups: string[]) => void;
  listStatuses?: any[];
  onStatusChange?: (status: string, data: { name?: string, color?: string, allowedRoles?: string[], groupName?: string }) => void | Promise<void>;
}

const CATEGORIES = [
  {
    id: 'client_details',
    title: 'Client Details',
    badgeClass: 'bg-cyan-500/15 text-cyan-300',
    borderColor: 'rgba(6, 182, 212, 0.5)',
    icon: '👤',
    statuses: ['KYC', 'Pin Board'],
  },
  {
    id: 'recurring',
    title: 'Recurring',
    badgeClass: 'bg-purple-500/15 text-purple-300',
    borderColor: 'rgba(168, 85, 247, 0.5)',
    icon: '🔁',
    statuses: ['Daily', 'Weekly', 'Monthly'],
  },
  {
    id: 'workflow',
    title: 'Workflow & Progress',
    badgeClass: 'bg-indigo-500/15 text-indigo-300',
    borderColor: 'rgba(99, 102, 241, 0.5)',
    icon: '⚡',
    statuses: [
      'Pending',
      'In Progress',
      'Revision',
      'Waiting',
      'In Review',
      'Checking',
      'On-Hold',
      'Closed',
    ],
  },
];

const ALL_CONFIGURED_STATUSES = CATEGORIES.flatMap((c) => c.statuses);

const SortableGroupWrapper = memo(function SortableGroupWrapper({
  category,
  children,
}: {
  category: any;
  children: (sortable: any) => React.ReactNode;
}) {
  const isSortable = !category.isCatchAll;
  const sortable = useSortable({
    id: category.id,
    data: { type: 'Group', groupName: category.title },
    disabled: !isSortable,
  });

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`flex-shrink-0 snap-start self-stretch flex items-stretch ${sortable.isDragging ? 'z-50 relative' : ''}`}
    >
      {children(sortable)}
    </div>
  );
});

const MemoizedColumnWrapper = memo(function MemoizedColumnWrapper({
  status,
  category,
  tasks,
  isCollapsed,
  setCollapsedColumns,
  toggleColumnCollapse,
  listStatuses,
  currentUser,
  workspaceRoles,
  roleMap,
  columnThemes,
  setColumnThemes,
  onStatusChange,
  onAddTaskClick,
  onTaskClick,
  hasMarginRight,
  groupRunCount,
  isCollapsedGroupLeader,
  statusesInRun
}: any) {
  const dbStatus = listStatuses.find((s: any) => (s.name || '').trim().toUpperCase() === status.trim().toUpperCase());
  const permissionCheck = canUserMoveTask({ status } as any, listStatuses, currentUser, workspaceRoles);

  const handleToggle = useCallback(() => {
    if (isCollapsed && groupRunCount > 1 && isCollapsedGroupLeader) {
      setCollapsedColumns((prev: any) => {
        const next = { ...prev };
        statusesInRun.forEach((s: string) => { next[s] = false; });
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('nexus_board_collapsed_columns', JSON.stringify(next)); } catch {}
        }
        return next;
      });
    } else {
      toggleColumnCollapse(status, category.id);
    }
  }, [isCollapsed, groupRunCount, isCollapsedGroupLeader, setCollapsedColumns, statusesInRun, toggleColumnCollapse, status, category.id]);

  const handleUpdateColumn = useCallback((statusName: string, data: any) => {
    if (onStatusChange) {
      onStatusChange(statusName, {
        name: data.name,
        color: data.color || dbStatus?.color || columnThemes[statusName],
        allowedRoles: data.allowedRoles ?? dbStatus?.allowedRoles ?? [],
      });
    }
    if (data.color) {
      setColumnThemes((prev: any) => ({ ...prev, [statusName]: data.color! }));
    }
  }, [onStatusChange, dbStatus, columnThemes, setColumnThemes]);

  const handleThemeChange = useCallback((themeId: string) => {
    if (onStatusChange) {
      onStatusChange(status, { color: themeId, allowedRoles: dbStatus?.allowedRoles });
    }
    setColumnThemes((prev: any) => ({ ...prev, [status]: themeId }));
  }, [onStatusChange, status, dbStatus, setColumnThemes]);

  const handleRoleChange = useCallback((roles: string[]) => {
    if (onStatusChange) {
      onStatusChange(status, { color: dbStatus?.color || columnThemes[status], allowedRoles: roles });
    }
  }, [onStatusChange, status, dbStatus, columnThemes]);

  return (
    <div className={`h-full transition-all duration-300 ${hasMarginRight ? 'mr-4' : ''}`}>
      <KanbanColumn
        status={status}
        tasks={tasks}
        isCollapsed={isCollapsed}
        collapsedGroupCount={groupRunCount}
        isCollapsedGroupLeader={isCollapsedGroupLeader}
        onToggleCollapse={handleToggle}
        customTheme={dbStatus?.color || columnThemes[status]}
        roleMap={roleMap}
        allowedRoles={dbStatus?.allowedRoles}
        isColumnRestrictedForUser={!permissionCheck.allowed}
        columnRestrictionReason={permissionCheck.reason}
        listStatuses={listStatuses}
        onUpdateColumn={handleUpdateColumn}
        onThemeChange={handleThemeChange}
        onAddTaskClick={onAddTaskClick}
        onTaskClick={onTaskClick}
        onRoleChange={handleRoleChange}
      />
    </div>
  );
});

export function KanbanBoard({ tasks, onTaskMove, onTaskReorder, onAddTaskClick, onTaskClick, customGroups, onAddGroup, onGroupReorder, listStatuses = [], onStatusChange }: Props) {
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const currentUser = useAppStore((s) => s.currentUser);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeGroup, setActiveGroup] = useState<any | null>(null);
  const [localTasks, setLocalTasks] = useState(tasks);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nexus_board_collapsed_categories');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {};
  });
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nexus_board_collapsed_columns');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {};
  });
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  const [addingStatusToGroup, setAddingStatusToGroup] = useState<string | null>(null);
  const [newStatusName, setNewStatusName] = useState('');
  const [columnThemes, setColumnThemes] = useState<Record<string, string>>({});
  const [workspaceRoles, setWorkspaceRoles] = useState<WorkspaceRole[]>([]);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    getRoles()
      .then(setWorkspaceRoles)
      .catch((err) => console.error('Failed to load roles in board:', err));
  }, []);

  const roleMap = useMemo(() => {
    const map: Record<string, string> = {};
    workspaceRoles.forEach((r) => {
      map[r.id] = r.name;
      map[r.name] = r.name;
    });
    return map;
  }, [workspaceRoles]);

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const isCurrentlyCollapsed = prev[categoryId];
      const next = { ...prev, [categoryId]: !isCurrentlyCollapsed };
      
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('nexus_board_collapsed_categories', JSON.stringify(next));
        } catch {}
      }

      // If we are uncollapsing the category,ALSO uncollapse all columns inside it
      if (isCurrentlyCollapsed) {
        const cat = categorizedColumns.find(c => c.id === categoryId);
        if (cat) {
          setCollapsedColumns(prevCols => {
             const nextCols = { ...prevCols };
             cat.statuses.forEach((status: string) => {
               nextCols[status] = false;
             });
             if (typeof window !== 'undefined') {
               try {
                 localStorage.setItem('nexus_board_collapsed_columns', JSON.stringify(nextCols));
               } catch {}
             }
             return nextCols;
          });
        }
      }

      return next;
    });
  };

  const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
    if (boardContainerRef.current && e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      boardContainerRef.current.scrollLeft += e.deltaY * 2.5;
    }
  };

  const isDraggingBoardRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    isDraggingBoardRef.current = true;
    startXRef.current = e.pageX - (boardContainerRef.current?.offsetLeft || 0);
    scrollLeftRef.current = boardContainerRef.current?.scrollLeft || 0;
  };

  const handleHeaderMouseLeave = () => {
    isDraggingBoardRef.current = false;
  };

  const handleHeaderMouseUp = () => {
    isDraggingBoardRef.current = false;
  };

  const handleHeaderMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingBoardRef.current || !boardContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - (boardContainerRef.current.offsetLeft || 0);
    const walk = (x - startXRef.current) * 1.5;
    boardContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Require the user to move 8px before drag starts — prevents accidental drags on click
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    return localTasks.reduce((acc: Record<string, Task[]>, task) => {
      const status = task.status || 'Pending';
      if (!acc[status]) acc[status] = [];
      acc[status].push(task);
      return acc;
    }, {});
  }, [localTasks]);

  // Group columns into configured categories + dynamic custom groups
  const categorizedColumns = useMemo(() => {
    const configuredStatusNames = new Set(ALL_CONFIGURED_STATUSES);
    const sections: any[] = [];
    const presetTitles = CATEGORIES.map((cat) => cat.title);

    // 1. Predefined categories
    CATEGORIES.forEach((cat) => {
      const dynamicStatusesForCat = listStatuses
        .filter((s) => s.groupName === cat.title && !cat.statuses.includes(s.name))
        .map((s) => s.name);
        
      dynamicStatusesForCat.forEach(s => configuredStatusNames.add(s));
      
      sections.push({
        id: `preset_${cat.id}`,
        title: cat.title,
        badgeClass: cat.badgeClass,
        borderColor: cat.borderColor,
        icon: cat.icon,
        statuses: [...cat.statuses, ...dynamicStatusesForCat],
        isPreset: true,
      });
    });

    // 2. Custom groups
    const purelyCustomGroups = customGroups.filter(g => !presetTitles.includes(g));

    purelyCustomGroups.forEach((groupName) => {
      const groupStatuses = listStatuses
        .filter((s) => s.groupName === groupName)
        .map((s) => s.name);
      
      sections.push({
        id: `group_${groupName.replace(/\s+/g, '_').toLowerCase()}`,
        title: groupName,
        badgeClass: 'bg-zinc-500/15 text-zinc-300',
        borderColor: 'rgba(113, 113, 122, 0.5)',
        icon: '📌',
        statuses: groupStatuses,
        isPreset: false,
      });

      groupStatuses.forEach((s) => configuredStatusNames.add(s));
    });

    // Build a master order for groups
    const masterOrder: string[] = [];
    presetTitles.forEach(pt => {
      if (!customGroups.includes(pt)) masterOrder.push(pt);
    });
    customGroups.forEach(g => {
      if (!masterOrder.includes(g)) masterOrder.push(g);
    });
    
    // Catch groups that are in listStatuses but not in customGroups
    const dynamicGroupNames = new Set(listStatuses.map(s => s.groupName).filter(Boolean));
    dynamicGroupNames.forEach(dg => {
      if (dg && !masterOrder.includes(dg)) {
        masterOrder.push(dg);
        
        // Ensure it's added to sections too if it wasn't
        if (!presetTitles.includes(dg) && !purelyCustomGroups.includes(dg)) {
          const groupStatuses = listStatuses.filter((s) => s.groupName === dg).map((s) => s.name);
          sections.push({
            id: `group_${dg.replace(/\s+/g, '_').toLowerCase()}`,
            title: dg,
            badgeClass: 'bg-zinc-500/15 text-zinc-300',
            borderColor: 'rgba(113, 113, 122, 0.5)',
            icon: '📌',
            statuses: groupStatuses,
            isPreset: false,
          });
          groupStatuses.forEach((s) => configuredStatusNames.add(s));
        }
      }
    });

    // 3. Sort sections based on master order
    const sortedSections = [...sections].sort((a, b) => {
      return masterOrder.indexOf(a.title) - masterOrder.indexOf(b.title);
    });

    // 4. Catch-all for any task status or db status that doesn't belong to any group
    const activeCustom = Array.from(
      new Set([
        ...Object.keys(tasksByStatus).filter((s) => !configuredStatusNames.has(s)),
        ...listStatuses.filter(s => !s.groupName && !configuredStatusNames.has(s.name)).map(s => s.name),
      ])
    );

    if (activeCustom.length > 0) {
      sortedSections.push({
        id: 'custom_catchall',
        title: 'Other Statuses',
        badgeClass: 'bg-zinc-500/15 text-zinc-300',
        borderColor: 'rgba(113, 113, 122, 0.5)',
        icon: '📌',
        statuses: activeCustom,
        isCatchAll: true,
      });
    }

    return sortedSections;
  }, [tasksByStatus, customGroups, listStatuses]);

  const toggleColumnCollapse = (status: string, categoryId: string) => {
    setCollapsedColumns((prev) => {
      const next = { ...prev, [status]: !prev[status] };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('nexus_board_collapsed_columns', JSON.stringify(next));
        } catch {}
      }

      // Check if newly collapsed column causes category to auto-collapse
      if (next[status]) {
        const cat = categorizedColumns.find(c => c.id === categoryId);
        if (cat) {
          const allCollapsed = cat.statuses.every((s: string) => next[s]);
          if (allCollapsed) {
            setCollapsedCategories((pc) => {
              const pcNext = { ...pc, [categoryId]: true };
              if (typeof window !== 'undefined') {
                try {
                  localStorage.setItem('nexus_board_collapsed_categories', JSON.stringify(pcNext));
                } catch {}
              }
              return pcNext;
            });
          }
        }
      }

      return next;
    });
  };

  const handleAddGroup = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newGroup.trim()) {
      onAddGroup(newGroup.trim());
      setNewGroup('');
      setIsAddingGroup(false);
    }
  }, [newGroup, onAddGroup]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    
    if (active.data.current?.type === 'Group') {
      const groupName = active.data.current.groupName;
      const category = categorizedColumns.find(c => c.title === groupName);
      if (category) {
        setActiveGroup(category);
      }
      return;
    }

    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      const check = canUserMoveTask(task, listStatuses, currentUser, workspaceRoles);
      if (!check.allowed) {
        toast.error(check.reason || 'You do not have permission to move tasks from this status');
        return;
      }
      setActiveTask(task);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    
    if (active.data.current?.type === 'Group') return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    const activeTaskIndex = localTasks.findIndex(t => t.id === activeId);
    if (activeTaskIndex === -1) return;
    const activeTask = localTasks[activeTaskIndex];

    let overStatus = over.data?.current?.status;
    if (!overStatus) {
      const overTask = localTasks.find((t) => t.id === overId);
      if (overTask) overStatus = overTask.status;
    }

    if (overStatus && activeTask.status !== overStatus) {
      setLocalTasks((prev) => {
        const newTasks = [...prev];
        const idx = newTasks.findIndex(t => t.id === activeId);
        if (idx > -1) {
          newTasks[idx] = { ...newTasks[idx], status: overStatus };
        }
        return newTasks;
      });
    }
  };

  const customCollisionDetection = useCallback((args: any) => {
    const isGroupDrag = args.active?.data?.current?.type === 'Group';
    const collisions = rectIntersection(args);
    
    if (isGroupDrag) {
      return collisions.filter((c: any) => c.data?.current?.type === 'Group');
    }
    
    return collisions.filter((c: any) => c.data?.current?.type !== 'Group');
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (active.data.current?.type === 'Group') {
      setActiveGroup(null);
      if (over && active.id !== over.id && onGroupReorder) {
        const draggableColumns = categorizedColumns.filter(c => !c.isCatchAll);
        const oldIndex = draggableColumns.findIndex(c => c.id === active.id);
        const newIndex = draggableColumns.findIndex(c => c.id === over.id);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(draggableColumns, oldIndex, newIndex);
          onGroupReorder(newOrder.map(c => c.title));
        }
      }
      return;
    }

    const originalTask = activeTask;

    // Clear drag state
    setActiveTask(null);

    if (!originalTask) return;

    const activeId = active.id as string;

    // Check permissions on the original task
    const check = canUserMoveTask(originalTask, listStatuses, currentUser, workspaceRoles);
    if (!check.allowed) {
      toast.error(check.reason || 'You do not have permission to move tasks from this status');
      return;
    }

    let finalStatus: string | undefined;

    if (over) {
      const overId = over.id as string;
      finalStatus = over.data?.current?.status;
      if (!finalStatus) {
        const overTask = tasks.find((t) => t.id === overId);
        if (overTask) finalStatus = overTask.status;
      }
    }

    if (!finalStatus) return;

    if (finalStatus !== originalTask.status) {
      // Card moved to a different column — commit to API
      onTaskMove(activeId, finalStatus);
    } else if (over && active.id !== over.id && onTaskReorder) {
      // Reordered within the same column
      onTaskReorder(activeId, over.id as string);
    }
  };

  const handleDragCancel = () => {
    setActiveTask(null);
    setActiveGroup(null);
    setLocalTasks(tasks);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      autoScroll={{
        layoutShiftCompensation: false,
        acceleration: 1.5, // Slow down auto-scroll (default is often 10+)
      }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {!isMounted ? (
        <div className="flex h-full w-full items-center justify-center pt-20 text-zinc-500">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500"></div>
        </div>
      ) : (
      <div 
        ref={boardContainerRef}
        onWheel={handleWheelScroll}
        className={`flex gap-6 items-start h-full overflow-x-auto overflow-y-hidden pt-8 pb-4 px-2 custom-scrollbar transition-all duration-300 ${!activeTask ? 'snap-x snap-mandatory' : ''}`}
      >
        <SortableContext 
          items={categorizedColumns.filter(c => !c.isCatchAll).map(c => c.id)} 
          strategy={horizontalListSortingStrategy}
        >
          {categorizedColumns.map((category) => {
            const isCollapsed = Boolean(collapsedCategories[category.id]);
            const totalCategoryTasks = category.statuses.reduce(
              (sum: number, s: string) => sum + (tasksByStatus[s]?.length || 0),
              0
            );

            return (
              <SortableGroupWrapper key={category.id} category={category}>
                {(sortable: any) => (
                  <>
                    {/* ── COLLAPSED: slim vertical pill ── */}
                    <button
                      onClick={() => toggleCategory(category.id)}
                      title={`Expand ${category.title}`}
                      className={`relative flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-500 ease-in-out overflow-hidden select-none whitespace-nowrap rounded-xl border ${category.badgeClass} ${
                        isCollapsed 
                          ? 'max-w-[48px] w-12 opacity-80 hover:opacity-100 hover:brightness-110' 
                          : 'max-w-0 w-0 opacity-0 border-transparent p-0 mx-0'
                      }`}
                    >
                      <div className="flex flex-col items-center justify-center w-12 min-h-[200px] h-full shrink-0">
                        <ChevronRight className="w-4 h-4 shrink-0 mb-2" />
                        <span
                          className="text-[11px] font-bold uppercase tracking-widest"
                          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                        >
                          {totalCategoryTasks} task{totalCategoryTasks !== 1 ? 's' : ''} · {category.statuses.length} cols
                        </span>
                        <span className="text-lg mt-2">{category.icon}</span>
                      </div>
                    </button>

                    {/* ── EXPANDED: bordered group box ── */}
                    <div 
                      className={`relative flex flex-col h-full min-h-[200px] transition-all duration-500 ease-in-out ${
                        isCollapsed 
                          ? 'max-w-0 opacity-0 mx-0' 
                          : 'max-w-[5000px] opacity-100'
                      }`}
                    >
                      {/* Inner container with overflow-hidden to clip contents during animation */}
                      <div 
                        className="rounded-2xl border bg-[#18181c] h-full p-4 pt-3 overflow-hidden flex flex-col shadow-sm shadow-black/20"
                        style={{ borderColor: category.borderColor }}
                      >
                        {/* Group Header */}
                        <div 
                          className={`flex items-center justify-between mb-3 w-full ${!category.id.startsWith('group_') ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          onMouseDown={!category.id.startsWith('group_') ? handleHeaderMouseDown : undefined}
                          onMouseLeave={!category.id.startsWith('group_') ? handleHeaderMouseLeave : undefined}
                          onMouseUp={!category.id.startsWith('group_') ? handleHeaderMouseUp : undefined}
                          onMouseMove={!category.id.startsWith('group_') ? handleHeaderMouseMove : undefined}
                        >
                          <div className="flex items-center gap-1.5">
                            {category.id.startsWith('group_') && (
                              <div 
                                className="p-1 cursor-grab active:cursor-grabbing hover:bg-white/10 rounded mr-1"
                                {...sortable.listeners}
                                {...sortable.attributes}
                                onMouseDown={(e) => {
                                  // Ensure we don't trigger the group-level drag-to-scroll when sorting
                                  if (sortable.listeners?.onMouseDown) {
                                    sortable.listeners.onMouseDown(e);
                                  }
                                }}
                              >
                                <GripVertical className="w-4 h-4 text-zinc-500" />
                              </div>
                            )}
                            <div 
                               className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all duration-200 hover:bg-white/5"
                               onClick={() => toggleCategory(category.id)}
                               title="Collapse section"
                               onMouseDown={(e) => e.stopPropagation()}
                            >
                              <span className="whitespace-nowrap text-zinc-300">{category.title}</span>
                              <span className="opacity-60 shrink-0 text-zinc-400">({totalCategoryTasks})</span>
                              <ChevronDown className="w-3 h-3 ml-1 opacity-70 shrink-0 text-zinc-400" />
                            </div>
                          </div>
                          
                          <button
                            onClick={() => {
                              setAddingStatusToGroup(category.title);
                              setNewStatusName('');
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                          >
                            Add status
                          </button>
                        </div>

                  {/* Columns inside the group */}
                  <div className="flex items-start h-full shrink-0 min-w-max">
                    {category.statuses.map((status: string, index: number) => {
                      const isCollapsed = collapsedColumns[status];
                      
                      let groupRunIndex = 0;
                      let groupRunCount = 1;
                      let statusesInRun: string[] = [status];

                      if (isCollapsed) {
                         let start = index;
                         while (start > 0 && collapsedColumns[category.statuses[start - 1]]) {
                            start--;
                         }
                         groupRunIndex = index - start;
                         
                         let end = index;
                         while (end < category.statuses.length - 1 && collapsedColumns[category.statuses[end + 1]]) {
                            end++;
                         }
                         groupRunCount = end - start + 1;
                         statusesInRun = category.statuses.slice(start, end + 1);
                      }
                      
                      const isCollapsedGroupLeader = isCollapsed && groupRunIndex === 0;
                      const isCollapsedFollower = isCollapsed && groupRunIndex > 0;
                      
                      const isLast = index === category.statuses.length - 1;
                      const hasMarginRight = !isLast && !isCollapsedFollower;

                      return (
                        <MemoizedColumnWrapper
                          key={status}
                          status={status}
                          category={category}
                          tasks={tasksByStatus[status] || []}
                          isCollapsed={isCollapsed}
                          setCollapsedColumns={setCollapsedColumns}
                          toggleColumnCollapse={toggleColumnCollapse}
                          listStatuses={listStatuses}
                          currentUser={currentUser}
                          workspaceRoles={workspaceRoles}
                          roleMap={roleMap}
                          columnThemes={columnThemes}
                          setColumnThemes={setColumnThemes}
                          onStatusChange={onStatusChange}
                          onAddTaskClick={onAddTaskClick}
                          onTaskClick={onTaskClick}
                          hasMarginRight={hasMarginRight}
                          groupRunCount={groupRunCount}
                          isCollapsedGroupLeader={isCollapsedGroupLeader}
                        />
                      );
                    })}
                    {addingStatusToGroup === category.title && (
                      <div className="w-[300px] shrink-0 h-max flex flex-col mt-[2px] ml-2 animate-in fade-in zoom-in-95 duration-200">
                        <div className="group relative flex items-center justify-between gap-3 bg-zinc-800/80 border border-zinc-700/50 rounded-xl p-3 shadow-sm text-left overflow-hidden">
                          <div className="w-2.5 h-2.5 rounded bg-zinc-500 shrink-0" />
                          <input
                            type="text"
                            autoFocus
                            placeholder="Status name"
                            value={newStatusName}
                            onChange={(e) => setNewStatusName(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                if (newStatusName.trim() && onStatusChange) {
                                  try {
                                    await onStatusChange(newStatusName.trim(), { groupName: addingStatusToGroup || undefined });
                                  } catch (error) {
                                    console.error(error);
                                  }
                                }
                                setAddingStatusToGroup(null);
                                setNewStatusName('');
                              } else if (e.key === 'Escape') {
                                setAddingStatusToGroup(null);
                                setNewStatusName('');
                              }
                            }}
                            className="bg-transparent border-none text-[13px] font-semibold text-zinc-200 placeholder-zinc-500 focus:outline-none w-full"
                          />
                          <button
                            onClick={() => {
                              setAddingStatusToGroup(null);
                              setNewStatusName('');
                            }}
                            className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              </>
            )}
            </SortableGroupWrapper>
          );
        })}
        </SortableContext>
        
        {/* Add Group Column / Input */}
        <div className="flex-shrink-0 w-[350px] snap-start">
          <div className="flex flex-col pt-3">
            {!isAddingGroup ? (
              <button 
                onClick={() => setIsAddingGroup(true)}
                className="flex items-center gap-1 text-base font-semibold text-zinc-500 hover:text-zinc-700 transition-colors mb-2 cursor-pointer"
              >
                <Plus className="w-5 h-5" /> Add group
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => setIsAddingGroup(false)}
                  className="flex items-center gap-1 text-base font-semibold text-zinc-500 hover:text-zinc-300 transition-colors mb-1 cursor-pointer"
                >
                  <Plus className="w-5 h-5" /> Add group
                </button>
                <div className="flex items-center gap-2 p-1.5 border border-zinc-700 bg-[#18181c] rounded-lg shadow-sm">
                  <div className="w-4 h-4 rounded bg-amber-500 ml-1 shrink-0" />
                  <input 
                    type="text" 
                    placeholder="Group name" 
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                    onKeyDown={handleAddGroup}
                    autoFocus
                    className="bg-transparent border-none text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none w-full"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      <DragOverlay>
        {activeTask ? <KanbanCard task={activeTask} isOverlay /> : null}
        {activeGroup ? (
          <div className="flex-shrink-0 snap-start self-stretch flex items-stretch h-[500px]">
             <div className="rounded-2xl border bg-[#18181c] h-full p-4 pt-3 flex flex-col shadow-2xl scale-105 opacity-90 cursor-grabbing" style={{ borderColor: activeGroup.borderColor }}>
               <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg mb-3">
                 <GripVertical className="w-4 h-4 text-zinc-500 mr-1" />
                 <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">{activeGroup.title}</span>
               </div>
               <div className="flex-1 flex gap-4">
                 {activeGroup.statuses.slice(0, 3).map((status: string) => (
                   <div key={status} className="w-[280px] h-full rounded-xl bg-white/5 border border-white/5 flex flex-col p-3">
                     <div className="text-xs font-semibold text-zinc-500 mb-2">{status}</div>
                     <div className="w-full h-20 bg-white/5 rounded-lg mb-2" />
                     <div className="w-full h-24 bg-white/5 rounded-lg" />
                   </div>
                 ))}
               </div>
             </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
