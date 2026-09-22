import { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

import {
  DndContext,
  DragOverlay,
  closestCorners,
  rectIntersection,
  pointerWithin,
  closestCenter,
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
import { Plus, ChevronDown, ChevronRight, X, GripVertical, Trash2, MoreHorizontal, Pencil } from 'lucide-react';
import { getRoles } from '@/api/roles';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';
import { canUserMoveTask, canUserEditTask } from '@/lib/permissions';
import { useAppStore } from '@/lib/store';
import { toast } from '@/lib/toast';
const EMPTY_ARRAY: any[] = [];

interface Props {
  tasks: Task[];
  onTaskMove: (taskId: string, newStatus: string) => void;
  onTaskMovePreview?: (taskId: string, newStatus: string) => void;
  onTaskReorder?: (activeId: string, overId: string) => void;
  onAddTaskClick?: (status: string) => void;
  onTaskClick?: (task: Task) => void;
  customGroups: string[];
  onAddGroup: (group: string) => void;
  onGroupReorder?: (newGroups: string[]) => void;
  listStatuses?: any[];
  onStatusChange?: (status: string, data: { name?: string, color?: string, allowedRoles?: string[], groupName?: string }) => void | Promise<void>;
  onStatusDelete?: (statusName: string) => void | Promise<void>;
  onDeleteGroup?: (groupName: string) => void;
  onRenameGroup?: (oldName: string, newName: string) => void | Promise<void>;
  onStatusReorder?: (activeStatus: string, overStatus: string, isOverGroup?: boolean, newGroupName?: string) => void;
}

const GROUP_STYLES: Record<string, { badgeClass: string; borderColor: string; icon: string }> = {
  'Client Details': {
    badgeClass: 'bg-cyan-500/15 text-cyan-300',
    borderColor: 'rgba(6, 182, 212, 0.5)',
    icon: '👤',
  },
  'Recurring': {
    badgeClass: 'bg-purple-500/15 text-purple-300',
    borderColor: 'rgba(168, 85, 247, 0.5)',
    icon: '🔁',
  },
  'Workflow & Progress': {
    badgeClass: 'bg-indigo-500/15 text-indigo-300',
    borderColor: 'rgba(99, 102, 241, 0.5)',
    icon: '⚡',
  }
};

const SortableGroupWrapper = memo(function SortableGroupWrapper({
  category,
  activeGroup,
  children,
}: {
  category: any;
  activeGroup: any;
  children: (sortable: any) => React.ReactNode;
}) {
  const isSortable = !category.isCatchAll;
  const sortableData = useMemo(() => ({ type: 'Group', groupName: category.title }), [category.title]);
  const sortable = useSortable({
    id: category.id,
    data: sortableData,
    disabled: !isSortable,
  });

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging || activeGroup?.id === category.id ? 0.3 : 1,
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
  onStatusDelete,
  onAddTaskClick,
  onTaskClick,
  hasMarginRight,
  groupRunCount,
  isCollapsedGroupLeader,
  statusesInRun,
  activeColumn
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

  const sortableData = useMemo(() => ({ type: 'Column', status }), [status]);
  const sortable = useSortable({
    id: status,
    data: sortableData,
    disabled: isCollapsed,
  });

  const isGhost = sortable.isDragging || activeColumn === status;

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition ? `${sortable.transition}, opacity 300ms, width 300ms` : 'opacity 300ms, width 300ms',
    opacity: isGhost ? 0.3 : 1,
  };

  return (
    <div 
      ref={sortable.setNodeRef}
      style={style}
      className={`h-full ${hasMarginRight ? 'mr-4' : ''} ${isGhost ? 'z-50 relative' : ''}`}
    >
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
        onDeleteColumn={onStatusDelete}
        dragListeners={sortable.listeners}
        dragAttributes={sortable.attributes}
        isOver={sortable.isOver}
      />
    </div>
  );
});

export function KanbanBoard({ tasks,  onTaskMove,
  onTaskMovePreview,
  onTaskReorder,
  onAddTaskClick, onTaskClick, customGroups, onAddGroup, onGroupReorder, listStatuses = [], onStatusChange, onStatusDelete, onDeleteGroup, onRenameGroup, onStatusReorder }: Props) {

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const currentUser = useAppStore((s) => s.currentUser);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeGroup, setActiveGroup] = useState<any | null>(null);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState(tasks);
  
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null);
  const [openGroupMenuRect, setOpenGroupMenuRect] = useState<DOMRect | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  
  // Keep track of the latest tasks prop to merge missed websocket updates after drag
  const latestTasksRef = useRef(tasks);
  latestTasksRef.current = tasks;
  
  const [localStatuses, setLocalStatuses] = useState(listStatuses);

  // Maintain stable IDs for groups so they don't unmount when renamed
  const groupIdMapRef = useRef<Record<string, string>>({});

  // Track dragging state in a ref so it doesn't trigger effect runs
  const isDraggingRef = useRef(false);

  // Close dropdown on outside click or scroll
  useEffect(() => {
    if (!openGroupMenu) return;
    
    const handleClose = () => setOpenGroupMenu(null);
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [openGroupMenu]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalTasks(tasks);
      setLocalStatuses(listStatuses);
    }
  }, [tasks, listStatuses]);
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
    if (!currentUser) return;
    getRoles()
      .then(setWorkspaceRoles)
      .catch((err) => console.warn('Failed to load roles in board:', err));
  }, [currentUser]);

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

  const pointerSensorOptions = useMemo(() => ({
    activationConstraint: {
      distance: 8,
    },
  }), []);

  const keyboardSensorOptions = useMemo(() => ({
    coordinateGetter: sortableKeyboardCoordinates,
  }), []);

  const sensors = useSensors(
    useSensor(PointerSensor, pointerSensorOptions),
    useSensor(KeyboardSensor, keyboardSensorOptions)
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
    const sections: any[] = [];
    const processedStatuses = new Set<string>();

    // 1. Process customGroups in exact order from DB
    customGroups.forEach((groupName) => {
      const groupStatuses = localStatuses
        .filter((s: any) => s.groupName === groupName)
        .map((s: any) => s.name);
      
      const styles = GROUP_STYLES[groupName] || {
        badgeClass: 'bg-zinc-500/15 text-zinc-300',
        borderColor: 'rgba(113, 113, 122, 0.5)',
        icon: '📌',
      };

      if (!groupIdMapRef.current[groupName]) {
        groupIdMapRef.current[groupName] = `group_${groupName.toLowerCase().replace(/\s+/g, '_')}_${Math.random().toString(36).substr(2, 6)}`;
      }

      sections.push({
        id: groupIdMapRef.current[groupName],
        title: groupName,
        ...styles,
        statuses: groupStatuses,
        isPreset: false, // Everything is fully custom and deletable now
      });

      groupStatuses.forEach((s) => processedStatuses.add(s));
    });

    // 2. Catch-all for any task status or db status that doesn't belong to any group at all
    const activeCustom = Array.from(
      new Set([
        ...Object.keys(tasksByStatus).filter((s) => !processedStatuses.has(s)),
        ...localStatuses.filter((s: any) => !processedStatuses.has(s.name)).map((s: any) => s.name),
      ])
    );

    if (activeCustom.length > 0) {
      sections.push({
        id: 'custom_catchall',
        title: 'Other Statuses',
        badgeClass: 'bg-zinc-500/15 text-zinc-300',
        borderColor: 'rgba(113, 113, 122, 0.5)',
        icon: '📌',
        statuses: activeCustom,
        isCatchAll: true,
      });
    }

    return sections;
  }, [tasksByStatus, customGroups, localStatuses]);

  const sortableColumnIds = useMemo(() => {
    return categorizedColumns.filter(c => !c.isCatchAll).map(c => c.id);
  }, [categorizedColumns]);

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
    isDraggingRef.current = true;
    const { active } = event;
    
    if (active.data?.current?.type === 'Group') {
      const groupName = active.data?.current?.groupName;
      const category = categorizedColumns.find(c => c.title === groupName);
      if (category) {
        setActiveGroup(category);
      }
      return;
    }

    if (active.data?.current?.type === 'Column') {
      setActiveColumn(active.id as string);
      return;
    }

    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      // Check task-level edit restriction (teamAssignAccessRole)
      const editCheck = canUserEditTask(task, currentUser);
      if (!editCheck.allowed) {
        toast.error(editCheck.reason || 'You do not have permission to move this task');
        return;
      }
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
    
    if (active.data?.current?.type === 'Group') {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    if (active.data?.current?.type === 'Column') {
      let newGroupName = '';
      const isOverGroup = over.data?.current?.type === 'Group';
      
      if (isOverGroup) {
        newGroupName = over.data?.current?.groupName;
      } else {
        const overCat = categorizedColumns.find(c => c.statuses.includes(overId));
        newGroupName = overCat ? overCat.title : '';
      }

      setLocalStatuses((prev: any) => {
        const oldIndex = prev.findIndex((s: any) => s.name === activeId);
        let newIndex = prev.findIndex((s: any) => s.name === overId);

        if (oldIndex !== -1) {
          const oldGroupName = prev[oldIndex].groupName || '';
          
          // IMPORTANT: If dragging WITHIN the same group, DO NOT mutate the array during onDragOver!
          // dnd-kit's SortableContext relies on CSS transforms to simulate the swap visually.
          // Mutating the array breaks the transforms and causes ghosts to get stuck.
          if (oldGroupName === newGroupName && !isOverGroup) {
            return prev;
          }

          const newStatuses = [...prev];
          let [removed] = newStatuses.splice(oldIndex, 1);
          
          if (newGroupName && removed.groupName !== newGroupName) {
            removed = { ...removed, groupName: newGroupName };
          }
          
          if (isOverGroup) {
            const groupStatuses = newStatuses.filter(s => s.groupName === newGroupName);
            if (groupStatuses.length > 0) {
              const lastItem = groupStatuses[groupStatuses.length - 1];
              newIndex = newStatuses.findIndex(s => s.name === lastItem.name) + 1;
            } else {
              newIndex = newStatuses.length;
            }
          }

          if (newIndex !== -1) {
            newStatuses.splice(newIndex, 0, removed);
            return newStatuses;
          }
        }
        return prev;
      });
      return;
    }

    const activeTaskIndex = localTasks.findIndex(t => t.id === activeId);
    if (activeTaskIndex === -1) return;
    const activeTask = localTasks[activeTaskIndex];

    let overStatus = over.data?.current?.type === 'ColumnDrop' ? over.data?.current?.status : over.data?.current?.status;
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

      // Relay the move to other clients immediately (while still dragging)
      if (onTaskMovePreview) {
        onTaskMovePreview(activeId, overStatus);
      }
    }
  };

  const customCollisionDetection = useCallback((args: any) => {
    const isGroupDrag = args.active?.data?.current?.type === 'Group';
    const isColumnDrag = args.active?.data?.current?.type === 'Column';
    
    if (isGroupDrag) {
      let collisions = pointerWithin(args);
      if (collisions.length === 0) {
        collisions = closestCenter(args);
      }
      const groupIds = categorizedColumns.map(c => c.id);
      const valid = collisions.filter((c: any) => groupIds.includes(c.id));
      return valid;
    }
    
    // Allow columns to be dropped onto columns or groups (empty space)
    if (isColumnDrag) {
      // Use rectIntersection instead of pointerWithin so it requires significant overlap (not just the cursor position)
      // This prevents the column from "jumping" into the next group when only 10% of it crosses the boundary.
      const collisions = rectIntersection(args);
      let valid: any[] = [];
      
      const columnIds = localStatuses.map((s: any) => s.name);
      const groupIds = categorizedColumns.map(c => c.id);
      
      if (collisions.length > 0) valid = collisions.filter((c: any) => (columnIds.includes(c.id) || groupIds.includes(c.id)));
      
      if (valid.length === 0) {
        const closest = closestCenter(args);
        valid = closest.filter((c: any) => (columnIds.includes(c.id) || groupIds.includes(c.id)));
      }
      
      return valid;
    }
    
    // For tasks, use pointerWithin to prevent layout shift infinite loops.
    // If the pointer is not strictly within any container, fallback to closestCenter.
    let collisions = pointerWithin(args);
    if (collisions.length === 0) {
      collisions = closestCenter(args);
    }
    
    return collisions.filter((c: any) => c.data?.current?.type !== 'Group' && c.data?.current?.type !== 'Column' && c.id !== args.active?.id);
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (active.data?.current?.type === 'Group') {
      isDraggingRef.current = false;
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

    if (active.data?.current?.type === 'Column') {
      isDraggingRef.current = false;
      setActiveColumn(null);
      
      const activeStatusName = active.id as string;
      const overId = over?.id as string;

      if (!over || activeStatusName === overId) return;

      let newGroupName = '';
      const isOverGroup = over.data?.current?.type === 'Group';
      if (isOverGroup) {
        newGroupName = over.data?.current?.groupName;
      } else if (over.data?.current?.type === 'Column') {
        const overCat = categorizedColumns.find(c => c.statuses.includes(overId));
        if (overCat) newGroupName = overCat.title;
      }

      if (newGroupName) {
        // Compare against original listStatuses, because local categorizedColumns might already reflect the DragOver state
        const originalStatus = listStatuses.find((s: any) => s.name === activeStatusName);
        if (originalStatus && originalStatus.groupName !== newGroupName) {
          if (onStatusChange) {
            onStatusChange(activeStatusName, { groupName: newGroupName });
          }
        }
      }

      if (onStatusReorder) {
        onStatusReorder(activeStatusName, overId, isOverGroup, newGroupName);
      }
      return;
    }

    const originalTask = activeTask;

    // Clear drag state
    isDraggingRef.current = false;
    setActiveTask(null);

    if (!originalTask) {
      return;
    }

    const activeId = active.id as string;

    // Check task-level edit restriction (teamAssignAccessRole) in drag END too
    const editCheck = canUserEditTask(originalTask, currentUser);
    if (!editCheck.allowed) {
      toast.error(editCheck.reason || 'You do not have permission to edit this task.');
      setLocalTasks(tasks);
      return;
    }

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
      // Optimistic update locally on top of the latest tasks (in case we missed websocket updates while dragging)
      setLocalTasks(() => {
        const newTasks = [...latestTasksRef.current];
        const idx = newTasks.findIndex(t => t.id === activeId);
        if (idx > -1) {
          newTasks[idx] = { ...newTasks[idx], status: finalStatus };
        }
        return newTasks;
      });

      // Card moved to a different column — commit to API
      onTaskMove(activeId, finalStatus);
    } else if (over && active.id !== over.id && onTaskReorder) {
      // Reordered within the same column
      onTaskReorder(activeId, over.id as string);
    }
  };


  const handleDragCancel = () => {
    isDraggingRef.current = false;
    setActiveTask(null);
    setActiveGroup(null);
    setActiveColumn(null);
    setLocalTasks(latestTasksRef.current);
    setLocalStatuses(listStatuses);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      autoScroll={useMemo(() => ({
        layoutShiftCompensation: false,
        acceleration: 1.5, // Slow down auto-scroll (default is often 10+)
      }), [])}
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
        className={`flex gap-6 items-start h-full overflow-x-auto overflow-y-hidden pt-8 px-2 custom-scrollbar transition-all duration-300`}
      >
        <SortableContext 
          items={sortableColumnIds} 
          strategy={horizontalListSortingStrategy}
        >
          {categorizedColumns.map((category) => {
            const isCollapsed = Boolean(collapsedCategories[category.id]);
            const totalCategoryTasks = category.statuses.reduce(
              (sum: number, s: string) => sum + (tasksByStatus[s]?.length || 0),
              0
            );

            return (
              <SortableGroupWrapper key={category.id} category={category} activeGroup={activeGroup}>
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
                          className="flex items-center justify-between mb-3 w-full cursor-grab active:cursor-grabbing"
                          onMouseDown={!category.id.startsWith('group_') ? handleHeaderMouseDown : undefined}
                          onMouseLeave={!category.id.startsWith('group_') ? handleHeaderMouseLeave : undefined}
                          onMouseUp={!category.id.startsWith('group_') ? handleHeaderMouseUp : undefined}
                          onMouseMove={!category.id.startsWith('group_') ? handleHeaderMouseMove : undefined}
                          {...(category.id.startsWith('group_') ? sortable.listeners : {})}
                          {...(category.id.startsWith('group_') ? sortable.attributes : {})}
                        >
                          <div className="flex items-center gap-1.5">
                            {editingGroup === category.title ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={editingGroupName}
                                  onChange={(e) => setEditingGroupName(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onKeyDown={async (e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                      const newName = editingGroupName.trim();
                                      const oldName = category.title;
                                      setEditingGroup(null);
                                      if (newName && newName !== oldName && onRenameGroup) {
                                        // Transfer the stable ID to prevent unmounting/flashing
                                        if (groupIdMapRef.current[oldName]) {
                                          groupIdMapRef.current[newName] = groupIdMapRef.current[oldName];
                                        }
                                        await onRenameGroup(oldName, newName);
                                      }
                                    } else if (e.key === 'Escape') {
                                      setEditingGroup(null);
                                    }
                                  }}
                                  onBlur={async () => {
                                    if (editingGroup === category.title) {
                                      const newName = editingGroupName.trim();
                                      const oldName = category.title;
                                      setEditingGroup(null);
                                      if (newName && newName !== oldName && onRenameGroup) {
                                        // Transfer the stable ID to prevent unmounting/flashing
                                        if (groupIdMapRef.current[oldName]) {
                                          groupIdMapRef.current[newName] = groupIdMapRef.current[oldName];
                                        }
                                        await onRenameGroup(oldName, newName);
                                      }
                                    }
                                  }}
                                  className="bg-zinc-800 text-[10px] font-bold uppercase tracking-wider text-white px-2 py-1 rounded outline-none w-40 border border-zinc-700 focus:border-indigo-500"
                                />
                            ) : (
                              <div 
                                 className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all duration-200 hover:bg-white/5"
                                 onClick={(e) => { e.stopPropagation(); toggleCategory(category.id); }}
                                 title="Collapse section"
                                 onMouseDown={(e) => e.stopPropagation()}
                              >
                                <span className="whitespace-nowrap text-zinc-300">{category.title}</span>
                                <span className="opacity-60 shrink-0 text-zinc-400">({totalCategoryTasks})</span>
                                <div className="p-0.5 ml-1 rounded transition-all opacity-0 group-hover:opacity-100 hover:bg-zinc-700/50">
                                  <ChevronDown className="w-3 h-3 shrink-0 text-zinc-400" />
                                </div>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1 relative">
                             <button
                               onClick={(e) => {
                                 e.stopPropagation();
                                 if (openGroupMenu === category.title) {
                                   setOpenGroupMenu(null);
                                   setOpenGroupMenuRect(null);
                                 } else {
                                   setOpenGroupMenu(category.title);
                                   setOpenGroupMenuRect(e.currentTarget.getBoundingClientRect());
                                 }
                               }}
                               onMouseDown={(e) => e.stopPropagation()}
                               onPointerDown={(e) => e.stopPropagation()}
                               className="p-1.5 hover:bg-white/10 rounded-md transition-colors cursor-pointer text-zinc-400 hover:text-white"
                               title="Group options"
                             >
                               <MoreHorizontal className="w-4 h-4" />
                             </button>

                             {openGroupMenu === category.title && openGroupMenuRect && typeof window !== 'undefined' && createPortal(
                               <div 
                                 className="fixed w-40 bg-zinc-900 border border-zinc-700/50 rounded-lg shadow-xl z-[9999] py-1 animate-in fade-in zoom-in-95 duration-100"
                                 style={{ 
                                   top: openGroupMenuRect.bottom + 4,
                                   left: openGroupMenuRect.right - 160 // 160px is w-40
                                 }}
                                 onClick={(e) => e.stopPropagation()}
                                 onMouseDown={(e) => e.stopPropagation()}
                                 onPointerDown={(e) => e.stopPropagation()}
                               >
                                 {!category.isCatchAll && (
                                   <button
                                     className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
                                     onClick={() => {
                                       setEditingGroup(category.title);
                                       setEditingGroupName(category.title);
                                       setOpenGroupMenu(null);
                                       setOpenGroupMenuRect(null);
                                     }}
                                   >
                                     <Pencil className="w-3.5 h-3.5" />
                                     Rename
                                   </button>
                                 )}
                                 <button
                                   className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
                                   onClick={() => {
                                     setAddingStatusToGroup(category.title);
                                     setNewStatusName('');
                                     setOpenGroupMenu(null);
                                     setOpenGroupMenuRect(null);
                                   }}
                                 >
                                   <Plus className="w-3.5 h-3.5" />
                                   Add status
                                 </button>
                                 {!category.isCatchAll && (
                                   <button
                                     className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 flex items-center gap-2 transition-colors cursor-pointer"
                                     onClick={() => {
                                       setOpenGroupMenu(null);
                                       setOpenGroupMenuRect(null);
                                       setGroupToDelete(category.title);
                                     }}
                                   >
                                     <Trash2 className="w-3.5 h-3.5" />
                                     Delete
                                   </button>
                                 )}
                               </div>,
                               document.body
                             )}
                           </div>
                         </div>

                  {/* Columns inside the group */}
                  <div className="flex items-start flex-1 min-h-0 shrink-0 min-w-max">
                    <SortableContext items={category.statuses} strategy={horizontalListSortingStrategy}>
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
                            tasks={tasksByStatus[status] || EMPTY_ARRAY}
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
                            onStatusDelete={onStatusDelete}
                            onAddTaskClick={onAddTaskClick}
                            onTaskClick={onTaskClick}
                            hasMarginRight={hasMarginRight}
                            groupRunCount={groupRunCount}
                            isCollapsedGroupLeader={isCollapsedGroupLeader}
                            statusesInRun={statusesInRun}
                            activeColumn={activeColumn}
                          />
                        );
                      })}
                    </SortableContext>
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
        {activeColumn ? (() => {
           const dbStatus = listStatuses.find((s: any) => s.name === activeColumn);
           return (
             <div className="flex-shrink-0 flex items-stretch cursor-grabbing opacity-90 scale-[1.02] shadow-2xl">
                <KanbanColumn
                  status={activeColumn}
                  tasks={tasksByStatus[activeColumn] || []}
                  isCollapsed={false}
                  onToggleCollapse={() => {}}
                  customTheme={dbStatus?.color || columnThemes[activeColumn]}
                  roleMap={roleMap}
                  allowedRoles={dbStatus?.allowedRoles}
                  listStatuses={listStatuses}
                  isOverlay={true}
                />
             </div>
           );
        })() : null}
        {activeGroup ? (
          <div className="flex-shrink-0 snap-start self-stretch flex items-stretch h-[500px] z-50 relative cursor-grabbing opacity-90 scale-[1.02] shadow-2xl">
             <div className="rounded-2xl border bg-[#18181c] w-[320px] h-full p-4 pt-3 flex flex-col shadow-2xl" style={{ borderColor: activeGroup.borderColor }}>
               <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg mb-3">
                 <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">{activeGroup.title}</span>
               </div>
               <div className="flex-1 flex gap-4">
                 <div className="w-full h-full rounded-xl bg-white/5 border border-white/5 flex flex-col p-3">
                    <div className="w-full h-20 bg-white/5 rounded-lg mb-2" />
                    <div className="w-full h-24 bg-white/5 rounded-lg" />
                 </div>
               </div>
             </div>
          </div>
        ) : null}
      </DragOverlay>

      <ConfirmDeleteModal
        isOpen={!!groupToDelete}
        onClose={() => setGroupToDelete(null)}
        onConfirm={async () => {
          if (groupToDelete && onDeleteGroup) {
            await onDeleteGroup(groupToDelete);
          }
          setGroupToDelete(null);
        }}
        title="Delete Group"
        itemName={groupToDelete || ''}
      />
    </DndContext>
  );
}
