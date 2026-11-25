import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Pin,
  Search,
  X,
  Clock,
  CheckCircle2,
  Eye,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { TaskMapItem, SuperviseCheckItem } from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';
import { useLiveClock } from '@/lib/liveClock';
import { getAssigneeAvatarColor, isClosedStatus } from '@/lib/taskTokens';
import { toast } from '@/lib/toast';
import {
  TaskTimeProgressSlot,
  CardStatusDropdown,
  CardPriorityDropdown,
  getSessionDiffMs,
  MAX_LIVE_SHIFT_MS,
} from './TaskMapCardControls';
import { TaskDescriptionButton } from './TaskDescriptionButton';

const MIN_SUPERVISE_LIVE_MS = 20 * 60 * 1000;
const SUPERVISE_TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SUPERVISE_THREE_HOURS_MS = 3 * 60 * 60 * 1000;

function getNextSuperviseMilestoneMs(elapsedMs: number): number {
  if (elapsedMs < SUPERVISE_TWO_HOURS_MS) {
    return SUPERVISE_TWO_HOURS_MS;
  }
  const stepsAfterTwoHours = Math.floor((elapsedMs - SUPERVISE_TWO_HOURS_MS) / SUPERVISE_THREE_HOURS_MS) + 1;
  return SUPERVISE_TWO_HOURS_MS + stepsAfterTwoHours * SUPERVISE_THREE_HOURS_MS;
}

function formatMilestoneHours(ms: number): string {
  const hours = Math.round(ms / (60 * 60 * 1000));
  return `${hours}h`;
}

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
  currentDate?: string;
  superviseChecks?: SuperviseCheckItem[];
  onSuperviseCheck?: (payload: {
    maName: string;
    dateKey?: string;
    timeIn: string;
    taskId?: string | null;
    taskTitle?: string | null;
    client?: string | null;
    note?: string | null;
  }) => Promise<void> | void;
  onSuperviseUncheck?: (sessionKey: string) => Promise<void> | void;
  onTaskUpdate?: (taskId: string, fields: Partial<TaskMapItem>) => Promise<void> | void;
  onDataRefresh?: () => void;
  onOpenDeliverables?: (
    task: TaskMapItem,
    targetStatus: 'To Review' | 'Hand-over',
    user: any,
    realTaskId: string
  ) => void;
}

interface SuperviseEntry {
  userId: string;
  user: any;
  task: TaskMapItem;
  diffMs: number;
  clientName: string;
  isUpwork: boolean;
  realTaskId: string | null;
  sessionKey: string;
  maName: string;
  timeIn: string;
  activeCheck: SuperviseCheckItem | null;
}

function formatElapsedShort(diffMs: number): string {
  const totalMins = Math.max(0, Math.floor(diffMs / 60000));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatRemainingMins(reappearAt: string, nowMs: number): string {
  const diffMs = Math.max(0, new Date(reappearAt).getTime() - nowMs);
  const totalMins = Math.max(1, Math.ceil(diffMs / 60000));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${totalMins}m`;
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
  currentDate,
  superviseChecks = [],
  onSuperviseCheck,
  onSuperviseUncheck,
  onTaskUpdate,
  onDataRefresh,
  onOpenDeliverables,
}) => {
  const liveNow = useLiveClock(true);
  const nowMs = liveNow.getTime();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showChecked, setShowChecked] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<SuperviseEntry | null>(null);
  const [checkNote, setCheckNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checksByKey = useMemo(() => {
    const map = new Map<string, SuperviseCheckItem>();
    for (const c of superviseChecks) {
      if (!c?.sessionKey) continue;
      if (new Date(c.reappearAt).getTime() > nowMs) {
        map.set(c.sessionKey, c);
      }
    }
    return map;
  }, [superviseChecks, nowMs]);

  const effectiveDateKey = useMemo(() => {
    if (currentDate) return currentDate.split('T')[0];
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(liveNow);
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }, [currentDate, liveNow]);

  const liveEntries = useMemo<SuperviseEntry[]>(() => {
    const entries: SuperviseEntry[] = [];
    const seen = new Set<string>();

    for (const [userId, { user, tasks }] of sortedUserColumns) {
      for (const task of tasks) {
        if (!isTaskLiveWorking(task, user?.name, liveNow)) continue;

        const diffMs = getSessionDiffMs(task.progress?.timeIn, task.progress?.date, liveNow);
        if (diffMs == null || diffMs < MIN_SUPERVISE_LIVE_MS || diffMs > MAX_LIVE_SHIFT_MS) {
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

        const realTaskId =
          task.linkedTaskId && !task.linkedTaskId.startsWith('general-slot-')
            ? task.linkedTaskId
            : !task.isAssumptionBlock
              ? task.id
              : null;

        const maName = (user?.name || task.progress?.maName || 'Unknown').trim();
        const timeIn = (task.progress?.timeIn || '').trim();
        const sessionKey = `${effectiveDateKey}::${maName.toLowerCase()}::${timeIn}::${realTaskId || 'none'}`;
        const activeCheck = checksByKey.get(sessionKey) || null;

        entries.push({
          userId,
          user,
          task,
          diffMs,
          clientName: clientName || 'No client inputted',
          isUpwork,
          realTaskId,
          sessionKey,
          maName,
          timeIn,
          activeCheck,
        });
      }
    }

    entries.sort((a, b) => b.diffMs - a.diffMs);
    return entries;
  }, [
    sortedUserColumns,
    isTaskLiveWorking,
    liveNow,
    upworkClients,
    upworkProjectClients,
    effectiveDateKey,
    checksByKey,
  ]);

  const { uncheckedEntries, checkedEntries } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (entry: SuperviseEntry) => {
      if (!q) return true;
      const userName = (entry.user?.name || '').toLowerCase();
      const title = (entry.task.title || '').toLowerCase();
      const client = entry.clientName.toLowerCase();
      return userName.includes(q) || title.includes(q) || client.includes(q);
    };

    const unchecked: SuperviseEntry[] = [];
    const checked: SuperviseEntry[] = [];
    for (const entry of liveEntries) {
      if (!matches(entry)) continue;
      if (entry.activeCheck) {
        checked.push(entry);
      } else {
        unchecked.push(entry);
      }
    }
    return { uncheckedEntries: unchecked, checkedEntries: checked };
  }, [liveEntries, searchQuery]);

  const handleConfirmCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmTarget || !onSuperviseCheck || isSubmitting) return;
    try {
      setIsSubmitting(true);
      await onSuperviseCheck({
        maName: confirmTarget.maName,
        dateKey: effectiveDateKey,
        timeIn: confirmTarget.timeIn,
        taskId: confirmTarget.realTaskId,
        taskTitle: confirmTarget.task.isSubtask
          ? (confirmTarget.task.title || '').replace(/^--\s*/, '')
          : confirmTarget.task.title,
        client: confirmTarget.clientName,
        note: checkNote.trim() || null,
      });
      const nextMilestoneLabel = formatMilestoneHours(getNextSuperviseMilestoneMs(confirmTarget.diffMs));
      toast.success(`Checked ${confirmTarget.maName} — will reappear at ${nextMilestoneLabel}`);
      setConfirmTarget(null);
      setCheckNote('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save supervise check');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUncheck = async (entry: SuperviseEntry) => {
    if (!onSuperviseUncheck) return;
    try {
      await onSuperviseUncheck(entry.sessionKey);
      toast.info(`Returned ${entry.maName} to Supervise`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to uncheck');
    }
  };

  if (isCollapsed) {
    return (
      <div
        className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-emerald-500/50 ${
          isPinned ? 'ring-1 ring-emerald-500/40 border-emerald-500/30 shadow-2xl backdrop-blur-md bg-card/95' : ''
        }`}
        onClick={onToggleCollapse}
        title="Expand Supervise"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
          title="Expand column"
        >
          <ChevronRight className="size-4 text-emerald-400" />
        </button>

        {isPinned && (
          <Pin className="size-3 text-emerald-400 fill-emerald-400/40 rotate-45 mb-2" />
        )}

        <span className="size-2.5 rounded-full bg-emerald-400 animate-pulse mb-2 shrink-0" />

        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mb-4">
          {uncheckedEntries.length}
        </span>

        <span
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
          className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
        >
          Supervise
        </span>
      </div>
    );
  }

  const renderCard = (entry: SuperviseEntry, isSnoozed: boolean) => {
    const { userId, user, task, clientName, isUpwork, realTaskId, activeCheck } = entry;
    const initials = (user?.name || 'U').substring(0, 2).toUpperCase();
    const avatarBg = getAssigneeAvatarColor(user?.name || 'U');
    const isClickable = Boolean(realTaskId);
    const realListId =
      task.list?.id && !String(task.list.id).startsWith('general-slot-')
        ? task.list.id
        : task.listId && !String(task.listId).startsWith('general-slot-')
          ? task.listId
          : null;

    const syncSessionPatch = (patch: Record<string, any>) => {
      if (!entry.maName) return;
      const sKey = entry.maName.trim().toLowerCase();
      const prevSess = useAppStore.getState().maActiveSessions[sKey] || {};
      useAppStore.getState().updateMaActiveSession(entry.maName, {
        ...prevSess,
        ...patch,
      });
    };

    return (
      <div
        key={`${userId}-${task.id}-${isSnoozed ? 'snoozed' : 'active'}`}
        onClick={(e) => {
          if (e.defaultPrevented || !isClickable || !realTaskId) return;
          onOpenDetail({
            ...task,
            id: realTaskId,
            isAssumptionBlock: false,
          });
        }}
        className={`group relative rounded-xl border p-3 shadow-md transition-all duration-200 ease-out ${
          isSnoozed
            ? 'border-zinc-800/80 bg-zinc-900/45 opacity-70 hover:opacity-95'
            : 'bg-zinc-900 not-has-[[data-card-control]:hover]:hover:bg-zinc-800/80 not-has-[[data-card-control]:hover]:hover:shadow-md'
        } ${isClickable ? 'cursor-pointer active:scale-[0.99]' : ''}`}
        style={!isSnoozed ? { borderColor: 'rgba(208, 74, 124, 0.35)' } : undefined}
      >
        {!isSnoozed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-[1px] rounded-xl border animate-border-glow-breathe"
            style={{
              borderColor: '#D04A7C',
              boxShadow: '0 0 0 2px rgba(208, 74, 124, 0.5), 0 0 20px rgba(208, 74, 124, 0.35)',
            }}
          />
        )}
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
              {entry.maName}
            </span>
          </div>

          <div className="shrink-0">
            <TaskTimeProgressSlot task={task} now={liveNow} isLive={true} />
          </div>
        </div>

        {/* Client */}
        <div className="flex items-center gap-1.5 text-[11px] mb-0.5">
          <span className="text-zinc-400 truncate">{clientName}</span>
          {isUpwork && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/10 text-white border border-white/20 shrink-0">
              Upwork
            </span>
          )}
        </div>

        {/* Task Title */}
        <h4
          className="text-[13px] font-bold text-zinc-100 group-hover:text-white line-clamp-2 leading-snug my-0.5"
          title={task.title}
        >
          {task.isSubtask ? (task.title || '').replace(/^--\s*/, '') : task.title}
        </h4>

        {/* Controls row: Status Circle, Description, Priority + Check */}
        <div
          className="flex items-center gap-2 text-xs text-zinc-500 pt-1.5 mt-1"
          data-card-control="true"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <CardStatusDropdown
            taskId={realTaskId || task.id}
            currentStatus={task.status || 'In progress'}
            listId={realListId || undefined}
            listStatuses={task.list?.statuses}
            onSelect={(newStatus: string) => {
              const normNew = newStatus.toLowerCase().replace(/[\s_-]+/g, '');
              if (
                onOpenDeliverables &&
                (normNew === 'toreview' || normNew === 'inreview' || normNew === 'handover')
              ) {
                onOpenDeliverables(
                  task,
                  normNew === 'handover' ? 'Hand-over' : 'To Review',
                  user,
                  realTaskId || task.id
                );
                return;
              }
              const isClosing = isClosedStatus(newStatus);
              if (task.isAssumptionBlock) {
                task.status = newStatus;
                if (isClosing) {
                  useAppStore.getState().updateMaActiveSession(entry.maName, null);
                } else {
                  syncSessionPatch({ taskStatus: newStatus, status: newStatus });
                }
                if (!realTaskId) {
                  toast.success(`Status updated to ${newStatus}`);
                  return;
                }
              }
              const targetId = realTaskId || task.id;
              const payload: Partial<TaskMapItem> = isClosing
                ? { status: newStatus, assigneeId: null }
                : { status: newStatus };
              if (onTaskUpdate) {
                onTaskUpdate(targetId, payload);
              } else {
                tasksApi
                  .updateTask(targetId, payload as any)
                  .then(() => onDataRefresh?.())
                  .catch((err: any) => toast.error(err?.message || 'Failed to update status'));
              }
            }}
          />

          <TaskDescriptionButton
            description={task.description}
            taskTitle={task.title}
            taskId={realTaskId}
            clientName={clientName !== 'No client inputted' ? clientName : null}
            lazyFetch={Boolean(task.isAssumptionBlock)}
          />

          <CardPriorityDropdown
            taskId={realTaskId || task.id}
            priority={task.priority || 'NORMAL'}
            onSelect={(newPriority: string) => {
              if (task.isAssumptionBlock) {
                task.priority = newPriority as any;
                syncSessionPatch({ priority: newPriority });
                if (!realTaskId) {
                  toast.success(`Priority updated to ${newPriority}`);
                  return;
                }
              }
              const targetId = realTaskId || task.id;
              if (onTaskUpdate) {
                onTaskUpdate(targetId, { priority: newPriority as any });
              } else {
                tasksApi
                  .updateTask(targetId, { priority: newPriority } as any)
                  .then(() => onDataRefresh?.())
                  .catch((err: any) => toast.error(err?.message || 'Failed to update priority'));
              }
            }}
          />

          <div className="ml-auto flex items-center gap-1">
            {isSnoozed && activeCheck ? (
              <>
                <span
                  className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60"
                  title={
                    activeCheck.note
                      ? `Checked by ${activeCheck.checkedByName || 'Supervisor'}: ${activeCheck.note}`
                      : `Checked by ${activeCheck.checkedByName || 'Supervisor'}`
                  }
                >
                  {formatRemainingMins(activeCheck.reappearAt, nowMs)}
                </span>
                {onSuperviseUncheck && (
                  <button
                    type="button"
                    onClick={() => void handleUncheck(entry)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors cursor-pointer"
                    title="Return to Supervise list now"
                  >
                    <RotateCcw className="size-2.5" />
                    <span>Undo</span>
                  </button>
                )}
              </>
            ) : (
              onSuperviseCheck && (
                <button
                  type="button"
                  onClick={() => {
                    setCheckNote('');
                    setConfirmTarget(entry);
                  }}
                  className="inline-flex items-center justify-center p-1.5 rounded-md bg-emerald-500/10 hover:bg-emerald-600 text-emerald-700 dark:text-emerald-300 hover:!text-white border border-emerald-500/30 hover:border-emerald-600 transition-colors cursor-pointer"
                  title="Mark as checked (hides until next check-in)"
                  aria-label="Mark as checked"
                >
                  <CheckCircle2 className="size-4" />
                </button>
              )
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div
        className={`w-[340px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${
          isPinned ? 'ring-1 ring-emerald-500/40 border-emerald-500/30 shadow-2xl backdrop-blur-md bg-card/95' : ''
        }`}
      >
        {/* Header Top Row */}
        <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2 h-7">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <h3 className="text-sm font-bold text-zinc-100 truncate">Supervise</h3>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
              {uncheckedEntries.length}
            </span>

            {checkedEntries.length > 0 && (
              <button
                type="button"
                onClick={() => setShowChecked((prev) => !prev)}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border transition-colors cursor-pointer shrink-0 ${
                  showChecked
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 border-zinc-700/60'
                }`}
                title={showChecked ? 'Hide checked cards' : 'Peek at checked cards'}
              >
                <Eye className="size-2.5" />
                <span>Checked ({checkedEntries.length})</span>
              </button>
            )}
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
              <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-0.5 max-w-[125px] text-xs">
                <Search className="size-3 text-zinc-400 shrink-0 mr-1" />
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsSearchOpen(false);
                    }
                  }}
                  placeholder="Search..."
                  className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setIsSearchOpen(false);
                  }}
                  className="text-zinc-400 hover:text-zinc-200 ml-0.5 p-0.5 cursor-pointer"
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
                    ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
                title={searchQuery ? `Searching "${searchQuery}"` : 'Search Supervise tasks'}
              >
                <Search className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Cards List */}
        <div
          data-column-body="true"
          className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 px-1 py-1 min-h-0"
        >
          {uncheckedEntries.length === 0 && (!showChecked || checkedEntries.length === 0) ? (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <Clock className="size-5 text-zinc-600 mb-2" />
              <p className="text-xs font-medium text-zinc-400">
                {searchQuery
                  ? 'No matching live tasks.'
                  : checkedEntries.length > 0
                    ? `All ${checkedEntries.length} live task(s) checked — waiting for next check-in.`
                    : 'No live progress 20 mins and above.'}
              </p>
            </div>
          ) : (
            <>
              {uncheckedEntries.map((entry) => renderCard(entry, false))}

              {showChecked && checkedEntries.length > 0 && (
                <div className="pt-2 mt-2 border-t border-zinc-800/80 space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Checked (Snoozed)
                    </span>
                  </div>
                  {checkedEntries.map((entry) => renderCard(entry, true))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirmation Modal (Portaled to cover Sidebar & Header) */}
      {confirmTarget && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => !isSubmitting && setConfirmTarget(null)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 shrink-0">
                  <CheckCircle2 className="size-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-zinc-100">Confirm Supervise Check</h3>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {confirmTarget.maName} • {formatElapsedShort(confirmTarget.diffMs)} elapsed
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                disabled={isSubmitting}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmCheck} className="p-5 space-y-4">
              <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 p-3 space-y-1">
                <div className="text-[11px] text-zinc-400 truncate">{confirmTarget.clientName}</div>
                <div className="text-xs font-semibold text-zinc-100 line-clamp-2">
                  {confirmTarget.task.isSubtask
                    ? (confirmTarget.task.title || '').replace(/^--\s*/, '')
                    : confirmTarget.task.title}
                </div>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                Confirm you&apos;ve checked in on <span className="font-semibold text-white">{confirmTarget.maName}</span>&apos;s progress. This card will be hidden from <span className="font-semibold text-emerald-400">Supervise</span> and automatically reappear at the <span className="font-semibold text-white">{formatMilestoneHours(getNextSuperviseMilestoneMs(confirmTarget.diffMs))}</span> mark if still live.
              </p>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-zinc-400">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={checkNote}
                  onChange={(e) => setCheckNote(e.target.value)}
                  placeholder="e.g. On track, asked for quick update..."
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setConfirmTarget(null)}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold !text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-3.5" />
                      <span>Confirm Check (Hide until {formatMilestoneHours(getNextSuperviseMilestoneMs(confirmTarget.diffMs))})</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
