import { useState, useEffect } from 'react';
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
import { Plus } from 'lucide-react';

interface Props {
  tasks: Task[];
  onTaskMove: (taskId: string, newStatus: string) => Promise<void>;
  onTaskReorder?: (activeId: string, overId: string) => void;
  onAddTaskClick?: (status: string) => void;
  onTaskClick?: (task: Task) => void;
  customGroups: string[];
  onAddGroup: (group: string) => void;
}

export function KanbanBoard({ tasks, onTaskMove, onTaskReorder, onAddTaskClick, onTaskClick, customGroups, onAddGroup }: Props) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  const [columnThemes, setColumnThemes] = useState<Record<string, string>>({});

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
  const tasksByStatus = tasks.reduce((acc: Record<string, Task[]>, task) => {
    const status = task.status || 'TODO';
    if (!acc[status]) acc[status] = [];
    acc[status].push(task);
    return acc;
  }, {});

  // Maintain a stable order for columns so they don't jump around when tasks move
  const [stableStatuses, setStableStatuses] = useState<string[]>([]);

  useEffect(() => {
    const incoming = Array.from(new Set([...Object.keys(tasksByStatus), ...customGroups]));
    setStableStatuses(prev => {
      // Find new columns to append
      const missing = incoming.filter(s => !prev.includes(s));
      // Remove columns that no longer exist (unless they are custom groups)
      const valid = prev.filter(s => incoming.includes(s));
      
      if (missing.length > 0 || valid.length !== prev.length) {
        return [...valid, ...missing];
      }
      return prev;
    });
  }, [tasks, customGroups]);

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
      <div className="flex gap-4 items-start h-full overflow-x-auto overflow-y-hidden pb-4 custom-scrollbar">
        {stableStatuses.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus[status] || []}
            customTheme={columnThemes[status]}
            onThemeChange={(themeId) => setColumnThemes({ ...columnThemes, [status]: themeId })}
            onAddTaskClick={onAddTaskClick}
            onTaskClick={onTaskClick}
          />
        ))}
        
        {/* Add Group Column / Input */}
        <div className="flex-shrink-0 w-[350px]">
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
