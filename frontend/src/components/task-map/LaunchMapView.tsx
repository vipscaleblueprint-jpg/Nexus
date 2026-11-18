'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Rocket,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Layers,
  Pencil,
  Calendar as CalendarIcon,
  Clock,
  Loader2,
  Table2,
  Building2,
  Flag,
  Trash2,
  ExternalLink,
  CalendarClock,
} from 'lucide-react';
import {
  LaunchMapLightItem,
  LaunchMeta,
  taskMapApi,
  isLaunchReviewStatus,
  getManilaDateKey,
  getTaskEffectiveLaunchDate,
  getTaskLaunchTargetPeriod,
  mergeTaskAssignees,
  isClosedStatus,
  toCanonicalTaskStatus,
} from '@/api/taskMap';
import { STATUS_COLORS } from '@/lib/taskTokens';
import { toast } from '@/lib/toast';
import type { EnrichedLaunchEntry } from './LaunchMapDayDrawer';
import { LaunchAssigneeChips, LaunchTextWithLinks } from './LaunchTextWithLinks';

const LaunchMapDayDrawer = dynamic(
  () => import('./LaunchMapDayDrawer').then((m) => m.LaunchMapDayDrawer),
  { ssr: false }
);

const LaunchScheduleModal = dynamic(
  () => import('./LaunchScheduleModal').then((m) => m.LaunchScheduleModal),
  { ssr: false }
);

export type CalendarViewMode = 'JOURNAL' | 'MONTH' | 'WEEK' | 'AGENDA';
export type AgendaScopeMode = 'ACTIVE' | 'COMPLETED' | 'ALL';
export type JournalGroupMode = 'CLIENT' | 'DATE';

const VIEW_MODE_STORAGE_KEY = 'nexus_launch_map_view_mode';
const VIEW_MODE_EVENT = 'nexus:launch-map-view-mode';

function subscribeViewMode(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', cb);
  window.addEventListener(VIEW_MODE_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(VIEW_MODE_EVENT, cb);
  };
}

function getClientViewMode(): CalendarViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === 'JOURNAL' || saved === 'MONTH' || saved === 'WEEK' || saved === 'AGENDA') {
      return saved;
    }
  } catch {
    // Ignore storage failures
  }
  return 'JOURNAL';
}

function getServerViewMode(): CalendarViewMode {
  return 'JOURNAL';
}

interface LaunchMapViewProps {
  tasks: LaunchMapLightItem[];
  search?: string;
  loadingRange?: boolean;
  toolbarRightSlot?: React.ReactNode;
  onRangeChange: (range: { start?: string; end?: string; mode: CalendarViewMode }) => void;
  onOpenDetail: (task: LaunchMapLightItem) => void;
  onLaunchMetaUpdated?: (
    taskId: string,
    data: {
      launchMeta: LaunchMeta;
      effectiveLaunchDate: string | null;
      targetPeriod?: string | null;
      dueDate: string | null;
    }
  ) => void;
  onDataRefresh?: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function parseDateKeyParts(dateKey: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateKey.split('-').map((n) => parseInt(n, 10));
  return {
    year: Number.isFinite(y) ? y : new Date().getFullYear(),
    month: Number.isFinite(m) ? m - 1 : new Date().getMonth(),
    day: Number.isFinite(d) ? d : 1,
  };
}

function buildDateKey(year: number, monthZeroIdx: number, day: number): string {
  const d = new Date(Date.UTC(year, monthZeroIdx, day, 12, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

function formatReadableDate(dateKey: string): string {
  try {
    const d = new Date(`${dateKey}T12:00:00+08:00`);
    if (isNaN(d.getTime())) return dateKey;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateKey;
  }
}

function formatShortDate(dateKey: string): string {
  try {
    const d = new Date(`${dateKey}T12:00:00+08:00`);
    if (isNaN(d.getTime())) return dateKey;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateKey;
  }
}

function resolveStatusColorHex(task: LaunchMapLightItem): string {
  const statusStr = (task.status || '').trim();
  const upper = statusStr.toUpperCase();
  const listMatch = (task.list?.statuses || []).find(
    (s) => (s.name || '').trim().toUpperCase() === upper
  );
  if (listMatch?.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(listMatch.color.trim())) {
    return listMatch.color.trim();
  }
  const canonical = toCanonicalTaskStatus(statusStr);
  const raw = STATUS_COLORS[canonical] || STATUS_COLORS[upper] || '#64748b';
  if (raw.startsWith('#')) return raw;
  const bracketMatch = raw.match(/bg-\[([^\]]+)\]/);
  return bracketMatch ? bracketMatch[1] : '#64748b';
}

function isRoutineRecurringStatus(status?: string | null): boolean {
  const canonical = toCanonicalTaskStatus(status).toUpperCase();
  return (
    canonical === 'DAILY' ||
    canonical === 'WEEKLY' ||
    canonical === 'MONTHLY' ||
    canonical === 'RECURRING'
  );
}

function formatRelativeDayTag(dateKey: string, todayKey: string): string | null {
  try {
    const target = new Date(`${dateKey}T12:00:00+08:00`);
    const today = new Date(`${todayKey}T12:00:00+08:00`);
    if (isNaN(target.getTime()) || isNaN(today.getTime())) return null;
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 1 && diffDays <= 14) return `In ${diffDays}d`;
    if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
    return null;
  } catch {
    return null;
  }
}

interface MonthCellProps {
  dateKey: string;
  dayNum: number;
  inCurrentMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
  entries: EnrichedLaunchEntry[];
  onSelectDay: (dateKey: string) => void;
  onQuickSchedule: (dateKey: string) => void;
  onOpenDetail: (task: LaunchMapLightItem) => void;
}

const MonthDayCell = React.memo<MonthCellProps>(
  ({
    dateKey,
    dayNum,
    inCurrentMonth,
    isWeekend,
    isToday,
    entries,
    onSelectDay,
    onQuickSchedule,
    onOpenDetail,
  }) => {
    const visiblePills = entries.slice(0, 3);
    const overflowCount = Math.max(0, entries.length - 3);
    const hasInReview = entries.some((e) => e.isInReview);

    const cellVariantClass = isToday
      ? 'launch-cell-today'
      : !inCurrentMonth
      ? 'launch-cell-outside'
      : isWeekend
      ? 'launch-cell-weekend'
      : 'launch-cell-weekday';

    return (
      <div
        onClick={() => onSelectDay(dateKey)}
        className={`launch-map-cell ${cellVariantClass} group relative flex flex-col p-1.5 border-r border-b border-[var(--border)] min-h-[96px] transition-colors cursor-pointer`}
      >
        <div className="flex items-center justify-between gap-1 mb-1 px-0.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[11px] font-semibold leading-none ${
                isToday
                  ? 'size-5 rounded-full bg-[var(--accent)] text-[var(--on-accent)] flex items-center justify-center font-bold shadow-xs'
                  : inCurrentMonth
                  ? 'text-[var(--text)]'
                  : 'text-[var(--muted)]/55'
              }`}
            >
              {dayNum}
            </span>
            {hasInReview && (
              <span
                className="size-1.5 rounded-full bg-orange-400 animate-pulse"
                title="Contains IN REVIEW task(s) needing PM & Auditor review"
              />
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickSchedule(dateKey);
            }}
            className="opacity-0 group-hover:opacity-100 size-4 rounded flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] transition-all cursor-pointer"
            title={`Schedule task on ${dateKey}`}
          >
            <Plus className="size-3" />
          </button>
        </div>

        <div className="flex flex-col gap-1 min-w-0 flex-1 overflow-hidden">
          {visiblePills.map((entry) => {
            const assigneeNames = entry.assignees.map((a) => a.name).join(', ');
            return (
              <button
                key={entry.task.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail(entry.task);
                }}
                title={`${entry.task.title} · ${entry.clientName} · ${entry.canonicalStatus}${
                  assigneeNames ? ` · ${assigneeNames}` : ''
                }${entry.isUrgent ? ' · URGENT' : ''}`}
                className={`w-full text-left flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] leading-tight transition-colors cursor-pointer truncate ${
                  entry.isInReview
                    ? 'border-l-2 border-orange-400 bg-orange-500/20 text-orange-100 hover:bg-orange-500/30 [.theme-light_&]:bg-orange-50 [.theme-light_&]:text-orange-950 [.theme-light_&]:hover:bg-orange-100 [.theme-light_&]:border-orange-500'
                    : entry.isMilestone
                    ? 'border-l-2 border-rose-400 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 [.theme-light_&]:bg-rose-50 [.theme-light_&]:text-rose-950 [.theme-light_&]:hover:bg-rose-100 [.theme-light_&]:border-rose-500'
                    : entry.isClosed
                    ? 'launch-pill-closed text-[var(--muted)]'
                    : 'launch-pill-default text-[var(--text)] border border-[var(--border)]'
                }`}
              >
                {entry.isInReview ? (
                  <AlertTriangle className="size-3 shrink-0 text-orange-400 [.theme-light_&]:text-orange-600" />
                ) : entry.isUrgent ? (
                  <Flag className="size-3 shrink-0 text-red-400 [.theme-light_&]:text-red-600" />
                ) : entry.isMilestone ? (
                  <Rocket className="size-3 shrink-0 text-rose-400 [.theme-light_&]:text-rose-600" />
                ) : entry.isClosed ? (
                  <CheckCircle2 className="size-3 shrink-0 text-emerald-400 [.theme-light_&]:text-emerald-600" />
                ) : (
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: entry.statusColor }}
                  />
                )}
                <span className="truncate font-medium flex-1 min-w-0">{entry.task.title}</span>
                <span className="shrink-0 text-[9.5px] text-[var(--muted)] max-w-[60px] truncate">
                  {entry.clientName}
                </span>
              </button>
            );
          })}

          {overflowCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDay(dateKey);
              }}
              className="text-left px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--accent)] hover:underline cursor-pointer"
            >
              +{overflowCount} more
            </button>
          )}
        </div>
      </div>
    );
  }
);
MonthDayCell.displayName = 'MonthDayCell';

export const LaunchMapView: React.FC<LaunchMapViewProps> = ({
  tasks,
  search = '',
  loadingRange = false,
  toolbarRightSlot,
  onRangeChange,
  onOpenDetail,
  onLaunchMetaUpdated,
  onDataRefresh,
}) => {
  const todayKey = useMemo(() => getManilaDateKey(new Date()) || '2026-01-01', []);
  const todayParts = useMemo(() => parseDateKeyParts(todayKey), [todayKey]);

  const [cursorYear, setCursorYear] = useState<number>(todayParts.year);
  const [cursorMonth, setCursorMonth] = useState<number>(todayParts.month);
  const [cursorDay, setCursorDay] = useState<number>(todayParts.day);
  const viewMode = React.useSyncExternalStore(
    subscribeViewMode,
    getClientViewMode,
    getServerViewMode
  );
  const [agendaScope, setAgendaScope] = useState<AgendaScopeMode>('ACTIVE');
  const [journalGroupMode, setJournalGroupMode] = useState<JournalGroupMode>('CLIENT');
  const [collapsedClients, setCollapsedClients] = useState<Record<string, boolean>>({});
  const [pastOpenExpanded, setPastOpenExpanded] = useState<boolean>(true);

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<{
    open: boolean;
    task: LaunchMapLightItem | null;
    dateKey: string;
  }>({ open: false, task: null, dateKey: todayKey });

  const handleSetViewMode = useCallback((mode: CalendarViewMode) => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(VIEW_MODE_EVENT));
    }
  }, []);

  // Build Month & Week grids
  const monthGridDays = useMemo(() => {
    const firstDayUtc = new Date(Date.UTC(cursorYear, cursorMonth, 1, 12, 0, 0));
    const startWeekday = firstDayUtc.getUTCDay();
    const gridStartOffset = -startWeekday;
    const days: Array<{
      dateKey: string;
      dayNum: number;
      inCurrentMonth: boolean;
      isWeekend: boolean;
      isToday: boolean;
    }> = [];

    for (let i = 0; i < 42; i++) {
      const d = new Date(Date.UTC(cursorYear, cursorMonth, 1 + gridStartOffset + i, 12, 0, 0));
      const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate()
      ).padStart(2, '0')}`;
      const wd = d.getUTCDay();
      days.push({
        dateKey,
        dayNum: d.getUTCDate(),
        inCurrentMonth: d.getUTCMonth() === cursorMonth && d.getUTCFullYear() === cursorYear,
        isWeekend: wd === 0 || wd === 6,
        isToday: dateKey === todayKey,
      });
    }
    return days;
  }, [cursorYear, cursorMonth, todayKey]);

  const weekGridDays = useMemo(() => {
    const anchor = new Date(Date.UTC(cursorYear, cursorMonth, cursorDay, 12, 0, 0));
    const wd = anchor.getUTCDay();
    const days: Array<{
      dateKey: string;
      dayNum: number;
      monthShort: string;
      weekday: string;
      isWeekend: boolean;
      isToday: boolean;
    }> = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(
        Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - wd + i, 12, 0, 0)
      );
      const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate()
      ).padStart(2, '0')}`;
      const dayWd = d.getUTCDay();
      days.push({
        dateKey,
        dayNum: d.getUTCDate(),
        monthShort: MONTHS[d.getUTCMonth()].slice(0, 3),
        weekday: WEEKDAYS[dayWd],
        isWeekend: dayWd === 0 || dayWd === 6,
        isToday: dateKey === todayKey,
      });
    }
    return days;
  }, [cursorYear, cursorMonth, cursorDay, todayKey]);

  // Notify parent when visible date range changes (lazy loading per month/week)
  useEffect(() => {
    if (viewMode === 'MONTH') {
      onRangeChange({
        start: monthGridDays[0]?.dateKey,
        end: monthGridDays[monthGridDays.length - 1]?.dateKey,
        mode: 'MONTH',
      });
    } else if (viewMode === 'WEEK') {
      onRangeChange({
        start: weekGridDays[0]?.dateKey,
        end: weekGridDays[weekGridDays.length - 1]?.dateKey,
        mode: 'WEEK',
      });
    } else {
      onRangeChange({ start: undefined, end: undefined, mode: viewMode });
    }
  }, [viewMode, monthGridDays, weekGridDays, onRangeChange]);

  // Close drawer/modal on Esc
  useEffect(() => {
    if (!selectedDayKey && !editorState.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editorState.open) setEditorState((prev) => ({ ...prev, open: false }));
        else if (selectedDayKey) setSelectedDayKey(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDayKey, editorState.open]);

  const searchLower = search.trim().toLowerCase();

  const allEntries = useMemo(() => {
    const entries: EnrichedLaunchEntry[] = [];

    for (const task of tasks) {
      const dateKey = getTaskEffectiveLaunchDate(task);
      const rawPeriod = getTaskLaunchTargetPeriod(task);
      const targetPeriod = !dateKey ? rawPeriod || 'TBD' : null;
      if (!dateKey && !targetPeriod) continue;

      const closed = Boolean(task.isClosed || isClosedStatus(task.status));
      const inReview = !closed && isLaunchReviewStatus(task.status);
      const subStatuses = (task.taskMapStatuses || []).filter((s) => !/\blaunch\s*date\b/i.test(s || ''));
      const milestone = Boolean(
        task.launchMeta?.isLaunchDate ??
          task.isLaunchDate ??
          (/\blaunch\s*date\b/i.test(task.status || '') ||
            (task.taskMapStatuses || []).some((s) => /\blaunch\s*date\b/i.test(s || '')))
      );
      const urgent = (task.priority || '').toUpperCase() === 'URGENT';
      const clientName = task.list?.name || 'General';
      const workstream = task.launchMeta?.workstream || '';
      const details = (task.launchMeta?.details ?? task.description ?? '').trim();
      const notes = (task.launchMeta?.notes || '').trim();
      const assignees = mergeTaskAssignees(task);

      if (searchLower) {
        const assigneeNames = assignees.map((a) => a.name || '').join(' ');
        const haystack = `${task.title || ''} ${clientName} ${workstream} ${details} ${notes} ${
          task.status || ''
        } ${subStatuses.join(' ')} ${assigneeNames} ${dateKey || ''} ${targetPeriod || ''}`.toLowerCase();
        if (!haystack.includes(searchLower)) continue;
      }

      entries.push({
        task,
        dateKey,
        targetPeriod,
        isInReview: inReview,
        isMilestone: milestone,
        isClosed: closed,
        isUrgent: urgent,
        clientName,
        workstream,
        details,
        notes,
        assignees,
        subStatuses,
        statusColor: resolveStatusColorHex(task),
        canonicalStatus: toCanonicalTaskStatus(task.status) || task.status || 'PENDING',
      });
    }

    entries.sort((a, b) => {
      if (a.isInReview !== b.isInReview) return a.isInReview ? -1 : 1;
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      if (a.isMilestone !== b.isMilestone) return a.isMilestone ? -1 : 1;
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      return (a.task.title || '').localeCompare(b.task.title || '');
    });

    return entries;
  }, [tasks, searchLower]);

  const tbdEntries = useMemo(
    () => allEntries.filter((e) => !e.dateKey && Boolean(e.targetPeriod)),
    [allEntries]
  );

  const entriesByDate = useMemo(() => {
    const map = new Map<string, EnrichedLaunchEntry[]>();
    for (const e of allEntries) {
      if (!e.dateKey) continue;
      const list = map.get(e.dateKey) || [];
      list.push(e);
      map.set(e.dateKey, list);
    }
    return map;
  }, [allEntries]);

  const timelineStats = useMemo(() => {
    const isActiveLaunch = (e: EnrichedLaunchEntry) =>
      !e.isClosed && (e.isMilestone || e.isInReview || !isRoutineRecurringStatus(e.task.status));

    const activeList = allEntries.filter(isActiveLaunch);
    const completedList = allEntries.filter((e) => e.isClosed);

    const scopedList =
      agendaScope === 'ACTIVE' ? activeList : agendaScope === 'COMPLETED' ? completedList : allEntries;

    const datedActive = activeList.filter((e) => Boolean(e.dateKey));
    const pastOpenCount = datedActive.filter((e) => (e.dateKey as string) < todayKey).length;
    const todayCount = datedActive.filter((e) => e.dateKey === todayKey).length;
    const upcomingCount = datedActive.filter((e) => (e.dateKey as string) > todayKey).length;
    const scopedTbdCount = scopedList.filter((e) => !e.dateKey).length;

    return {
      activeList,
      completedList,
      scopedList,
      activeCount: activeList.length,
      completedCount: completedList.length,
      allCount: allEntries.length,
      pastOpenCount,
      todayCount,
      upcomingCount,
      scopedTbdCount,
    };
  }, [allEntries, agendaScope, todayKey]);

  const agendaData = useMemo(() => {
    if (viewMode !== 'AGENDA') {
      return {
        pastOpenGroups: [] as Array<{
          dateKey: string;
          items: EnrichedLaunchEntry[];
          isToday: boolean;
          isPast: boolean;
          relativeTag: string | null;
        }>,
        upcomingGroups: [] as Array<{
          dateKey: string;
          items: EnrichedLaunchEntry[];
          isToday: boolean;
          isPast: boolean;
          relativeTag: string | null;
        }>,
        historyGroups: [] as Array<{
          dateKey: string;
          items: EnrichedLaunchEntry[];
          isToday: boolean;
          isPast: boolean;
          relativeTag: string | null;
        }>,
        tbdItems: [] as EnrichedLaunchEntry[],
      };
    }

    const groupByDate = (list: EnrichedLaunchEntry[], direction: 'ASC' | 'DESC') => {
      const sorted = [...list]
        .filter((e) => Boolean(e.dateKey))
        .sort((a, b) =>
          direction === 'ASC'
            ? (a.dateKey as string).localeCompare(b.dateKey as string)
            : (b.dateKey as string).localeCompare(a.dateKey as string)
        );
      const map = new Map<string, EnrichedLaunchEntry[]>();
      for (const entry of sorted) {
        const dk = entry.dateKey as string;
        const arr = map.get(dk) || [];
        arr.push(entry);
        map.set(dk, arr);
      }
      return Array.from(map.entries()).map(([dateKey, items]) => ({
        dateKey,
        items,
        isToday: dateKey === todayKey,
        isPast: dateKey < todayKey,
        relativeTag: formatRelativeDayTag(dateKey, todayKey),
      }));
    };

    const upcomingList = timelineStats.activeList.filter(
      (e) => e.dateKey && e.dateKey >= todayKey
    );
    const pastOpenList = timelineStats.activeList.filter(
      (e) => e.dateKey && e.dateKey < todayKey
    );

    const tbdItems = timelineStats.scopedList.filter((e) => !e.dateKey);

    return {
      pastOpenGroups: groupByDate(pastOpenList, 'DESC'),
      upcomingGroups: groupByDate(upcomingList, 'ASC'),
      historyGroups:
        agendaScope === 'COMPLETED'
          ? groupByDate(timelineStats.completedList, 'DESC')
          : agendaScope === 'ALL'
          ? groupByDate(allEntries, 'DESC')
          : [],
      tbdItems,
    };
  }, [viewMode, timelineStats, allEntries, todayKey, agendaScope]);

  const journalGroups = useMemo(() => {
    if (viewMode !== 'JOURNAL') return { clientGroups: [], datedRows: [], tbdRows: [] };

    const sortEntriesChronologically = (a: EnrichedLaunchEntry, b: EnrichedLaunchEntry) => {
      if (a.dateKey && b.dateKey) {
        const cmp = a.dateKey.localeCompare(b.dateKey);
        if (cmp !== 0) return cmp;
      } else if (a.dateKey && !b.dateKey) {
        return -1;
      } else if (!a.dateKey && b.dateKey) {
        return 1;
      } else {
        const periodCmp = (a.targetPeriod || '').localeCompare(b.targetPeriod || '');
        if (periodCmp !== 0) return periodCmp;
      }
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      return (a.task.title || '').localeCompare(b.task.title || '');
    };

    const byClient = new Map<string, EnrichedLaunchEntry[]>();
    for (const entry of timelineStats.scopedList) {
      const arr = byClient.get(entry.clientName) || [];
      arr.push(entry);
      byClient.set(entry.clientName, arr);
    }

    const clientGroups = Array.from(byClient.entries())
      .sort(([aName], [bName]) => aName.localeCompare(bName))
      .map(([clientName, items]) => ({
        clientName,
        items: [...items].sort(sortEntriesChronologically),
      }));

    const datedRows = timelineStats.scopedList
      .filter((e) => Boolean(e.dateKey))
      .sort((a, b) => {
        if (agendaScope === 'COMPLETED') {
          const cmp = (b.dateKey as string).localeCompare(a.dateKey as string);
          return cmp !== 0 ? cmp : (a.task.title || '').localeCompare(b.task.title || '');
        }
        return sortEntriesChronologically(a, b);
      });

    const tbdRows = timelineStats.scopedList
      .filter((e) => !e.dateKey)
      .sort((a, b) => {
        const pCmp = (a.targetPeriod || '').localeCompare(b.targetPeriod || '');
        if (pCmp !== 0) return pCmp;
        return a.clientName.localeCompare(b.clientName);
      });

    return { clientGroups, datedRows, tbdRows };
  }, [viewMode, timelineStats.scopedList, agendaScope]);

  const yearOptions = useMemo(() => {
    const base = todayParts.year;
    return [base - 1, base, base + 1, base + 2];
  }, [todayParts.year]);

  const handleNavigatePrev = useCallback(() => {
    if (viewMode === 'WEEK') {
      const d = new Date(Date.UTC(cursorYear, cursorMonth, cursorDay - 7, 12, 0, 0));
      setCursorYear(d.getUTCFullYear());
      setCursorMonth(d.getUTCMonth());
      setCursorDay(d.getUTCDate());
      return;
    }
    if (cursorMonth === 0) {
      setCursorYear((y) => y - 1);
      setCursorMonth(11);
    } else {
      setCursorMonth((m) => m - 1);
    }
    setCursorDay(1);
  }, [viewMode, cursorYear, cursorMonth, cursorDay]);

  const handleNavigateNext = useCallback(() => {
    if (viewMode === 'WEEK') {
      const d = new Date(Date.UTC(cursorYear, cursorMonth, cursorDay + 7, 12, 0, 0));
      setCursorYear(d.getUTCFullYear());
      setCursorMonth(d.getUTCMonth());
      setCursorDay(d.getUTCDate());
      return;
    }
    if (cursorMonth === 11) {
      setCursorYear((y) => y + 1);
      setCursorMonth(0);
    } else {
      setCursorMonth((m) => m + 1);
    }
    setCursorDay(1);
  }, [viewMode, cursorYear, cursorMonth, cursorDay]);

  const handleGoToday = useCallback(() => {
    setCursorYear(todayParts.year);
    setCursorMonth(todayParts.month);
    setCursorDay(todayParts.day);
  }, [todayParts]);

  const openScheduleModal = useCallback(
    (opts?: { task?: LaunchMapLightItem; dateKey?: string }) => {
      setEditorState({
        open: true,
        task: opts?.task || null,
        dateKey: opts?.dateKey || buildDateKey(cursorYear, cursorMonth, cursorDay),
      });
    },
    [cursorYear, cursorMonth, cursorDay]
  );

  const handleQuickScheduleForDay = useCallback(
    (dateKey: string) => openScheduleModal({ dateKey }),
    [openScheduleModal]
  );

  const handleUnscheduleTask = useCallback(
    async (taskId: string) => {
      try {
        const res = await taskMapApi.updateLaunchMeta(taskId, {
          launchDate: null,
          targetPeriod: null,
          isLaunchDate: false,
          syncDueDate: true,
        });
        if (res.success) {
          onLaunchMetaUpdated?.(taskId, {
            launchMeta: res.launchMeta,
            effectiveLaunchDate: res.effectiveLaunchDate,
            targetPeriod: res.targetPeriod ?? null,
            dueDate: res.dueDate,
          });
          toast.success('Removed from Launch Map');
          onDataRefresh?.();
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to clear launch date');
      }
    },
    [onLaunchMetaUpdated, onDataRefresh]
  );

  const handleToggleMilestoneQuick = useCallback(
    async (entry: EnrichedLaunchEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const nextFlag = !entry.isMilestone;
        const res = await taskMapApi.updateLaunchMeta(entry.task.id, {
          launchDate: entry.dateKey,
          targetPeriod: entry.targetPeriod,
          isLaunchDate: nextFlag,
          syncDueDate: false,
        });
        if (res.success) {
          onLaunchMetaUpdated?.(entry.task.id, {
            launchMeta: res.launchMeta,
            effectiveLaunchDate: res.effectiveLaunchDate,
            targetPeriod: res.targetPeriod ?? null,
            dueDate: res.dueDate,
          });
          toast.success(nextFlag ? 'Marked as LAUNCH DATE' : 'Removed LAUNCH DATE status');
          onDataRefresh?.();
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to update Launch Date status');
      }
    },
    [onLaunchMetaUpdated, onDataRefresh]
  );

  const renderJournalRow = (entry: EnrichedLaunchEntry, showClientTag: boolean) => {
    const relTag = entry.dateKey ? formatRelativeDayTag(entry.dateKey, todayKey) : null;
    const isOverdue = Boolean(entry.dateKey && entry.dateKey < todayKey && !entry.isClosed);
    const isTodayRow = entry.dateKey === todayKey;

    return (
      <tr
        key={entry.task.id}
        onClick={() => onOpenDetail(entry.task)}
        className={`group border-b border-[var(--border)]/65 transition-colors cursor-pointer hover:bg-[var(--hover-subtle)] ${
          entry.isInReview
            ? 'bg-orange-500/[0.05] [.theme-light_&]:bg-orange-50/70'
            : isTodayRow
            ? 'bg-[color-mix(in_srgb,var(--accent,#4F46E5)_7%,transparent)]'
            : ''
        }`}
      >
        {/* 1. Date */}
        <td className="px-3.5 py-2.5 align-top whitespace-nowrap w-[155px]">
          {entry.dateKey ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-[var(--text)]">
                {formatShortDate(entry.dateKey)}
              </span>
              {relTag && (
                <span
                  className={`text-[10.5px] font-medium ${
                    isTodayRow
                      ? 'text-[var(--accent)] font-bold'
                      : isOverdue
                      ? 'text-amber-400 [.theme-light_&]:text-amber-700'
                      : 'text-[var(--muted)]'
                  }`}
                >
                  {relTag}
                </span>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/35 [.theme-light_&]:bg-indigo-50 [.theme-light_&]:text-indigo-800 [.theme-light_&]:border-indigo-300">
              <CalendarClock className="size-3 shrink-0" />
              {entry.targetPeriod || 'TBD'}
            </span>
          )}
        </td>

        {/* 2. Task */}
        <td className="px-3.5 py-2.5 align-top min-w-[220px] max-w-[300px]">
          <div className="flex flex-col gap-1">
            <div className="flex items-start gap-1.5">
              <span className="text-xs font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors leading-snug">
                {entry.task.title}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {showClientTag && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[10px] font-medium text-[var(--muted)]">
                  {entry.clientName}
                </span>
              )}
              {entry.workstream && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[10px] text-[var(--muted)]">
                  <Layers className="size-2.5 shrink-0" />
                  <span className="truncate max-w-[180px]">{entry.workstream}</span>
                </span>
              )}
              {entry.task.listId && (
                <Link
                  href={`/lists/${entry.task.listId}?task=${entry.task.id}`}
                  onClick={(e) => e.stopPropagation()}
                  title="Open task in client board"
                  className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-[var(--accent)] hover:underline transition-opacity"
                >
                  <span>Board</span>
                  <ExternalLink className="size-2.5" />
                </Link>
              )}
            </div>
          </div>
        </td>

        {/* 3. Details */}
        <td className="px-3.5 py-2.5 align-top min-w-[220px] max-w-[340px] text-xs text-[var(--text)]/90">
          <LaunchTextWithLinks text={entry.details} />
        </td>

        {/* 4. Status */}
        <td className="px-3.5 py-2.5 align-top whitespace-nowrap">
          <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
            {entry.isUrgent && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/20 text-red-300 border border-red-500/40 [.theme-light_&]:bg-red-50 [.theme-light_&]:text-red-700 [.theme-light_&]:border-red-300">
                <Flag className="size-2.5" />
                URGENT
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/15 text-rose-300 border border-rose-500/35 [.theme-light_&]:bg-rose-50 [.theme-light_&]:text-rose-700 [.theme-light_&]:border-rose-300">
              <Rocket className="size-2.5" />
              LAUNCH DATE
            </span>
            {!/\blaunch\s*date\b/i.test(entry.canonicalStatus) && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border"
                style={{
                  backgroundColor: `${entry.statusColor}20`,
                  color: entry.statusColor,
                  borderColor: `${entry.statusColor}45`,
                }}
              >
                {entry.isInReview && <AlertTriangle className="size-2.5" />}
                {entry.canonicalStatus}
              </span>
            )}
            {entry.subStatuses.map((sub) => (
              <span
                key={sub}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)]"
              >
                {sub}
              </span>
            ))}
          </div>
        </td>

        {/* 5. Assignees */}
        <td className="px-3.5 py-2.5 align-top min-w-[150px] max-w-[230px]">
          <LaunchAssigneeChips assignees={entry.assignees} maxVisible={3} />
        </td>

        {/* 6. Notes */}
        <td className="px-3.5 py-2.5 align-top min-w-[200px] max-w-[320px] text-xs text-[var(--muted)]">
          <LaunchTextWithLinks text={entry.notes} />
        </td>

        {/* Actions */}
        <td className="px-2.5 py-2.5 align-top whitespace-nowrap text-right w-[68px]">
          <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openScheduleModal({ task: entry.task });
              }}
              className="p-1.5 rounded-md hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
              title="Edit Launch Details"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleUnscheduleTask(entry.task.id);
              }}
              className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 cursor-pointer"
              title="Remove from Launch Map"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const renderAgendaScopeTabs = () => (
    <div className="flex items-center gap-1 rounded-lg bg-[var(--bg)]/60 border border-[var(--border)] p-0.5 text-[11px] font-medium">
      {(
        [
          { key: 'ACTIVE', label: 'Active', count: timelineStats.activeCount },
          { key: 'COMPLETED', label: 'Completed', count: timelineStats.completedCount },
          { key: 'ALL', label: 'All', count: timelineStats.allCount },
        ] as const
      ).map((tab) => {
        const isActive = agendaScope === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => setAgendaScope(tab.key)}
            className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              isActive
                ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <span>{tab.label}</span>
            {isActive && <span className="tabular-nums opacity-85">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="launch-map-calendar flex flex-col h-full w-full px-5 pb-4 pt-3 gap-2.5 overflow-hidden select-none">
      <style>{`
        .launch-map-calendar .launch-map-header-bar {
          background-color: color-mix(in srgb, var(--accent, #4F46E5) 8%, var(--surface));
        }
        .launch-map-calendar .launch-cell-weekday {
          background-color: var(--surface);
        }
        .launch-map-calendar .launch-cell-weekday:hover {
          background-color: var(--hover-subtle);
        }
        .launch-map-calendar .launch-cell-weekend {
          background-color: color-mix(in srgb, var(--surface) 64%, var(--bg));
        }
        .launch-map-calendar .launch-cell-weekend:hover {
          background-color: var(--hover-subtle);
        }
        .launch-map-calendar .launch-cell-outside {
          background-color: color-mix(in srgb, var(--bg) 82%, var(--surface));
        }
        .launch-map-calendar .launch-cell-outside:hover {
          background-color: color-mix(in srgb, var(--hover-subtle) 65%, var(--bg));
        }
        .launch-map-calendar .launch-cell-today {
          background-color: color-mix(in srgb, var(--accent, #4F46E5) 11%, var(--surface));
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, #4F46E5) 60%, transparent);
        }
        .launch-map-calendar .launch-cell-today:hover {
          background-color: color-mix(in srgb, var(--accent, #4F46E5) 16%, var(--surface));
        }
        .launch-map-calendar .launch-pill-default {
          background-color: color-mix(in srgb, var(--bg) 52%, var(--surface));
        }
        .launch-map-calendar .launch-pill-default:hover {
          background-color: var(--hover-subtle);
        }
        .launch-map-calendar .launch-pill-closed {
          background-color: color-mix(in srgb, var(--bg) 74%, var(--surface));
          opacity: 0.85;
        }
        .launch-map-calendar .launch-pill-closed:hover {
          background-color: var(--hover-subtle);
          opacity: 1;
        }
      `}</style>

      {/* Single Unified Header + Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Title + Month/Year Navigation (when in Month/Week) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-1">
            <div
              className="size-7 rounded-lg border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent, #4F46E5) 14%, var(--surface))',
                borderColor: 'color-mix(in srgb, var(--accent, #4F46E5) 36%, var(--border))',
              }}
            >
              <Rocket className="size-3.5 text-[var(--accent)]" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-[var(--text)] tracking-tight">
              Launch Map
            </h1>
          </div>

          {(viewMode === 'MONTH' || viewMode === 'WEEK') && (
            <>
              <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={handleNavigatePrev}
                  className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] transition-colors cursor-pointer"
                  title={viewMode === 'WEEK' ? 'Previous week' : 'Previous month'}
                >
                  <ChevronLeft className="size-3.5" />
                </button>

                <select
                  value={cursorMonth}
                  onChange={(e) => {
                    setCursorMonth(Number(e.target.value));
                    setCursorDay(1);
                  }}
                  aria-label="Month"
                  className="bg-transparent px-1.5 py-0.5 text-xs font-semibold text-[var(--text)] focus:outline-none cursor-pointer"
                >
                  {MONTHS.map((mName, idx) => (
                    <option key={mName} value={idx} className="bg-popover text-foreground">
                      {mName}
                    </option>
                  ))}
                </select>

                <select
                  value={cursorYear}
                  onChange={(e) => setCursorYear(Number(e.target.value))}
                  aria-label="Year"
                  className="bg-transparent px-1 py-0.5 text-xs font-semibold text-[var(--text)] focus:outline-none cursor-pointer"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y} className="bg-popover text-foreground">
                      {y}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleNavigateNext}
                  className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] transition-colors cursor-pointer"
                  title={viewMode === 'WEEK' ? 'Next week' : 'Next month'}
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleGoToday}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs font-medium text-[var(--text)] hover:bg-[var(--hover-subtle)] transition-colors cursor-pointer"
              >
                Today
              </button>
            </>
          )}

          {loadingRange && (
            <Loader2 className="size-3.5 animate-spin text-[var(--accent)] shrink-0" aria-label="Loading" />
          )}
        </div>

        {/* Right: TBD pill + View Switcher + Search/Client slot + Schedule Button */}
        <div className="flex flex-wrap items-center gap-2">
          {(viewMode === 'MONTH' || viewMode === 'WEEK') && tbdEntries.length > 0 && (
            <button
              type="button"
              onClick={() => handleSetViewMode('JOURNAL')}
              title="View Year-Level / TBD launches in Journal"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/35 [.theme-light_&]:bg-indigo-50 [.theme-light_&]:text-indigo-800 [.theme-light_&]:border-indigo-300 hover:opacity-90 cursor-pointer"
            >
              <CalendarClock className="size-3" />
              <span>{tbdEntries.length} TBD</span>
            </button>
          )}

          <div className="flex items-center bg-[var(--surface)] border border-[var(--border)] rounded-lg p-0.5 text-[11px] font-medium">
            {(
              [
                { key: 'JOURNAL', label: 'Journal', icon: Table2 },
                { key: 'MONTH', label: 'Month', icon: null },
                { key: 'WEEK', label: 'Week', icon: null },
                { key: 'AGENDA', label: 'Agenda', icon: null },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => handleSetViewMode(opt.key)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    viewMode === opt.key
                      ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold shadow-xs'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {Icon && <Icon className="size-3" />}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {toolbarRightSlot}

          <button
            type="button"
            onClick={() => openScheduleModal()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:opacity-90 text-[var(--on-accent)] text-xs font-semibold shadow-xs transition-opacity cursor-pointer whitespace-nowrap"
          >
            <Plus className="size-3.5" />
            <span>Schedule</span>
          </button>
        </div>
      </div>

      {/* Main Content Surface */}
      <div className="flex-1 min-h-0 rounded-xl overflow-hidden flex flex-col border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        {/* JOURNAL TABLE VIEW */}
        {viewMode === 'JOURNAL' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Journal Scope & Grouping Strip */}
            <div className="launch-map-header-bar shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)]">
              <div className="flex flex-wrap items-center gap-2">
                {renderAgendaScopeTabs()}

                <div className="flex items-center gap-1 rounded-lg bg-[var(--bg)]/60 border border-[var(--border)] p-0.5 text-[11px] font-medium">
                  {(
                    [
                      { key: 'CLIENT', label: 'By Client' },
                      { key: 'DATE', label: 'By Date' },
                    ] as const
                  ).map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setJournalGroupMode(g.key)}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        journalGroupMode === g.key
                          ? 'bg-[var(--surface)] text-[var(--text)] font-semibold border border-[var(--border)] shadow-2xs'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
                <span>
                  <strong className="text-[var(--text)] font-semibold">{timelineStats.todayCount}</strong> Today
                </span>
                <span>
                  <strong className="text-[var(--text)] font-semibold">{timelineStats.upcomingCount}</strong> Upcoming
                </span>
                {timelineStats.pastOpenCount > 0 && (
                  <span className="text-amber-400 [.theme-light_&]:text-amber-700">
                    <strong className="font-semibold">{timelineStats.pastOpenCount}</strong> Past Open
                  </span>
                )}
                {timelineStats.scopedTbdCount > 0 && (
                  <span className="text-indigo-300 [.theme-light_&]:text-indigo-700">
                    <strong className="font-semibold">{timelineStats.scopedTbdCount}</strong> TBD
                  </span>
                )}
              </div>
            </div>

            {/* Table Scroller */}
            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
              {timelineStats.scopedList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-2">
                  <Rocket className="size-8 text-[var(--accent)]/60" />
                  <p className="text-sm font-semibold text-[var(--text)]">
                    No tasks with LAUNCH DATE status match this filter
                  </p>
                  <p className="text-xs text-[var(--muted)] max-w-md">
                    Schedule a Nexus task with LAUNCH DATE status to track its Date, Task, Details, Status, Assignees, and Notes here.
                  </p>
                  <button
                    type="button"
                    onClick={() => openScheduleModal()}
                    className="mt-2 px-3.5 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold cursor-pointer"
                  >
                    + Schedule Launch Date
                  </button>
                </div>
              ) : (
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] shadow-2xs">
                    <tr className="launch-map-header-bar text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Task</th>
                      <th className="px-3.5 py-2.5">Details</th>
                      <th className="px-3.5 py-2.5">Status</th>
                      <th className="px-3.5 py-2.5">Assignees</th>
                      <th className="px-3.5 py-2.5">Notes</th>
                      <th className="px-2.5 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalGroupMode === 'CLIENT' ? (
                      journalGroups.clientGroups.map((group) => {
                        const isCollapsed = Boolean(collapsedClients[group.clientName]);
                        return (
                          <React.Fragment key={group.clientName}>
                            <tr
                              onClick={() =>
                                setCollapsedClients((prev) => ({
                                  ...prev,
                                  [group.clientName]: !prev[group.clientName],
                                }))
                              }
                              className="bg-[color-mix(in_srgb,var(--bg)_65%,var(--surface))] border-b border-[var(--border)] cursor-pointer hover:bg-[var(--hover-subtle)] transition-colors"
                            >
                              <td colSpan={7} className="px-3.5 py-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <ChevronDown
                                      className={`size-3.5 text-[var(--muted)] transition-transform ${
                                        isCollapsed ? '-rotate-90' : ''
                                      }`}
                                    />
                                    <Building2 className="size-3.5 text-[var(--accent)]" />
                                    <span className="text-xs font-bold text-[var(--text)]">
                                      {group.clientName}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)]">
                                      {group.items.length}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openScheduleModal();
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--accent)] cursor-pointer"
                                  >
                                    <Plus className="size-3" />
                                    <span>Schedule</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {!isCollapsed &&
                              group.items.map((entry) => renderJournalRow(entry, false))}
                          </React.Fragment>
                        );
                      })
                    ) : (
                      <>
                        {journalGroups.datedRows.map((entry) => renderJournalRow(entry, true))}
                        {journalGroups.tbdRows.length > 0 && (
                          <>
                            <tr className="bg-[color-mix(in_srgb,var(--bg)_65%,var(--surface))] border-b border-[var(--border)]">
                              <td colSpan={7} className="px-3.5 py-2">
                                <div className="flex items-center gap-2">
                                  <CalendarClock className="size-3.5 text-indigo-400" />
                                  <span className="text-xs font-bold text-[var(--text)] uppercase tracking-wide">
                                    TBD / Year-Level Target Dates
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)]">
                                    {journalGroups.tbdRows.length}
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {journalGroups.tbdRows.map((entry) => renderJournalRow(entry, true))}
                          </>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* MONTH VIEW */}
        {viewMode === 'MONTH' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-auto custom-scrollbar">
            <div className="launch-map-header-bar grid grid-cols-7 border-b border-[var(--border)] shrink-0">
              {WEEKDAYS.map((day, idx) => {
                const isWeekend = idx === 0 || idx === 6;
                return (
                  <div
                    key={day}
                    className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider border-r last:border-r-0 border-[var(--border)] ${
                      isWeekend ? 'text-[var(--muted)]' : 'text-[var(--text)]'
                    }`}
                  >
                    {day}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-[540px]">
              {monthGridDays.map((cell) => (
                <MonthDayCell
                  key={cell.dateKey}
                  dateKey={cell.dateKey}
                  dayNum={cell.dayNum}
                  inCurrentMonth={cell.inCurrentMonth}
                  isWeekend={cell.isWeekend}
                  isToday={cell.isToday}
                  entries={entriesByDate.get(cell.dateKey) || []}
                  onSelectDay={setSelectedDayKey}
                  onQuickSchedule={handleQuickScheduleForDay}
                  onOpenDetail={onOpenDetail}
                />
              ))}
            </div>
          </div>
        )}

        {/* WEEK VIEW */}
        {viewMode === 'WEEK' && (
          <div className="grid grid-cols-1 md:grid-cols-7 flex-1 min-h-0 overflow-auto custom-scrollbar">
            {weekGridDays.map((day) => {
              const dayEntries = entriesByDate.get(day.dateKey) || [];
              return (
                <div
                  key={day.dateKey}
                  className={`flex flex-col border-r last:border-r-0 border-[var(--border)] min-h-[420px] ${
                    day.isToday
                      ? 'launch-cell-today'
                      : day.isWeekend
                      ? 'launch-cell-weekend'
                      : 'launch-cell-weekday'
                  }`}
                >
                  <div
                    onClick={() => setSelectedDayKey(day.dateKey)}
                    className="launch-map-header-bar flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)] cursor-pointer hover:opacity-90"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase text-[var(--muted)]">
                        {day.weekday}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          day.isToday
                            ? 'px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--on-accent)]'
                            : 'text-[var(--text)]'
                        }`}
                      >
                        {day.monthShort} {day.dayNum}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openScheduleModal({ dateKey: day.dateKey });
                      }}
                      className="p-1 rounded hover:bg-[var(--hover-subtle)] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2">
                    {dayEntries.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-[11px] text-[var(--muted)] italic py-8 text-center">
                        No launches
                      </div>
                    ) : (
                      dayEntries.map((entry) => (
                        <div
                          key={entry.task.id}
                          onClick={() => onOpenDetail(entry.task)}
                          className={`group rounded-lg border p-2.5 flex flex-col gap-1.5 cursor-pointer transition-colors ${
                            entry.isInReview
                              ? 'border-orange-500/60 bg-orange-500/15 hover:bg-orange-500/25 [.theme-light_&]:bg-orange-50 [.theme-light_&]:border-orange-300'
                              : entry.isMilestone
                              ? 'border-rose-500/50 bg-rose-500/15 hover:bg-rose-500/25 [.theme-light_&]:bg-rose-50 [.theme-light_&]:border-rose-300'
                              : 'launch-pill-default border-[var(--border)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[10px] font-medium text-[var(--muted)] truncate max-w-[130px]">
                              {entry.clientName}
                            </span>
                            <div className="flex items-center gap-1">
                              {entry.isUrgent && (
                                <Flag className="size-3 text-red-400 [.theme-light_&]:text-red-600" />
                              )}
                              {entry.isMilestone && (
                                <Rocket className="size-3 text-rose-400 [.theme-light_&]:text-rose-600" />
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openScheduleModal({ task: entry.task });
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--hover-subtle)] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                              >
                                <Pencil className="size-3" />
                              </button>
                            </div>
                          </div>

                          <p className="text-xs font-semibold text-[var(--text)] line-clamp-2 leading-snug">
                            {entry.task.title}
                          </p>

                          {entry.details && (
                            <p className="text-[10.5px] text-[var(--muted)] line-clamp-2 leading-snug">
                              {entry.details}
                            </p>
                          )}

                          {entry.workstream && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)]">
                              <Layers className="size-2.5 shrink-0" />
                              <span className="truncate">{entry.workstream}</span>
                            </span>
                          )}

                          <div className="flex items-center justify-between gap-1.5 pt-0.5">
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold uppercase border"
                              style={{
                                backgroundColor: `${entry.statusColor}20`,
                                color: entry.statusColor,
                                borderColor: `${entry.statusColor}45`,
                              }}
                            >
                              {entry.isInReview && <AlertTriangle className="size-2.5" />}
                              {entry.canonicalStatus}
                            </span>

                            {entry.assignees.length > 0 && (
                              <span className="text-[10px] text-[var(--muted)] truncate max-w-[95px]">
                                {entry.assignees.map((a) => a.name).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* AGENDA VIEW */}
        {viewMode === 'AGENDA' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Compact Agenda Scope Strip */}
            <div className="launch-map-header-bar shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)]">
              {renderAgendaScopeTabs()}

              {agendaScope === 'ACTIVE' && (
                <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
                  <span>
                    <strong className="text-[var(--text)] font-semibold">{timelineStats.todayCount}</strong> Today
                  </span>
                  <span>
                    <strong className="text-[var(--text)] font-semibold">{timelineStats.upcomingCount}</strong> Upcoming
                  </span>
                  {timelineStats.pastOpenCount > 0 && (
                    <span className="text-amber-400 [.theme-light_&]:text-amber-700">
                      <strong className="font-semibold">{timelineStats.pastOpenCount}</strong> Past Open
                    </span>
                  )}
                  {timelineStats.scopedTbdCount > 0 && (
                    <span className="text-indigo-300 [.theme-light_&]:text-indigo-700">
                      <strong className="font-semibold">{timelineStats.scopedTbdCount}</strong> TBD
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Block Scroll Timeline — No Flex Height Compression */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {(() => {
                const renderAgendaItem = (entry: EnrichedLaunchEntry) => (
                  <div
                    key={entry.task.id}
                    onClick={() => onOpenDetail(entry.task)}
                    className={`group flex items-start justify-between gap-4 px-4 py-2.5 transition-colors cursor-pointer hover:bg-[var(--hover-subtle)] ${
                      entry.isInReview
                        ? 'border-l-2 border-l-orange-400 bg-orange-500/[0.06] [.theme-light_&]:bg-orange-50/70'
                        : entry.isMilestone
                        ? 'border-l-2 border-l-rose-400 bg-rose-500/[0.05] [.theme-light_&]:bg-rose-50/60'
                        : ''
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="mt-1 shrink-0">
                        {entry.isInReview ? (
                          <AlertTriangle className="size-3.5 text-orange-400 [.theme-light_&]:text-orange-600" />
                        ) : entry.isUrgent ? (
                          <Flag className="size-3.5 text-red-400 [.theme-light_&]:text-red-600" />
                        ) : entry.isMilestone ? (
                          <Rocket className="size-3.5 text-rose-400 [.theme-light_&]:text-rose-600" />
                        ) : entry.isClosed ? (
                          <CheckCircle2 className="size-3.5 text-emerald-400 [.theme-light_&]:text-emerald-600" />
                        ) : (
                          <span
                            className="block size-2.5 rounded-full mt-0.5"
                            style={{ backgroundColor: entry.statusColor }}
                          />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-[var(--text)] leading-snug">
                            {entry.task.title}
                          </span>
                          {entry.targetPeriod && !entry.dateKey && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/35 [.theme-light_&]:bg-indigo-50 [.theme-light_&]:text-indigo-800 [.theme-light_&]:border-indigo-300">
                              {entry.targetPeriod}
                            </span>
                          )}
                          {entry.isUrgent && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/40 [.theme-light_&]:bg-red-50 [.theme-light_&]:text-red-700 [.theme-light_&]:border-red-300 shrink-0">
                              URGENT
                            </span>
                          )}
                          {entry.isMilestone && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 [.theme-light_&]:bg-rose-50 [.theme-light_&]:text-rose-700 [.theme-light_&]:border-rose-300 shrink-0">
                              <Rocket className="size-2.5" />
                              LAUNCH DATE
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-[var(--muted)]">
                          <span className="font-medium text-[var(--text)]/80">
                            {entry.clientName}
                          </span>
                          {entry.workstream && (
                            <span className="truncate max-w-[220px]">· {entry.workstream}</span>
                          )}
                        </div>

                        {entry.details && (
                          <div className="text-xs text-[var(--text)]/85">
                            <LaunchTextWithLinks text={entry.details} />
                          </div>
                        )}

                        {entry.notes && (
                          <div className="text-[11px] text-[var(--muted)] italic">
                            <LaunchTextWithLinks text={entry.notes} />
                          </div>
                        )}

                        {entry.assignees.length > 0 && (
                          <div className="pt-0.5">
                            <LaunchAssigneeChips assignees={entry.assignees} maxVisible={4} />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase border whitespace-nowrap"
                        style={{
                          backgroundColor: `${entry.statusColor}20`,
                          color: entry.statusColor,
                          borderColor: `${entry.statusColor}45`,
                        }}
                      >
                        {entry.canonicalStatus}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openScheduleModal({ task: entry.task });
                        }}
                        className="p-1.5 rounded-md opacity-60 group-hover:opacity-100 hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)] transition-all cursor-pointer"
                        title="Edit launch date"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );

                const renderDateGroup = (group: {
                  dateKey: string;
                  items: EnrichedLaunchEntry[];
                  isToday: boolean;
                  isPast: boolean;
                  relativeTag: string | null;
                }) => (
                  <section
                    key={group.dateKey}
                    className={`border-b border-[var(--border)] last:border-b-0 ${
                      group.isToday ? 'border-l-2 border-l-[var(--accent)]' : ''
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between px-4 py-2 border-b border-[var(--border)]/70 ${
                        group.isToday
                          ? 'launch-cell-today'
                          : 'bg-[color-mix(in_srgb,var(--bg)_58%,var(--surface))]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-[var(--text)]">
                          {formatReadableDate(group.dateKey)}
                        </span>
                        {group.isToday ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--accent)] text-[var(--on-accent)]">
                            TODAY
                          </span>
                        ) : group.relativeTag ? (
                          <span
                            className={`text-[11px] font-medium ${
                              group.isPast && group.items.some((i) => !i.isClosed)
                                ? 'text-amber-400 [.theme-light_&]:text-amber-700'
                                : 'text-[var(--muted)]'
                            }`}
                          >
                            {group.relativeTag}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[11px] text-[var(--muted)]">
                          {group.items.length} item{group.items.length === 1 ? '' : 's'}
                        </span>
                        <button
                          type="button"
                          onClick={() => openScheduleModal({ dateKey: group.dateKey })}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                        >
                          <Plus className="size-3" />
                          <span>Add</span>
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-[var(--border)]/60">
                      {group.items.map(renderAgendaItem)}
                    </div>
                  </section>
                );

                const renderTbdSection = () =>
                  agendaData.tbdItems.length > 0 ? (
                    <section className="border-t border-[var(--border)]">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]/70 bg-indigo-500/[0.08] [.theme-light_&]:bg-indigo-50">
                        <div className="flex items-center gap-2">
                          <CalendarClock className="size-3.5 text-indigo-400 [.theme-light_&]:text-indigo-700" />
                          <span className="text-xs font-bold text-indigo-300 [.theme-light_&]:text-indigo-800 uppercase tracking-wide">
                            TBD / Year-Level Target Dates ({agendaData.tbdItems.length})
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-[var(--border)]/60">
                        {agendaData.tbdItems.map(renderAgendaItem)}
                      </div>
                    </section>
                  ) : null;

                if (agendaScope === 'ACTIVE') {
                  const hasAnyActive =
                    agendaData.upcomingGroups.length > 0 ||
                    agendaData.pastOpenGroups.length > 0 ||
                    agendaData.tbdItems.length > 0;

                  if (!hasAnyActive) {
                    return (
                      <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-2">
                        <CheckCircle2 className="size-8 text-emerald-400 [.theme-light_&]:text-emerald-600" />
                        <p className="text-sm font-semibold text-[var(--text)]">
                          All launch deliverables are caught up
                        </p>
                        <p className="text-xs text-[var(--muted)] max-w-sm">
                          No active or upcoming launches with LAUNCH DATE status match the current filter.
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => openScheduleModal()}
                            className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold cursor-pointer"
                          >
                            + Schedule Launch
                          </button>
                          {timelineStats.completedCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setAgendaScope('COMPLETED')}
                              className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-medium text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
                            >
                              View Completed ({timelineStats.completedCount})
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div>
                      {agendaData.pastOpenGroups.length > 0 && (
                        <div className="border-b border-[var(--border)]">
                          <button
                            type="button"
                            onClick={() => setPastOpenExpanded((v) => !v)}
                            className="w-full flex items-center justify-between px-4 py-2 bg-amber-500/[0.08] [.theme-light_&]:bg-amber-50 hover:bg-amber-500/[0.12] transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <Clock className="size-3.5 text-amber-400 [.theme-light_&]:text-amber-700" />
                              <span className="text-xs font-bold text-amber-300 [.theme-light_&]:text-amber-800 uppercase tracking-wide">
                                Needs Attention · Past Target ({timelineStats.pastOpenCount})
                              </span>
                            </div>
                            <ChevronDown
                              className={`size-3.5 text-amber-300 [.theme-light_&]:text-amber-700 transition-transform ${
                                pastOpenExpanded ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                          {pastOpenExpanded && (
                            <div>{agendaData.pastOpenGroups.map(renderDateGroup)}</div>
                          )}
                        </div>
                      )}

                      {agendaData.upcomingGroups.length > 0 && (
                        <div>{agendaData.upcomingGroups.map(renderDateGroup)}</div>
                      )}

                      {renderTbdSection()}
                    </div>
                  );
                }

                if (agendaData.historyGroups.length === 0 && agendaData.tbdItems.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-2">
                      <CalendarIcon className="size-8 text-[var(--muted)]" />
                      <p className="text-sm font-semibold text-[var(--text)]">
                        No {agendaScope === 'COMPLETED' ? 'completed ' : ''}scheduled deliverables
                      </p>
                      <p className="text-xs text-[var(--muted)] max-w-sm">
                        Adjust your client filter or schedule a launch date to see items here.
                      </p>
                    </div>
                  );
                }

                return (
                  <div>
                    {agendaData.historyGroups.map(renderDateGroup)}
                    {renderTbdSection()}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Lazy-Loaded Day Drawer */}
      {selectedDayKey && (
        <LaunchMapDayDrawer
          dateKey={selectedDayKey}
          todayKey={todayKey}
          formattedDate={formatReadableDate(selectedDayKey)}
          entries={entriesByDate.get(selectedDayKey) || []}
          onClose={() => setSelectedDayKey(null)}
          onAddTask={(dateKey) => openScheduleModal({ dateKey })}
          onEditTask={(task) => openScheduleModal({ task })}
          onOpenDetail={onOpenDetail}
          onToggleMilestone={handleToggleMilestoneQuick}
          onUnschedule={handleUnscheduleTask}
        />
      )}

      {/* Lazy-Loaded Schedule Modal */}
      {editorState.open && (
        <LaunchScheduleModal
          initialTask={editorState.task}
          initialDate={editorState.dateKey}
          onClose={() => setEditorState((prev) => ({ ...prev, open: false }))}
          onSaved={(taskId, data) => {
            onLaunchMetaUpdated?.(taskId, data);
            onDataRefresh?.();
          }}
        />
      )}
    </div>
  );
};
