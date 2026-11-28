'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  MoreHorizontal,
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

const LaunchDayModal = dynamic(
  () => import('./LaunchDayModal').then((m) => m.LaunchDayModal),
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
    // Clean up legacy stale 'JOURNAL' from localStorage from when it was previously the default
    const legacy = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (legacy === 'JOURNAL') {
      localStorage.removeItem(VIEW_MODE_STORAGE_KEY);
    }

    const saved =
      sessionStorage.getItem(VIEW_MODE_STORAGE_KEY) ||
      localStorage.getItem(VIEW_MODE_STORAGE_KEY);

    if (saved === 'MONTH' || saved === 'WEEK' || saved === 'AGENDA') {
      return saved;
    }

    // Only allow JOURNAL if explicitly chosen within the current browser session
    if (saved === 'JOURNAL' && sessionStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'JOURNAL') {
      return 'JOURNAL';
    }
  } catch {
    // Ignore storage failures
  }
  return 'MONTH';
}

function getServerViewMode(): CalendarViewMode {
  return 'MONTH';
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

export type LaunchTimingState = 'PASSED' | 'TODAY' | 'UPCOMING' | 'FAR';

export function getLaunchTiming(
  dateKey: string | null | undefined,
  todayKey: string,
  isClosed: boolean
): LaunchTimingState {
  if (isClosed) return 'PASSED';
  if (!dateKey) return 'FAR';
  if (dateKey < todayKey) return 'PASSED';
  if (dateKey === todayKey) return 'TODAY';

  try {
    const target = new Date(`${dateKey}T12:00:00+08:00`);
    const today = new Date(`${todayKey}T12:00:00+08:00`);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diffDays <= 7) return 'UPCOMING';
    return 'FAR';
  } catch {
    return 'FAR';
  }
}

interface MonthCellProps {
  dateKey: string;
  dayNum: number;
  inCurrentMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
  todayKey: string;
  entries: EnrichedLaunchEntry[];
  heatOpacity: number;
  isPopoutOpen: boolean;
  onSelectDay: (dateKey: string) => void;
  onQuickSchedule: (dateKey: string) => void;
  onEditLaunch: (task: LaunchMapLightItem, dateKey: string) => void;
  onRequestMenu: (task: LaunchMapLightItem, dateKey: string, anchorRect: DOMRect) => void;
  onMoveLaunch: (taskId: string, targetDateKey: string) => void;
  onOpenPopout: (dateKey: string, anchorRect: DOMRect) => void;
  onClosePopout: () => void;
}

const MonthDayCell = React.memo<MonthCellProps>(
  ({
    dateKey,
    dayNum,
    inCurrentMonth,
    isWeekend,
    isToday,
    todayKey,
    entries,
    heatOpacity,
    isPopoutOpen,
    onSelectDay,
    onQuickSchedule,
    onEditLaunch,
    onRequestMenu,
    onMoveLaunch,
    onOpenPopout,
    onClosePopout,
  }) => {
    const cellRef = React.useRef<HTMLDivElement | null>(null);
    const [isDragOver, setIsDragOver] = React.useState(false);

    // Group entries by client for summary view
    const byClient = React.useMemo(() => {
      const map = new Map<string, EnrichedLaunchEntry[]>();
      for (const e of entries) {
        const arr = map.get(e.clientName) || [];
        arr.push(e);
        map.set(e.clientName, arr);
      }
      return map;
    }, [entries]);

    const multiClient = byClient.size >= 2;
    const hasInReview = entries.some((e) => e.isInReview);

    const cellVariantClass = isToday
      ? 'launch-cell-today'
      : !inCurrentMonth
      ? 'launch-cell-outside'
      : isWeekend
      ? 'launch-cell-weekend'
      : 'launch-cell-weekday';

    const renderPill = (entry: EnrichedLaunchEntry) => {
      const timing = getLaunchTiming(entry.dateKey || dateKey, todayKey, entry.isClosed);

      let pillClasses = 'launch-pill-default text-[var(--text)] border border-[var(--border)]';
      let icon = (
        <span
          className="size-2 rounded-full shrink-0"
          style={{ backgroundColor: entry.statusColor }}
        />
      );

      if (entry.isInReview) {
        pillClasses =
          'border-l-2 border-orange-400 bg-orange-500/20 text-orange-100 hover:bg-orange-500/30 [.theme-light_&]:bg-orange-50 [.theme-light_&]:text-orange-950 [.theme-light_&]:hover:bg-orange-100 [.theme-light_&]:border-orange-500';
        icon = <AlertTriangle className="size-3 shrink-0 text-orange-400 [.theme-light_&]:text-orange-600" />;
      } else if (entry.isUrgent) {
        pillClasses =
          'border-l-2 border-red-400 bg-red-500/20 text-red-100 hover:bg-red-500/30 [.theme-light_&]:bg-red-50 [.theme-light_&]:text-red-950 [.theme-light_&]:border-red-500';
        icon = <Flag className="size-3 shrink-0 text-red-400 [.theme-light_&]:text-red-600" />;
      } else if (timing === 'PASSED') {
        // Date passed: Done styling in emerald green
        pillClasses =
          'border-l-2 border-emerald-400 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 [.theme-light_&]:bg-emerald-50 [.theme-light_&]:text-emerald-950 [.theme-light_&]:border-emerald-600';
        icon = <CheckCircle2 className="size-3 shrink-0 text-emerald-400 [.theme-light_&]:text-emerald-600" />;
      } else if (timing === 'TODAY') {
        // Today's launch: active purple pulse
        pillClasses =
          'border-l-2 border-purple-400 bg-purple-500/25 text-purple-100 hover:bg-purple-500/35 ring-1 ring-purple-500/40 [.theme-light_&]:bg-purple-50 [.theme-light_&]:text-purple-950 [.theme-light_&]:border-purple-600';
        icon = <Rocket className="size-3 shrink-0 text-purple-300 animate-pulse" />;
      } else if (timing === 'UPCOMING') {
        // Upcoming in next 7 days: rose milestone
        pillClasses =
          'border-l-2 border-rose-400 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 [.theme-light_&]:bg-rose-50 [.theme-light_&]:text-rose-950 [.theme-light_&]:hover:bg-rose-100 [.theme-light_&]:border-rose-500';
        icon = <Rocket className="size-3 shrink-0 text-rose-400 [.theme-light_&]:text-rose-600" />;
      } else {
        // Farther away (> 7 days, later months, or TBD): sky blue
        pillClasses =
          'border-l-2 border-sky-400 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 [.theme-light_&]:bg-sky-50 [.theme-light_&]:text-sky-950 [.theme-light_&]:border-sky-500';
        icon = <CalendarClock className="size-3 shrink-0 text-sky-400 [.theme-light_&]:text-sky-600" />;
      }

      return (
        <div
          key={entry.task.id}
          draggable={true}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', entry.task.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onClick={(e) => {
            e.stopPropagation();
            onEditLaunch(entry.task, dateKey);
          }}
          className={`group/pill relative w-full text-left flex items-center justify-between gap-1.5 px-2 py-1 rounded-md text-[11px] leading-tight transition-colors cursor-pointer ${pillClasses}`}
          title={`${entry.task.title} (${entry.clientName}) - ${
            timing === 'PASSED'
              ? 'Passed / Done'
              : timing === 'TODAY'
              ? 'Today'
              : timing === 'UPCOMING'
              ? 'Upcoming in next 7 days'
              : 'Farther away launch'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {icon}
            <span className="truncate font-medium">{entry.task.title}</span>
            <span className="shrink-0 text-[9.5px] opacity-75 max-w-[65px] truncate">
              {entry.clientName}
            </span>
          </div>

          {/* ... Action Menu Button (opens Portal dropdown for Delete) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onRequestMenu(entry.task, dateKey, rect);
            }}
            className="opacity-0 group-hover/pill:opacity-100 p-0.5 rounded hover:bg-black/30 text-current transition-opacity cursor-pointer shrink-0"
            title="Launch options"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </div>
      );
    };

    return (
      <div
        ref={cellRef}
        onClick={() => onSelectDay(dateKey)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!isDragOver) setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const taskId = e.dataTransfer.getData('text/plain');
          if (taskId) {
            onMoveLaunch(taskId, dateKey);
          }
        }}
        className={`launch-map-cell ${cellVariantClass} ${
          isDragOver ? 'ring-2 ring-purple-500 bg-purple-500/20' : ''
        } ${
          isPopoutOpen ? 'ring-2 ring-purple-500/70 border-purple-500/60' : ''
        } group relative flex flex-col p-2 border-r border-b border-[var(--border)] min-h-[140px] sm:min-h-[155px] transition-colors cursor-pointer overflow-hidden`}
        style={
          heatOpacity > 0 && !isDragOver
            ? {
                backgroundColor: `color-mix(in srgb, #000000 ${Math.round(heatOpacity * 90)}%, var(--surface))`,
                borderColor: heatOpacity > 0.25 ? 'rgba(139, 92, 246, 0.4)' : undefined,
              }
            : undefined
        }
      >
        <div className="flex items-center justify-between gap-1 mb-1 px-0.5 shrink-0">
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
            title={`Add launch on ${dateKey}`}
          >
            <Plus className="size-3" />
          </button>
        </div>

        <div className="flex flex-col gap-1 min-w-0 flex-1 overflow-hidden">
          {/* Multi-launch summary pill: opens outward-expanding popover instead of cramped in-cell scroll */}
          {entries.length > 2 || multiClient ? (
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPopoutOpen) {
                    onClosePopout();
                  } else {
                    const rect =
                      cellRef.current?.getBoundingClientRect() ||
                      e.currentTarget.getBoundingClientRect();
                    onOpenPopout(dateKey, rect);
                  }
                }}
                className={`w-full text-left flex items-center justify-between px-2 py-1 rounded transition-all cursor-pointer shrink-0 ${
                  isPopoutOpen
                    ? 'bg-purple-600/30 border border-purple-500/50 text-white shadow-xs'
                    : 'bg-purple-500/15 border border-purple-500/30 hover:bg-purple-500/25 text-purple-300 hover:text-white'
                }`}
                title={isPopoutOpen ? 'Click to collapse launches' : 'Click to expand all launches outward'}
              >
                <span className="text-[9.5px] font-bold uppercase tracking-wider">
                  {entries.length} LAUNCHES
                </span>
                <span className="text-[9.5px] font-semibold flex items-center gap-0.5">
                  {isPopoutOpen ? '▲ Collapse' : '▼ Expand'}
                </span>
              </button>

              {/* Show top 2 pills directly in cell for quick glance */}
              <div className="flex flex-col gap-1 overflow-hidden">
                {entries.slice(0, 2).map(renderPill)}
                {entries.length > 2 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPopoutOpen) {
                        onClosePopout();
                      } else {
                        const rect =
                          cellRef.current?.getBoundingClientRect() ||
                          e.currentTarget.getBoundingClientRect();
                        onOpenPopout(dateKey, rect);
                      }
                    }}
                    className="text-left text-[9.5px] font-medium text-purple-400/90 hover:text-purple-300 pl-1 py-0.5 cursor-pointer transition-colors truncate"
                  >
                    +{entries.length - 2} more launches...
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* 1 or 2 launches fit comfortably directly inside cell */
            <div className="flex flex-col gap-1 overflow-hidden">
              {entries.map(renderPill)}
            </div>
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
  // Day-click, + Launch, and Edit Launch modal state (all unified into new LaunchDayModal)
  const [dayModalState, setDayModalState] = useState<{
    open: boolean;
    dateKey: string;
    task?: LaunchMapLightItem | null;
  } | null>(null);
  const calendarContainerRef = useRef<HTMLDivElement | null>(null);

  // Outward-Expanding Popover for Multi-Launch days
  const [popoverDay, setPopoverDay] = useState<{
    dateKey: string;
    rect: DOMRect;
  } | null>(null);

  // Floating Portal Menu for launch actions ("...")
  const [activeMenu, setActiveMenu] = useState<{
    task: LaunchMapLightItem;
    dateKey: string;
    rect: DOMRect;
  } | null>(null);

  // Confirmation modal for deleting a launch
  const [confirmDeleteState, setConfirmDeleteState] = useState<{
    open: boolean;
    task: LaunchMapLightItem;
  } | null>(null);
  const [deletingLaunch, setDeletingLaunch] = useState(false);

  // Wheel navigation refs
  const wheelCooldownRef = useRef<number>(0);
  const wheelAccumulatorRef = useRef<number>(0);

  useEffect(() => {
    if (!activeMenu) return;
    const handleClose = () => setActiveMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null);
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenu]);

  const handleSetViewMode = useCallback((mode: CalendarViewMode) => {
    try {
      sessionStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
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
    if (!selectedDayKey && !dayModalState?.open && !popoverDay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (popoverDay) setPopoverDay(null);
        else if (dayModalState?.open) setDayModalState(null);
        else if (selectedDayKey) setSelectedDayKey(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDayKey, dayModalState, popoverDay]);

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
      // Completed / done launches are moved to the bottom; upcoming active launches are prioritized at the top
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      if (a.isInReview !== b.isInReview) return a.isInReview ? -1 : 1;
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      if (a.isMilestone !== b.isMilestone) return a.isMilestone ? -1 : 1;
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

  // Reactive entries for outward-expanding popover
  const popoverEntries = useMemo(() => {
    if (!popoverDay?.dateKey) return [];
    return entriesByDate.get(popoverDay.dateKey) || [];
  }, [popoverDay?.dateKey, entriesByDate]);

  // ── Heatmap: compute max launches per day in the visible month grid ──────────
  // Used to darken calendar cells — cells with more launches are darker.
  const monthHeatmap = useMemo(() => {
    const dayCounts = new Map<string, number>();
    for (const cell of monthGridDays) {
      const count = (entriesByDate.get(cell.dateKey) || []).filter((e) => !e.isClosed).length;
      dayCounts.set(cell.dateKey, count);
    }
    const values = Array.from(dayCounts.values());
    const maxCount = Math.max(1, ...values);
    // Returns opacity 0–0.45 for cells based on their active launch count
    const getHeatOpacity = (dateKey: string): number => {
      const c = dayCounts.get(dateKey) || 0;
      if (c === 0) return 0;
      return Math.min(0.45, (c / maxCount) * 0.45);
    };
    return { getHeatOpacity, maxCount };
  }, [monthGridDays, entriesByDate]);

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

  // Earliest upcoming active launch
  const nextUpcomingLaunch = useMemo(() => {
    return allEntries
      .filter((e) => !e.isClosed && e.dateKey && e.dateKey >= todayKey)
      .sort((a, b) => (a.dateKey as string).localeCompare(b.dateKey as string))[0];
  }, [allEntries, todayKey]);

  // If other client launches in the current viewed month are done (or there are no active launches in current month),
  // automatically advance the calendar cursor to the earliest upcoming active launch!
  const userInteractedRef = useRef<boolean>(false);
  const autoAdvancedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (userInteractedRef.current) return;
    if (!nextUpcomingLaunch?.dateKey) return;

    // Check if the current viewed month has any active launches
    const hasActiveInCurrentMonth = allEntries.some((e) => {
      if (e.isClosed || !e.dateKey) return false;
      const p = parseDateKeyParts(e.dateKey);
      return p.year === cursorYear && p.month === cursorMonth;
    });

    if (hasActiveInCurrentMonth) return;

    // If all launches in current month are done, move calendar date to upcoming launch
    const target = parseDateKeyParts(nextUpcomingLaunch.dateKey);
    const targetKey = `${target.year}-${target.month}`;
    if (autoAdvancedKeyRef.current !== targetKey) {
      autoAdvancedKeyRef.current = targetKey;
      setCursorYear(target.year);
      setCursorMonth(target.month);
      setCursorDay(target.day);
    }
  }, [nextUpcomingLaunch, cursorYear, cursorMonth, allEntries]);

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
    const start = Math.min(base - 5, cursorYear - 2);
    const end = Math.max(base + 10, cursorYear + 2);
    const list: number[] = [];
    for (let y = start; y <= end; y++) {
      list.push(y);
    }
    return list;
  }, [todayParts.year, cursorYear]);

  const handleNavigatePrev = useCallback(() => {
    userInteractedRef.current = true;
    setPopoverDay(null);
    setActiveMenu(null);
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
    userInteractedRef.current = true;
    setPopoverDay(null);
    setActiveMenu(null);
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
    userInteractedRef.current = true;
    setPopoverDay(null);
    setActiveMenu(null);
    setCursorYear(todayParts.year);
    setCursorMonth(todayParts.month);
    setCursorDay(todayParts.day);
  }, [todayParts]);

  // On-wheel calendar navigation with scroll-boundary detection
  // Vertically scrolling inside the month scrolls smoothly without changing months;
  // wheeling past the top or bottom boundary advances/retreats the month with debounce.
  const handleCalendarWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Don't intercept wheel if scrolling inside a nested scrollable element like the popover list
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('.custom-scrollbar') &&
        target.closest('.custom-scrollbar') !== calendarContainerRef.current
      ) {
        return;
      }

      const container = calendarContainerRef.current;
      if (!container) return;

      const now = Date.now();
      // Cooldown between month navigations (500ms) to avoid multiple rapid flips
      if (now - wheelCooldownRef.current < 500) {
        return;
      }

      // 1. Horizontal trackpad gesture (left/right)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 40) {
        wheelCooldownRef.current = now;
        wheelAccumulatorRef.current = 0;
        setPopoverDay(null);
        setActiveMenu(null);
        if (e.deltaX > 0) {
          handleNavigateNext();
        } else {
          handleNavigatePrev();
        }
        return;
      }

      // 2. Vertical wheel boundary check
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtTop = scrollTop <= 4;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 6;
      const isScrollable = scrollHeight > clientHeight + 10;

      // When the container is scrollable and the user is scrolling within its body,
      // allow natural vertical scrolling without navigating months
      if (isScrollable) {
        if (e.deltaY > 0 && !isAtBottom) {
          wheelAccumulatorRef.current = 0;
          return;
        }
        if (e.deltaY < 0 && !isAtTop) {
          wheelAccumulatorRef.current = 0;
          return;
        }
      }

      // 3. User is at boundary (top or bottom) and scrolling past it with intent
      wheelAccumulatorRef.current += e.deltaY;

      if (e.deltaY > 0 && (isAtBottom || !isScrollable)) {
        if (wheelAccumulatorRef.current > 50) {
          wheelCooldownRef.current = now;
          wheelAccumulatorRef.current = 0;
          setPopoverDay(null);
          setActiveMenu(null);
          handleNavigateNext();
          requestAnimationFrame(() => {
            if (calendarContainerRef.current) {
              calendarContainerRef.current.scrollTop = 0;
            }
          });
        }
      } else if (e.deltaY < 0 && (isAtTop || !isScrollable)) {
        if (wheelAccumulatorRef.current < -50) {
          wheelCooldownRef.current = now;
          wheelAccumulatorRef.current = 0;
          setPopoverDay(null);
          setActiveMenu(null);
          handleNavigatePrev();
          requestAnimationFrame(() => {
            if (calendarContainerRef.current) {
              calendarContainerRef.current.scrollTop = calendarContainerRef.current.scrollHeight;
            }
          });
        }
      }
    },
    [handleNavigateNext, handleNavigatePrev]
  );

  const openScheduleModal = useCallback(
    (opts?: { task?: LaunchMapLightItem; dateKey?: string }) => {
      setDayModalState({
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

  const handleMoveLaunch = useCallback(
    async (taskId: string, targetDateKey: string) => {
      // 1. Optimistic update immediately so the user sees the pill move with zero delay
      onLaunchMetaUpdated?.(taskId, {
        launchMeta: {
          type: 'LAUNCH_META',
          launchDate: targetDateKey,
          targetPeriod: null,
          isLaunchDate: true,
          updatedAt: new Date().toISOString(),
        },
        effectiveLaunchDate: targetDateKey,
        targetPeriod: null,
        dueDate: `${targetDateKey}T12:00:00+08:00`,
      });

      try {
        const res = await taskMapApi.updateLaunchMeta(taskId, {
          launchDate: targetDateKey,
          targetPeriod: null,
          syncDueDate: true,
        });
        if (res.success) {
          onLaunchMetaUpdated?.(taskId, {
            launchMeta: res.launchMeta,
            effectiveLaunchDate: res.effectiveLaunchDate,
            targetPeriod: res.targetPeriod ?? null,
            dueDate: res.dueDate,
          });
          toast.success(`Launch moved to ${formatReadableDate(targetDateKey)}`);
          onDataRefresh?.();
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to move launch');
        onDataRefresh?.();
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
        onClick={() => openScheduleModal({ task: entry.task, dateKey: entry.dateKey || todayKey })}
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

              {nextUpcomingLaunch?.dateKey && (
                <button
                  type="button"
                  onClick={() => {
                    const target = parseDateKeyParts(nextUpcomingLaunch.dateKey!);
                    setCursorYear(target.year);
                    setCursorMonth(target.month);
                    setCursorDay(target.day);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/35 hover:bg-purple-500/25 transition-colors cursor-pointer"
                  title={`Jump to next upcoming active launch: ${nextUpcomingLaunch.task.title} (${nextUpcomingLaunch.dateKey})`}
                >
                  <Rocket className="size-3 text-purple-400" />
                  <span>Next Launch</span>
                </button>
              )}
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
                { key: 'MONTH', label: 'Month', icon: CalendarIcon },
                { key: 'WEEK', label: 'Week', icon: null },
                { key: 'JOURNAL', label: 'Journal', icon: Table2 },
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
            <span>Launch</span>
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
          <div
            ref={calendarContainerRef}
            onWheel={handleCalendarWheel}
            className="flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar"
          >
            <div className="launch-map-header-bar grid grid-cols-7 border-b border-[var(--border)] shrink-0 sticky top-0 z-10 bg-[var(--surface)] shadow-xs">
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

            <div className="grid grid-cols-7 auto-rows-fr flex-1 min-h-[560px]">
              {monthGridDays.map((cell) => (
                <MonthDayCell
                  key={cell.dateKey}
                  dateKey={cell.dateKey}
                  dayNum={cell.dayNum}
                  inCurrentMonth={cell.inCurrentMonth}
                  isWeekend={cell.isWeekend}
                  isToday={cell.isToday}
                  todayKey={todayKey}
                  entries={entriesByDate.get(cell.dateKey) || []}
                  heatOpacity={monthHeatmap.getHeatOpacity(cell.dateKey)}
                  isPopoutOpen={popoverDay?.dateKey === cell.dateKey}
                  onSelectDay={(dk) => openScheduleModal({ dateKey: dk })}
                  onQuickSchedule={(dk) => openScheduleModal({ dateKey: dk })}
                  onEditLaunch={(task, dk) => openScheduleModal({ task, dateKey: dk })}
                  onRequestMenu={(task, dk, rect) => setActiveMenu({ task, dateKey: dk, rect })}
                  onMoveLaunch={handleMoveLaunch}
                  onOpenPopout={(dk, rect) => setPopoverDay({ dateKey: dk, rect })}
                  onClosePopout={() => setPopoverDay(null)}
                />
              ))}
            </div>
          </div>
        )}

        {/* WEEK VIEW */}
        {viewMode === 'WEEK' && (
          <div
            ref={calendarContainerRef}
            onWheel={handleCalendarWheel}
            className="grid grid-cols-1 md:grid-cols-7 flex-1 min-h-0 overflow-auto custom-scrollbar"
          >
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
                      dayEntries.map((entry) => {
                        const timing = getLaunchTiming(entry.dateKey || day.dateKey, todayKey, entry.isClosed);
                        let weekCardClasses = 'launch-pill-default border-[var(--border)]';
                        let weekIcon = null;

                        if (entry.isInReview) {
                          weekCardClasses = 'border-orange-500/60 bg-orange-500/15 hover:bg-orange-500/25 [.theme-light_&]:bg-orange-50 [.theme-light_&]:border-orange-300';
                          weekIcon = <AlertTriangle className="size-3 text-orange-400 [.theme-light_&]:text-orange-600" />;
                        } else if (entry.isUrgent) {
                          weekCardClasses = 'border-red-500/60 bg-red-500/15 hover:bg-red-500/25 [.theme-light_&]:bg-red-50 [.theme-light_&]:border-red-300';
                          weekIcon = <Flag className="size-3 text-red-400 [.theme-light_&]:text-red-600" />;
                        } else if (timing === 'PASSED') {
                          weekCardClasses = 'border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 [.theme-light_&]:bg-emerald-50 [.theme-light_&]:border-emerald-300';
                          weekIcon = <CheckCircle2 className="size-3 text-emerald-400 [.theme-light_&]:text-emerald-600" />;
                        } else if (timing === 'TODAY') {
                          weekCardClasses = 'border-purple-500/60 bg-purple-500/25 hover:bg-purple-500/35 ring-1 ring-purple-500/40 text-purple-100 [.theme-light_&]:bg-purple-50 [.theme-light_&]:border-purple-300';
                          weekIcon = <Rocket className="size-3 text-purple-300 animate-pulse" />;
                        } else if (timing === 'UPCOMING') {
                          weekCardClasses = 'border-rose-500/50 bg-rose-500/15 hover:bg-rose-500/25 text-rose-100 [.theme-light_&]:bg-rose-50 [.theme-light_&]:border-rose-300';
                          weekIcon = <Rocket className="size-3 text-rose-400 [.theme-light_&]:text-rose-600" />;
                        } else {
                          weekCardClasses = 'border-sky-500/50 bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 [.theme-light_&]:bg-sky-50 [.theme-light_&]:border-sky-300';
                          weekIcon = <CalendarClock className="size-3 text-sky-400 [.theme-light_&]:text-sky-600" />;
                        }

                        return (
                          <div
                            key={entry.task.id}
                            onClick={() => openScheduleModal({ task: entry.task, dateKey: day.dateKey })}
                            className={`group rounded-lg border p-2.5 flex flex-col gap-1.5 cursor-pointer transition-colors ${weekCardClasses}`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-[10px] font-medium opacity-80 truncate max-w-[130px]">
                                {entry.clientName}
                              </span>
                              <div className="flex items-center gap-1">
                                {weekIcon}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openScheduleModal({ task: entry.task, dateKey: day.dateKey });
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/30 text-current cursor-pointer"
                                  title="Edit launch"
                                >
                                  <Pencil className="size-3" />
                                </button>
                              </div>
                            </div>

                            <p className="text-xs font-semibold line-clamp-2 leading-snug">
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
                      );
                    }))}
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
                const renderAgendaItem = (entry: EnrichedLaunchEntry) => {
                  const timing = getLaunchTiming(entry.dateKey, todayKey, entry.isClosed);
                  let itemClasses = 'border-l-2 border-l-transparent hover:bg-[var(--hover-subtle)]';
                  let itemIcon = (
                    <span
                      className="block size-2.5 rounded-full mt-0.5"
                      style={{ backgroundColor: entry.statusColor }}
                    />
                  );

                  if (entry.isInReview) {
                    itemClasses = 'border-l-2 border-l-orange-400 bg-orange-500/[0.06] [.theme-light_&]:bg-orange-50/70';
                    itemIcon = <AlertTriangle className="size-3.5 text-orange-400 [.theme-light_&]:text-orange-600" />;
                  } else if (entry.isUrgent) {
                    itemClasses = 'border-l-2 border-l-red-400 bg-red-500/[0.06] [.theme-light_&]:bg-red-50/70';
                    itemIcon = <Flag className="size-3.5 text-red-400 [.theme-light_&]:text-red-600" />;
                  } else if (timing === 'PASSED') {
                    itemClasses = 'border-l-2 border-l-emerald-400 bg-emerald-500/[0.06] [.theme-light_&]:bg-emerald-50/70';
                    itemIcon = <CheckCircle2 className="size-3.5 text-emerald-400 [.theme-light_&]:text-emerald-600" />;
                  } else if (timing === 'TODAY') {
                    itemClasses = 'border-l-2 border-l-purple-400 bg-purple-500/[0.08] ring-1 ring-purple-500/20 [.theme-light_&]:bg-purple-50/70';
                    itemIcon = <Rocket className="size-3.5 text-purple-300 [.theme-light_&]:text-purple-600 animate-pulse" />;
                  } else if (timing === 'UPCOMING') {
                    itemClasses = 'border-l-2 border-l-rose-400 bg-rose-500/[0.05] [.theme-light_&]:bg-rose-50/60';
                    itemIcon = <Rocket className="size-3.5 text-rose-400 [.theme-light_&]:text-rose-600" />;
                  } else {
                    itemClasses = 'border-l-2 border-l-sky-400 bg-sky-500/[0.05] [.theme-light_&]:bg-sky-50/60';
                    itemIcon = <CalendarClock className="size-3.5 text-sky-400 [.theme-light_&]:text-sky-600" />;
                  }

                  return (
                    <div
                      key={entry.task.id}
                      onClick={() => openScheduleModal({ task: entry.task, dateKey: entry.dateKey || todayKey })}
                      className={`group flex items-start justify-between gap-4 px-4 py-2.5 transition-colors cursor-pointer ${itemClasses}`}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="mt-1 shrink-0">{itemIcon}</div>

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
              };

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
          onEditTask={(task) => openScheduleModal({ task, dateKey: selectedDayKey })}
          onOpenDetail={(task) => openScheduleModal({ task, dateKey: selectedDayKey })}
          onToggleMilestone={handleToggleMilestoneQuick}
          onUnschedule={handleUnscheduleTask}
        />
      )}

      {/* Day-click, + Launch, and Edit Launch Modal (Unified new LaunchDayModal) */}
      {dayModalState?.open && (
        <LaunchDayModal
          initialDate={dayModalState.dateKey}
          initialTask={dayModalState.task || null}
          existingEntries={entriesByDate.get(dayModalState.dateKey) || []}
          onDeleteLaunch={handleUnscheduleTask}
          onClose={() => setDayModalState(null)}
          onSaved={(taskId, data) => {
            onLaunchMetaUpdated?.(taskId, data);
            onDataRefresh?.();
            setDayModalState(null);
          }}
        />
      )}

      {/* Outward-Expanding Multi-Launch Popover via Portal */}
      {popoverDay && popoverEntries.length > 0 && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-[9990] bg-black/30 backdrop-blur-[1px] animate-in fade-in duration-100"
            onClick={() => setPopoverDay(null)}
          />

          {/* Elevated Floating Popover Panel */}
          <div
            className="fixed z-[9995] bg-[#14141e] border border-purple-500/40 rounded-2xl shadow-2xl p-3 flex flex-col gap-2.5 text-zinc-100 animate-in fade-in zoom-in-95 duration-150"
            style={{
              width: Math.min(380, Math.max(300, popoverDay.rect.width + 50)),
              top: Math.max(12, Math.min(popoverDay.rect.top - 8, window.innerHeight - 380)),
              left: Math.max(12, Math.min(popoverDay.rect.left - 12, window.innerWidth - 392)),
              maxHeight: 'min(440px, calc(100vh - 32px))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#29293d] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-white truncate">
                  {formatReadableDate(popoverDay.dateKey)}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/35 shrink-0">
                  {popoverEntries.length} Launches
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const dk = popoverDay.dateKey;
                    setPopoverDay(null);
                    openScheduleModal({ dateKey: dk });
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/35 border border-purple-500/30 text-purple-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                  title="Add launch on this date"
                >
                  <Plus className="size-3" />
                  <span>Add</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPopoverDay(null)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-zinc-800 text-purple-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                  title="Collapse"
                >
                  <span>▲ Collapse</span>
                </button>
              </div>
            </div>

            {/* List of Launches */}
            <div className="flex flex-col gap-1.5 overflow-y-auto custom-scrollbar pr-1 max-h-[330px]">
              {popoverEntries.map((entry) => {
                const entryDateKey = entry.dateKey || popoverDay.dateKey;
                const timing = getLaunchTiming(entryDateKey, todayKey, entry.isClosed);

                let pillClasses = 'border-[#2d2d3f] bg-[#1a1a26] hover:bg-[#222232] text-zinc-100 hover:border-purple-500/40 shadow-xs';
                let icon = (
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: entry.statusColor }}
                  />
                );

                if (entry.isInReview) {
                  pillClasses = 'border-orange-500/50 bg-orange-500/15 text-orange-200 hover:bg-orange-500/25';
                  icon = <AlertTriangle className="size-3.5 shrink-0 text-orange-400" />;
                } else if (entry.isUrgent) {
                  pillClasses = 'border-red-500/50 bg-red-500/20 text-red-200 hover:bg-red-500/30';
                  icon = <Flag className="size-3.5 shrink-0 text-red-400" />;
                } else if (timing === 'PASSED') {
                  pillClasses = 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25';
                  icon = <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />;
                } else if (timing === 'TODAY') {
                  pillClasses = 'border-purple-500/60 bg-purple-500/25 text-purple-100 hover:bg-purple-500/35 ring-1 ring-purple-500/40';
                  icon = <Rocket className="size-3.5 shrink-0 text-purple-300 animate-pulse" />;
                } else if (timing === 'UPCOMING') {
                  pillClasses = 'border-rose-500/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30';
                  icon = <Rocket className="size-3.5 shrink-0 text-rose-400" />;
                } else {
                  pillClasses = 'border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25';
                  icon = <CalendarClock className="size-3.5 shrink-0 text-sky-400" />;
                }

                return (
                  <div
                    key={entry.task.id}
                    draggable={true}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', entry.task.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPopoverDay(null);
                      openScheduleModal({ task: entry.task, dateKey: entryDateKey });
                    }}
                    className={`group/popover-pill relative w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs leading-tight transition-all cursor-pointer border ${pillClasses}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {icon}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-semibold text-zinc-100 truncate">
                          {entry.task.title}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 mt-0.5">
                          <span className="truncate max-w-[120px] font-medium text-zinc-300">
                            {entry.clientName}
                          </span>
                          {entry.workstream && (
                            <>
                              <span>·</span>
                              <span className="truncate max-w-[100px]">{entry.workstream}</span>
                            </>
                          )}
                          {entry.canonicalStatus && (
                            <>
                              <span>·</span>
                              <span
                                className="px-1.5 py-0.5 rounded uppercase font-bold text-[9px]"
                                style={{
                                  color: entry.statusColor,
                                  backgroundColor: `${entry.statusColor}22`,
                                }}
                              >
                                {entry.canonicalStatus}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ... Action Menu Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setActiveMenu({ task: entry.task, dateKey: entryDateKey, rect });
                      }}
                      className="p-1 rounded-md hover:bg-zinc-700/80 text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
                      title="Launch actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Floating Action Menu for "..." button rendered via Portal outside clipped elements */}
      {activeMenu && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999] min-w-[135px] bg-[#1a1a24] border border-[#2e2e3f] rounded-xl shadow-2xl p-1 flex flex-col gap-0.5 text-xs text-zinc-200 backdrop-blur-md animate-in fade-in duration-100"
          style={{
            top: Math.min(activeMenu.rect.bottom + 4, window.innerHeight - 55),
            left: Math.max(8, Math.min(activeMenu.rect.right - 135, window.innerWidth - 145)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const { task } = activeMenu;
              setActiveMenu(null);
              setConfirmDeleteState({ open: true, task });
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-red-500/20 text-red-300 hover:text-red-200 cursor-pointer font-medium transition-colors"
          >
            <Trash2 className="size-3.5 text-red-400" />
            <span>Delete Launch</span>
          </button>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteState?.open && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-100"
          onClick={() => setConfirmDeleteState(null)}
        >
          <div
            className="w-full max-w-sm bg-[#16161e] border border-[#2d2d3d] rounded-2xl p-5 shadow-2xl flex flex-col gap-4 text-zinc-100 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
                <Trash2 className="size-5 text-red-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-zinc-100">Delete Launch?</h3>
                <p className="text-xs text-zinc-400 mt-1 truncate">
                  Remove <span className="font-semibold text-zinc-200">"{confirmDeleteState.task.title}"</span> from calendar?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#262636]">
              <button
                type="button"
                disabled={deletingLaunch}
                onClick={() => setConfirmDeleteState(null)}
                className="px-3 py-1.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-xs text-zinc-300 font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingLaunch}
                onClick={async () => {
                  setDeletingLaunch(true);
                  try {
                    await handleUnscheduleTask(confirmDeleteState.task.id);
                    setConfirmDeleteState(null);
                  } finally {
                    setDeletingLaunch(false);
                  }
                }}
                className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {deletingLaunch ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
