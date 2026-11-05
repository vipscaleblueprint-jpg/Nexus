'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  taskMapApi,
  TaskMapItem,
  TaskMapOption,
  TaskMapShift,
  UpworkSession,
} from '@/api/taskMap';
import { TaskMapSidebar } from './TaskMapSidebar';
import { TaskMapHeader } from './TaskMapHeader';
import { TaskMapBoardView } from './TaskMapBoardView';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';

export const TaskMapContainer: React.FC = () => {
  const [tasks, setTasks] = useState<TaskMapItem[]>([]);
  const [availablePool, setAvailablePool] = useState<TaskMapItem[]>([]);
  const [options, setOptions] = useState<TaskMapOption[]>([]);
  const [shifts, setShifts] = useState<TaskMapShift[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [shiftUsers, setShiftUsers] = useState<any[]>([]);
  const [activeUpworkSessions, setActiveUpworkSessions] = useState<UpworkSession[]>([]);
  const currentUser = useAppStore((s) => s.currentUser);

  // Shift & Date state (defaults to Nov 5, 2026 or today)
  const [currentShift, setCurrentShift] = useState<string>('DAY');
  const [currentDate, setCurrentDate] = useState<string>('2026-11-05');
  const [search, setSearch] = useState<string>('');

  const [loading, setLoading] = useState(true);

  // Task Detail Modal
  const [selectedTaskModal, setSelectedTaskModal] = useState<any | null>(null);

  // Fetch data
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await taskMapApi.getData({
        shift: currentShift,
        date: currentDate,
        search,
      });

      if (res.success) {
        setTasks(res.tasks || []);
        setAvailablePool(res.availablePool || []);
        setOptions(res.options || []);
        setShifts(res.shifts || []);
        setAllUsers(res.allUsers || []);
        setShiftUsers(res.shiftUsers || []);
        setActiveUpworkSessions(res.activeUpworkSessions || []);
        if (!currentShift && res.activeShift) {
          setCurrentShift(res.activeShift);
        }
      }
    } catch (err: any) {
      console.error('Failed to load task map data:', err);
      toast.error('Failed to load Task Map data');
    } finally {
      setLoading(false);
    }
  }, [currentShift, currentDate, search]);

  // Initial load & when shift or date changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 45 seconds silently
  useEffect(() => {
    const timer = setInterval(() => {
      loadData(true);
    }, 45000);
    return () => clearInterval(timer);
  }, [loadData]);

  // Socket.io & Window events listeners for real-time synchronization
  useEffect(() => {
    const handleTaskUpdated = () => {
      loadData(true);
    };

    const handleTaskMapUpdated = (e: any) => {
      const data = e.detail || e;
      if (!data?.taskId) {
        loadData(true);
        return;
      }

      const {
        taskId,
        statuses,
        taskMap,
        upworkStartedAt,
        upworkSession,
        activeUpworkSessions: incomingActiveSessions,
      } = data;

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            upworkStartedAt: upworkStartedAt !== undefined ? upworkStartedAt : t.upworkStartedAt,
            upworkSession: upworkSession !== undefined ? upworkSession : t.upworkSession,
            taskMap: {
              ...t.taskMap,
              ...(taskMap || {}),
              statuses: statuses || taskMap?.statuses || t.taskMap.statuses,
            },
          };
        })
      );

      setAvailablePool((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            upworkStartedAt: upworkStartedAt !== undefined ? upworkStartedAt : t.upworkStartedAt,
            upworkSession: upworkSession !== undefined ? upworkSession : t.upworkSession,
            taskMap: {
              ...t.taskMap,
              ...(taskMap || {}),
              statuses: statuses || taskMap?.statuses || t.taskMap.statuses,
            },
          };
        })
      );

      if (incomingActiveSessions) {
        setActiveUpworkSessions(incomingActiveSessions);
      }
    };

    const handleUpworkChanged = (e: any) => {
      const data = e.detail || e;
      if (!data) return;

      if (data.active) {
        toast.info(`⚡ ${data.userName || 'A user'} is now active on Upwork!`, 6000);
        setActiveUpworkSessions((prev) => {
          const filtered = prev.filter((s) => s.taskId !== data.taskId);
          return [
            ...filtered,
            {
              taskId: data.taskId,
              taskTitle: data.taskTitle,
              userId: data.userId,
              userName: data.userName,
              pmName: data.pmName,
              startedAt: data.startedAt,
            },
          ];
        });
      } else {
        const mins = data.durationS ? Math.floor(data.durationS / 60) : 0;
        const durStr = mins > 0 ? `worked ${mins}m` : 'completed';
        toast.success(`✓ ${data.userName || 'User'} stopped Upwork (${durStr}) — Upwork is now available!`, 5000);
        setActiveUpworkSessions((prev) => prev.filter((s) => s.taskId !== data.taskId));
      }

      loadData(true);
    };

    window.addEventListener('task:updated', handleTaskUpdated);
    window.addEventListener('task_map:updated', handleTaskMapUpdated);
    window.addEventListener('task_activity', handleTaskUpdated);
    window.addEventListener('upwork:status_changed', handleUpworkChanged);

    return () => {
      window.removeEventListener('task:updated', handleTaskUpdated);
      window.removeEventListener('task_map:updated', handleTaskMapUpdated);
      window.removeEventListener('task_activity', handleTaskUpdated);
      window.removeEventListener('upwork:status_changed', handleUpworkChanged);
    };
  }, [loadData]);

  // Status Change Handler with Optimistic Updates (Frontend First) & Instant Realtime
  const handleStatusChange = async (taskId: string, newStatuses: string[]) => {
    const existingTask = tasks.find((t) => t.id === taskId) || availablePool.find((t) => t.id === taskId);
    const upworkStatus = newStatuses.find((s) => s.toUpperCase().startsWith('UPWORK'));

    let optimisticStartedAt: string | null = null;
    let optimisticSession: UpworkSession | null = null;

    if (upworkStatus) {
      const m = upworkStatus.match(/^UPWORK\s*\|\s*(.+)$/i);
      const pmName = m && m[1] ? m[1].trim().toUpperCase() : 'General';
      optimisticStartedAt = existingTask?.upworkStartedAt || new Date().toISOString();
      const rawUser = currentUser?.name || existingTask?.assignee?.name || (currentUser?.email ? currentUser.email.split('@')[0] : '') || 'User';
      const cleanUser = rawUser.includes('@') ? rawUser.split('@')[0] : rawUser;
      const userName = (pmName && pmName !== 'General' && pmName !== 'Active') ? pmName : cleanUser.toUpperCase();
      optimisticSession = {
        taskId,
        taskTitle: existingTask?.title || 'Task',
        userId: currentUser?.id || '',
        userName,
        pmName,
        startedAt: optimisticStartedAt,
      };
    }

    // 1. Update Frontend First on both tasks and availablePool immediately
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              upworkStartedAt: optimisticStartedAt,
              upworkSession: optimisticSession,
              taskMap: { ...t.taskMap, statuses: newStatuses },
            }
          : t
      )
    );

    setAvailablePool((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              upworkStartedAt: optimisticStartedAt,
              upworkSession: optimisticSession,
              taskMap: { ...t.taskMap, statuses: newStatuses },
            }
          : t
      )
    );

    // 2. Optimistically update activeUpworkSessions for instant Header Banner change
    if (optimisticSession) {
      setActiveUpworkSessions((prev) => {
        const withoutThis = prev.filter((s) => s.taskId !== taskId);
        return [...withoutThis, optimisticSession!];
      });
    } else {
      setActiveUpworkSessions((prev) => prev.filter((s) => s.taskId !== taskId));
    }

    // 3. Send update to server
    try {
      const res = await taskMapApi.updateTaskStatuses(taskId, newStatuses);
      if (res.activeUpworkSessions) {
        setActiveUpworkSessions(res.activeUpworkSessions);
      }
      if (res.upworkStartedAt !== undefined) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, upworkStartedAt: res.upworkStartedAt, upworkSession: res.upworkSession }
              : t
          )
        );
        setAvailablePool((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, upworkStartedAt: res.upworkStartedAt, upworkSession: res.upworkSession }
              : t
          )
        );
      }
      toast.success('Statuses updated');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update statuses');
      loadData(true);
    }
  };

  if (loading && tasks.length === 0 && availablePool.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 h-full bg-[#0a0a0c] text-zinc-400">
        <Loader2 className="size-8 animate-spin text-[#0099ff] mb-3" />
        <p className="text-sm font-medium">Loading Task Map Journal...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-[#0a0a0c] overflow-hidden select-none">
      {/* 1. Left: Dedicated Date Sidebar (Matches Image 1) */}
      <TaskMapSidebar
        currentDate={currentDate}
        onSelectDate={(newDate) => {
          setCurrentDate(newDate);
        }}
      />

      {/* 2. Right: Main Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#0a0a0c]">
        {/* Top Header Bar: Date, Day, Shift Pills [Day] [Noon] [Night], Search */}
        <TaskMapHeader
          currentDate={currentDate}
          currentShift={currentShift}
          onShiftChange={setCurrentShift}
          shifts={shifts}
          search={search}
          onSearchChange={setSearch}
          activeUpworkSessions={activeUpworkSessions}
        />

        {/* Board Viewport: Available Tasks Pool + User Shift Columns */}
        <div className="flex-1 overflow-hidden">
          <TaskMapBoardView
            tasks={tasks}
            availablePool={availablePool}
            options={options}
            allUsers={allUsers}
            shiftUsers={shiftUsers}
            currentShift={currentShift}
            onStatusChange={handleStatusChange}
            onOptionsUpdated={() => loadData(true)}
            onOpenDetail={setSelectedTaskModal}
            onDataRefresh={() => loadData(true)}
          />
        </div>
      </main>

      {/* Task Detail Modal */}
      {selectedTaskModal && (
        <TaskDetailModal
          isOpen={!!selectedTaskModal}
          onClose={() => setSelectedTaskModal(null)}
          task={selectedTaskModal}
          mode="full"
          onUpdateTask={() => loadData(true)}
        />
      )}
    </div>
  );
};
