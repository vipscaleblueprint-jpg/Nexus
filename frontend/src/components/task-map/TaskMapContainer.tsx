'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  taskMapApi,
  TaskMapItem,
  TaskMapOption,
  TaskMapShift,
} from '@/api/taskMap';
import { TaskMapSidebar } from './TaskMapSidebar';
import { TaskMapHeader } from './TaskMapHeader';
import { TaskMapBoardView } from './TaskMapBoardView';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';

export const TaskMapContainer: React.FC = () => {
  const [tasks, setTasks] = useState<TaskMapItem[]>([]);
  const [availablePool, setAvailablePool] = useState<TaskMapItem[]>([]);
  const [options, setOptions] = useState<TaskMapOption[]>([]);
  const [shifts, setShifts] = useState<TaskMapShift[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [shiftUsers, setShiftUsers] = useState<any[]>([]);

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

    window.addEventListener('task:updated', handleTaskUpdated);
    window.addEventListener('task_map:updated', handleTaskUpdated);
    window.addEventListener('task_activity', handleTaskUpdated);

    return () => {
      window.removeEventListener('task:updated', handleTaskUpdated);
      window.removeEventListener('task_map:updated', handleTaskUpdated);
      window.removeEventListener('task_activity', handleTaskUpdated);
    };
  }, [loadData]);

  // Status Change Handler
  const handleStatusChange = async (taskId: string, newStatuses: string[]) => {
    // Optimistic local update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, taskMap: { ...t.taskMap, statuses: newStatuses } }
          : t
      )
    );

    try {
      await taskMapApi.updateTaskStatuses(taskId, newStatuses);
      toast.success('Statuses updated');
    } catch (err: any) {
      toast.error('Failed to update statuses');
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
