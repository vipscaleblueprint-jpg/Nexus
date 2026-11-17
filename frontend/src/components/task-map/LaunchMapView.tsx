'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
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
} from 'lucide-react';
import {
  LaunchMapLightItem,
  LaunchMeta,
  taskMapApi,
  isLaunchReviewStatus,
  getManilaDateKey,
  getTaskEffectiveLaunchDate,
  isClosedStatus,
  toCanonicalTaskStatus,
} from '@/api/taskMap';
import { STATUS_COLORS } from '@/lib/taskTokens';
import { toast } from '@/lib/toast';
import type { EnrichedLaunchEntry } from './LaunchMapDayDrawer';

const LaunchMapDayDrawer = dynamic(
  () => import('./LaunchMapDayDrawer').then((m) => m.LaunchMapDayDrawer),
  { ssr: false }
);

const LaunchScheduleModal = dynamic(
  () => import('./LaunchScheduleModal').then((m) => m.LaunchScheduleModal),
  { ssr: false }
);

export type CalendarViewMode = 'MONTH' | 'WEEK' | 'AGENDA';
export type LaunchFilterMode = 'ALL' | 'IN_REVIEW' | 'MILESTONES';
export type AgendaScopeMode = 'ACTIVE' | 'COMPLETED' | 'ALL';

interface LaunchMapViewProps {
  tasks: LaunchMapLightItem[];
  search?: string;
  loadingRange?: boolean;
  inReviewCountGlobal?: number;
  toolbarRightSlot?: React.ReactNode;
  onRangeChange: (range: { start?: string; end?: string; mode: CalendarViewMode }) => void;
  onOpenDetail: (task: LaunchMapLightItem) => void;
  onLaunchMetaUpdated?: (
    taskId: string,
    data: { launchMeta: LaunchMeta; effectiveLaunchDate: string | null; dueDate: string | null }
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

function getStatusColorHex(status?: string | null): string {
  const canonical = toCanonicalTaskStatus(status);
  return STATUS_COLORS[canonical] || STATUS_COLORS[(status || '').toUpperCase()] || '#64748b';
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
          {visiblePills.map((entry) => (
            <button
              key={entry.task.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(entry.task);
              }}
              title={`${entry.task.title} · ${entry.clientName} · ${entry.canonicalStatus}${
                entry.isMilestone ? ' · LAUNCH DATE' : ''
              }`}
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
          ))}

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
  inReviewCountGlobal,
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
  const [viewMode, setViewMode] = useState<CalendarViewMode>('MONTH');
  const [filterMode, setFilterMode] = useState<LaunchFilterMode>('ALL');
  const [agendaScope, setAgendaScope] = useState<AgendaScopeMode>('ACTIVE');
  const [pastOpenExpanded, setPastOpenExpanded] = useState<boolean>(true);

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<{
    open: boolean;
    task: LaunchMapLightItem | null;
    dateKey: string;
  }>({ open: false, task: null, dateKey: todayKey });

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
      onRangeChange({ start: undefined, end: undefined, mode: 'AGENDA' });
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

  const { allEntries, inReviewLocalCount } = useMemo(() => {
    const entries: EnrichedLaunchEntry[] = [];
    let reviewCount = 0;

    for (const task of tasks) {
      const dateKey = getTaskEffectiveLaunchDate(task);
      if (!dateKey) continue;

      const closed = Boolean(task.isClosed || isClosedStatus(task.status));
      const inReview = !closed && isLaunchReviewStatus(task.status);
      const milestone = Boolean(
        task.launchMeta?.isLaunchDate ??
          task.isLaunchDate ??
          /\blaunch\s*date\b/i.test(`${task.title || ''} ${task.launchMeta?.notes || ''}`)
      );
      const clientName = task.list?.name || 'General';
      const workstream = task.launchMeta?.workstream || '';
      const notes = task.launchMeta?.notes || '';

      if (inReview) reviewCount++;

      if (searchLower) {
        const assigneeNames = (task.assignees || []).map((a) => a?.name || '').join(' ');
        const haystack = `${task.title || ''} ${clientName} ${workstream} ${notes} ${task.status || ''} ${assigneeNames}`.toLowerCase();
        if (!haystack.includes(searchLower)) continue;
      }

      entries.push({
        task,
        dateKey,
        isInReview: inReview,
        isMilestone: milestone,
        isClosed: closed,
        clientName,
        workstream,
        notes,
        statusColor: getStatusColorHex(task.status),
        canonicalStatus: toCanonicalTaskStatus(task.status) || task.status || 'PENDING',
      });
    }

    entries.sort((a, b) => {
      if (a.isInReview !== b.isInReview) return a.isInReview ? -1 : 1;
      if (a.isMilestone !== b.isMilestone) return a.isMilestone ? -1 : 1;
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      const urgentA = (a.task.priority || '').toUpperCase() === 'URGENT' ? 1 : 0;
      const urgentB = (b.task.priority || '').toUpperCase() === 'URGENT' ? 1 : 0;
      if (urgentA !== urgentB) return urgentB - urgentA;
      return (a.task.title || '').localeCompare(b.task.title || '');
    });

    return { allEntries: entries, inReviewLocalCount: reviewCount };
  }, [tasks, searchLower]);

  const filteredEntries = useMemo(() => {
    if (filterMode === 'IN_REVIEW') return allEntries.filter((e) => e.isInReview);
    if (filterMode === 'MILESTONES') return allEntries.filter((e) => e.isMilestone);
    return allEntries;
  }, [allEntries, filterMode]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, EnrichedLaunchEntry[]>();
    for (const e of filteredEntries) {
      const list = map.get(e.dateKey) || [];
      list.push(e);
      map.set(e.dateKey, list);
    }
    return map;
  }, [filteredEntries]);

  const agendaData = useMemo(() => {
    if (viewMode !== 'AGENDA') {
      return {
        pastOpenGroups: [] as Array<{ dateKey: string; items: EnrichedLaunchEntry[]; isToday: boolean; isPast: boolean; relativeTag: string | null }>,
        upcomingGroups: [] as Array<{ dateKey: string; items: EnrichedLaunchEntry[]; isToday: boolean; isPast: boolean; relativeTag: string | null }>,
        historyGroups: [] as Array<{ dateKey: string; items: EnrichedLaunchEntry[]; isToday: boolean; isPast: boolean; relativeTag: string | null }>,
        activeCount: 0,
        completedCount: 0,
        allCount: 0,
        pastOpenCount: 0,
        todayCount: 0,
        upcomingCount: 0,
      };
    }

    const isRelevantLaunchEntry = (e: EnrichedLaunchEntry) =>
      !e.isClosed && (e.isMilestone || e.isInReview || !isRoutineRecurringStatus(e.task.status));

    const activeEntries = filteredEntries.filter(isRelevantLaunchEntry);
    const completedEntries = filteredEntries.filter((e) => e.isClosed);

    const groupByDate = (list: EnrichedLaunchEntry[], direction: 'ASC' | 'DESC') => {
      const sorted = [...list].sort((a, b) =>
        direction === 'ASC'
          ? a.dateKey.localeCompare(b.dateKey)
          : b.dateKey.localeCompare(a.dateKey)
      );
      const map = new Map<string, EnrichedLaunchEntry[]>();
      for (const entry of sorted) {
        const arr = map.get(entry.dateKey) || [];
        arr.push(entry);
        map.set(entry.dateKey, arr);
      }
      return Array.from(map.entries()).map(([dateKey, items]) => ({
        dateKey,
        items,
        isToday: dateKey === todayKey,
        isPast: dateKey < todayKey,
        relativeTag: formatRelativeDayTag(dateKey, todayKey),
      }));
    };

    const upcomingList = activeEntries.filter((e) => e.dateKey >= todayKey);
    const pastOpenList = activeEntries.filter((e) => e.dateKey < todayKey);

    return {
      // Show newest overdue / IN REVIEW past items first
      pastOpenGroups: groupByDate(pastOpenList, 'DESC'),
      // Today first, then chronological upcoming launches
      upcomingGroups: groupByDate(upcomingList, 'ASC'),
      // Completed or All sorted newest-first so latest launches appear at top
      historyGroups:
        agendaScope === 'COMPLETED'
          ? groupByDate(completedEntries, 'DESC')
          : agendaScope === 'ALL'
          ? groupByDate(filteredEntries, 'DESC')
          : [],
      activeCount: activeEntries.length,
      completedCount: completedEntries.length,
      allCount: filteredEntries.length,
      pastOpenCount: pastOpenList.length,
      todayCount: upcomingList.filter((e) => e.dateKey === todayKey).length,
      upcomingCount: upcomingList.filter((e) => e.dateKey > todayKey).length,
    };
  }, [viewMode, filteredEntries, todayKey, agendaScope]);

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
          isLaunchDate: false,
          syncDueDate: true,
        });
        if (res.success) {
          onLaunchMetaUpdated?.(taskId, {
            launchMeta: res.launchMeta,
            effectiveLaunchDate: res.effectiveLaunchDate,
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
          isLaunchDate: nextFlag,
          syncDueDate: false,
        });
        if (res.success) {
          onLaunchMetaUpdated?.(entry.task.id, {
            launchMeta: res.launchMeta,
            effectiveLaunchDate: res.effectiveLaunchDate,
            dueDate: res.dueDate,
          });
          toast.success(nextFlag ? 'Marked as LAUNCH DATE milestone' : 'Unmarked LAUNCH DATE milestone');
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to update milestone flag');
      }
    },
    [onLaunchMetaUpdated]
  );

  const activeAlertBadgeCount =
    inReviewCountGlobal !== undefined ? inReviewCountGlobal : inReviewLocalCount;

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

      {/* Single Unified, De-cluttered Header + Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Title + Month/Year Navigation + Today + Alert Chip */}
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
            <h1 className="text-base sm:text-lg font-bold text-foreground tracking-tight">
              Launch Map
            </h1>
          </div>

          {viewMode !== 'AGENDA' && (
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

          {activeAlertBadgeCount > 0 && (
            <button
              type="button"
              onClick={() => setFilterMode((prev) => (prev === 'IN_REVIEW' ? 'ALL' : 'IN_REVIEW'))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === 'IN_REVIEW'
                  ? 'bg-orange-500 text-white border-orange-400'
                  : 'bg-orange-500/15 border-orange-500/40 text-orange-300 hover:bg-orange-500/25 [.theme-light_&]:bg-orange-50 [.theme-light_&]:border-orange-300 [.theme-light_&]:text-orange-800'
              }`}
              title="Filter IN REVIEW tasks needing PM & Auditor review"
            >
              <AlertTriangle className="size-3 shrink-0" />
              <span>{activeAlertBadgeCount} IN REVIEW</span>
            </button>
          )}

          {loadingRange && (
            <Loader2 className="size-3.5 animate-spin text-[var(--accent)] shrink-0" aria-label="Loading" />
          )}
        </div>

        {/* Right: Filter + View Switcher + Search/Client slot + Schedule Button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[var(--surface)] border border-[var(--border)] rounded-lg p-0.5 text-[11px] font-medium">
            {(
              [
                { key: 'ALL', label: 'All' },
                { key: 'IN_REVIEW', label: 'In Review' },
                { key: 'MILESTONES', label: 'Launches' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilterMode(opt.key)}
                className={`px-2 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  filterMode === opt.key
                    ? opt.key === 'IN_REVIEW'
                      ? 'bg-orange-500/25 text-orange-200 font-semibold [.theme-light_&]:bg-orange-100 [.theme-light_&]:text-orange-900'
                      : opt.key === 'MILESTONES'
                      ? 'bg-rose-500/25 text-rose-200 font-semibold [.theme-light_&]:bg-rose-100 [.theme-light_&]:text-rose-900'
                      : 'bg-[var(--hover-subtle)] text-[var(--text)] font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-[var(--surface)] border border-[var(--border)] rounded-lg p-0.5 text-[11px] font-medium">
            {(['MONTH', 'WEEK', 'AGENDA'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  viewMode === m
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {m === 'MONTH' ? 'Month' : m === 'WEEK' ? 'Week' : 'Agenda'}
              </button>
            ))}
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

      {/* Calendar Surface — Palette-Adaptive Nexus Theme */}
      <div className="flex-1 min-h-0 rounded-xl overflow-hidden flex flex-col border border-[var(--border)] bg-[var(--surface)] shadow-sm">
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

                            {(entry.task.assignees?.length || entry.task.assignee) && (
                              <span className="text-[10px] text-[var(--muted)] truncate max-w-[90px]">
                                {entry.task.assignees?.[0]?.name || entry.task.assignee?.name}
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

        {viewMode === 'AGENDA' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Compact Agenda Scope Strip */}
            <div className="launch-map-header-bar shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-1 rounded-lg bg-[var(--bg)]/60 border border-[var(--border)] p-0.5 text-[11px] font-medium">
                {(
                  [
                    { key: 'ACTIVE', label: 'Active', count: agendaData.activeCount },
                    { key: 'COMPLETED', label: 'Completed', count: agendaData.completedCount },
                    { key: 'ALL', label: 'All', count: agendaData.allCount },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setAgendaScope(tab.key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      agendaScope === tab.key
                        ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold shadow-xs'
                        : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono ${
                        agendaScope === tab.key ? 'opacity-85' : 'text-[var(--muted)]'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {agendaScope === 'ACTIVE' && (
                <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
                  <span>
                    <strong className="text-[var(--text)] font-semibold">{agendaData.todayCount}</strong> Today
                  </span>
                  <span>
                    <strong className="text-[var(--text)] font-semibold">{agendaData.upcomingCount}</strong> Upcoming
                  </span>
                  {agendaData.pastOpenCount > 0 && (
                    <span className="text-amber-400 [.theme-light_&]:text-amber-700">
                      <strong className="font-semibold">{agendaData.pastOpenCount}</strong> Past Open
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Block Scroll Timeline — No Flex Height Compression */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {(() => {
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
                      {group.items.map((entry) => {
                        const assigneeName =
                          entry.task.assignees?.[0]?.name || entry.task.assignee?.name || '';
                        return (
                          <div
                            key={entry.task.id}
                            onClick={() => onOpenDetail(entry.task)}
                            className={`group flex items-center justify-between gap-4 px-4 py-2.5 transition-colors cursor-pointer hover:bg-[var(--hover-subtle)] ${
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

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[13px] font-semibold text-[var(--text)] leading-snug">
                                    {entry.task.title}
                                  </span>
                                  {entry.isMilestone && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 [.theme-light_&]:bg-rose-50 [.theme-light_&]:text-rose-700 [.theme-light_&]:border-rose-300 shrink-0">
                                      <Rocket className="size-2.5" />
                                      LAUNCH DATE
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-[var(--muted)] mt-0.5">
                                  <span className="font-medium text-[var(--text)]/80">
                                    {entry.clientName}
                                  </span>
                                  {entry.workstream && (
                                    <span className="truncate max-w-[220px]">· {entry.workstream}</span>
                                  )}
                                  {assigneeName && (
                                    <span className="truncate max-w-[160px]">· {assigneeName}</span>
                                  )}
                                  {entry.notes && (
                                    <span className="truncate max-w-[320px] italic">
                                      — {entry.notes}
                                    </span>
                                  )}
                                </div>
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
                      })}
                    </div>
                  </section>
                );

                if (agendaScope === 'ACTIVE') {
                  const hasAnyActive =
                    agendaData.upcomingGroups.length > 0 || agendaData.pastOpenGroups.length > 0;

                  if (!hasAnyActive) {
                    return (
                      <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-2">
                        <CheckCircle2 className="size-8 text-emerald-400 [.theme-light_&]:text-emerald-600" />
                        <p className="text-sm font-semibold text-[var(--text)]">
                          All launch deliverables are caught up
                        </p>
                        <p className="text-xs text-[var(--muted)] max-w-sm">
                          No active or upcoming launches match the current filter.
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => openScheduleModal()}
                            className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold cursor-pointer"
                          >
                            + Schedule Launch
                          </button>
                          {agendaData.completedCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setAgendaScope('COMPLETED')}
                              className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-medium text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
                            >
                              View Completed ({agendaData.completedCount})
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
                                Needs Attention · Past Target ({agendaData.pastOpenCount})
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
                    </div>
                  );
                }

                if (agendaData.historyGroups.length === 0) {
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

                return <div>{agendaData.historyGroups.map(renderDateGroup)}</div>;
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
