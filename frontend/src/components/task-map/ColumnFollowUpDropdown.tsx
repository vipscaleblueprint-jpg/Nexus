'use client';

import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Check, ArrowUpDown } from 'lucide-react';
import { TaskMapItem, getTaskCrmWaitingInfo, CrmFollowUpTier } from '@/api/taskMap';

export type CrmFollowUpFilter =
  | 'ALL'
  | 'NEEDS_RESPONSE'
  | CrmFollowUpTier;

export type CrmFollowUpSort =
  | 'MOST_OVERDUE'
  | 'LEAST_OVERDUE'
  | 'PRIORITY';

export const matchesCrmFollowUpFilter = (
  task: TaskMapItem,
  filter: CrmFollowUpFilter,
  now: Date = new Date()
): boolean => {
  if (!filter || filter === 'ALL') return true;
  const info = getTaskCrmWaitingInfo(task, now);
  if (filter === 'NEEDS_RESPONSE') {
    return info.daysPassed >= 4;
  }
  return info.rule.tier === filter;
};

export const sortCrmSentTasks = (
  tasks: TaskMapItem[],
  sortMode: CrmFollowUpSort,
  fallbackUrgentSort: (items: TaskMapItem[]) => TaskMapItem[],
  now: Date = new Date()
): TaskMapItem[] => {
  if (sortMode === 'PRIORITY') {
    return fallbackUrgentSort(tasks);
  }
  const urgentOrdered = fallbackUrgentSort(tasks);
  const rankMap = new Map<string, number>();
  urgentOrdered.forEach((t, idx) => rankMap.set(t.id, idx));

  return [...tasks].sort((a, b) => {
    const infoA = getTaskCrmWaitingInfo(a, now);
    const infoB = getTaskCrmWaitingInfo(b, now);
    if (infoA.daysPassed !== infoB.daysPassed) {
      return sortMode === 'MOST_OVERDUE'
        ? infoB.daysPassed - infoA.daysPassed
        : infoA.daysPassed - infoB.daysPassed;
    }
    return (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0);
  });
};

const TIER_OPTIONS: Array<{
  key: CrmFollowUpFilter;
  label: string;
  sublabel: string;
  dotColor?: string;
  badgeClass: string;
}> = [
  {
    key: 'NEEDS_RESPONSE',
    label: 'Needs Response',
    sublabel: '4d+',
    dotColor: '#f97316',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  {
    key: 'SEVENTH_PLUS',
    label: '7th Day+',
    sublabel: 'Violet',
    dotColor: '#8b5cf6',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/35',
  },
  {
    key: 'FIFTH_DAY',
    label: '5th Day',
    sublabel: 'Red',
    dotColor: '#ef4444',
    badgeClass: 'bg-red-500/15 text-red-300 border-red-500/35',
  },
  {
    key: 'THIRD_DAY',
    label: '3rd Day',
    sublabel: 'Orange',
    dotColor: '#f97316',
    badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/35',
  },
  {
    key: 'NEXT_DAY',
    label: 'Next Day',
    sublabel: 'Yellow',
    dotColor: '#eab308',
    badgeClass: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/35',
  },
  {
    key: 'TODAY',
    label: 'Today',
    sublabel: '0d',
    dotColor: '#71717a',
    badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  },
];

const SORT_OPTIONS: Array<{ key: CrmFollowUpSort; label: string }> = [
  { key: 'MOST_OVERDUE', label: 'Most Overdue First' },
  { key: 'LEAST_OVERDUE', label: 'Newest Sent First' },
  { key: 'PRIORITY', label: 'Priority (Urgent First)' },
];

export const ColumnFollowUpDropdown: React.FC<{
  columnId: string;
  tasks: TaskMapItem[];
  activeFilter: CrmFollowUpFilter;
  activeSort: CrmFollowUpSort;
  onSelectFilter: (columnId: string, filter: CrmFollowUpFilter) => void;
  onSelectSort: (columnId: string, sort: CrmFollowUpSort) => void;
}> = ({ columnId, tasks, activeFilter, activeSort, onSelectFilter, onSelectSort }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const counts = React.useMemo(() => {
    const map: Record<string, number> = {
      ALL: tasks.length,
      NEEDS_RESPONSE: 0,
      SEVENTH_PLUS: 0,
      FIFTH_DAY: 0,
      THIRD_DAY: 0,
      NEXT_DAY: 0,
      TODAY: 0,
    };
    const now = new Date();
    for (const t of tasks) {
      const info = getTaskCrmWaitingInfo(t, now);
      map[info.rule.tier] = (map[info.rule.tier] || 0) + 1;
      if (info.daysPassed >= 4) map.NEEDS_RESPONSE++;
    }
    return map;
  }, [tasks]);

  const calcPos = (rect: DOMRect) => {
    const width = 232;
    const height = 360;
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
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords(calcPos(rect));
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

  const activeTier = TIER_OPTIONS.find((o) => o.key === activeFilter);
  const hasCustomFilter = activeFilter !== 'ALL';
  const sortLabel =
    activeSort === 'MOST_OVERDUE' ? 'Days ↓' : activeSort === 'LEAST_OVERDUE' ? 'Days ↑' : '';

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
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${
          hasCustomFilter && activeTier
            ? activeTier.badgeClass
            : activeSort !== 'PRIORITY'
              ? 'bg-card hover:bg-zinc-800/60 text-zinc-200 border-zinc-700/80'
              : 'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700'
        }`}
        title="Filter & sort by Follow-Up Rules"
      >
        <Clock className="size-3 shrink-0" style={activeTier?.dotColor ? { color: activeTier.dotColor } : undefined} />
        {activeTier ? (
          <span className="font-semibold max-w-[90px] truncate">{activeTier.label}</span>
        ) : sortLabel ? (
          <span className="text-[11px] font-semibold text-zinc-300">{sortLabel}</span>
        ) : null}
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed w-58 bg-popover border border-border rounded-xl shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-100 select-none z-[999999]"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sort Section */}
            <div className="px-1.5 py-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase border-b border-border/80 mb-1 flex items-center gap-1.5">
              <ArrowUpDown className="size-3 text-zinc-400" />
              <span>Sort Order</span>
            </div>
            <div className="space-y-0.5 mb-2">
              {SORT_OPTIONS.map((opt) => {
                const isSelected = activeSort === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      onSelectSort(columnId, opt.key);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#22A3AE]/20 text-[#22A3AE] font-semibold border border-[#22A3AE]/30'
                        : 'text-zinc-300 hover:bg-zinc-800/70'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Filter Section */}
            <div className="px-1.5 py-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase border-b border-border/80 mb-1 flex items-center justify-between">
              <span>Follow-Up Filter</span>
              {hasCustomFilter && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectFilter(columnId, 'ALL');
                    setIsOpen(false);
                  }}
                  className="text-zinc-500 hover:text-zinc-200 text-[10px] lowercase cursor-pointer"
                >
                  reset
                </button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  onSelectFilter(columnId, 'ALL');
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                  activeFilter === 'ALL'
                    ? 'bg-blue-600/20 text-blue-300 font-semibold border border-blue-500/30'
                    : 'text-zinc-300 hover:bg-zinc-800/70'
                }`}
              >
                <span>All Waiting</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">{counts.ALL || 0}</span>
                  {activeFilter === 'ALL' && <Check className="size-3.5 text-blue-400" />}
                </div>
              </button>

              {TIER_OPTIONS.map((opt) => {
                const isSelected = activeFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      onSelectFilter(columnId, isSelected ? 'ALL' : opt.key);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                      isSelected
                        ? `${opt.badgeClass} font-semibold border`
                        : 'text-zinc-300 hover:bg-zinc-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: opt.dotColor }}
                      />
                      <span className="truncate">{opt.label}</span>
                      <span className="text-[10px] text-zinc-500 shrink-0">({opt.sublabel})</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-zinc-500">{counts[opt.key] || 0}</span>
                      {isSelected && <Check className="size-3.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
