import { useState, useMemo, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Task } from '@/lib/types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  tasks: Task[];
  onTaskMove: (taskId: string, newStatus: string) => Promise<void>;
  onTaskReorder?: (activeId: string, overId: string) => void;
  onAddTaskClick?: (status: string) => void;
  onTaskClick?: (task: Task) => void;
  customGroups: string[];
  onAddGroup: (group: string) => void;
}

const CATEGORIES = [
  {
    id: 'client_details',
    title: 'Client Details',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    icon: '👤',
    statuses: ['KYC', 'Pin Board'],
  },
  {
    id: 'recurring',
    title: 'Recurring',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    icon: '🔁',
    statuses: ['Daily', 'Weekly', 'Monthly'],
  },
  {
    id: 'workflow',
    title: 'Workflow & Progress',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
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

export function KanbanBoard({ tasks, onTaskMove, onTaskReorder, onAddTaskClick, onTaskClick, customGroups, onAddGroup }: Props) {
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('nexus_board_collapsed_categories');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {};
  });
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  const [columnThemes, setColumnThemes] = useState<Record<string, string>>({});

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = { ...prev, [categoryId]: !prev[categoryId] };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('nexus_board_collapsed_categories', JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
    if (boardContainerRef.current && e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Multiply scroll distance for fast, effortless left-to-right navigation
      boardContainerRef.current.scrollLeft += e.deltaY * 2.5;
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    return tasks.reduce((acc: Record<string, Task[]>, task) => {
      const status = task.status || 'Pending';
      if (!acc[status]) acc[status] = [];
      acc[status].push(task);
      return acc;
    }, {});
  }, [tasks]);

  // Group columns into configured categories + any custom/extra columns
  const categorizedColumns = useMemo(() => {
    const activeCustom = Array.from(
      new Set([
        ...Object.keys(tasksByStatus).filter((s) => !ALL_CONFIGURED_STATUSES.includes(s)),
        ...customGroups.filter((g) => !ALL_CONFIGURED_STATUSES.includes(g)),
      ])
    );

    const sections = CATEGORIES.map((cat) => ({
      ...cat,
      statuses: cat.statuses,
    }));

    if (activeCustom.length > 0) {
      sections.push({
        id: 'custom',
        title: 'Custom Groups',
        badgeClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
        icon: '📌',
        statuses: activeCustom,
      });
    }

    return sections;
  }, [tasksByStatus, customGroups]);

  const handleAddGroup = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newGroup.trim()) {
      onAddGroup(newGroup.trim());
      setNewGroup('');
      setIsAddingGroup(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = tasks.find((t) => t.id === active.id);
    if (task) setActiveTask(task);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    let newStatus = over.data?.current?.status;
    if (!newStatus) {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) newStatus = overTask.status;
    }

    if (newStatus && activeTask && activeTask.status !== newStatus) {
      // Optimistically move to new column so the placeholder shows up there
      onTaskMove(activeId, newStatus);
      setActiveTask(prev => prev ? { ...prev, status: newStatus } : null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Is it dropped directly on a column?
    let newStatus = over.data?.current?.status;
    
    // If dropped on another task, find that task's status
    if (!newStatus) {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) newStatus = overTask.status || 'TODO';
    }

    if (newStatus && activeTask) {
      if (activeTask.status !== newStatus) {
        // Moved to a different column
        onTaskMove(activeId, newStatus);
      } else if (activeId !== overId && onTaskReorder) {
        // Reordered in the same column
        onTaskReorder(activeId, overId);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div 
        ref={boardContainerRef}
        onWheel={handleWheelScroll}
        className="flex gap-6 items-start h-full overflow-x-auto overflow-y-hidden pb-4 custom-scrollbar snap-x snap-mandatory"
      >
        {categorizedColumns.map((category) => {
          const isCollapsed = Boolean(collapsedCategories[category.id]);
          const totalCategoryTasks = category.statuses.reduce(
            (sum, s) => sum + (tasksByStatus[s]?.length || 0),
            0
          );

          return (
            <div key={category.id} className="flex flex-col gap-3 flex-shrink-0 transition-all snap-start">
              {/* Category Header (Clickable Collapse Toggle) */}
              <button
                onClick={() => toggleCategory(category.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wider ${category.badgeClass} w-fit shadow-sm hover:opacity-90 transition-all cursor-pointer select-none group`}
              >
                <span className="text-sm">{category.icon}</span>
                <span>{category.title}</span>
                <span className="opacity-60 text-[10px]">
                  ({totalCategoryTasks} task{totalCategoryTasks !== 1 ? 's' : ''})
                </span>
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 ml-1 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 ml-1 text-zinc-400 group-hover:translate-y-0.5 transition-transform" />
                )}
              </button>

              {/* Category Content (Expanded columns OR Collapsed Summary) */}
              {isCollapsed ? (
                <div
                  onClick={() => toggleCategory(category.id)}
                  className="w-56 bg-[#18181c] border border-zinc-800/80 hover:border-zinc-700 rounded-2xl p-4 flex flex-col gap-3 cursor-pointer transition-all hover:bg-zinc-800/40 shadow-md"
                >
                  <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                    <span className="text-xs font-semibold text-zinc-300">Section Collapsed</span>
                    <span className="text-[10px] text-zinc-500 font-mono">{category.statuses.length} cols</span>
                  </div>
                  <div className="space-y-1.5">
                    {category.statuses.map((status) => {
                      const count = tasksByStatus[status]?.length || 0;
                      return (
                        <div key={status} className="flex justify-between items-center text-[11px] text-zinc-400">
                          <span className="truncate pr-2">{status}</span>
                          <span className="px-1.5 py-0.2 rounded bg-zinc-800 font-mono text-[10px] text-zinc-300">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-indigo-400 font-medium pt-1 text-center">
                    Click to Expand →
                  </div>
                </div>
              ) : (
                <div className="flex gap-4 items-start">
                  {category.statuses.map((status) => (
                    <KanbanColumn
                      key={status}
                      status={status}
                      tasks={tasksByStatus[status] || []}
                      customTheme={columnThemes[status]}
                      onThemeChange={(themeId) => setColumnThemes((prev) => ({ ...prev, [status]: themeId }))}
                      onAddTaskClick={onAddTaskClick}
                      onTaskClick={onTaskClick}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        
        {/* Add Group Column / Input */}
        <div className="flex-shrink-0 w-[350px] snap-start">
          <div className="flex flex-col pt-3">
            {!isAddingGroup ? (
              <button 
                onClick={() => setIsAddingGroup(true)}
                className="flex items-center gap-1 text-base font-semibold text-zinc-500 hover:text-zinc-700 transition-colors mb-2"
              >
                <Plus className="w-5 h-5" /> Add group
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => setIsAddingGroup(false)}
                  className="flex items-center gap-1 text-base font-semibold text-zinc-500 hover:text-zinc-300 transition-colors mb-1"
                >
                  <Plus className="w-5 h-5" /> Add group
                </button>
                <div className="flex items-center gap-2 p-1.5 border border-zinc-700 bg-[#18181c] rounded-lg shadow-sm">
                  <div className="w-4 h-4 rounded bg-amber-500 ml-1 shrink-0" />
                  <input 
                    type="text" 
                    placeholder="Status name" 
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

      <DragOverlay>
        {activeTask ? <KanbanCard task={activeTask} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
