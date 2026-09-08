'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { spacesApi, authApi } from '@/api';
import { useAppStore } from '@/lib/store';
import {
  List as ListIcon,
  Plus,
  CheckSquare,
  Calendar,
  User,
  Flag,
  ChevronDown,
  Loader2,
  KanbanSquare,
} from 'lucide-react';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { KanbanBoard } from '@/components/board/KanbanBoard';
import { tasksApi } from '@/api/tasks';
import { CreateTaskModal } from '@/components/modals/CreateTaskModal';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { arrayMove } from '@dnd-kit/sortable';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/api/client';

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400 bg-zinc-800',
  MEDIUM: 'text-blue-400 bg-blue-500/20',
  HIGH: 'text-orange-400 bg-orange-500/20',
  URGENT: 'text-red-400 bg-red-500/20',
};

const STATUS_COLORS: Record<string, string> = {
  TODO: 'bg-zinc-700 text-zinc-300',
  IN_PROGRESS: 'bg-blue-600 text-white',
  DONE: 'bg-emerald-600 text-white',
  CANCELLED: 'bg-red-700/60 text-red-200',
};

export default function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser, setCurrentUser } = useAppStore();
  const [list, setList] = useState<any>(null);
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'board'>('board');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalStatus, setTaskModalStatus] = useState<string>('TODO');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve auth
      if (!currentUser) {
        try {
          const { user } = await authApi.getMe();
          if (!cancelled && user) setCurrentUser(user);
        } catch { }
      }

      try {
        const listRes = await spacesApi.getList(id);
        if (!cancelled) {
          setList(listRes.list);
          if (listRes.list?.customGroups) {
            setCustomGroups(listRes.list.customGroups);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load board');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const s = io(API_BASE_URL, { withCredentials: true });
    setSocket(s);

    s.on('connect', () => {
      s.emit('join_list', id);
    });

    // Real-time: task created by another user
    s.on('task:created', (newTask: any) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        // Don't add if we already have it by real ID (API response arrived first)
        if (prev.tasks.some((t: any) => t.id === newTask.id)) return prev;
        // If we have a temp task (we were the creator), replace it with the real one
        const tempIdx = prev.tasks.findIndex((t: any) =>
          typeof t.id === 'string' && t.id.startsWith('temp-') && t.title === newTask.title
        );
        if (tempIdx !== -1) {
          const updated = [...prev.tasks];
          updated[tempIdx] = newTask;
          return { ...prev, tasks: updated };
        }
        return { ...prev, tasks: [...prev.tasks, newTask] };
      });
    });

    // Real-time: task updated/moved by another user
    s.on('task:updated', (updatedTask: any) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t: any) => t.id === updatedTask.id ? { ...t, ...updatedTask } : t)
        };
      });
      setSelectedTask((prev: any) => prev?.id === updatedTask.id ? { ...prev, ...updatedTask } : prev);
    });

    // Real-time: task deleted by another user
    s.on('task:deleted', (data: { taskId: string }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        return { ...prev, tasks: prev.tasks.filter((t: any) => t.id !== data.taskId) };
      });
      setSelectedTask((prev: any) => prev?.id === data.taskId ? null : prev);
    });

    s.on('task:comment_added', (payload: { taskId: string, comment: any }) => {
      // Since comments aren't in the raw list fetch typically, we can just update selectedTask if it's open
      setSelectedTask((prev: any) => {
        if (prev?.id === payload.taskId) {
          return { ...prev, comments: [...(prev.comments || []), payload.comment] };
        }
        return prev;
      });
    });

    s.on('list:group_added', (group: string) => {
      setCustomGroups(prev => prev.includes(group) ? prev : [...prev, group]);
    });

    // Real-time: task reorder within a column
    s.on('task_reorder', (data: { status: string; taskIds: string[] }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        const otherTasks = prev.tasks.filter((t: any) => t.status !== data.status);
        const statusTasks = prev.tasks.filter((t: any) => t.status === data.status);
        // Reorder statusTasks according to the received taskIds order
        const reordered = data.taskIds
          .map((tid: string) => statusTasks.find((t: any) => t.id === tid))
          .filter(Boolean);
        // Append any tasks not in the reorder list (safety net)
        const remaining = statusTasks.filter((t: any) => !data.taskIds.includes(t.id));
        return { ...prev, tasks: [...otherTasks, ...reordered, ...remaining] };
      });
    });

    return () => {
      s.emit('leave_list', id);
      s.disconnect();
    };
  }, [id]);

  // Group tasks by status
  const tasksByStatus = list?.tasks?.reduce((acc: Record<string, any[]>, task: any) => {
    const status = task.status || 'TODO';
    if (!acc[status]) acc[status] = [];
    acc[status].push(task);
    return acc;
  }, {} as Record<string, any[]>) ?? {};

  const statusOrder = [
    'KYC',
    'Pin Board',
    'Daily',
    'Weekly',
    'Monthly',
    'Pending',
    'In Progress',
    'Revision',
    'Waiting',
    'In Review',
    'Checking',
    'On-Hold',
    'Closed',
  ];
  const orderedStatuses = [
    ...statusOrder.filter((s) => tasksByStatus[s]),
    ...Object.keys(tasksByStatus).filter((s) => !statusOrder.includes(s)),
  ];

  const breadcrumb = [
    list?.space?.name,
    list?.folder?.name,
    list?.name,
  ].filter(Boolean).join(' / ');

  const handleTaskMove = async (taskId: string, newStatus: string) => {
    // Optimistically update UI
    setList((prev: any) => ({
      ...prev,
      tasks: prev.tasks.map((t: any) =>
        t.id === taskId ? { ...t, status: newStatus } : t
      ),
    }));

    try {
      await tasksApi.moveTask(taskId, newStatus, id as string);
    } catch (err: any) {
      console.error('Failed to move task:', err);
      // Revert on failure by refetching
      const listRes = await spacesApi.getList(id as string);
      setList(listRes.list);
      alert(err.message || 'You do not have permission to move to this status');
    }
  };

  const handleTaskReorder = (activeId: string, overId: string) => {
    setList((prev: any) => {
      if (!prev || !prev.tasks) return prev;
      const oldIndex = prev.tasks.findIndex((t: any) => t.id === activeId);
      const newIndex = prev.tasks.findIndex((t: any) => t.id === overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(prev.tasks, oldIndex, newIndex);
        // Broadcast the new order to other users
        if (socket) {
          const movedTask = prev.tasks[oldIndex];
          const statusTasks = reordered.filter((t: any) => t.status === movedTask.status);
          socket.emit('task_reorder', {
            listId: id,
            status: movedTask.status,
            taskIds: statusTasks.map((t: any) => t.id),
          });
        }
        return { ...prev, tasks: reordered };
      }
      return prev;
    });
  };

  const handleAddTask = async (task: any) => {
    // Optimistic ID for UI
    const tempId = `temp-${Date.now()}`;
    const newTask = { ...task, id: tempId, listId: id, creatorId: currentUser?.id, createdAt: new Date().toISOString() };

    setList((prev: any) => ({
      ...prev,
      tasks: [...(prev.tasks || []), newTask],
    }));

    try {
      const res = await tasksApi.createTask({ ...task, listId: id, creatorId: currentUser?.id });
      // Replace temp task with real task
      setList((prev: any) => ({
        ...prev,
        tasks: prev.tasks.map((t: any) => t.id === tempId ? res.task : t),
      }));
    } catch (err) {
      console.error('Failed to add task:', err);
      // Revert optimistic update
      setList((prev: any) => ({
        ...prev,
        tasks: prev.tasks.filter((t: any) => t.id !== tempId),
      }));
    }
  };

  return (
    <>
      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
      ) : selectedTask ? (
        <div className="w-full h-full">
          <TaskDetailModal
            isOpen={!!selectedTask}
            onClose={() => setSelectedTask(null)}
            task={selectedTask}
            socket={socket}
            onStatusChange={(newStatus) => {
              if (selectedTask) {
                handleTaskMove(selectedTask.id, newStatus);
                setSelectedTask({ ...selectedTask, status: newStatus });
              }
            }}
            onUpdateTask={async (updatedTask) => {
              // Optimistic update
              setSelectedTask(updatedTask);
              setList((prev: any) => ({
                ...prev,
                tasks: prev.tasks.map((t: any) => t.id === updatedTask.id ? updatedTask : t)
              }));
              // API call
              try {
                await tasksApi.updateTask(updatedTask.id, {
                  ...updatedTask,
                  assigneeId: updatedTask.assignee?.id,
                  currentListId: id
                } as any);
              } catch (e) {
                console.error('Update failed', e);
              }
            }}
          />
        </div>
      ) : (
        <div className="w-full h-full flex flex-col px-6 py-6 overflow-hidden">
          {/* Header */}
          <div className="mb-6">
            <p className="text-[11px] text-zinc-500 mb-1">{breadcrumb}</p>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/15">
                <ListIcon className="w-5 h-5 text-blue-400" />
              </div>
              <h1 className="text-xl font-semibold text-zinc-100">{list?.name}</h1>
              <span className="text-[11px] text-zinc-500 px-2 py-0.5 bg-zinc-800 rounded-full">
                {list?.tasks?.length ?? 0} tasks
              </span>
            </div>
          </div>

          {/* View Tabs */}
          <div className="flex items-center gap-4 border-b border-zinc-800/80 mb-4">
            <button
              onClick={() => setActiveTab('board')}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'board'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
            >
              <KanbanSquare className="w-4 h-4" />
              Board
            </button>
          </div>

          {/* Task Groups by Status */}
          {activeTab === 'board' ? (
            <div className="flex-1 min-h-0">
              <KanbanBoard
                tasks={list?.tasks || []}
                onTaskMove={handleTaskMove}
                onTaskReorder={handleTaskReorder}
                onAddTaskClick={(status) => {
                  setTaskModalStatus(status);
                  setIsTaskModalOpen(true);
                }}
                onTaskClick={setSelectedTask}
                customGroups={customGroups}
                listStatuses={list?.statuses || []}
                onStatusChange={async (statusName, data) => {
                  try {
                    // Find existing status or create it
                    const existingStatus = list?.statuses?.find((s: any) => s.name === statusName);
                    
                    if (existingStatus) {
                      const res = await fetch(`${API_BASE_URL}/api/lists/${id}/statuses/${existingStatus.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data),
                      });
                      if (res.ok) {
                        const updated = await res.json();
                        setList((prev: any) => ({
                          ...prev,
                          statuses: prev.statuses.map((s: any) => s.id === existingStatus.id ? updated.status : s)
                        }));
                      }
                    } else {
                      const res = await fetch(`${API_BASE_URL}/api/lists/${id}/statuses`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: statusName, ...data }),
                      });
                      if (res.ok) {
                        const created = await res.json();
                        setList((prev: any) => ({
                          ...prev,
                          statuses: [...(prev.statuses || []), created.status]
                        }));
                      }
                    }
                  } catch (e) {
                    console.error('Failed to update status', e);
                  }
                }}
                onAddGroup={(group) => {
                  setCustomGroups(prev => {
                    const newGroups = [...prev, group];
                    // Persist to backend
                    spacesApi.updateList(id as string, { customGroups: newGroups }).catch(console.error);
                    return newGroups;
                  });
                  socket?.emit('add_group', { listId: id, group });
                }}
              />
            </div>
          ) : list?.tasks?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <CheckSquare className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">No tasks yet</p>
              <p className="text-xs mt-1">Tasks added to this list will appear here</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-2">
              {orderedStatuses.map((status) => (
                <div key={status}>
                  {/* Status group header */}
                  <div className="flex items-center gap-2 mb-2">
                    <button className="flex items-center gap-1.5">
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${STATUS_COLORS[status] ?? 'bg-zinc-700 text-zinc-300'}`}>
                        {status.replace('_', ' ')}
                      </span>
                    </button>
                    <span className="text-[11px] text-zinc-600">{tasksByStatus[status].length}</span>
                  </div>

                  {/* Task table */}
                  <div className="border border-zinc-800 rounded-lg overflow-hidden">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_140px_120px_100px] bg-zinc-900/60 border-b border-zinc-800 px-4 py-2 text-[10px] text-zinc-500 uppercase tracking-wide font-semibold">
                      <span>Name</span>
                      <span>Assignee</span>
                      <span>Due Date</span>
                      <span>Priority</span>
                    </div>

                    {/* Task rows */}
                    {tasksByStatus[status].map((task: any) => (
                      <div
                        key={task.id}
                        onClick={() => setSelectedTask(task)}
                        className="grid grid-cols-[1fr_140px_120px_100px] px-4 py-2.5 border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/30 transition-colors group cursor-pointer"
                      >
                        {/* Name */}
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckSquare className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                          <span className="text-[12px] text-zinc-200 truncate">{task.title}</span>
                          {task.subtasks?.length > 0 && (
                            <span className="text-[10px] text-zinc-500 shrink-0">
                              {task.subtasks.filter((s: any) => s.completed).length}/{task.subtasks.length}
                            </span>
                          )}
                        </div>

                        {/* Assignee */}
                        <div className="flex items-center gap-1.5">
                          {task.assignee ? (
                            <>
                              <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold shrink-0">
                                {task.assignee.name?.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-[11px] text-zinc-400 truncate">{task.assignee.name}</span>
                            </>
                          ) : (
                            <div className="flex items-center gap-1 text-zinc-600">
                              <User className="w-3.5 h-3.5" />
                              <span className="text-[11px]">Unassigned</span>
                            </div>
                          )}
                        </div>

                        {/* Due Date */}
                        <div className="flex items-center gap-1 text-zinc-500">
                          <Calendar className="w-3 h-3" />
                          <span className="text-[11px]">
                            {task.dueDate
                              ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              : '—'}
                          </span>
                        </div>

                        {/* Priority */}
                        <div className="flex items-center">
                          {task.priority ? (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${PRIORITY_COLORS[task.priority] ?? 'text-zinc-400 bg-zinc-800'}`}>
                              {task.priority}
                            </span>
                          ) : (
                            <Flag className="w-3.5 h-3.5 text-zinc-700" />
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Add Task row */}
                    <div
                      onClick={() => {
                        setTaskModalStatus(status);
                        setIsTaskModalOpen(true);
                      }}
                      className="px-4 py-2 flex items-center gap-2 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/20 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Add Task</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CreateTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        status={taskModalStatus}
        listId={id as string}
        onSave={handleAddTask}
      />
    </>
  );
}
