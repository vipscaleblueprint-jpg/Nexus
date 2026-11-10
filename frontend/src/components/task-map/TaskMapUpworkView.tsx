import React, { useState, useEffect } from 'react';
import { TaskMapItem, UpworkSession } from '@/api/taskMap';
import { Clock, Play, Square, AlertCircle, CheckCircle2, User, Search, ExternalLink } from 'lucide-react';
import { toast } from '@/lib/toast';

interface Props {
  tasks: TaskMapItem[];
  availablePool: TaskMapItem[];
  activeUpworkSessions: UpworkSession[];
  allUsers?: any[];
  onStatusChange: (taskId: string, newStatuses: string[]) => void;
  onOpenDetail: (task: TaskMapItem) => void;
  onRefresh: () => void;
}

function formatManilaTime(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return '';
  try {
    const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
}

function parseManilaTimeInToMs(timeIn?: string | null, dateStr?: string | null): number | null {
  if (!timeIn || typeof timeIn !== 'string') return null;
  const cleanTime = timeIn.trim();
  const ampmMatch = cleanTime.match(/(\d{1,2}):(\d{1,2})(?::\d{2})?\s*(am|pm)/i);
  const hourAmPmMatch = !ampmMatch ? cleanTime.match(/^(\d{1,2})\s*(am|pm)$/i) : null;
  if (!ampmMatch && !hourAmPmMatch) return null;

  let hours = parseInt(ampmMatch ? ampmMatch[1] : hourAmPmMatch![1], 10);
  const mins = ampmMatch ? parseInt(ampmMatch[2], 10) : 0;
  const ampm = (ampmMatch ? ampmMatch[3] : hourAmPmMatch![2]).toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  let datePart = dateStr ? dateStr.trim().split('T')[0] : '';
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const nowManila = new Date(Date.now() + 8 * 3600 * 1000);
    datePart = nowManila.toISOString().split('T')[0];
  }

  const iso = `${datePart}T${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00+08:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function resolveSessionStartMs(session: any): number {
  if (session?.timeIn) {
    const fromTimeIn = parseManilaTimeInToMs(session.timeIn, session.date);
    if (fromTimeIn) return fromTimeIn;
  }
  if (session?.startedAt) {
    const ms = new Date(session.startedAt).getTime();
    if (!isNaN(ms)) return ms;
  }
  return NaN;
}

function formatElapsed(sessionOrStartedAt: any, now: Date): string {
  const startMs = typeof sessionOrStartedAt === 'string' || sessionOrStartedAt instanceof Date
    ? new Date(sessionOrStartedAt).getTime()
    : resolveSessionStartMs(sessionOrStartedAt);

  if (isNaN(startMs)) return '0h 00m 00s';
  const diffMs = Math.max(0, now.getTime() - startMs);
  const totalSecs = Math.floor(diffMs / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

export const TaskMapUpworkView: React.FC<Props> = ({
  tasks = [],
  availablePool = [],
  activeUpworkSessions = [],
  onStatusChange,
  onOpenDetail,
}) => {
  const [now, setNow] = useState<Date>(new Date());
  const [search, setSearch] = useState('');

  // 1-second live clock for Upwork durations
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Collect all unique tasks across board and available pool
  const allTasksMap = new Map<string, TaskMapItem>();
  tasks.forEach((t) => allTasksMap.set(t.id, t));
  availablePool.forEach((t) => allTasksMap.set(t.id, t));
  const combinedTasks = Array.from(allTasksMap.values());

  // Tasks that currently have an Upwork status or have past Upwork review logs
  const upworkTasks = combinedTasks.filter((t) => {
    const statuses = t.taskMap?.statuses || [];
    const hasActiveUpwork = statuses.some((s) => s.toUpperCase().startsWith('UPWORK'));
    const pmReviews = t.taskMap?.pmReviews;
    let hasUpworkHistory = false;
    if (Array.isArray(pmReviews)) {
      hasUpworkHistory = pmReviews.some((r: any) => r.type === 'UPWORK_SESSION');
    }
    return hasActiveUpwork || hasUpworkHistory;
  });

  const filteredUpworkTasks = upworkTasks.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const titleMatch = t.title.toLowerCase().includes(q);
    const clientMatch = (t.list?.name || '').toLowerCase().includes(q);
    const userMatch = (t.assignee?.name || '').toLowerCase().includes(q);
    return titleMatch || clientMatch || userMatch;
  });

  const handleStopUpwork = (task: TaskMapItem) => {
    const current = task.taskMap?.statuses || [];
    const next = current.filter((s) => !s.toUpperCase().startsWith('UPWORK'));
    onStatusChange(task.id, next);
    toast.success(`Stopped Upwork for "${task.title}"`);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scrollbar px-6 pb-8 select-none">
      {/* Top Section: Hero Status Banner & Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Main Contract Status Card */}
        <div className={`p-4 rounded-2xl border transition-all ${
          activeUpworkSessions.length > 0
            ? 'bg-red-950/40 border-red-800/80 text-red-200 shadow-lg shadow-red-950/20'
            : 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Contract Status
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
              activeUpworkSessions.length > 0
                ? 'bg-red-900/80 border-red-700/80 text-red-100 animate-pulse'
                : 'bg-emerald-900/60 border-emerald-700/60 text-emerald-100'
            }`}>
              {activeUpworkSessions.length > 0 ? 'In Use' : 'Available'}
            </span>
          </div>

          <div className="text-xl sm:text-2xl font-black tracking-tight mb-1">
            {activeUpworkSessions.length > 0 ? (
              <span className="text-red-400">
                {activeUpworkSessions.length} Active {activeUpworkSessions.length === 1 ? 'Contract' : 'Contracts'}
              </span>
            ) : (
              <span className="text-emerald-400">Ready For Tracking</span>
            )}
          </div>

          <p className="text-xs text-zinc-400">
            {activeUpworkSessions.length > 0
              ? 'Members are currently logging time under Upwork.'
              : 'No active Upwork timers currently running.'}
          </p>
        </div>

        {/* Active Members on Upwork */}
        <div className="p-4 rounded-2xl border border-zinc-800/80 bg-card text-zinc-200 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Active Team Members
            </span>
            <User className="size-4 text-indigo-400" />
          </div>

          <div className="text-2xl font-black text-zinc-100 mb-1">
            {activeUpworkSessions.length}
          </div>

          <div className="text-xs text-zinc-400 truncate">
            {activeUpworkSessions.length > 0
              ? activeUpworkSessions.map((s) => s.userName || s.pmName || 'User').join(', ')
              : 'All members available for new contracts'}
          </div>
        </div>

        {/* Upwork Tracked Tasks Total */}
        <div className="p-4 rounded-2xl border border-zinc-800/80 bg-card text-zinc-200 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Tracked Tasks Total
            </span>
            <Clock className="size-4 text-amber-400" />
          </div>

          <div className="text-2xl font-black text-zinc-100 mb-1">
            {upworkTasks.length}
          </div>

          <div className="text-xs text-zinc-400">
            Tasks with active or recorded Upwork sessions
          </div>
        </div>
      </div>

      {/* Active Live Sessions Section */}
      {activeUpworkSessions.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="size-2 rounded-full bg-red-500 animate-ping" />
            <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
              Live Active Upwork Sessions
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeUpworkSessions.map((session) => {
              const taskObj = combinedTasks.find((t) => t.id === session.taskId);
              const elapsed = formatElapsed(session, now);
              const startedManila = session.timeIn || formatManilaTime(session.startedAt);

              return (
                <div
                  key={session.taskId}
                  className="p-4 rounded-xl bg-card border border-red-800/70 shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
                      <span className="font-bold text-red-400 uppercase tracking-wide">
                        {session.userName || session.pmName || 'Active User'}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-400">
                        Since {startedManila} (Manila)
                      </span>
                    </div>

                    <h4
                      onClick={() => taskObj && onOpenDetail(taskObj)}
                      className="text-sm font-bold text-white group-hover:text-blue-400 cursor-pointer transition-colors line-clamp-2 leading-snug"
                    >
                      {session.taskTitle}
                    </h4>

                    {taskObj?.list?.name && (
                      <span className="text-[11px] text-zinc-500 font-medium block mt-1">
                        Client: {taskObj.list.name}
                      </span>
                    )}
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-red-300">
                      <Clock className="size-3.5 text-red-400" />
                      <span>{elapsed}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {taskObj && (
                        <button
                          type="button"
                          onClick={() => onOpenDetail(taskObj)}
                          className="px-2 py-1 rounded text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors flex items-center gap-1"
                        >
                          <ExternalLink className="size-3" />
                          <span>View</span>
                        </button>
                      )}
                      {taskObj && (
                        <button
                          type="button"
                          onClick={() => handleStopUpwork(taskObj)}
                          className="px-2.5 py-1 rounded text-xs font-bold bg-red-600/90 hover:bg-red-500 text-white transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Square className="size-3 fill-current" />
                          <span>Stop</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upwork Tasks List */}
      <div className="bg-card border border-zinc-800/80 rounded-2xl p-4 shadow-xl flex-1 flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800 mb-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">Upwork Contract Tasks</h3>
            <p className="text-xs text-zinc-400">All tasks tracked or previously logged with Upwork contracts.</p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="size-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter tasks..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
            />
          </div>
        </div>

        {filteredUpworkTasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-zinc-500">
            <Clock className="size-8 text-zinc-600 mb-2" />
            <p className="text-sm font-medium">No tasks found with Upwork tracking.</p>
            <p className="text-xs text-zinc-600 mt-1">Assign an "UPWORK | &lt;NAME&gt;" status from any task to begin tracking.</p>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead>
                <tr className="border-b border-zinc-800 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Task Title</th>
                  <th className="py-2.5 px-3">Client</th>
                  <th className="py-2.5 px-3">Assignee</th>
                  <th className="py-2.5 px-3">Upwork Status</th>
                  <th className="py-2.5 px-3">Started At (Manila)</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredUpworkTasks.map((t) => {
                  const upworkTag = (t.taskMap?.statuses || []).find((s) => s.toUpperCase().startsWith('UPWORK'));
                  const isActive = Boolean(upworkTag);
                  const startedManila = formatManilaTime(t.upworkStartedAt);

                  return (
                    <tr key={t.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="py-3 px-3">
                        <span
                          onClick={() => onOpenDetail(t)}
                          className="font-bold text-zinc-100 hover:text-blue-400 cursor-pointer transition-colors line-clamp-1 max-w-xs"
                          title={t.title}
                        >
                          {t.title}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-zinc-400">
                        {t.list?.name || 'General'}
                      </td>

                      <td className="py-3 px-3">
                        {t.assignee?.name || 'Unassigned'}
                      </td>

                      <td className="py-3 px-3">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-300 border border-red-800">
                            <span className="size-1.5 rounded-full bg-red-400 animate-pulse" />
                            <span>{upworkTag}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-zinc-500">
                            Past Session
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-mono text-[11px] text-zinc-400">
                        {startedManila || '—'}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenDetail(t)}
                            className="px-2 py-1 rounded text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                          >
                            Details
                          </button>

                          {isActive && (
                            <button
                              type="button"
                              onClick={() => handleStopUpwork(t)}
                              className="px-2 py-1 rounded text-[11px] font-bold bg-red-600/90 hover:bg-red-500 text-white transition-colors"
                            >
                              Stop
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
