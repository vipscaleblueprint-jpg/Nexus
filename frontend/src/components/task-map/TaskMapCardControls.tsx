'use client';

import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Flag, ChevronDown, Check, CheckCircle2, Clock, Infinity as InfinityIcon } from 'lucide-react';
import { DEFAULT_ESTIMATED_HOURS, formatEstimatedHours } from '@/components/modals/EstimatedHoursField';
import { CustomCircleDot, CustomCircleDotted, ALL_STATUSES, STATUS_COLORS, isClosedStatus, isHiddenBoardStatus, sortStatusesWithClosedAndKycAtEnd } from '@/lib/taskTokens';
import { fetchListStatuses, getCachedListStatuses } from '@/lib/listStatusCache';
import { getPriorityConfig } from '@/lib/priority';
import { TaskMapItem, isTaskMapItemOnHold, compareAvailablePoolTasks, toCanonicalTaskStatus, resolveDbStatusColor, isTaskHandedOver, matchesTaskLinkOrId } from '@/api/taskMap';
import { format } from 'date-fns';
import { useAppStore } from '@/lib/store';
import { canUserEditTaskStatus, STATUS_EDIT_DENIED_MESSAGE } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { useLiveClock } from '@/lib/liveClock';
import { HoverHint } from './HoverHint';
export { ColumnSubStatusDropdown, matchesSubStatusFilter, getColumnSubStatusCounts, getSubStatusColor } from './ColumnSubStatusDropdown';

const getHexColor = (color: string) => {
  const trimmed = (color || '').trim();
  const bracketHex = trimmed.match(/\[(#?[0-9a-fA-F]{3,6})\]/)?.[1];
  if (bracketHex) return bracketHex.startsWith('#') ? bracketHex : `#${bracketHex}`;
  const colors: Record<string, string> = {
    slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
    red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
    green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
    blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
    pink: '#ec4899', rose: '#f43f5e',
  };
  return colors[trimmed.toLowerCase()] || trimmed;
};


export const getDotColor = (status?: string) => {
  if (!status) return '#3b82f6';
  const up = status.toUpperCase();
  const hexMap: Record<string, string> = {
    'IN PROGRESS': '#D04A7C',
    'IN_PROGRESS': '#D04A7C',
    PENDING: '#D29A2A',
    REVISION: '#5B6BD6',
    WAITING: '#D9534F',
    'IN REVIEW': '#D97B3A',
    IN_REVIEW: '#D97B3A',
    'TO REVIEW': '#D97B3A',
    'TO_REVIEW': '#D97B3A',
    'DONE REVIEW': '#2dd4bf',
    CHECKING: '#A35DB8',
    CRM: '#22A3AE',
    CLOSED: '#2FA37A',
    DONE: '#2FA37A',
    KYC: '#3A8F55',
    'PIN BOARD': '#1F8A6E',
    'ON-HOLD': '#8A8F98',
  };
  return hexMap[up] || '#3b82f6';
};

/**
 * Converts a 3- or 6-digit hex color string into an `rgba(r, g, b, alpha)` CSS value.
 */
export const hexToRgba = (hex: string, alpha: number): string => {
  const clean = (hex || '').trim().replace(/^#/, '');
  let full = clean;
  if (clean.length === 3) {
    full = clean.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return hex;
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

interface ListStatusLike {
  name?: string;
  status?: string;
  title?: string;
  color?: string | null;
}

interface StoreListEntryLike {
  list?: {
    id?: string;
    statuses?: Array<ListStatusLike | string>;
  };
}

/**
 * Resolves the canonical hex color for a task status, checking custom DB list statuses first
 * (from provided listStatuses, listStatusCache, or Zustand allLists), then STATUS_COLORS / getDotColor.
 */
export const resolveTaskStatusColor = (
  status?: string | null,
  listId?: string | null,
  listStatuses?: Array<ListStatusLike | string>
): string => {
  const clean = (status || '').trim();
  if (!clean) return getDotColor(undefined);

  const upper = clean.toUpperCase();
  let candidateStatuses: Array<ListStatusLike | string> | undefined =
    listStatuses && listStatuses.length > 0 ? listStatuses : undefined;
  if (!candidateStatuses && listId && listId !== 'general') {
    const cached = getCachedListStatuses(listId) as Array<ListStatusLike | string> | null;
    if (cached && cached.length > 0) {
      candidateStatuses = cached;
    } else {
      const storeLists = (useAppStore.getState().allLists || []) as StoreListEntryLike[];
      const matchedList = storeLists.find((entry) => entry?.list?.id === listId);
      if (Array.isArray(matchedList?.list?.statuses) && matchedList.list.statuses.length > 0) {
        candidateStatuses = matchedList.list.statuses;
      }
    }
  }

  const customObj = candidateStatuses?.find(
    (ls): ls is ListStatusLike =>
      typeof ls === 'object' && ls !== null && (ls.name || ls.status || ls.title)?.toUpperCase() === upper
  );
  if (customObj?.color) {
    return getHexColor(customObj.color);
  }

  const tokenHex = STATUS_COLORS[upper]?.match(/\[(.*?)\]/)?.[1];
  return tokenHex || getDotColor(clean);
};

/**
 * Sub-status dropdown color sourced from the DB list statuses (task.list.statuses, list cache, or store),
 * so CRM / Audit / Task Map dropdown options match the Prisma status colors. Falls back to `fallback`.
 */
export const resolveSubStatusColor = (
  label: string,
  fallback: string,
  listId?: string | null,
  listStatuses?: Array<ListStatusLike | string> | null
): string => {
  let candidates: Array<ListStatusLike | string> | undefined =
    listStatuses && listStatuses.length > 0 ? listStatuses : undefined;
  if (!candidates && listId && listId !== 'general') {
    const cached = getCachedListStatuses(listId) as Array<ListStatusLike | string> | null;
    if (cached && cached.length > 0) {
      candidates = cached;
    } else {
      const storeLists = (useAppStore.getState().allLists || []) as StoreListEntryLike[];
      const matched = storeLists.find((entry) => entry?.list?.id === listId)?.list?.statuses;
      if (Array.isArray(matched) && matched.length > 0) candidates = matched;
    }
  }
  const hex = resolveDbStatusColor(label, '', candidates as any);
  return hex ? getHexColor(hex) : fallback;
};
export const isTaskInProgress = (task: TaskMapItem) => {
  const s = (task.status || '').toUpperCase().replace(/[\s_-]+/g, '');
  if (s === 'INPROGRESS') return true;
  const customStatuses = task.taskMap?.statuses || [];
  return customStatuses.some(
    (cs) => cs.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS'
  );
};

export const isTaskUrgent = (task: TaskMapItem) => {
  const p = (task.priority || '').toUpperCase();
  if (p === 'URGENT') return true;
  const customStatuses = task.taskMap?.statuses || [];
  if (customStatuses.some((cs) => cs.toUpperCase().includes('URGENT'))) return true;
  const tags = (task as TaskMapItem & { tags?: Array<string | { name?: string }> }).tags || [];
  if (tags.some((tag) => (typeof tag === 'string' ? tag : tag?.name || '').toUpperCase().includes('URGENT'))) return true;
  if ((task.title || '').toUpperCase().includes('[URGENT]')) return true;
  return false;
};

export const isTaskHigh = (task: TaskMapItem) => {
  const p = (task.priority || '').toUpperCase();
  return p === 'HIGH';
};

export const isTaskOnHold = isTaskMapItemOnHold;

/**
 * Sort Task Map items with all On-Hold tasks strictly at the most bottom,
 * then Urgent tasks at the top, then High priority, optional In Progress, and newest first.
 */
export const sortTasksUrgentFirst = (
  items: TaskMapItem[],
  options?: { prioritizeInProgress?: boolean }
) => {
  const prioritizeInProgress = Boolean(options?.prioritizeInProgress);
  return [...items].sort((a, b) => {
    const holdA = isTaskOnHold(a) ? 1 : 0;
    const holdB = isTaskOnHold(b) ? 1 : 0;
    if (holdA !== holdB) return holdA - holdB;

    const urgentA = isTaskUrgent(a) ? 1 : 0;
    const urgentB = isTaskUrgent(b) ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;

    const highA = isTaskHigh(a) ? 1 : 0;
    const highB = isTaskHigh(b) ? 1 : 0;
    if (highA !== highB) return highB - highA;

    if (prioritizeInProgress) {
      const inProgA = isTaskInProgress(a) ? 1 : 0;
      const inProgB = isTaskInProgress(b) ? 1 : 0;
      if (inProgA !== inProgB) return inProgB - inProgA;
    }

    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
};

export const sortAvailablePoolTasks = (items: TaskMapItem[]) =>
  groupTasksWithSubtasks([...items].sort(compareAvailablePoolTasks));

/**
 * Returns true if a subtask should visually nest/attach directly below its parent task.
 * A subtask with a different status color than its parent (or On-Hold/Waiting mismatch)
 * acts independently like a whole task even when its parent is in the same column.
 */
export const shouldSubtaskAttachToParent = (
  subtask: TaskMapItem,
  parent?: TaskMapItem | null
): boolean => {
  if (!subtask.isSubtask || !subtask.parentTaskId || !parent || parent.isSubtask) return false;
  if (parent.id !== subtask.parentTaskId) return false;
  // Keep On-Hold subtasks at the very bottom rather than pulling them up under an active parent
  if (isTaskOnHold(subtask) && !isTaskOnHold(parent)) return false;

  const subColor = resolveTaskStatusColor(
    subtask.status || 'PENDING',
    subtask.listId || subtask.list?.id,
    subtask.list?.statuses
  )
    .trim()
    .toLowerCase();
  const parentColor = resolveTaskStatusColor(
    parent.status || 'PENDING',
    parent.listId || parent.list?.id,
    parent.list?.statuses
  )
    .trim()
    .toLowerCase();

  if (subColor !== parentColor) return false;
  return true;
};

/**
 * Places subtasks directly below their parent main task whenever both exist in the same column
 * and share the same status color (subtasks with a different status color act like whole tasks),
 * while keeping separated subtasks at their natural sorted positions.
 */
export const groupTasksWithSubtasks = (sortedItems: TaskMapItem[]): TaskMapItem[] => {
  const parentById = new Map<string, TaskMapItem>();
  for (const item of sortedItems) {
    if (!item.isSubtask) parentById.set(item.id, item);
  }

  const shouldAttachToParent = (item: TaskMapItem): boolean => {
    if (!item.isSubtask || !item.parentTaskId) return false;
    const parent = parentById.get(item.parentTaskId);
    return shouldSubtaskAttachToParent(item, parent);
  };

  const attachedByParent = new Map<string, TaskMapItem[]>();
  for (const item of sortedItems) {
    if (shouldAttachToParent(item) && item.parentTaskId) {
      const list = attachedByParent.get(item.parentTaskId) || [];
      list.push(item);
      attachedByParent.set(item.parentTaskId, list);
    }
  }

  // Sort attached subtasks under the same parent chronologically (oldest first) to match task detail ordering
  attachedByParent.forEach((children) => {
    children.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return da - db;
    });
  });

  const result: TaskMapItem[] = [];
  for (const item of sortedItems) {
    if (shouldAttachToParent(item)) {
      continue;
    }
    result.push(item);
    if (!item.isSubtask) {
      const children = attachedByParent.get(item.id);
      if (children && children.length > 0) {
        result.push(...children);
      }
    }
  }
  return result;
};

export const matchesPriorityFilter = (task: TaskMapItem, filter: string) => {
  if (!filter || filter === 'ALL') return true;
  const p = (task.priority || '').toUpperCase();
  if (filter === 'URGENT') return isTaskUrgent(task);
  if (filter === 'HIGH') return isTaskHigh(task);
  if (filter === 'NORMAL') return p === 'NORMAL' || p === 'MEDIUM';
  if (filter === 'LOW') return p === 'LOW';
  return true;
};

export const matchesSearchFilter = (task: TaskMapItem, query?: string) => {
  if (!query || !query.trim()) return true;
  if (matchesTaskLinkOrId(task, query)) return true;
  const q = query.trim().toLowerCase();
  const title = (task.title || '').toLowerCase();
  const parentTitle = (task.parentTaskTitle || '').toLowerCase();
  const hasMatchingSubtask =
    Array.isArray(task.subtasks) &&
    task.subtasks.some((st: any) => (st?.title || '').toLowerCase().includes(q));
  return title.includes(q) || parentTitle.includes(q) || hasMatchingSubtask;
};

export const getColumnPriorityCounts = (items: TaskMapItem[]) => {
  const counts = { ALL: items.length, URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
  for (const t of items) {
    const p = (t.priority || '').toUpperCase();
    if (isTaskUrgent(t)) counts.URGENT++;
    else if (isTaskHigh(t)) counts.HIGH++;
    else if (p === 'NORMAL' || p === 'MEDIUM') counts.NORMAL++;
    else if (p === 'LOW') counts.LOW++;
  }
  return counts;
};

export const ColumnPriorityDropdown: React.FC<{
  columnId: string;
  tasks: TaskMapItem[];
  activeFilter: string;
  onSelectFilter: (columnId: string, filter: string) => void;
}> = ({ columnId, tasks, activeFilter, onSelectFilter }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const counts = getColumnPriorityCounts(tasks);
  const currentKey = activeFilter || 'ALL';

  const calcPos = (rect: DOMRect) => {
    const width = 160;
    const height = 220;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - height - 4);
    }
    // Open to the right!
    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - width - 10);
    }
    return { top, left };
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pos = calcPos(rect);
    setCoords(pos);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCoords(null);
      }
    };
    const handleScrollOrResize = (e?: Event) => {
      // Don't close if the scroll happened inside the portal dropdown itself
      if (e && dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
      setCoords(null);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const getDisplayDetails = () => {
    switch (currentKey) {
      case 'URGENT':
        return {
          label: 'Urgent',
          flagClass: 'text-red-500 dark:text-red-400',
          btnClass: 'bg-red-100 hover:bg-red-200 text-red-700 border-red-300 dark:bg-red-950/70 dark:hover:bg-red-950 dark:text-red-200 dark:border-red-700/80',
          badgeClass: 'bg-red-200/60 text-red-800 dark:bg-black/40 dark:text-red-300',
          count: counts.URGENT,
        };
      case 'HIGH':
        return {
          label: 'High',
          flagClass: 'text-amber-500 dark:text-amber-400',
          btnClass: 'bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:hover:bg-amber-950 dark:text-amber-200 dark:border-amber-700/80',
          badgeClass: 'bg-amber-200/60 text-amber-900 dark:bg-black/40 dark:text-amber-300',
          count: counts.HIGH,
        };
      case 'NORMAL':
        return {
          label: 'Normal',
          flagClass: 'text-blue-500 dark:text-blue-400',
          btnClass: 'bg-blue-100 hover:bg-blue-200 text-blue-700 border-blue-300 dark:bg-blue-950/70 dark:hover:bg-blue-950 dark:text-blue-200 dark:border-blue-700/80',
          badgeClass: 'bg-blue-200/60 text-blue-800 dark:bg-black/40 dark:text-blue-300',
          count: counts.NORMAL,
        };
      case 'LOW':
        return {
          label: 'Low',
          flagClass: 'text-zinc-500 dark:text-zinc-400',
          btnClass: 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 dark:border-zinc-700',
          badgeClass: 'bg-zinc-200 text-zinc-700 dark:bg-black/40 dark:text-zinc-300',
          count: counts.LOW,
        };
      default:
        return {
          label: '',
          flagClass: 'text-zinc-400',
          btnClass: 'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700',
          badgeClass: 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/60',
          count: counts.ALL,
        };
    }
  };

  const details = getDisplayDetails();

  return (
    <div
      className="relative inline-block text-left shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${details.btnClass}`}
        title={details.label ? `Filtered by ${details.label}` : 'Filter by priority'}
      >
        <Flag className={`size-3 shrink-0 ${details.flagClass}`} />
        {details.label && <span className="font-semibold">{details.label}</span>}
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            className="w-40 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
          >
            <button
              type="button"
              onClick={() => {
                onSelectFilter(columnId, 'ALL');
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'ALL'
                  ? 'bg-zinc-800 text-zinc-100 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-zinc-500 shrink-0" />
                <span className="truncate">All</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400">
                {counts.ALL}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'URGENT' ? 'ALL' : 'URGENT';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'URGENT'
                  ? 'bg-red-950/60 text-red-200 border border-red-700/60 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-red-400 shrink-0" />
                <span className="truncate">Urgent</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'URGENT' ? 'bg-red-900/50 text-red-300' : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.URGENT}
                </span>
                {currentKey === 'URGENT' && <Check className="size-3.5 text-red-400" />}
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'HIGH' ? 'ALL' : 'HIGH';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'HIGH'
                  ? 'bg-amber-950/60 text-amber-200 border border-amber-700/60 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-amber-400 shrink-0" />
                <span className="truncate">High</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'HIGH' ? 'bg-amber-900/50 text-amber-300' : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.HIGH}
                </span>
                {currentKey === 'HIGH' && <Check className="size-3.5 text-amber-400" />}
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'NORMAL' ? 'ALL' : 'NORMAL';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'NORMAL'
                  ? 'bg-blue-950/60 text-blue-200 border border-blue-700/60 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-blue-400 shrink-0" />
                <span className="truncate">Normal</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'NORMAL' ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.NORMAL}
                </span>
                {currentKey === 'NORMAL' && <Check className="size-3.5 text-blue-400" />}
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'LOW' ? 'ALL' : 'LOW';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${currentKey === 'LOW'
                  ? 'bg-zinc-800 text-zinc-200 border border-zinc-700 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-zinc-400 shrink-0" />
                <span className="truncate">Low</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${currentKey === 'LOW' ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800/80 text-zinc-400'
                    }`}
                >
                  {counts.LOW}
                </span>
                {currentKey === 'LOW' && <Check className="size-3.5 text-zinc-400" />}
              </div>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};

export const CardStatusDropdown: React.FC<{
  taskId: string;
  currentStatus: string;
  listId?: string;
  listStatuses?: any[];
  onSelect: (newStatus: string) => void;
  excludeStatuses?: string[];
  readOnly?: boolean;
}> = ({ taskId, currentStatus, listId, listStatuses, onSelect, excludeStatuses = [], readOnly = false }) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const canEditStatus = canUserEditTaskStatus(currentUser);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [fetchedStatuses, setFetchedStatuses] = useState<any[]>(listStatuses || []);

  useEffect(() => {
    if (listStatuses && listStatuses.length > 0) {
      setFetchedStatuses(listStatuses);
      return;
    }
    if (!listId) return;

    // Check synchronous cache first
    const cached = getCachedListStatuses(listId);
    if (cached && cached.length > 0) {
      setFetchedStatuses(cached);
      return;
    }

    // Only fetch over the wire if the dropdown is open
    if (!isOpen) return;

    let active = true;
    fetchListStatuses(listId).then((res) => {
      if (active && Array.isArray(res) && res.length > 0) {
        setFetchedStatuses(res);
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [listId, listStatuses, isOpen]);

  const orderedStatuses = useMemo(() => {
    const raw = (fetchedStatuses && fetchedStatuses.length > 0)
      ? fetchedStatuses.map((s: any) => typeof s === 'string' ? s : (s.name || s.status || s.title || ''))
      : ALL_STATUSES;
    const excludeSet = new Set(excludeStatuses.map((s) => s.toUpperCase().trim()));
    const filtered = raw.filter((s: string) => !isHiddenBoardStatus(s) && !excludeSet.has(s.toUpperCase().trim()));
    return sortStatusesWithClosedAndKycAtEnd(filtered);
  }, [fetchedStatuses, excludeStatuses]);

  const openStatuses = useMemo(() => orderedStatuses.filter((s: string) => !isClosedStatus(s)), [orderedStatuses]);
  const closedStatuses = useMemo(() => orderedStatuses.filter((s: string) => isClosedStatus(s)), [orderedStatuses]);

  const calcPos = (rect: DOMRect) => {
    const width = 192;
    const height = 284;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - height - 4);
    }
    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - width - 10);
    }
    return { top, left };
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly) return;
    if (!canEditStatus) {
      toast.error(STATUS_EDIT_DENIED_MESSAGE);
      return;
    }
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const nextCoords = calcPos(rect);
    setCoords(nextCoords);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCoords(null);
      }
    };

    const handleScrollOrResize = (e?: Event) => {
      // Don't close if the scroll happened inside the portal dropdown itself
      if (e && dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
      setCoords(null);
    };

    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const clean = (currentStatus || 'In progress').trim();
  const isClosed = isClosedStatus(clean);
  const isKyc = clean.toUpperCase() === 'KYC';
  const triggerDotColor = resolveTaskStatusColor(clean, listId, fetchedStatuses);

  const renderItem = (s: string) => {
    const isSelected = clean.toUpperCase() === s.toUpperCase();
    const isClosedItem = isClosedStatus(s);
    const isKycItem = s.toUpperCase() === 'KYC';
    const itemColor = resolveTaskStatusColor(s, listId, fetchedStatuses);

    return (
      <button
        key={s}
        type="button"
        onClick={() => {
          setIsOpen(false);
          setCoords(null);
          if (!canEditStatus) {
            toast.error(STATUS_EDIT_DENIED_MESSAGE);
            return;
          }
          onSelect(s);
        }}
        className={`w-full shrink-0 flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
          isSelected
            ? 'bg-blue-500/15 text-blue-400 font-semibold'
            : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          {isClosedItem ? (
            <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" style={{ color: itemColor }} />
          ) : isKycItem ? (
            <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" style={{ color: itemColor }} />
          ) : (
            <CustomCircleDot
              className="size-3.5 shrink-0"
              style={{ color: itemColor }}
            />
          )}
          <span className="truncate uppercase font-medium">{s}</span>
        </div>
        {isSelected && <Check className="size-3 text-blue-400 shrink-0" />}
      </button>
    );
  };

  return (
    <div
      className="relative inline-flex items-center"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <HoverHint label="Status" value={clean} hint={readOnly ? undefined : 'Click to change'} accent={triggerDotColor}>
      <button
        ref={triggerRef}
        type="button"
        disabled={readOnly}
        onClick={handleToggle}
        onMouseEnter={() => {
          if (!readOnly && listId && !getCachedListStatuses(listId)) {
            fetchListStatuses(listId).catch(() => {});
          }
        }}
        className={`flex items-center p-1 -m-1 rounded transition-colors select-none ${
          readOnly ? 'cursor-default opacity-80' : 'hover:bg-zinc-800 cursor-pointer'
        }`}
      >
        {isClosed ? (
          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" style={{ color: triggerDotColor }} />
        ) : isKyc ? (
          <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" style={{ color: triggerDotColor }} />
        ) : (
          <CustomCircleDot
            className="size-3.5 shrink-0"
            style={{ color: triggerDotColor }}
          />
        )}
      </button>
      </HoverHint>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            className="w-48 overflow-hidden bg-popover border border-zinc-700/80 rounded-xl shadow-2xl flex flex-col text-zinc-200 animate-in fade-in zoom-in-95 duration-75"
          >
            <div className="px-2.5 pt-2 pb-1.5 border-b border-zinc-800/80 text-[10px] font-bold text-zinc-400 uppercase tracking-wider select-none shrink-0 bg-popover">
              Change Status
            </div>
            <div className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 flex flex-col gap-0.5">
              {openStatuses.map(renderItem)}
              {closedStatuses.length > 0 && (
                <>
                  <div className="my-1 border-t border-zinc-700/60 shrink-0" />
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider px-2 py-0.5 select-none shrink-0">
                    Closed
                  </span>
                  {closedStatuses.map(renderItem)}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export const CardPriorityDropdown: React.FC<{
  taskId: string;
  priority: string;
  onSelect: (newPriority: string) => void;
  readOnly?: boolean;
}> = ({ taskId, priority, onSelect, readOnly = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const priorities = [
    { key: 'URGENT', label: 'Urgent', iconColor: 'text-red-500', color: 'text-red-400' },
    { key: 'HIGH', label: 'High', iconColor: 'text-amber-500', color: 'text-amber-400' },
    { key: 'NORMAL', label: 'Normal', iconColor: 'text-blue-500', color: 'text-blue-400' },
    { key: 'LOW', label: 'Low', iconColor: 'text-zinc-400', color: 'text-zinc-400' },
  ];

  const priorityConfig = getPriorityConfig(priority);

  const calcPos = (rect: DOMRect) => {
    const width = 140;
    const height = 180;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - height - 4);
    }
    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - width - 10);
    }
    return { top, left };
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly) return;
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const nextCoords = calcPos(rect);
    setCoords(nextCoords);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCoords(null);
      }
    };

    const handleScrollOrResize = (e?: Event) => {
      // Don't close if the scroll happened inside the portal dropdown itself
      if (e && dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
      setCoords(null);
    };

    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const currentKey = (priority || 'NORMAL').toUpperCase();

  return (
    <div
      className="relative inline-flex items-center"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <HoverHint label="Priority" value={priorityConfig.label} hint={readOnly ? undefined : 'Click to change'}>
      <button
        ref={triggerRef}
        type="button"
        disabled={readOnly}
        onClick={(e) => {
          e.stopPropagation();
          if (readOnly) return;
          handleToggle(e);
        }}
        className={`flex items-center gap-1 font-medium text-[11px] px-1.5 py-0.5 rounded transition-colors select-none ${
          readOnly ? 'cursor-default opacity-80' : 'hover:bg-zinc-800/80 cursor-pointer'
        }`}
      >
        <Flag className={`size-3 ${priorityConfig.iconColor}`} />
        <span className={priorityConfig.color}>{priorityConfig.label}</span>
      </button>
      </HoverHint>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            className="w-36 p-1.5 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl flex flex-col gap-0.5 text-zinc-200 animate-in fade-in zoom-in-95 duration-75"
          >
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider px-2 py-1">
              Set Priority
            </span>
            {priorities.map((item) => {
              const isSelected =
                currentKey === item.key ||
                (item.key === 'NORMAL' && currentKey === 'MEDIUM');
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setCoords(null);
                    onSelect(item.key);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${isSelected
                      ? 'bg-zinc-800 text-white font-semibold'
                      : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <Flag className={`size-3 ${item.iconColor}`} />
                    <span className={item.color}>{item.label}</span>
                  </div>
                  {isSelected && <Check className="size-3 text-blue-400 shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};



export const MAX_LIVE_SHIFT_MS = 14 * 60 * 60 * 1000; // 14 hours max continuous shift window

/** Formats "09:15 AM" -> "9:15 AM" to save space */
export function cleanDisplayTime(timeStr?: string | null): string {
  if (!timeStr) return '';
  return timeStr.trim().replace(/^0(\d:)/, '$1');
}

/** Computes the duration between two time strings into "Mins" (e.g. 48m) or "Hrs with mins" (e.g. 1h 24m) */
export function computeDuration(timeInStr?: string | null, timeOutStr?: string | null): string {
  if (!timeInStr || !timeOutStr) return '';
  const mIn = timeInStr.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  const mOut = timeOutStr.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!mIn || !mOut) return '';

  let hIn = parseInt(mIn[1], 10);
  const minIn = parseInt(mIn[2], 10);
  const ampmIn = (mIn[3] || '').toUpperCase();
  if (ampmIn === 'PM' && hIn < 12) hIn += 12;
  if (ampmIn === 'AM' && hIn === 12) hIn = 0;

  let hOut = parseInt(mOut[1], 10);
  const minOut = parseInt(mOut[2], 10);
  const ampmOut = (mOut[3] || '').toUpperCase();
  if (ampmOut === 'PM' && hOut < 12) hOut += 12;
  if (ampmOut === 'AM' && hOut === 12) hOut = 0;

  let startMinutes = hIn * 60 + minIn;
  let endMinutes = hOut * 60 + minOut;

  // Handle shift wrapping across midnight (e.g. 11:00 PM to 02:00 AM)
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }

  const diffMins = Math.max(1, endMinutes - startMinutes);
  const h = Math.floor(diffMins / 60);
  const remM = diffMins % 60;

  if (h > 0) {
    return remM > 0 ? `${h}hr ${remM} mins` : `${h}hr`;
  }
  return `${remM} mins`;
}

/** Computes the duration in milliseconds between timeIn (Manila time UTC+8) and now, resilient to sheet date formats, clock skew, and midnight shifts */
export function getSessionDiffMs(timeInStr?: string | null, dateStr?: string | null, now = new Date()): number | null {
  if (!timeInStr) return null;
  const m = timeInStr.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;

  let hrs = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hrs < 12) hrs += 12;
  if (ampm === 'AM' && hrs === 12) hrs = 0;

  const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // Allow up to 5 minutes of clock skew without wrapping -24h
  const toManilaEpochMs = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d, hrs - 8, mins, 0, 0);

  // 1. If an explicit dateStr is provided, try parsing YYYY-MM-DD, M/D/YYYY, or text date in Manila time
  if (dateStr) {
    const cleanDate = dateStr.trim();
    let y: number | null = null;
    let mo: number | null = null;
    let d: number | null = null;

    const ymd = cleanDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const mdy = cleanDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ymd) {
      y = parseInt(ymd[1], 10);
      mo = parseInt(ymd[2], 10);
      d = parseInt(ymd[3], 10);
    } else if (mdy) {
      mo = parseInt(mdy[1], 10);
      d = parseInt(mdy[2], 10);
      y = parseInt(mdy[3], 10);
    } else {
      const parsed = new Date(cleanDate.includes(':') ? cleanDate : `${cleanDate} 12:00:00`);
      if (!isNaN(parsed.getTime())) {
        const manilaStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Manila',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(parsed);
        const parts = manilaStr.split('-').map(Number);
        if (parts.length === 3) {
          [y, mo, d] = parts;
        }
      }
    }

    if (y !== null && mo !== null && d !== null) {
      const explicitDiff = now.getTime() - toManilaEpochMs(y, mo, d);
      if (explicitDiff >= -CLOCK_SKEW_TOLERANCE_MS) {
        return Math.max(0, explicitDiff);
      }
    }
  }

  // 2. Fallback relative to today's Manila calendar date (handles missing dates or midnight rollover)
  const manilaTodayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [ty, tmo, td] = manilaTodayStr.split('-').map(Number);

  let diffMs = now.getTime() - toManilaEpochMs(ty, tmo, td);
  if (diffMs >= -CLOCK_SKEW_TOLERANCE_MS && diffMs < 0) {
    return 0;
  }
  if (diffMs < -CLOCK_SKEW_TOLERANCE_MS) {
    // Clocked in before midnight and current time is after midnight (e.g. 11:30 PM to 01:00 AM)
    diffMs = now.getTime() - toManilaEpochMs(ty, tmo, td - 1);
  }

  return diffMs;
}

/** Checks whether a live session exceeds the maximum allowable shift window (>14h) */
export function isStaleLiveSession(timeInStr?: string | null, dateStr?: string | null, now = new Date()): boolean {
  const diffMs = getSessionDiffMs(timeInStr, dateStr, now);
  if (diffMs == null) return true;
  return diffMs > MAX_LIVE_SHIFT_MS;
}

export function computeElapsed(timeInStr?: string | null, dateStr?: string | null, now = new Date()): string {
  const diffMs = getSessionDiffMs(timeInStr, dateStr, now);
  if (diffMs == null || diffMs < 0 || diffMs > MAX_LIVE_SHIFT_MS) return '';

  const totalMins = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMins / 60);
  const remM = totalMins % 60;

  if (totalMins === 0) {
    return '0hr 0m';
  }
  if (h > 0) {
    return remM > 0 ? `${h}hr ${remM} mins` : `${h}hr`;
  }
  return `${remM} mins`;
}

/** Parses "1hr 20 mins" / "45 mins" / "2hr" / "0hr 0m" back into minutes. */
function parseDurationLabelMinutes(label: string): number | null {
  if (!label) return null;
  const h = label.match(/(\d+)\s*hr/);
  const m = label.match(/(\d+)\s*m(?:in|$|\b)/);
  if (!h && !m) return null;
  return (h ? parseInt(h[1], 10) : 0) * 60 + (m ? parseInt(m[1], 10) : 0);
}

/**
 * Time-vs-estimate color. Slower: >=1.75x purple, >=1.5x red, >=1.25x orange.
 * Faster (only once the work is finished): <=0.5x teal, <=0.75x green. Otherwise null (normal color).
 */
export function getPaceColor(task: TaskMapItem, durationLabel: string, finished: boolean): { hex: string; label: string } | null {
  const minutes = parseDurationLabelMinutes(durationLabel);
  if (minutes == null) return null;
  const ratio = minutes / ((task.estimatedHours ?? DEFAULT_ESTIMATED_HOURS) * 60);
  if (ratio >= 1.75) return { hex: '#a855f7', label: '1.75x+ over estimate' };
  if (ratio >= 1.5) return { hex: '#ef4444', label: '1.5x+ over estimate' };
  if (ratio >= 1.25) return { hex: '#f97316', label: '1.25x+ over estimate' };
  if (finished && ratio <= 0.5) return { hex: '#14b8a6', label: '2x faster than estimate' };
  if (finished && ratio <= 0.75) return { hex: '#22c55e', label: 'Faster than estimate' };
  return null;
}

/** Clock icon + estimated time under the time badge; blank estimates show the 30m default. */
export const TaskEstimateLabel: React.FC<{ task: TaskMapItem }> = ({ task }) => {
  const hours = task.estimatedHours ?? null;
  const label = formatEstimatedHours(hours ?? DEFAULT_ESTIMATED_HOURS);
  return (
    <div
      className="inline-flex items-center gap-1 text-[9.5px] font-mono text-zinc-500 select-none"
      title={hours != null ? `Estimated time: ${label}` : `No estimate set — default ${label}`}
    >
      <Clock className="size-3 shrink-0" />
      <span>Est. {label}</span>
    </div>
  );
};

export interface TaskTimeProgressSlotProps {
  task: TaskMapItem;
  now?: Date;
  isLive?: boolean;
}

export const TaskTimeProgressSlot: React.FC<TaskTimeProgressSlotProps> = ({ task, now: propNow, isLive = true }) => {
  const prog = task.progress;
  const isCountingLive = Boolean(isLive && prog?.timeIn && !prog?.timeOut);
  const liveClockNow = useLiveClock(isCountingLive && !propNow);
  const now = propNow || liveClockNow;
  const upworkClients = useAppStore((s) => s.upworkClients);
  const upworkProjectClients = useAppStore((s) => s.upworkProjectClients);

  const clientName = prog?.client || task.list?.name || '';
  const isClientConfiguredUpwork = upworkClients.some((c) => c.toLowerCase() === clientName.toLowerCase());
  const hasManualUpworkTag = (task.taskMap?.statuses || []).some((s) => s.toLowerCase().startsWith('upwork'));
  const isLauren = clientName.toLowerCase().includes('lauren');

  // Upwork determination: Lauren is project-based (only Upwork if manually marked or in upworkClients); otherwise check configured list/tracker/tag
  const isUpwork = isLauren && !hasManualUpworkTag && !isClientConfiguredUpwork
    ? false
    : Boolean(
      isClientConfiguredUpwork ||
      prog?.isUpwork ||
      prog?.timeTracker?.toLowerCase().includes('upwork') ||
      task.list?.name?.toLowerCase().includes('upwork') ||
      hasManualUpworkTag
    );

  // 1. Missing Time Alert: Red badge with crossed-out time (when user started/entered task without Time In)
  if (prog?.isMissingTime && !prog?.timeOut && isLive && !isTaskHandedOver(task)) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/50 text-red-400 font-bold text-[10px] shadow-[0_0_8px_rgba(239,68,68,0.18)] select-none truncate max-w-full"
        title="Missing Time In — user did not input a Time In on their Daily Schedule"
      >
        <span className="relative flex size-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full size-1.5 bg-red-500" />
        </span>
        <span className="font-mono line-through decoration-red-400 decoration-[1.5px] opacity-90">--:--</span>
        <span className="text-[9px] font-semibold text-red-300 truncate">No Time In</span>
      </div>
    );
  }

  // 2. Completed Time: Duration in mins/hrs (e.g. 1hr 20 mins, 45 mins) when both Time In & Time Out exist,
  // falling back to Time Out alone if Time In is missing; exact range remains in the hover tooltip.
  if (prog?.timeOut) {
    const timeOutDisplay = cleanDisplayTime(prog.timeOut);
    const duration = prog.timeIn ? computeDuration(prog.timeIn, prog.timeOut) : '';
    const label = duration || timeOutDisplay;
    const pace = duration ? getPaceColor(task, duration, true) : null;

    return (
      <div
        className="text-[9.5px] font-mono text-zinc-300 font-medium truncate max-w-full px-1.5 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/60 shadow-xs select-none tracking-tight"
        style={pace ? { backgroundColor: hexToRgba(pace.hex, 0.15), borderColor: hexToRgba(pace.hex, 0.5), color: pace.hex } : undefined}
        title={`Logged time: ${prog.timeIn ? `${prog.timeIn} - ` : ''}${prog.timeOut}${duration ? ` (${duration})` : ''}${prog.maName ? ` • ${prog.maName}` : ''}${pace ? ` • ${pace.label}` : ''}`}
      >
        {label}
      </div>
    );
  }

  // 3. In-Progress Live Time: Time In | Mins or Hrs with mins (Counting elapsed)
  if (prog?.timeIn && !prog?.timeOut) {
    const isStale = isStaleLiveSession(prog.timeIn, prog.date, now);
    const elapsed = computeElapsed(prog.timeIn, prog.date, now);
    const timeInDisplay = cleanDisplayTime(prog.timeIn);

    // If session is runaway / stale (>14h or unclosed old date), or not marked as active live task, display static Time In without live pinging beacon
    if ((!isLive && !task.isAssumptionBlock) || isStale || !elapsed) {
      return (
        <div
          className="text-[10px] font-mono text-zinc-400 font-medium truncate max-w-full px-1.5 py-0.5 rounded bg-zinc-800/40 border border-zinc-700/40 select-none"
          title={`Clocked in at ${prog.timeIn}${prog.date ? ` on ${prog.date}` : ''} (session ended or unclosed)`}
        >
          {timeInDisplay}
        </div>
      );
    }

    const liveText = `${timeInDisplay} | ${elapsed}`;
    const pace = getPaceColor(task, elapsed, false);

    // If it's an Upwork task, highlight the time badge in pure white! (unless it's running over the estimate)
    if (isUpwork && !pace) {
      return (
        <div
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/40 text-indigo-700 dark:bg-white/15 dark:border-white/50 dark:text-white font-bold text-[10px] shadow-[0_0_8px_rgba(99,102,241,0.12)] dark:shadow-[0_0_8px_rgba(255,255,255,0.12)] select-none truncate max-w-full"
          title={`Upwork task in progress since ${prog.timeIn} (${elapsed} elapsed)`}
        >
          <span className="relative flex size-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 dark:bg-white opacity-75" />
            <span className="relative inline-flex rounded-full size-1.5 bg-indigo-600 dark:bg-white" />
          </span>
          <span className="font-mono truncate">{liveText}</span>
        </div>
      );
    }

    // Non-Upwork live task: highlight the time badge using the task's DB status color
    const statusLabel = toCanonicalTaskStatus(task.status) || task.status || 'IN PROGRESS';
    const statusHex = pace?.hex ?? resolveTaskStatusColor(statusLabel, task.listId || task.list?.id, task.list?.statuses);
    return (
      <div
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-bold text-[10px] select-none truncate max-w-full"
        style={{
          backgroundColor: hexToRgba(statusHex, 0.15),
          borderColor: hexToRgba(statusHex, 0.4),
          color: statusHex,
          boxShadow: `0 0 8px ${hexToRgba(statusHex, 0.12)}`,
        }}
        title={`${statusLabel} since ${prog.timeIn} (${elapsed} elapsed)${pace ? ` • ${pace.label}` : ''}`}
      >
        <span className="relative flex size-1.5 shrink-0">
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: statusHex }}
          />
          <span
            className="relative inline-flex rounded-full size-1.5"
            style={{ backgroundColor: statusHex }}
          />
        </span>
        <span className="font-mono truncate">{liveText}</span>
      </div>
    );
  }

  if (task.isAssumptionBlock && !prog?.timeIn) {
    return (
      <div className="text-[10px] font-mono text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/40 border border-zinc-700/40 select-none">
        --:-- - --:--
      </div>
    );
  }

  return (
    <span className="text-[10px] font-medium text-zinc-500">
      Posted {task.createdAt ? format(new Date(task.createdAt), 'MMM d') : format(now, 'MMM d')}
    </span>
  );
};
