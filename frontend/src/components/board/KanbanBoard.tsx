import { useState, useMemo, useRef } from 'react';
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
  listStatuses?: any[];
  onStatusChange?: (statusName: string, data: { color?: string; allowedRoles?: string[] }) => void;
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

export function KanbanBoard({ tasks, onTaskMove, onTaskReorder, onAddTaskClick, onTaskClick, customGroups, onAddGroup, listStatuses = [], onStatusChange }: Props) {
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // Local visual override: tracks which status to SHOW the dragged card in during drag
  // This does NOT call any API — it's purely for visual feedback.
  const [dragOverride, setDragOverride] = useState<{ taskId: string; status: string } | null>(null);
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
  const [columnThemes, setColumnThemes] = useState<Record<string, string>>({});

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
             cat.statuses.forEach(status => {
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

  // Group tasks by status, applying the local drag override for visual preview
  const tasksByStatus = useMemo(() => {
    return tasks.reduce((acc: Record<string, Task[]>, task) => {
      // If this task is being dragged, show it in the override column instead
      const status = (dragOverride?.taskId === task.id ? dragOverride.status : task.status) || 'Pending';
      if (!acc[status]) acc[status] = [];
      acc[status].push(task);
      return acc;
    }, {});
  }, [tasks, dragOverride]);

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
        badgeClass: 'bg-zinc-500/15 text-zinc-300',
        borderColor: 'rgba(113, 113, 122, 0.5)',
        icon: '📌',
        statuses: activeCustom,
      });
    }

    return sections;
  }, [tasksByStatus, customGroups]);

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
          const allCollapsed = cat.statuses.every(s => next[s]);
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
    if (task) {
      setActiveTask(task);
      // Initialize the override to the task's current status
      setDragOverride({ taskId: task.id, status: task.status });
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !activeTask) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    // Determine the target column status from the over element
    let targetStatus = over.data?.current?.status;
    if (!targetStatus) {
      // Hovering over another task — use that task's current status
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) targetStatus = overTask.status;
    }

    // Only update the LOCAL visual override — NO API call here
    if (targetStatus && dragOverride?.status !== targetStatus) {
      setDragOverride({ taskId: activeId, status: targetStatus });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const originalTask = activeTask;
    // Capture the last known hover target BEFORE clearing state
    const lastOverrideStatus = dragOverride?.status ?? null;

    // Clear drag state
    setActiveTask(null);
    setDragOverride(null);

    if (!originalTask) return;

    const activeId = active.id as string;

    // PRIMARY: use the last column the card was hovering over (dragOverride)
    // This is the most reliable signal — wherever the card visually "was" is where it should go.
    // FALLBACK: use the dnd-kit over target if dragOverride is unavailable.
    let finalStatus: string | undefined = lastOverrideStatus ?? undefined;

    if (!finalStatus && over) {
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
    setDragOverride(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div 
        ref={boardContainerRef}
        onWheel={handleWheelScroll}
        className="flex gap-6 items-start h-full overflow-x-auto overflow-y-hidden pt-8 pb-4 px-2 custom-scrollbar snap-x snap-mandatory transition-all duration-300"
      >
        {categorizedColumns.map((category) => {
          const isCollapsed = Boolean(collapsedCategories[category.id]);
          const totalCategoryTasks = category.statuses.reduce(
            (sum, s) => sum + (tasksByStatus[s]?.length || 0),
            0
          );

          return (
            <div key={category.id} className="flex-shrink-0 snap-start self-stretch flex items-stretch">
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
                {/* Floating Chrome-style Tab at top-left */}
                <div className={`absolute bottom-full translate-y-[1px] left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg rounded-b-none text-[10px] font-bold uppercase tracking-wider border border-b-0 bg-[#18181c] cursor-pointer transition-all duration-200 hover:brightness-125 ${category.badgeClass.replace(/bg-[a-z]+-\d+\/\d+/, '')}`}
                     onClick={() => toggleCategory(category.id)}
                     title="Collapse section"
                     style={{ 
                       pointerEvents: isCollapsed ? 'none' : 'auto',
                       borderColor: category.borderColor
                     }}
                >
                  <span className="shrink-0">{category.icon}</span>
                  <span className="whitespace-nowrap">{category.title}</span>
                  <span className="opacity-60 shrink-0">({totalCategoryTasks})</span>
                  <ChevronDown className="w-3 h-3 ml-1 opacity-70 shrink-0" />
                </div>

                {/* Inner container with overflow-hidden to clip contents during animation */}
                <div 
                  className="rounded-2xl border bg-[#18181c] h-full p-4 pt-6 overflow-hidden flex gap-4 items-start shadow-sm shadow-black/20"
                  style={{ borderColor: category.borderColor }}
                >
                  {/* Columns inside the group */}
                  <div className="flex items-start h-full shrink-0 min-w-max">
                    {category.statuses.map((status, index) => {
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

                      const handleToggle = () => {
                         if (isCollapsed && groupRunCount > 1 && isCollapsedGroupLeader) {
                            // Expand all in this run
                            setCollapsedColumns(prev => {
                               const next = { ...prev };
                               statusesInRun.forEach(s => { next[s] = false; });
                               if (typeof window !== 'undefined') {
                                 try { localStorage.setItem('nexus_board_collapsed_columns', JSON.stringify(next)); } catch {}
                               }
                               return next;
                            });
                         } else {
                            toggleColumnCollapse(status, category.id);
                         }
                      };

                      const dbStatus = listStatuses.find(s => s.name === status);

                      return (
                        <div key={status} className={`h-full transition-all duration-300 ${hasMarginRight ? 'mr-4' : ''}`}>
                          <KanbanColumn
                            status={status}
                            tasks={tasksByStatus[status] || []}
                            isCollapsed={isCollapsed}
                            collapsedGroupCount={groupRunCount}
                            isCollapsedGroupLeader={isCollapsedGroupLeader}
                            onToggleCollapse={handleToggle}
                            customTheme={dbStatus?.color || columnThemes[status]}
                            onThemeChange={(themeId) => {
                                if (onStatusChange) onStatusChange(status, { color: themeId });
                                setColumnThemes((prev) => ({ ...prev, [status]: themeId }));
                            }}
                            onAddTaskClick={onAddTaskClick}
                            onTaskClick={onTaskClick}
                            allowedRoles={dbStatus?.allowedRoles}
                            onRoleChange={(roles) => {
                                if (onStatusChange) onStatusChange(status, { allowedRoles: roles });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
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
