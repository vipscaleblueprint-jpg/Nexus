import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pin, Search, X, Clock, Flag } from 'lucide-react';
import { TaskMapItem } from '@/api/taskMap';
import { useLiveClock } from '@/lib/liveClock';
import { getAssigneeAvatarColor } from '@/lib/taskTokens';
import { getPriorityConfig } from '@/lib/priority';
import {
  TaskTimeProgressSlot,
  getSessionDiffMs,
  MAX_LIVE_SHIFT_MS,
} from './TaskMapCardControls';

const MIN_INSTRUCTION_LIVE_MS = 20 * 60 * 1000;

export interface InstructionLiveColumnProps {
  sortedUserColumns: Array<[string, { user: any; tasks: TaskMapItem[] }]>;
  isCollapsed: boolean;
  isPinned: boolean;
  onToggleCollapse: () => void;
  onTogglePin: () => void;
  onOpenDetail: (task: TaskMapItem) => void;
  isTaskLiveWorking: (task: TaskMapItem, userName?: string, now?: Date) => boolean;
  upworkClients: string[];
  upworkProjectClients: string[];
}

interface InstructionLiveEntry {
  userId: string;
  user: any;
  task: TaskMapItem;
  diffMs: number;
  clientName: string;
  isUpwork: boolean;
}

export const InstructionLiveColumn: React.FC<InstructionLiveColumnProps> = ({
  sortedUserColumns,
  isCollapsed,
  isPinned,
  onToggleCollapse,
  onTogglePin,
  onOpenDetail,
  isTaskLiveWorking,
  upworkClients,
  upworkProjectClients,
}) => {
  const liveNow = useLiveClock(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const liveEntries = useMemo<InstructionLiveEntry[]>(() => {
    const entries: InstructionLiveEntry[] = [];
    const seen = new Set<string>();

    for (const [userId, { user, tasks }] of sortedUserColumns) {
      for (const task of tasks) {
        if (!isTaskLiveWorking(task, user?.name, liveNow)) continue;

        const diffMs = getSessionDiffMs(task.progress?.timeIn, task.progress?.date, liveNow);
        if (diffMs == null || diffMs < MIN_INSTRUCTION_LIVE_MS || diffMs > MAX_LIVE_SHIFT_MS) {
          continue;
        }

        const dedupeKey = `${userId}:${task.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const clientName = task.progress?.client || task.list?.name || '';
        const isClientConfiguredUpwork = upworkClients.some(
          (c) => c.toLowerCase() === clientName.toLowerCase()
        );
        const hasManualUpworkTag = (task.taskMap?.statuses || []).some((s) =>
          s.toLowerCase().startsWith('upwork')
        );
        const isLauren = clientName.toLowerCase().includes('lauren');
        const isProjectBased = upworkProjectClients.some(
          (c) => c.toLowerCase() === clientName.toLowerCase()
        );
        const isUpwork =
          isLauren && !hasManualUpworkTag && !isClientConfiguredUpwork && !isProjectBased
            ? false
            : Boolean(
                isClientConfiguredUpwork ||
                  task.progress?.isUpwork ||
                  task.progress?.timeTracker?.toLowerCase().includes('upwork') ||
                  task.list?.name?.toLowerCase().includes('upwork') ||
                  hasManualUpworkTag
              );

        entries.push({
          userId,
          user,
          task,
          diffMs,
          clientName: clientName || 'No client inputted',
          isUpwork,
        });
      }
    }

    entries.sort((a, b) => b.diffMs - a.diffMs);
    return entries;
  }, [sortedUserColumns, isTaskLiveWorking, liveNow, upworkClients, upworkProjectClients]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return liveEntries;
    return liveEntries.filter((entry) => {
      const userName = (entry.user?.name || '').toLowerCase();
      const title = (entry.task.title || '').toLowerCase();
      const client = entry.clientName.toLowerCase();
      return userName.includes(q) || title.includes(q) || client.includes(q);
    });
  }, [liveEntries, searchQuery]);

  if (isCollapsed) {
    return (
      <div
        className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-emerald-500/50 ${
          isPinned ? 'ring-1 ring-emerald-500/40 border-emerald-500/30 shadow-2xl backdrop-blur-md bg-card/95' : ''
        }`}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
          title="Expand Instruction Live"
        >
          <ChevronRight className="size-4 text-emerald-400" />
        </button>
        {isPinned && (
          <Pin className="size-3 text-emerald-400 fill-emerald-400/40 rotate-45 mb-2" />
        )}
        <span className="size-2.5 rounded-full bg-emerald-400 animate-pulse mb-2 shrink-0" />
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mb-4">
          {liveEntries.length}
        </span>
        <span
          onClick={onToggleCollapse}
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
          className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
        >
          Instruction Live
        </span>
      </div>
    );
  }

  return (
    <div
      className={`w-[360px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${
        isPinned ? 'ring-1 ring-emerald-500/40 border-emerald-500/30 shadow-2xl backdrop-blur-md bg-card/95' : ''
      }`}
    >
      {/* Header Top Row */}
      <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2 h-7">
          <span className="size-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <h3 className="text-sm font-bold text-zinc-100 truncate">Instruction Live</h3>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
            {liveEntries.length}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 h-7">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
            title="Collapse column"
          >
            <ChevronLeft className="size-3.5" />
          </button>

          <button
            type="button"
            onClick={onTogglePin}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              isPinned
                ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
            title={isPinned ? 'Unpin column' : 'Pin column'}
          >
            <Pin className={`size-3.5 rotate-45 ${isPinned ? 'fill-emerald-400/40' : ''}`} />
          </button>

          {isSearchOpen ? (
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-md px-1.5 py-0.5">
              <Search className="size-3 text-zinc-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter..."
                autoFocus
                className="w-20 bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchOpen(false);
                }}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                title="Close search"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className={`p-1 rounded-md transition-colors cursor-pointer ${
                searchQuery
                  ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
              title={searchQuery ? `Filtering "${searchQuery}"` : 'Search live tasks'}
            >
              <Search className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Live Progress Cards */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2.5 pr-1">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
            <Clock className="size-5 text-zinc-600 mb-2" />
            <p className="text-xs font-medium text-zinc-400">
              {searchQuery
                ? 'No matching live tasks (20m+).'
                : 'No live progress 20 mins and above.'}
            </p>
          </div>
        ) : (
          filteredEntries.map(({ userId, user, task, clientName, isUpwork }) => {
            const initials = (user?.name || 'U').substring(0, 2).toUpperCase();
            const avatarBg = getAssigneeAvatarColor(user?.name || 'U');
            const priorityConfig = getPriorityConfig(task.priority);
            const realTaskId =
              task.linkedTaskId && !task.linkedTaskId.startsWith('general-slot-')
                ? task.linkedTaskId
                : !task.isAssumptionBlock
                  ? task.id
                  : null;
            const isClickable = Boolean(realTaskId);

            return (
              <div
                key={`${userId}-${task.id}`}
                onClick={() => {
                  if (!isClickable || !realTaskId) return;
                  onOpenDetail({
                    ...task,
                    id: realTaskId,
                    isAssumptionBlock: false,
                  });
                }}
                className={`group rounded-xl border border-emerald-500/30 bg-zinc-900/75 p-3 shadow-sm transition-colors ${
                  isClickable ? 'cursor-pointer hover:border-emerald-400/60 hover:bg-zinc-900' : ''
                }`}
              >
                {/* Person + Live Timer */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {user?.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.name}
                        className="size-6 rounded-full object-cover border border-zinc-700 shrink-0"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div
                        className={`size-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${avatarBg}`}
                      >
                        {initials}
                      </div>
                    )}
                    <span className="text-xs font-semibold text-zinc-100 truncate">
                      {user?.name || task.progress?.maName || 'Unknown'}
                    </span>
                  </div>

                  <div className="shrink-0">
                    <TaskTimeProgressSlot task={task} now={liveNow} isLive={true} />
                  </div>
                </div>

                {/* Client */}
                <div className="flex items-center gap-1.5 text-[11px] mb-1">
                  <span className="text-zinc-400 truncate">{clientName}</span>
                  {isUpwork && (
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/10 text-white border border-white/20 shrink-0">
                      Upwork
                    </span>
                  )}
                </div>

                {/* Task Title */}
                <h4
                  className="text-[13px] font-bold text-zinc-100 group-hover:text-white line-clamp-2 leading-snug"
                  title={task.title}
                >
                  {task.isSubtask ? (task.title || '').replace(/^--\s*/, '') : task.title}
                </h4>

                {/* Priority & Status */}
                {(task.priority || task.status) && (
                  <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-zinc-800/70 text-[10px]">
                    {task.priority && (
                      <span className={`inline-flex items-center gap-1 font-medium ${priorityConfig.color}`}>
                        <Flag className="size-3 shrink-0" />
                        {priorityConfig.label}
                      </span>
                    )}
                    {task.status && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium uppercase tracking-wide ml-auto">
                        {task.status}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
