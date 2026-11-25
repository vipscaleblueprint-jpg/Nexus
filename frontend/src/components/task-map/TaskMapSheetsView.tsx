'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileSpreadsheet,
  Search,
  Calendar,
  Download,
  RefreshCw,
  Clock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  User,
  Filter,
  Radio,
  ExternalLink,
} from 'lucide-react';
import {
  DailySheetLogItem,
  TaskMapItem,
  taskMapApi,
  formatManilaDateLong,
} from '@/api/taskMap';
import { toast } from '@/lib/toast';

interface Props {
  allTasks?: TaskMapItem[];
  allUsers?: any[];
  initialDate?: string;
  initialLogs?: DailySheetLogItem[];
  onOpenDetail?: (task: TaskMapItem) => void;
  onRefreshBoard?: () => void;
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

export const TaskMapSheetsView: React.FC<Props> = ({
  allTasks = [],
  allUsers = [],
  initialDate,
  initialLogs,
  onOpenDetail,
  onRefreshBoard,
}) => {
  const [dateKey, setDateKey] = useState<string>(() => initialDate || getTodayManilaKey());
  const [logs, setLogs] = useState<DailySheetLogItem[]>(() => initialLogs || []);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedMa, setSelectedMa] = useState<string>('ALL');
  const [liveFilter, setLiveFilter] = useState<'ALL' | 'LIVE' | 'COMPLETED'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchLogs = useCallback(async (targetDate: string) => {
    setLoading(true);
    try {
      const res = await taskMapApi.getDailySheetLogs({ date: targetDate });
      if (res?.success) {
        setLogs(res.logs || []);
      }
    } catch (err) {
      console.error('[TaskMapSheetsView] Failed to fetch daily sheet logs:', err);
      toast.error('Failed to load sheet logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(dateKey);
  }, [dateKey, fetchLogs]);

  // Real-time updates when a Google Sheet or Nexus livework submission arrives
  useEffect(() => {
    const handleLogUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const logDate = detail?.log?.dateKey || detail?.date;
      if (!logDate || logDate === dateKey) {
        void fetchLogs(dateKey);
      }
    };
    window.addEventListener('daily_sheet_log:updated', handleLogUpdated);
    return () => window.removeEventListener('daily_sheet_log:updated', handleLogUpdated);
  }, [dateKey, fetchLogs]);

  const maOptions = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      if (l.maName) set.add(l.maName);
    });
    allUsers.forEach((u) => {
      if (u?.name) set.add(u.name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [logs, allUsers]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (selectedMa !== 'ALL' && log.maName.toLowerCase() !== selectedMa.toLowerCase()) {
        return false;
      }
      if (liveFilter === 'LIVE' && !log.isLive) return false;
      if (liveFilter === 'COMPLETED' && log.isLive) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hay = [
          log.maName,
          log.client,
          log.taskName,
          log.status,
          log.taskDeliverables,
          log.taskUpdateAndDeliverables,
          log.source,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, selectedMa, liveFilter, searchQuery]);

  const stats = useMemo(() => {
    const liveCount = logs.filter((l) => l.isLive).length;
    const completedCount = logs.filter((l) => !l.isLive && Boolean(l.timeOut)).length;
    const uniqueMas = new Set(logs.map((l) => l.maKey)).size;
    return {
      total: logs.length,
      liveCount,
      completedCount,
      uniqueMas,
    };
  }, [logs]);

  const formattedDateHeader = useMemo(() => {
    const d = new Date(`${dateKey}T12:00:00+08:00`);
    return isNaN(d.getTime()) ? dateKey : formatManilaDateLong(d);
  }, [dateKey]);

  const handleOpenTask = (log: DailySheetLogItem) => {
    if (!log.taskId || !onOpenDetail) return;
    const matched = allTasks.find((t) => t.id === log.taskId);
    if (matched) {
      onOpenDetail(matched);
    } else {
      toast.info('Task is not in the active board pool');
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Date',
      'MA',
      'Live',
      'Client',
      'Task',
      'Time In',
      'Time Out',
      'Time Tracker',
      'Status',
      'Deliverables Description',
      'Update & Deliverables',
      'Sheet Row',
      'Source',
      'Submitted At',
    ];
    const csvContent = [
      headers.join(','),
      ...filteredLogs.map((r) =>
        [
          `"${r.dateKey}"`,
          `"${(r.maName || '').replace(/"/g, '""')}"`,
          `"${r.isLive ? 'LIVE' : 'LOGGED'}"`,
          `"${(r.client || '').replace(/"/g, '""')}"`,
          `"${(r.taskName || '').replace(/"/g, '""')}"`,
          `"${r.timeIn || ''}"`,
          `"${r.timeOut || ''}"`,
          `"${r.timeTracker || ''}"`,
          `"${r.status || ''}"`,
          `"${(r.taskDeliverables || '').replace(/"/g, '""')}"`,
          `"${(r.taskUpdateAndDeliverables || '').replace(/"/g, '""')}"`,
          `"${r.sheetRow ?? ''}"`,
          `"${r.source}"`,
          `"${r.submittedAt}"`,
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Nexus-Sheets-History-${dateKey}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.info(`Exported ${filteredLogs.length} sheet log(s)`);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden select-none">
      {/* TOOLBAR */}
      <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-md flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <FileSpreadsheet className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-zinc-100 tracking-tight">Sheets Livework History</h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 border border-sky-500/25 text-sky-400">
                <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
                Source of Truth for Sorting &amp; Live
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Every livework submission stored for the selected day. Task Map sorting and Live Working state derive from this ledger.
            </p>
          </div>
        </div>

        {/* Date Navigator */}
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
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
          >
            Today
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void fetchLogs(dateKey);
              onRefreshBoard?.();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            <Download className="size-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* STATS & FILTERS */}
      <div className="px-6 py-2.5 border-b border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-xs">
          <div className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">
            Total Submissions: <span className="font-bold text-zinc-100 tabular-nums">{stats.total}</span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 flex items-center gap-1.5">
            <Radio className="size-3 animate-pulse text-rose-400" />
            Live Working: <span className="font-bold tabular-nums">{stats.liveCount}</span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="size-3 text-emerald-400" />
            Clocked Out: <span className="font-bold tabular-nums">{stats.completedCount}</span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center gap-1.5">
            <User className="size-3 text-zinc-400" />
            MAs: <span className="font-bold text-zinc-100 tabular-nums">{stats.uniqueMas}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs">
            <User className="size-3.5 text-zinc-400" />
            <select
              value={selectedMa}
              onChange={(e) => setSelectedMa(e.target.value)}
              className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-zinc-900">All MAs</option>
              {maOptions.map((ma) => (
                <option key={ma} value={ma} className="bg-zinc-900">
                  {ma}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs">
            <Filter className="size-3.5 text-zinc-400" />
            <select
              value={liveFilter}
              onChange={(e) => setLiveFilter(e.target.value as 'ALL' | 'LIVE' | 'COMPLETED')}
              className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-zinc-900">All Entries</option>
              <option value="LIVE" className="bg-zinc-900">Live Working Only</option>
              <option value="COMPLETED" className="bg-zinc-900">Historical / Clocked Out</option>
            </select>
          </div>

          <div className="relative flex items-center">
            <Search className="size-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search task, client, MA..."
              className="pl-8 pr-3 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 w-56"
            />
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="flex-1 overflow-auto">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-500 text-xs gap-2">
            <FileSpreadsheet className="size-8 text-zinc-700" />
            <p className="font-medium text-zinc-400">
              {loading ? 'Loading sheet submissions...' : `No sheet submissions recorded for ${dateKey}`}
            </p>
            <p className="text-zinc-600">
              Livework submissions from Google Sheets and Nexus will appear here automatically.
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="py-2.5 px-3 font-semibold">State</th>
                <th className="py-2.5 px-3 font-semibold">MA</th>
                <th className="py-2.5 px-3 font-semibold">Client</th>
                <th className="py-2.5 px-3 font-semibold">Task</th>
                <th className="py-2.5 px-3 font-semibold">Time In</th>
                <th className="py-2.5 px-3 font-semibold">Time Out</th>
                <th className="py-2.5 px-3 font-semibold">Tracker</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold">Deliverables</th>
                <th className="py-2.5 px-3 font-semibold">Update</th>
                <th className="py-2.5 px-3 font-semibold">Row</th>
                <th className="py-2.5 px-3 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  className={`transition-colors ${
                    log.isLive
                      ? 'bg-rose-500/[0.06] hover:bg-rose-500/[0.1]'
                      : 'hover:bg-zinc-900/60'
                  }`}
                >
                  <td className="py-2 px-3 whitespace-nowrap">
                    {log.isLive ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 border border-rose-500/40 text-rose-300">
                        <span className="size-1.5 rounded-full bg-rose-400 animate-ping" />
                        LIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400">
                        <Clock className="size-2.5" />
                        LOGGED
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 font-semibold text-zinc-200 whitespace-nowrap">
                    {log.maName}
                  </td>
                  <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">
                    {log.client || '--'}
                  </td>
                  <td className="py-2 px-3 max-w-[240px]">
                    {log.taskId ? (
                      <button
                        type="button"
                        onClick={() => handleOpenTask(log)}
                        className="text-left font-medium text-sky-400 hover:text-sky-300 hover:underline inline-flex items-center gap-1 cursor-pointer truncate max-w-full"
                        title={log.taskName || ''}
                      >
                        <span className="truncate">{log.taskName || 'Linked Task'}</span>
                        <ExternalLink className="size-3 shrink-0 opacity-70" />
                      </button>
                    ) : (
                      <span className="text-zinc-200 truncate block" title={log.taskName || ''}>
                        {log.taskName || '--'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 font-mono text-zinc-200 whitespace-nowrap tabular-nums">
                    {log.timeIn || '--'}
                  </td>
                  <td className="py-2 px-3 font-mono text-zinc-400 whitespace-nowrap tabular-nums">
                    {log.timeOut || (log.isLive ? <span className="text-rose-400">Active</span> : '--')}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {log.isUpwork ? (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
                        Upwork
                      </span>
                    ) : (
                      <span className="text-zinc-500 text-[11px]">{log.timeTracker || 'No Need to Track'}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 text-[11px]">
                      {log.status || '--'}
                    </span>
                  </td>
                  <td className="py-2 px-3 max-w-[220px] truncate text-zinc-400" title={log.taskDeliverables || ''}>
                    {log.taskDeliverables || '--'}
                  </td>
                  <td className="py-2 px-3 max-w-[240px] truncate text-zinc-300" title={log.taskUpdateAndDeliverables || ''}>
                    {log.taskUpdateAndDeliverables || '--'}
                  </td>
                  <td className="py-2 px-3 font-mono text-zinc-500 tabular-nums whitespace-nowrap">
                    {log.sheetRow ? `#${log.sheetRow}` : '--'}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="text-[10px] font-mono text-zinc-500">
                      {log.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
