'use client';

import React, { useState, useMemo } from 'react';
import {
  Table as TableIcon,
  Plus,
  Search,
  Calendar,
  Download,
  ExternalLink,
  RefreshCw,
  Clock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  User,
  Filter,
  Layers,
  Sparkles,
  Link as LinkIcon,
} from 'lucide-react';
import { TaskMapItem, formatManilaTime, formatManilaDateLong, SpreadsheetScheduleRow } from '@/api/taskMap';
import { toast } from '@/lib/toast';

interface Props {
  tasks: TaskMapItem[];
  allTasks?: TaskMapItem[];
  allUsers?: any[];
  clients?: any[];
  onOpenDetail?: (task: TaskMapItem) => void;
  onRefresh?: () => void;
}

interface TrackerRowItem extends SpreadsheetScheduleRow {
  id: string;
  taskId?: string;
  isDraft?: boolean;
  assignedMa?: string;
}

export const TaskMapDailyTrackerView: React.FC<Props> = ({
  tasks = [],
  allTasks = [],
  allUsers = [],
  clients = [],
  onOpenDetail,
  onRefresh,
}) => {
  const [selectedMa, setSelectedMa] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [draftRows, setDraftRows] = useState<TrackerRowItem[]>([]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: string } | null>(null);

  const formattedDateHeader = useMemo(() => {
    return formatManilaDateLong(currentDate);
  }, [currentDate]);

  // Extract schedule rows from active tasks and their progress records
  const scheduleRows = useMemo(() => {
    const rows: TrackerRowItem[] = [];
    const sourceTasks = allTasks.length > 0 ? allTasks : tasks;

    sourceTasks.forEach((task, index) => {
      // 1. Check direct progress
      const p = task.progress;
      const maName = task.assignee?.name || p?.maName || 'General';
      const pmReviews = Array.isArray((task as any).taskMap?.pmReviews) ? (task as any).taskMap.pmReviews : [];

      // Extract SHEET_PROGRESS entries if available
      const sheetProgressEntries = pmReviews.filter((r: any) => r?.type === 'SHEET_PROGRESS');

      if (sheetProgressEntries.length > 0) {
        sheetProgressEntries.forEach((entry: any, eIdx: number) => {
          rows.push({
            id: `progress-${task.id}-${eIdx}`,
            taskId: task.id,
            rowNumber: rows.length + 2,
            date: entry.date || formattedDateHeader,
            timeIn: entry.timeIn || '',
            timeOut: entry.timeOut || '',
            durationHours: entry.timeIn && entry.timeOut ? 'Tracked' : '--',
            client: entry.client || p?.client || task.list?.name || 'General',
            timeTracker: entry.timeTracker || (p?.isUpwork ? 'Upwork' : 'No Need to Track'),
            task: entry.task || task.title,
            taskDeliverablesDescription: entry.taskDeliverables || (task as any).description || '',
            taskUpdateAndDeliverables: entry.taskUpdateAndDeliverables || '',
            taskLink: `https://nexus.vipscaleph.com/task/${task.id}`,
            taskStatus: entry.status || task.status || 'In Progress',
            wasDeliverablesSubmitted: entry.taskDeliverables ? 'Yes' : 'None',
            isRecorded: 'Yes',
            doubleCheckedBy: '',
            assignedMa: maName,
          });
        });
      } else if (p?.timeIn || task.status) {
        // Fallback to task's active progress
        rows.push({
          id: `task-${task.id}`,
          taskId: task.id,
          rowNumber: rows.length + 2,
          date: p?.date || formattedDateHeader,
          timeIn: p?.timeIn || '',
          timeOut: p?.timeOut || '',
          durationHours: p?.timeIn && p?.timeOut ? 'Tracked' : '--',
          client: p?.client || task.list?.name || 'General',
          timeTracker: p?.isUpwork ? 'Upwork' : 'No Need to Track',
          task: task.title,
          taskDeliverablesDescription: p?.taskDeliverablesDescription || p?.taskDeliverables || '',
          taskUpdateAndDeliverables: p?.taskUpdateAndDeliverables || '',
          taskLink: `https://nexus.vipscaleph.com/task/${task.id}`,
          taskStatus: task.status || 'In Progress',
          wasDeliverablesSubmitted: p?.taskDeliverables ? 'Yes' : 'None',
          isRecorded: 'Yes',
          doubleCheckedBy: '',
          assignedMa: maName,
        });
      }
    });

    return [...draftRows, ...rows];
  }, [allTasks, tasks, draftRows, formattedDateHeader]);

  // Filter rows
  const filteredRows = useMemo(() => {
    return scheduleRows.filter((row) => {
      if (selectedMa !== 'ALL' && row.assignedMa !== selectedMa) return false;
      if (statusFilter !== 'ALL' && (row.taskStatus || '').toUpperCase() !== statusFilter.toUpperCase()) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTask = (row.task || '').toLowerCase().includes(q);
        const matchesClient = (row.client || '').toLowerCase().includes(q);
        const matchesNotes = (row.taskUpdateAndDeliverables || '').toLowerCase().includes(q);
        const matchesDesc = (row.taskDeliverablesDescription || '').toLowerCase().includes(q);
        return matchesTask || matchesClient || matchesNotes || matchesDesc;
      }
      return true;
    });
  }, [scheduleRows, selectedMa, statusFilter, searchQuery]);

  // Add draft row
  const handleAddDraftRow = () => {
    const newDraft: TrackerRowItem = {
      id: `draft-${Date.now()}`,
      isDraft: true,
      rowNumber: scheduleRows.length + 2,
      date: formattedDateHeader,
      timeIn: formatManilaTime(new Date()),
      timeOut: '',
      client: clients[0]?.name || 'General',
      timeTracker: 'No Need to Track',
      task: '',
      taskDeliverablesDescription: '',
      taskUpdateAndDeliverables: '',
      taskStatus: 'In Progress',
      wasDeliverablesSubmitted: 'None',
      isRecorded: 'No',
      assignedMa: selectedMa !== 'ALL' ? selectedMa : 'General',
    };
    setDraftRows((prev) => [newDraft, ...prev]);
    toast.success('Draft row added! (Full spreadsheet auto-saving will be connected soon)');
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
      'MA',
    ];
    const csvContent = [
      headers.join(','),
      ...filteredRows.map((r) =>
        [
          `"${r.date || ''}"`,
          `"${r.timeIn || ''}"`,
          `"${r.timeOut || ''}"`,
          `"${r.client || ''}"`,
          `"${r.timeTracker || ''}"`,
          `"${(r.task || '').replace(/"/g, '""')}"`,
          `"${(r.taskDeliverablesDescription || '').replace(/"/g, '""')}"`,
          `"${(r.taskUpdateAndDeliverables || '').replace(/"/g, '""')}"`,
          `"${r.taskStatus || ''}"`,
          `"${r.assignedMa || ''}"`,
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Nexus-Daily-Tracker-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.info('Exported daily tracker rows to CSV');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden select-none">
      {/* TOOLBAR */}
      <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-md flex items-center justify-between gap-4 flex-wrap">
        {/* Left: View title & Sheet status */}
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xs">
            <TableIcon className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-zinc-100 tracking-tight">Daily Tracker Spreadsheet</h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Grid View
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Interactive 19-column spreadsheet layout mirroring the MA Daily Schedule sheets.
            </p>
          </div>
        </div>

        {/* Center: Date Navigator */}
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg p-1 text-xs">
          <button
            type="button"
            onClick={() => setCurrentDate((prev) => new Date(prev.getTime() - 86400000))}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
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
            onClick={() => setCurrentDate((prev) => new Date(prev.getTime() + 86400000))}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Next Day"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentDate(new Date())}
            className="px-2 py-0.5 text-[10px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
          >
            Today
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* MA Filter */}
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-300">
            <User className="size-3.5 text-zinc-400" />
            <select
              value={selectedMa}
              onChange={(e) => setSelectedMa(e.target.value)}
              className="bg-transparent text-xs text-zinc-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-zinc-900 text-zinc-200">
                All Shift MAs ({allUsers.length})
              </option>
              {allUsers.map((u) => (
                <option key={u.id || u.name} value={u.name} className="bg-zinc-900 text-zinc-200">
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tasks / clients..."
              className="w-44 pl-8 pr-3 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          {/* Add Row Button */}
          <button
            type="button"
            onClick={handleAddDraftRow}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer"
            title="Add a new row to this spreadsheet"
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
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              title="Refresh spreadsheet data"
            >
              <RefreshCw className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* KPI METRICS STRIP */}
      <div className="px-6 py-2 bg-zinc-950 border-b border-zinc-800/80 flex items-center gap-6 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-medium">Logged Entries:</span>
          <span className="font-semibold text-zinc-200">{filteredRows.length} rows</span>
        </div>
        <div className="w-px h-3 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-medium">Active In-Progress:</span>
          <span className="font-semibold text-blue-400">
            {filteredRows.filter((r) => (r.taskStatus || '').toUpperCase() === 'IN PROGRESS').length}
          </span>
        </div>
        <div className="w-px h-3 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-medium">In Review / Completed:</span>
          <span className="font-semibold text-amber-400">
            {filteredRows.filter((r) => ['IN REVIEW', 'CLOSED', 'HANDOVER'].includes((r.taskStatus || '').toUpperCase())).length}
          </span>
        </div>
        <div className="w-px h-3 bg-zinc-800" />
        <div className="flex items-center gap-1.5 text-zinc-500 italic text-[11px] ml-auto">
          <Sparkles className="size-3 text-emerald-400 shrink-0" />
          <span>Synced with n8n schedule pipeline & Google Sheets</span>
        </div>
      </div>

      {/* SPREADSHEET TABLE GRID */}
      <div className="flex-1 overflow-auto custom-scrollbar bg-zinc-950">
        <table className="w-full border-collapse text-left text-xs text-zinc-200 min-w-[1400px]">
          {/* ROW 1: Column Letters (Google Sheets Header Style) */}
          <thead>
            <tr className="bg-zinc-900/90 text-zinc-500 border-b border-zinc-800/80 text-[10px] font-mono select-none">
              <th className="w-12 px-2 py-1 text-center border-r border-zinc-800/60 sticky left-0 z-20 bg-zinc-900">
                #
              </th>
              <th className="w-40 px-3 py-1 border-r border-zinc-800/60 text-center">A</th>
              <th className="w-24 px-3 py-1 border-r border-zinc-800/60 text-center">B</th>
              <th className="w-24 px-3 py-1 border-r border-zinc-800/60 text-center">C</th>
              <th className="w-20 px-3 py-1 border-r border-zinc-800/60 text-center">F</th>
              <th className="w-36 px-3 py-1 border-r border-zinc-800/60 text-center">G</th>
              <th className="w-32 px-3 py-1 border-r border-zinc-800/60 text-center">H</th>
              <th className="w-64 px-3 py-1 border-r border-zinc-800/60 text-center">I</th>
              <th className="w-14 px-2 py-1 border-r border-zinc-800/60 text-center">J</th>
              <th className="w-64 px-3 py-1 border-r border-zinc-800/60 text-center">K</th>
              <th className="w-72 px-3 py-1 border-r border-zinc-800/60 text-center">L</th>
              <th className="w-16 px-2 py-1 border-r border-zinc-800/60 text-center">M</th>
              <th className="w-28 px-3 py-1 border-r border-zinc-800/60 text-center">N</th>
              <th className="w-28 px-3 py-1 border-r border-zinc-800/60 text-center">O</th>
              <th className="w-24 px-3 py-1 border-r border-zinc-800/60 text-center">P</th>
              <th className="w-32 px-3 py-1 text-center">MA</th>
            </tr>

            {/* ROW 2: Column Names */}
            <tr className="bg-zinc-900 text-zinc-300 font-semibold border-b border-zinc-800 text-[11px] sticky top-0 z-10 shadow-xs">
              <th className="w-12 px-2 py-2 text-center border-r border-zinc-800 sticky left-0 z-20 bg-zinc-900 font-mono text-zinc-500">
                Row
              </th>
              <th className="w-40 px-3 py-2 border-r border-zinc-800">Date:</th>
              <th className="w-24 px-3 py-2 border-r border-zinc-800">Time In:</th>
              <th className="w-24 px-3 py-2 border-r border-zinc-800">Time Out:</th>
              <th className="w-20 px-3 py-2 border-r border-zinc-800">Duration:</th>
              <th className="w-36 px-3 py-2 border-r border-zinc-800">Client:</th>
              <th className="w-32 px-3 py-2 border-r border-zinc-800">Time Tracker:</th>
              <th className="w-64 px-3 py-2 border-r border-zinc-800">Task:</th>
              <th className="w-14 px-2 py-2 border-r border-zinc-800 text-center">DC</th>
              <th className="w-64 px-3 py-2 border-r border-zinc-800">Task Deliverables Description:</th>
              <th className="w-72 px-3 py-2 border-r border-zinc-800">Task Update and Deliverables:</th>
              <th className="w-16 px-2 py-2 border-r border-zinc-800 text-center">Link</th>
              <th className="w-28 px-3 py-2 border-r border-zinc-800">Status:</th>
              <th className="w-28 px-3 py-2 border-r border-zinc-800">Submitted?</th>
              <th className="w-24 px-3 py-2 border-r border-zinc-800">Recorded?</th>
              <th className="w-32 px-3 py-2">Assigned MA</th>
            </tr>
          </thead>

          {/* TABLE BODY */}
          <tbody className="divide-y divide-zinc-800/60 font-sans">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={16} className="py-16 text-center text-zinc-500 italic">
                  No schedule entries found matching current filters. Click &quot;Add Row&quot; above to add a new task record.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => {
                const isSelected = selectedCell?.row === index;
                const statusNorm = (row.taskStatus || '').toUpperCase().replace(/[\s_-]+/g, '');
                const isLive = !row.timeOut && Boolean(row.timeIn);

                const statusColor =
                  statusNorm === 'INPROGRESS'
                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                    : statusNorm === 'INREVIEW' || statusNorm === 'TOREVIEW'
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                    : statusNorm === 'HANDOVER'
                    ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
                    : statusNorm === 'CLOSED'
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-400'
                    : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50';

                return (
                  <tr
                    key={row.id || index}
                    className={`transition-colors group ${
                      row.isDraft
                        ? 'bg-emerald-950/20 hover:bg-emerald-900/30'
                        : isSelected
                        ? 'bg-indigo-950/30 hover:bg-indigo-900/40'
                        : index % 2 === 0
                        ? 'bg-zinc-950 hover:bg-zinc-900/70'
                        : 'bg-zinc-900/30 hover:bg-zinc-900/70'
                    }`}
                  >
                    {/* Row Index */}
                    <td className="w-12 px-2 py-2 text-center border-r border-zinc-800/80 font-mono text-[11px] text-zinc-500 sticky left-0 z-10 bg-zinc-950 group-hover:bg-zinc-900">
                      {index + 2}
                    </td>

                    {/* Col A: Date */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 text-zinc-300 truncate max-w-[160px]">
                      {row.date || formattedDateHeader}
                    </td>

                    {/* Col B: Time In */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 font-mono font-medium text-emerald-400 whitespace-nowrap">
                      {row.timeIn ? (
                        <span className="flex items-center gap-1">
                          {isLive && <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />}
                          {row.timeIn}
                        </span>
                      ) : (
                        <span className="text-zinc-600">--:--</span>
                      )}
                    </td>

                    {/* Col C: Time Out */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 font-mono text-zinc-300 whitespace-nowrap">
                      {row.timeOut || (isLive ? <span className="text-amber-400/80 italic text-[10px]">Running...</span> : '--:--')}
                    </td>

                    {/* Col F: Duration */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 font-mono text-zinc-400 text-[11px]">
                      {row.durationHours || '--'}
                    </td>

                    {/* Col G: Client */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 font-semibold text-zinc-200 truncate max-w-[150px]">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-[11px] truncate">
                        {row.client || 'General'}
                      </span>
                    </td>

                    {/* Col H: Time Tracker */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 text-zinc-400 text-[11px] truncate">
                      {row.timeTracker || 'No Need to Track'}
                    </td>

                    {/* Col I: Task */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 font-medium text-zinc-100 max-w-[260px] truncate">
                      <div className="flex items-center justify-between gap-1 group/task">
                        <span className="truncate" title={row.task}>
                          {row.task || <span className="text-zinc-600 italic">Empty Task</span>}
                        </span>
                        {row.taskId && onOpenDetail && (
                          <button
                            type="button"
                            onClick={() => {
                              const found = allTasks.find((t) => t.id === row.taskId) || tasks.find((t) => t.id === row.taskId);
                              if (found) onOpenDetail(found);
                            }}
                            className="opacity-0 group-hover/task:opacity-100 p-0.5 text-zinc-400 hover:text-white transition-opacity"
                            title="Open task detail"
                          >
                            <ExternalLink className="size-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Col J: DC */}
                    <td className="px-2 py-2 border-r border-zinc-800/60 text-center font-mono text-zinc-500 text-[11px]">
                      {row.dc ? '✓' : '-'}
                    </td>

                    {/* Col K: Task Deliverables Description */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 text-zinc-300 max-w-[260px] truncate" title={row.taskDeliverablesDescription}>
                      {row.taskDeliverablesDescription || <span className="text-zinc-600 italic">None</span>}
                    </td>

                    {/* Col L: Task Update and Deliverables */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 text-zinc-400 max-w-[280px] truncate" title={row.taskUpdateAndDeliverables}>
                      {row.taskUpdateAndDeliverables || <span className="text-zinc-600 italic">None</span>}
                    </td>

                    {/* Col M: Task Link */}
                    <td className="px-2 py-2 border-r border-zinc-800/60 text-center">
                      {row.taskLink ? (
                        <a
                          href={row.taskLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center p-1 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                          title="Open Link"
                        >
                          <LinkIcon className="size-3" />
                        </a>
                      ) : (
                        <span className="text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Col N: Status */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusColor}`}>
                        {row.taskStatus || 'In Progress'}
                      </span>
                    </td>

                    {/* Col O: Was Deliverables Submitted? */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 text-zinc-400 text-center text-[11px]">
                      {row.wasDeliverablesSubmitted || 'None'}
                    </td>

                    {/* Col P: Is Recorded? */}
                    <td className="px-3 py-2 border-r border-zinc-800/60 text-zinc-400 text-center text-[11px]">
                      {row.isRecorded || 'No'}
                    </td>

                    {/* Col Q/MA: Assigned MA */}
                    <td className="px-3 py-2 font-medium text-zinc-300 truncate max-w-[130px]">
                      {row.assignedMa || 'General'}
                    </td>
                  </tr>
                );
              })
            )}

            {/* Empty spreadsheet rows for aesthetic grid feel */}
            {Array.from({ length: Math.max(0, 10 - filteredRows.length) }).map((_, emptyIdx) => {
              const rowNum = filteredRows.length + emptyIdx + 2;
              return (
                <tr key={`empty-${emptyIdx}`} className="bg-zinc-950/40 hover:bg-zinc-900/40 transition-colors">
                  <td className="w-12 px-2 py-2 text-center border-r border-zinc-800/40 font-mono text-[10px] text-zinc-700 sticky left-0 bg-zinc-950">
                    {rowNum}
                  </td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-2 py-2 border-r border-zinc-800/30 text-zinc-800 text-center">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-2 py-2 border-r border-zinc-800/30 text-zinc-800 text-center">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800 text-center">-</td>
                  <td className="px-3 py-2 border-r border-zinc-800/30 text-zinc-800 text-center">-</td>
                  <td className="px-3 py-2 text-zinc-800">-</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
