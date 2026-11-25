'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Table as TableIcon,
  Plus,
  Search,
  Calendar,
  Download,
  ExternalLink,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Lock,
  Save,
  Square,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  TaskMapItem,
  DailySheetLogItem,
  taskMapApi,
  formatManilaTime,
  formatManilaDateLong,
  calculateScheduleDuration,
} from '@/api/taskMap';
import { toast } from '@/lib/toast';

interface Props {
  tasks: TaskMapItem[];
  allTasks?: TaskMapItem[];
  currentUser?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    dailySheetUrl?: string | null;
  } | null;
  initialDate?: string;
  initialLogs?: DailySheetLogItem[];
  clients?: Array<{ id?: string; name: string }>;
  onOpenDetail?: (task: TaskMapItem) => void;
  onRefresh?: () => void;
}

interface EditableTrackerRow {
  localId: string;
  logId?: string;
  taskId?: string | null;
  subtaskId?: string | null;
  sheetRow?: number | null;
  date: string;
  timeIn: string;
  timeOut: string;
  client: string;
  timeTracker: string;
  task: string;
  taskDeliverablesDescription: string;
  taskUpdateAndDeliverables: string;
  taskLink: string;
  taskStatus: string;
  isDraft: boolean;
  isDirty: boolean;
  isLive: boolean;
}

function getTodayManilaKey(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const d = new Date(`${dateKey}T12:00:00+08:00`);
  if (isNaN(d.getTime())) return dateKey;
  d.setDate(d.getDate() + deltaDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function logToEditableRow(log: DailySheetLogItem, fallbackDateLong: string): EditableTrackerRow {
  return {
    localId: log.id,
    logId: log.id,
    taskId: log.taskId || null,
    subtaskId: log.subtaskId || null,
    sheetRow: log.sheetRow ?? null,
    date: fallbackDateLong,
    timeIn: log.timeIn || '',
    timeOut: log.timeOut || '',
    client: log.client || '',
    timeTracker: log.timeTracker || (log.isUpwork ? 'Upwork' : 'No Need to Track'),
    task: log.taskName || '',
    taskDeliverablesDescription: log.taskDeliverables || '',
    taskUpdateAndDeliverables: log.taskUpdateAndDeliverables || '',
    taskLink: log.taskLink || '',
    taskStatus: log.status || (log.isLive ? 'In Progress' : 'Completed'),
    isDraft: false,
    isDirty: false,
    isLive: Boolean(log.isLive),
  };
}

export const TaskMapDailyTrackerView: React.FC<Props> = ({
  tasks = [],
  allTasks = [],
  currentUser,
  initialDate,
  initialLogs,
  clients = [],
  onOpenDetail,
  onRefresh,
}) => {
  const [dateKey, setDateKey] = useState<string>(() => initialDate || getTodayManilaKey());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [savingRowIds, setSavingRowIds] = useState<Record<string, boolean>>({});
  const [dailySheetUrl, setDailySheetUrl] = useState<string | null>(
    currentUser?.dailySheetUrl || null
  );

  const myDisplayName = useMemo(
    () => (currentUser?.name || currentUser?.email || '').trim(),
    [currentUser?.name, currentUser?.email]
  );

  const formattedDateHeader = useMemo(() => {
    const d = new Date(`${dateKey}T12:00:00+08:00`);
    return isNaN(d.getTime()) ? dateKey : formatManilaDateLong(d);
  }, [dateKey]);

  const filterPrivateLogs = useCallback(
    (incoming: DailySheetLogItem[]): DailySheetLogItem[] => {
      if (!currentUser?.id && !myDisplayName) return [];
      const myNameLower = myDisplayName.toLowerCase();
      return incoming.filter((log) => {
        if (currentUser?.id && log.userId && log.userId === currentUser.id) return true;
        if (myNameLower && (log.maName || '').trim().toLowerCase() === myNameLower) return true;
        return false;
      });
    },
    [currentUser?.id, myDisplayName]
  );

  const [rows, setRows] = useState<EditableTrackerRow[]>(() => {
    if (!initialLogs) return [];
    return filterPrivateLogs(initialLogs).map((l) => logToEditableRow(l, formattedDateHeader));
  });

  // Fetch user's personal dailySheetUrl config
  useEffect(() => {
    if (!currentUser?.id) return;
    let active = true;
    taskMapApi
      .getDailyScheduleConfig(currentUser.id)
      .then((res) => {
        if (active && res?.success) {
          setDailySheetUrl(res.dailySheetUrl || null);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentUser?.id]);

  const fetchMyLogs = useCallback(
    async (targetDate: string) => {
      if (!myDisplayName && !currentUser?.id) return;
      setLoading(true);
      try {
        const res = await taskMapApi.getDailySheetLogs({
          date: targetDate,
          maName: myDisplayName || undefined,
        });
        if (res?.success) {
          const d = new Date(`${targetDate}T12:00:00+08:00`);
          const dateLong = isNaN(d.getTime()) ? targetDate : formatManilaDateLong(d);
          const myLogs = filterPrivateLogs(res.logs || []);
          setRows((prev) => {
            const unsavedDrafts = prev.filter((r) => r.isDraft);
            const persisted = myLogs.map((l) => {
              const existingDirty = prev.find((p) => !p.isDraft && p.logId === l.id && p.isDirty);
              return existingDirty || logToEditableRow(l, dateLong);
            });
            return [...unsavedDrafts, ...persisted];
          });
        }
      } catch (err) {
        console.error('[TaskMapDailyTrackerView] Failed to fetch personal daily logs:', err);
        toast.error('Failed to load your daily logs');
      } finally {
        setLoading(false);
      }
    },
    [myDisplayName, currentUser?.id, filterPrivateLogs]
  );

  useEffect(() => {
    void fetchMyLogs(dateKey);
  }, [dateKey, fetchMyLogs]);

  // Real-time sync when the user's sheet or board submission updates
  useEffect(() => {
    const handleLogUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const log = detail?.log;
      if (!log) return;
      const isMine =
        (currentUser?.id && log.userId === currentUser.id) ||
        (myDisplayName && (log.maName || '').trim().toLowerCase() === myDisplayName.toLowerCase());
      if (!isMine) return;
      if (!log.dateKey || log.dateKey === dateKey) {
        void fetchMyLogs(dateKey);
      }
    };
    window.addEventListener('daily_sheet_log:updated', handleLogUpdated);
    return () => window.removeEventListener('daily_sheet_log:updated', handleLogUpdated);
  }, [dateKey, fetchMyLogs, currentUser?.id, myDisplayName]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((row) => {
      return (
        (row.task || '').toLowerCase().includes(q) ||
        (row.client || '').toLowerCase().includes(q) ||
        (row.taskUpdateAndDeliverables || '').toLowerCase().includes(q) ||
        (row.taskDeliverablesDescription || '').toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery]);

  const updateRowField = (
    localId: string,
    field: keyof EditableTrackerRow,
    value: string
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.localId === localId ? { ...r, [field]: value, isDirty: true } : r
      )
    );
  };

  const handleAddDraftRow = () => {
    const newDraft: EditableTrackerRow = {
      localId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: formattedDateHeader,
      timeIn: formatManilaTime(new Date()),
      timeOut: '',
      client: '',
      timeTracker: 'No Need to Track',
      task: '',
      taskDeliverablesDescription: '',
      taskUpdateAndDeliverables: '',
      taskLink: '',
      taskStatus: 'In Progress',
      isDraft: true,
      isDirty: true,
      isLive: true,
    };
    setRows((prev) => [newDraft, ...prev]);
  };

  const handleDiscardDraft = (localId: string) => {
    setRows((prev) => prev.filter((r) => r.localId !== localId));
  };

  const handleSyncRow = async (
    row: EditableTrackerRow,
    overrideMode?: 'START' | 'STOP' | 'UPDATE',
    overrideTimeOut?: string
  ) => {
    const effectiveTimeOut = overrideTimeOut !== undefined ? overrideTimeOut : row.timeOut;
    const effectiveClient = row.client.trim();
    const effectiveTask = row.task.trim();

    if ((row.timeIn.trim() || effectiveTimeOut.trim()) && (!effectiveClient || !effectiveTask)) {
      toast.error('Client and Task are required before logging Time In or Time Out.');
      return;
    }
    if (!effectiveTask) {
      toast.error('Please enter a Task title.');
      return;
    }

    const mode: 'START' | 'STOP' | 'UPDATE' =
      overrideMode || (effectiveTimeOut.trim() ? 'STOP' : row.isDraft ? 'START' : 'UPDATE');

    setSavingRowIds((prev) => ({ ...prev, [row.localId]: true }));
    try {
      const { durationNum, durationHours } = calculateScheduleDuration(
        row.timeIn.trim(),
        effectiveTimeOut.trim()
      );
      const res = await taskMapApi.syncScheduleToSpreadsheet({
        taskId: row.taskId || null,
        subtaskId: row.subtaskId || null,
        taskTitle: effectiveTask,
        clientName: effectiveClient || 'General',
        taskLink: row.taskLink || undefined,
        status: mode === 'STOP' && row.taskStatus === 'In Progress' ? 'Completed' : row.taskStatus,
        mode,
        sheetRow: row.sheetRow ?? null,
        timeTracker: row.timeTracker || 'No Need to Track',
        taskDeliverablesDescription: row.taskDeliverablesDescription || effectiveTask,
        taskUpdateAndDeliverables: row.taskUpdateAndDeliverables || '',
        source: 'NEXUS_DAILY_TRACKER',
        explicitRow: {
          rowNumber: row.sheetRow ?? undefined,
          date: row.date || formattedDateHeader,
          timeIn: row.timeIn.trim(),
          timeOut: effectiveTimeOut.trim(),
          durationNum,
          durationHours,
          client: effectiveClient || 'General',
          timeTracker: row.timeTracker || 'No Need to Track',
          task: effectiveTask,
          dc: 'FALSE',
          taskDeliverablesDescription: row.taskDeliverablesDescription || effectiveTask,
          taskUpdateAndDeliverables: row.taskUpdateAndDeliverables || '',
          taskLink: row.taskLink || undefined,
          taskStatus: mode === 'STOP' && row.taskStatus === 'In Progress' ? 'Completed' : row.taskStatus,
        },
      });

      if (res?.success) {
        toast.success(
          mode === 'STOP'
            ? 'Clocked out & synced to your spreadsheet'
            : 'Saved & synced to your spreadsheet'
        );
        if (row.isDraft) {
          setRows((prev) => prev.filter((r) => r.localId !== row.localId));
        } else {
          setRows((prev) =>
            prev.map((r) =>
              r.localId === row.localId
                ? {
                    ...r,
                    timeOut: effectiveTimeOut.trim(),
                    taskStatus:
                      mode === 'STOP' && r.taskStatus === 'In Progress'
                        ? 'Completed'
                        : r.taskStatus,
                    isDirty: false,
                    isLive: !effectiveTimeOut.trim() && Boolean(r.timeIn.trim()),
                  }
                : r
            )
          );
        }
        void fetchMyLogs(dateKey);
        onRefresh?.();
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to sync row to spreadsheet');
    } finally {
      setSavingRowIds((prev) => ({ ...prev, [row.localId]: false }));
    }
  };

  const handleClockOutRow = (row: EditableTrackerRow) => {
    const nowTime = formatManilaTime(new Date());
    void handleSyncRow(row, 'STOP', nowTime);
  };

  const handleExportCsv = () => {
    const headers = [
      'Date',
      'Time In',
      'Time Out',
      'Client',
      'Time Tracker',
      'Task',
      'Task Deliverables Description',
      'Task Update and Deliverables',
      'Status',
    ];
    const csvContent = [
      headers.join(','),
      ...filteredRows.map((r) =>
        [
          `"${r.date || ''}"`,
          `"${r.timeIn || ''}"`,
          `"${r.timeOut || ''}"`,
          `"${(r.client || '').replace(/"/g, '""')}"`,
          `"${r.timeTracker || ''}"`,
          `"${(r.task || '').replace(/"/g, '""')}"`,
          `"${(r.taskDeliverablesDescription || '').replace(/"/g, '""')}"`,
          `"${(r.taskUpdateAndDeliverables || '').replace(/"/g, '""')}"`,
          `"${r.taskStatus || ''}"`,
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `My-Daily-Logs-${dateKey}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.info('Exported your daily logs to CSV');
  };

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c?.name) set.add(c.name);
    });
    rows.forEach((r) => {
      if (r.client) set.add(r.client);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [clients, rows]);

  const activeCount = filteredRows.filter((r) => !r.timeOut && Boolean(r.timeIn)).length;
  const completedCount = filteredRows.filter((r) => Boolean(r.timeOut)).length;

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Datalist for Client autocomplete */}
      <datalist id="daily-tracker-client-list">
        {clientOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* TOOLBAR */}
      <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-md flex items-center justify-between gap-4 flex-wrap">
        {/* Left: Private Title & Sheet Link */}
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xs">
            <TableIcon className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-zinc-100 tracking-tight">My Daily Logs</h2>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 border border-zinc-700 text-zinc-300"
                title="Only you can see and edit your personal daily log entries"
              >
                <Lock className="size-2.5 text-emerald-400" />
                Private{myDisplayName ? ` • ${myDisplayName}` : ''}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Input your tasks below to update your personal Google Daily Schedule spreadsheet in real time.
            </p>
          </div>
        </div>

        {/* Center: Date Navigator */}
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-xs">
          <button
            type="button"
            onClick={() => setDateKey((d) => shiftDateKey(d, -1))}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Previous Day"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex items-center gap-1.5 px-2 font-medium text-zinc-200">
            <Calendar className="size-3.5 text-zinc-400" />
            <span>{formattedDateHeader}</span>
          </div>
          <button
            type="button"
            onClick={() => setDateKey((d) => shiftDateKey(d, 1))}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Next Day"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setDateKey(getTodayManilaKey())}
            className="px-2 py-0.5 text-[10px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors cursor-pointer"
          >
            Today
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {dailySheetUrl ? (
            <a
              href={dailySheetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
              title="Open your personal Google Daily Sheet"
            >
              <ExternalLink className="size-3.5" />
              <span>Open My Sheet</span>
            </a>
          ) : (
            <Link
              href="/settings"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-medium text-amber-300 transition-colors"
              title="Set your Google Daily Sheet URL in Settings"
            >
              <AlertCircle className="size-3.5" />
              <span>Link Daily Sheet</span>
            </Link>
          )}

          {/* Search Input */}
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter my logs..."
              className="w-40 pl-8 pr-3 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          {/* Add Row Button */}
          <button
            type="button"
            onClick={handleAddDraftRow}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer"
            title="Add a new row to log and sync to your spreadsheet"
          >
            <Plus className="size-3.5" />
            <span>Add Row</span>
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Export CSV"
          >
            <Download className="size-4" />
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={() => {
              void fetchMyLogs(dateKey);
              onRefresh?.();
            }}
            className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Refresh my daily logs"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI METRICS STRIP */}
      <div className="px-6 py-2 bg-zinc-950 border-b border-zinc-800/80 flex items-center gap-6 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-medium">My Entries:</span>
          <span className="font-semibold text-zinc-200 tabular-nums">{filteredRows.length}</span>
        </div>
        <div className="w-px h-3 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-medium">Running:</span>
          <span className="font-semibold text-emerald-400 tabular-nums">{activeCount}</span>
        </div>
        <div className="w-px h-3 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-medium">Clocked Out:</span>
          <span className="font-semibold text-zinc-200 tabular-nums">{completedCount}</span>
        </div>
        <div className="ml-auto text-[11px] text-zinc-500">
          Client &amp; Task are required before Time In / Time Out.
        </div>
      </div>

      {/* SPREADSHEET TABLE GRID */}
      <div className="flex-1 overflow-auto custom-scrollbar bg-zinc-950">
        <table className="w-full border-collapse text-left text-xs text-zinc-200 min-w-[1380px]">
          <thead>
            <tr className="bg-zinc-900/90 text-zinc-500 border-b border-zinc-800/80 text-[10px] font-mono select-none">
              <th className="w-12 px-2 py-1 text-center border-r border-zinc-800/60 sticky left-0 z-20 bg-zinc-900">
                #
              </th>
              <th className="w-40 px-2 py-1 border-r border-zinc-800/60 text-center">A</th>
              <th className="w-24 px-2 py-1 border-r border-zinc-800/60 text-center">B</th>
              <th className="w-24 px-2 py-1 border-r border-zinc-800/60 text-center">C</th>
              <th className="w-20 px-2 py-1 border-r border-zinc-800/60 text-center">F</th>
              <th className="w-40 px-2 py-1 border-r border-zinc-800/60 text-center">G</th>
              <th className="w-36 px-2 py-1 border-r border-zinc-800/60 text-center">H</th>
              <th className="w-60 px-2 py-1 border-r border-zinc-800/60 text-center">I</th>
              <th className="w-56 px-2 py-1 border-r border-zinc-800/60 text-center">K</th>
              <th className="w-64 px-2 py-1 border-r border-zinc-800/60 text-center">L</th>
              <th className="w-28 px-2 py-1 border-r border-zinc-800/60 text-center">N</th>
              <th className="w-32 px-2 py-1 text-center">Sync</th>
            </tr>

            <tr className="bg-zinc-900 text-zinc-300 font-semibold border-b border-zinc-800 text-[11px] sticky top-0 z-10 shadow-xs">
              <th className="w-12 px-2 py-2 text-center border-r border-zinc-800 sticky left-0 z-20 bg-zinc-900 font-mono text-zinc-500">
                Row
              </th>
              <th className="w-40 px-2.5 py-2 border-r border-zinc-800">Date:</th>
              <th className="w-24 px-2.5 py-2 border-r border-zinc-800">Time In:</th>
              <th className="w-24 px-2.5 py-2 border-r border-zinc-800">Time Out:</th>
              <th className="w-20 px-2.5 py-2 border-r border-zinc-800">Duration:</th>
              <th className="w-40 px-2.5 py-2 border-r border-zinc-800">Client:</th>
              <th className="w-36 px-2.5 py-2 border-r border-zinc-800">Time Tracker:</th>
              <th className="w-60 px-2.5 py-2 border-r border-zinc-800">Task:</th>
              <th className="w-56 px-2.5 py-2 border-r border-zinc-800">Deliverables Desc:</th>
              <th className="w-64 px-2.5 py-2 border-r border-zinc-800">Update &amp; Deliverables:</th>
              <th className="w-28 px-2.5 py-2 border-r border-zinc-800">Status:</th>
              <th className="w-32 px-2.5 py-2 text-center">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-800/60 font-sans">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-16 text-center text-zinc-500 italic">
                  {loading
                    ? 'Loading your daily logs...'
                    : 'No personal log entries for this date yet. Click "Add Row" above to log a task and sync it to your spreadsheet.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => {
                const isSaving = Boolean(savingRowIds[row.localId]);
                const isRunning = !row.timeOut.trim() && Boolean(row.timeIn.trim());
                const { durationHours } =
                  row.timeIn && row.timeOut
                    ? calculateScheduleDuration(row.timeIn, row.timeOut)
                    : { durationHours: isRunning ? 'Running' : '--' };

                return (
                  <tr
                    key={row.localId}
                    className={`transition-colors group ${
                      row.isDraft
                        ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                        : row.isDirty
                        ? 'bg-amber-950/15 hover:bg-amber-950/25'
                        : index % 2 === 0
                        ? 'bg-zinc-950 hover:bg-zinc-900/60'
                        : 'bg-zinc-900/30 hover:bg-zinc-900/60'
                    }`}
                  >
                    {/* Row Index */}
                    <td className="w-12 px-2 py-1.5 text-center border-r border-zinc-800/80 font-mono text-[11px] text-zinc-500 sticky left-0 z-10 bg-zinc-950 group-hover:bg-zinc-900">
                      {row.sheetRow ? `#${row.sheetRow}` : index + 2}
                    </td>

                    {/* Col A: Date */}
                    <td className="px-2.5 py-1.5 border-r border-zinc-800/60 text-zinc-400 truncate max-w-[160px]">
                      {row.date}
                    </td>

                    {/* Col B: Time In */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <input
                        type="text"
                        value={row.timeIn}
                        onChange={(e) => updateRowField(row.localId, 'timeIn', e.target.value)}
                        placeholder="8:30 AM"
                        className="w-full bg-transparent px-1.5 py-1 rounded font-mono text-xs text-emerald-400 placeholder:text-zinc-600 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                      />
                    </td>

                    {/* Col C: Time Out */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <input
                        type="text"
                        value={row.timeOut}
                        onChange={(e) => updateRowField(row.localId, 'timeOut', e.target.value)}
                        placeholder={isRunning ? 'Running...' : '--:--'}
                        className="w-full bg-transparent px-1.5 py-1 rounded font-mono text-xs text-zinc-200 placeholder:text-amber-400/70 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                      />
                    </td>

                    {/* Col F: Duration */}
                    <td className="px-2.5 py-1.5 border-r border-zinc-800/60 font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                      {durationHours}
                    </td>

                    {/* Col G: Client */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <input
                        type="text"
                        list="daily-tracker-client-list"
                        value={row.client}
                        onChange={(e) => updateRowField(row.localId, 'client', e.target.value)}
                        placeholder="Client name..."
                        className="w-full bg-transparent px-1.5 py-1 rounded text-xs font-medium text-zinc-100 placeholder:text-zinc-600 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                      />
                    </td>

                    {/* Col H: Time Tracker */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <select
                        value={row.timeTracker}
                        onChange={(e) => updateRowField(row.localId, 'timeTracker', e.target.value)}
                        className="w-full bg-zinc-900/70 border border-zinc-800/80 rounded px-1.5 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-emerald-500/60 cursor-pointer"
                      >
                        <option value="No Need to Track">No Need to Track</option>
                        <option value="Upwork">Upwork</option>
                        <option value="Clockify">Clockify</option>
                      </select>
                    </td>

                    {/* Col I: Task */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={row.task}
                          onChange={(e) => updateRowField(row.localId, 'task', e.target.value)}
                          placeholder="Task title..."
                          className="w-full bg-transparent px-1.5 py-1 rounded text-xs font-medium text-zinc-100 placeholder:text-zinc-600 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                        />
                        {row.taskId && onOpenDetail && (
                          <button
                            type="button"
                            onClick={() => {
                              const found =
                                allTasks.find((t) => t.id === row.taskId) ||
                                tasks.find((t) => t.id === row.taskId);
                              if (found) onOpenDetail(found);
                            }}
                            className="p-1 text-zinc-500 hover:text-zinc-200 shrink-0 cursor-pointer"
                            title="Open task detail"
                          >
                            <ExternalLink className="size-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Col K: Deliverables Description */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <input
                        type="text"
                        value={row.taskDeliverablesDescription}
                        onChange={(e) =>
                          updateRowField(row.localId, 'taskDeliverablesDescription', e.target.value)
                        }
                        placeholder="Deliverables scope..."
                        className="w-full bg-transparent px-1.5 py-1 rounded text-xs text-zinc-300 placeholder:text-zinc-600 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                      />
                    </td>

                    {/* Col L: Update & Deliverables */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <input
                        type="text"
                        value={row.taskUpdateAndDeliverables}
                        onChange={(e) =>
                          updateRowField(row.localId, 'taskUpdateAndDeliverables', e.target.value)
                        }
                        placeholder="Progress update / output..."
                        className="w-full bg-transparent px-1.5 py-1 rounded text-xs text-zinc-300 placeholder:text-zinc-600 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500/60"
                      />
                    </td>

                    {/* Col N: Status */}
                    <td className="px-1.5 py-1 border-r border-zinc-800/60">
                      <select
                        value={row.taskStatus}
                        onChange={(e) => updateRowField(row.localId, 'taskStatus', e.target.value)}
                        className="w-full bg-zinc-900/70 border border-zinc-800/80 rounded px-1.5 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-500/60 cursor-pointer"
                      >
                        <option value="In Progress">In Progress</option>
                        <option value="In Review">In Review</option>
                        <option value="Handover">Handover</option>
                        <option value="Completed">Completed</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {isRunning && !row.isDraft && (
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleClockOutRow(row)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/40 text-amber-300 text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                            title="Clock out now & update spreadsheet"
                          >
                            <Square className="size-2.5 fill-current" />
                            <span>Out</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleSyncRow(row)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                            row.isDraft || row.isDirty
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                          }`}
                          title="Save & sync this row to your Google Spreadsheet"
                        >
                          {isSaving ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : row.isDraft || row.isDirty ? (
                            <Save className="size-3" />
                          ) : (
                            <CheckCircle2 className="size-3 text-emerald-400" />
                          )}
                          <span>{row.isDraft || row.isDirty ? 'Sync' : 'Synced'}</span>
                        </button>

                        {row.isDraft && (
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleDiscardDraft(row.localId)}
                            className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Discard unsaved row"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
