import React, { useEffect, useState } from 'react';
import { taskMapApi, TaskMapItem, TaskMapRecord } from '@/api/taskMap';
import { X, Clock, User, CheckCircle2, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';

interface Props {
  task: TaskMapItem | null;
  onClose: () => void;
}

export const TaskMapTimelineDrawer: React.FC<Props> = ({ task, onClose }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [taskMap, setTaskMap] = useState<TaskMapRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!task) return;
    setLoading(true);
    taskMapApi
      .getTimeline(task.id)
      .then((res) => {
        if (res.success) {
          setLogs(res.logs || []);
          setTaskMap(res.taskMap || null);
        }
      })
      .catch((err) => console.error('Failed to load timeline:', err))
      .finally(() => setLoading(false));
  }, [task]);

  if (!task) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col text-zinc-200 animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
        <div className="min-w-0 pr-2">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Task Timeline</span>
          <h2 className="text-sm font-bold text-zinc-100 truncate mt-0.5">{task.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Task Meta Snapshot */}
      <div className="p-4 bg-zinc-800/20 border-b border-zinc-800/60 text-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Current Shift:</span>
          <span className="font-semibold text-zinc-200 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700/60">
            {taskMap?.shift || task.taskMap.shift || 'DAY'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Rollover Count:</span>
          <span
            className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
              (taskMap?.rolloverCount || 0) >= 3
                ? 'bg-red-950/60 text-red-300 border border-red-800/60'
                : 'bg-zinc-800 text-zinc-300'
            }`}
          >
            {taskMap?.rolloverCount || 0} times
          </span>
        </div>
        {taskMap?.originShift && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Origin Shift:</span>
            <span className="text-zinc-300">
              {taskMap.originShift} ({taskMap.originDate ? format(new Date(taskMap.originDate), 'MMM d, yyyy') : 'Initial'})
            </span>
          </div>
        )}
      </div>

      {/* Timeline Stream */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-zinc-500 text-xs gap-2">
            <RefreshCw className="size-4 animate-spin text-blue-500" />
            <span>Loading timeline...</span>
          </div>
        ) : logs.length === 0 ? (
          <p className="text-center text-xs text-zinc-500 py-8 italic">No timeline events recorded yet.</p>
        ) : (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-zinc-800">
            {logs.map((log) => {
              const dt = new Date(log.createdAt);
              const formattedDate = format(dt, 'MMM d, h:mm a');
              let icon = <Clock className="size-3 text-zinc-400" />;
              let title = log.action;
              let description: React.ReactNode = null;

              if (log.action === 'TASK_MAP_STATUS_CHANGE') {
                title = 'Statuses Updated';
                const oldS = log.details?.oldStatuses || [];
                const newS = log.details?.newStatuses || [];
                description = (
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    <span className="text-zinc-500">{oldS.join(', ') || 'None'}</span>
                    <ArrowRight className="size-3 text-zinc-600" />
                    <span className="text-blue-400 font-medium">{newS.join(', ') || 'None'}</span>
                  </div>
                );
              } else if (log.action === 'PM_REVIEW_APPROVE') {
                icon = <CheckCircle2 className="size-3 text-emerald-400" />;
                title = `PM Approved by ${log.details?.approvedBy || 'PM'}`;
                description = log.details?.allApproved ? 'All PM approvals complete -> Moved to "To send"' : undefined;
              } else if (log.action === 'PM_REVIEW_REVISION') {
                icon = <AlertCircle className="size-3 text-purple-400" />;
                title = `Revision Requested by ${log.details?.requestedBy || 'PM'}`;
                description = <p className="italic text-zinc-300 mt-1">"{log.details?.comment}"</p>;
              } else if (log.action === 'TASK_MAP_ROLLOVER') {
                icon = <RefreshCw className="size-3 text-amber-400" />;
                title = `Rolled over to ${log.details?.toShift || 'next shift'}`;
                description = `Total rollovers: ${log.details?.rolloverCount || 1}`;
              } else if (log.action === 'TASK_MAP_CLAIM') {
                icon = <User className="size-3 text-sky-400" />;
                title = `Task claimed by ${log.details?.claimedBy || 'User'}`;
              }

              return (
                <div key={log.id} className="relative group">
                  {/* Dot icon */}
                  <div className="absolute -left-6 top-0.5 size-4 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                    {icon}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
                    <span>{log.user?.name || log.details?.actor || 'System'}</span>
                    <span>{formattedDate}</span>
                  </div>
                  <div className="text-xs font-semibold text-zinc-200">{title}</div>
                  {description && <div className="text-xs text-zinc-400 mt-0.5">{description}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
