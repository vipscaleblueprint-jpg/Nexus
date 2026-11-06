'use client';

import React, { useState } from 'react';
import { TaskMapItem, TaskMapOption, taskMapApi } from '@/api/taskMap';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import {
  ShieldCheck,
  CheckCircle2,
  Flag,
  Clock,
  UserCheck,
  AlertCircle,
  Building2,
} from 'lucide-react';
import { format } from 'date-fns';
import { getPriorityConfig } from '@/lib/priority';
import { CustomCircleDot } from '@/lib/taskTokens';
import { isProjectManagerOrAdmin } from '@/lib/permissions';
import { toast } from '@/lib/toast';
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
      className={`touch-none ${isDragging ? 'opacity-30' : ''} ${disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
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
      className={`${className || ''} ${isOver ? 'ring-2 ring-amber-500/60' : ''}`}
    >
      {children}
    </div>
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
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const isPmUser = isProjectManagerOrAdmin(currentUser);

  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);
  const [showAdminTasks, setShowAdminTasks] = useState(false);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

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

  // Categorize tasks into Auditing review columns
  const isDoneReview = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase();
    const mapStatuses = (t.taskMap?.statuses || []).map((x) => x.toUpperCase());
    return s === 'DONE REVIEW' || mapStatuses.includes('DONE REVIEW');
  };

  const hasTag = (t: TaskMapItem, tag: string) => {
    const mapStatuses = (t.taskMap?.statuses || []).map((x) => x.toUpperCase());
    return mapStatuses.includes(tag.toUpperCase());
  };

  const isGeneralToReview = (t: TaskMapItem) => {
    if (isDoneReview(t)) return false;
    if (hasTag(t, 'CHE') || hasTag(t, 'PAU') || hasTag(t, 'HAN')) return false;

    const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );

    return (
      s === 'TOREVIEW' ||
      s === 'INREVIEW' ||
      mapStatuses.includes('TOREVIEW') ||
      mapStatuses.includes('INREVIEW')
    );
  };

  // Partition tasks into columns
  const toReviewQueue = filteredReviewTasks.filter(isGeneralToReview);
  const cheQueue = filteredReviewTasks.filter((t) => !isDoneReview(t) && hasTag(t, 'CHE'));
  const pauQueue = filteredReviewTasks.filter((t) => !isDoneReview(t) && hasTag(t, 'PAU'));
  const hanQueue = filteredReviewTasks.filter((t) => !isDoneReview(t) && hasTag(t, 'HAN'));
  const doneReviewQueue = filteredReviewTasks.filter(isDoneReview);

  // DnD Drag Handlers
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

    // Strip previous review tags
    let updatedStatuses = currentStatuses.filter((s) => {
      const up = s.toUpperCase().trim();
      return up !== 'CHE' && up !== 'PAU' && up !== 'HAN' && up !== 'TO REVIEW' && up !== 'DONE REVIEW';
    });

    if (targetColumnId === 'col-che') {
      updatedStatuses.push('CHE');
      toast.success('Task routed to CHE for review');
    } else if (targetColumnId === 'col-pau') {
      updatedStatuses.push('PAU');
      toast.success('Task routed to PAU for review');
    } else if (targetColumnId === 'col-han') {
      updatedStatuses.push('HAN');
      toast.success('Task routed to HAN for review');
    } else if (targetColumnId === 'col-to-review') {
      updatedStatuses.push('To review');
      toast.info('Task moved to General Review queue');
    } else if (targetColumnId === 'col-done-review') {
      updatedStatuses.push('Done Review');
      toast.success('Task marked Done Review');
    }

    onStatusChange(taskId, updatedStatuses);
  };

  // Helper to build options
  const getAuditingOptions = (task: TaskMapItem): TaskMapOption[] => {
    return [
      { id: 'opt-donereview', label: 'Done Review', color: '#2dd4bf', textColor: '#134e4a', order: 1 },
      { id: 'opt-revision', label: 'Revision', color: '#c084fc', textColor: '#581c87', order: 2 },
      { id: 'opt-toreview', label: 'To review', color: '#1d4ed8', textColor: '#dbeafe', order: 3 },
      { id: 'opt-inprog', label: 'In progress', color: '#ca8a04', textColor: '#fef08a', order: 4 },
      { id: 'opt-pm-che', label: 'CHE', color: '#f87171', textColor: '#ffffff', order: 10 },
      { id: 'opt-pm-pau', label: 'PAU', color: '#7e22ce', textColor: '#ffffff', order: 11 },
      { id: 'opt-pm-han', label: 'HAN', color: '#facc15', textColor: '#713f12', order: 12 },
    ];
  };

  const columns = [
    {
      id: 'col-to-review',
      title: 'To Review',
      subtitle: 'Incoming tasks awaiting reviewer assignment',
      count: toReviewQueue.length,
      badgeColor: 'bg-blue-950 text-blue-300 border-blue-800',
      dotColor: 'bg-blue-500',
      tasks: toReviewQueue,
    },
    {
      id: 'col-che',
      title: 'CHE Review',
      subtitle: 'Review queue assigned to Che',
      count: cheQueue.length,
      badgeColor: 'bg-red-950 text-red-300 border-red-800',
      dotColor: 'bg-red-500',
      tasks: cheQueue,
    },
    {
      id: 'col-pau',
      title: 'PAU Review',
      subtitle: 'Review queue assigned to Pau',
      count: pauQueue.length,
      badgeColor: 'bg-purple-950 text-purple-300 border-purple-800',
      dotColor: 'bg-purple-500',
      tasks: pauQueue,
    },
    {
      id: 'col-han',
      title: 'HAN Review',
      subtitle: 'Review queue assigned to Hannah',
      count: hanQueue.length,
      badgeColor: 'bg-amber-950 text-amber-300 border-amber-800',
      dotColor: 'bg-amber-500',
      tasks: hanQueue,
    },
    {
      id: 'col-done-review',
      title: 'Done Review',
      subtitle: 'Approved & verified reviews',
      count: doneReviewQueue.length,
      badgeColor: 'bg-emerald-950 text-emerald-300 border-emerald-800',
      dotColor: 'bg-emerald-500',
      tasks: doneReviewQueue,
    },
  ];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full bg-background">
        {/* Sub-header Banner */}
        <div className="px-6 py-2.5 bg-card border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-zinc-200">
              Auditing & Review Board
            </span>
            <span className="text-zinc-500 text-xs hidden sm:inline">
              — Review tasks, assign PM auditors, approve or return for revision.
            </span>
          </div>

          {/* Admin Tasks Toggle */}
          <button
            type="button"
            onClick={() => setShowAdminTasks(!showAdminTasks)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer ${showAdminTasks
                ? 'bg-purple-950/80 text-purple-200 border-purple-700/80 shadow-sm'
                : 'bg-card text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            title={showAdminTasks ? 'Admin tasks are visible' : 'Admin tasks are hidden'}
          >
            <Building2 className={`size-3.5 ${showAdminTasks ? 'text-purple-400' : 'text-zinc-500'}`} />
            <span>Admin Tasks</span>
          </button>
        </div>

        {/* Board Columns */}
        <div className="flex-1 flex gap-5 px-6 py-5 overflow-x-auto custom-scrollbar select-none">
          {columns.map((col) => (
            <DroppableColumn
              key={col.id}
              id={col.id}
              className="w-[340px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-[calc(100vh-180px)]"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-1.5">
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${col.dotColor}`} />
                  <h3 className="text-sm font-bold text-zinc-100">{col.title}</h3>
                </div>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full border ${col.badgeColor}`}
                >
                  {col.count}
                </span>
              </div>

              <p className="text-xs text-zinc-400 mb-4 leading-relaxed line-clamp-1">
                {col.subtitle}
              </p>

              {/* Cards List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                {col.tasks.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic text-center py-12">
                    No tasks in {col.title}.
                  </p>
                ) : (
                  col.tasks.map((task) => {
                    const priorityConfig = getPriorityConfig(task.priority);
                    const isClosed =
                      (task.status || '').toUpperCase() === 'CLOSED' ||
                      (task.status || '').toUpperCase() === 'DONE';

                    const assignee =
                      task.assignee || (task.assignees && task.assignees[0]);

                    return (
                      <DraggableTaskCard key={task.id} task={task} disabled={false}>
                        <div className="p-3 bg-zinc-900 border border-border hover:border-zinc-700 rounded-xl shadow-md min-h-[94px] flex items-stretch gap-3 transition-all group">
                          {/* Left: Task Info */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                            {/* Client Name */}
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

                            {/* Controls row */}
                            <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                              {/* Assignee Avatar / Name */}
                              {assignee ? (
                                <span
                                  className="text-[10px] font-medium text-zinc-400 truncate max-w-[90px]"
                                  title={`Assigned to ${assignee.name || 'User'}`}
                                >
                                  {assignee.name?.split(' ')[0] || 'User'}
                                </span>
                              ) : (
                                <span className="text-[10px] italic text-zinc-500">
                                  Unassigned
                                </span>
                              )}

                              <TaskDescriptionButton
                                description={task.description}
                                taskTitle={task.title}
                              />

                              {/* Priority Flag */}
                              <span className="flex items-center gap-1 font-medium text-[11px]">
                                <Flag className={`size-3 ${priorityConfig.iconColor}`} />
                                <span className={priorityConfig.color}>
                                  {priorityConfig.label}
                                </span>
                              </span>
                            </div>
                          </div>

                          {/* Separator */}
                          <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                          {/* Right: Status Dropdown & Posted Date */}
                          <div className="w-[125px] shrink-0 flex flex-col justify-between py-0.5">
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
                                Status
                              </span>
                              <TaskMapStatusDropdown
                                selectedStatuses={task.taskMap.statuses || []}
                                options={getAuditingOptions(task)}
                                onToggleStatus={(label, nextStatuses) => {
                                  const next =
                                    nextStatuses ||
                                    ((task.taskMap.statuses || []).includes(label)
                                      ? (task.taskMap.statuses || []).filter(
                                        (s) => s !== label
                                      )
                                      : [...(task.taskMap.statuses || []), label]);
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
          ))}
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

