'use client';

import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Tag, Check } from 'lucide-react';
import { TaskMapItem } from '@/api/taskMap';

export const getSubStatusColor = (status: string) => {
  const up = status.toUpperCase().trim();
  const hexMap: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    'IN PROGRESS': { bg: 'bg-pink-100 dark:bg-pink-950/70', text: 'text-pink-800 dark:text-pink-200', border: 'border-pink-200 dark:border-pink-700/80', dot: '#D04A7C' },
    'INPROGRESS': { bg: 'bg-pink-100 dark:bg-pink-950/70', text: 'text-pink-800 dark:text-pink-200', border: 'border-pink-200 dark:border-pink-700/80', dot: '#D04A7C' },
    'AVAILABLE TASK': { bg: 'bg-blue-100 dark:bg-blue-950/70', text: 'text-blue-800 dark:text-blue-200', border: 'border-blue-200 dark:border-blue-700/80', dot: '#2563eb' },
    'AVAILABLETASK': { bg: 'bg-blue-100 dark:bg-blue-950/70', text: 'text-blue-800 dark:text-blue-200', border: 'border-blue-200 dark:border-blue-700/80', dot: '#2563eb' },
    'HAND OVER': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' },
    'HAND-OVER': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' },
    'HANDOVER': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' },
    'HAND-OVER IN': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' },
    'HANDOVERIN': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' },
    'HAND-OVER OUT': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' },
    'HANDOVEROUT': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' },
    PAUSED: { bg: 'bg-yellow-100 dark:bg-yellow-950/70', text: 'text-yellow-800 dark:text-yellow-200', border: 'border-yellow-200 dark:border-yellow-700/80', dot: '#eab308' },
    'ASK CLIENT': { bg: 'bg-cyan-100 dark:bg-cyan-950/70', text: 'text-cyan-800 dark:text-cyan-200', border: 'border-cyan-200 dark:border-cyan-700/80', dot: '#06b6d4' },
    'TO REVIEW': { bg: 'bg-orange-100 dark:bg-orange-950/70', text: 'text-orange-800 dark:text-orange-200', border: 'border-orange-200 dark:border-orange-700/80', dot: '#D97B3A' },
    WAITING: { bg: 'bg-red-100 dark:bg-red-950/70', text: 'text-red-800 dark:text-red-200', border: 'border-red-200 dark:border-red-700/80', dot: '#D9534F' },
    'ON-HOLD': { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#8a8f98' },
    ONHOLD: { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#8a8f98' },
    REVISION: { bg: 'bg-indigo-100 dark:bg-indigo-950/70', text: 'text-indigo-800 dark:text-indigo-200', border: 'border-indigo-200 dark:border-indigo-700/80', dot: '#5B6BD6' },
    REVISIONS: { bg: 'bg-indigo-100 dark:bg-indigo-950/70', text: 'text-indigo-800 dark:text-indigo-200', border: 'border-indigo-200 dark:border-indigo-700/80', dot: '#5B6BD6' },
    'TO SEND': { bg: 'bg-teal-100 dark:bg-teal-950/70', text: 'text-teal-800 dark:text-teal-200', border: 'border-teal-200 dark:border-teal-700/80', dot: '#22A3AE' },
    'READY TO SEND': { bg: 'bg-teal-100 dark:bg-teal-950/70', text: 'text-teal-800 dark:text-teal-200', border: 'border-teal-200 dark:border-teal-700/80', dot: '#22A3AE' },
    READYTOSEND: { bg: 'bg-teal-100 dark:bg-teal-950/70', text: 'text-teal-800 dark:text-teal-200', border: 'border-teal-200 dark:border-teal-700/80', dot: '#22A3AE' },
    SENT: { bg: 'bg-red-100 dark:bg-red-950/70', text: 'text-red-800 dark:text-red-200', border: 'border-red-200 dark:border-red-700/80', dot: '#D9534F' },
    'SENT BUT WAITING': { bg: 'bg-red-100 dark:bg-red-950/70', text: 'text-red-800 dark:text-red-200', border: 'border-red-200 dark:border-red-700/80', dot: '#D9534F' },
    SENTBUTWAITING: { bg: 'bg-red-100 dark:bg-red-950/70', text: 'text-red-800 dark:text-red-200', border: 'border-red-200 dark:border-red-700/80', dot: '#D9534F' },
    'FOLLOW UP': { bg: 'bg-sky-100 dark:bg-sky-950/70', text: 'text-sky-800 dark:text-sky-200', border: 'border-sky-200 dark:border-sky-700/80', dot: '#38bdf8' },
    CLOSED: { bg: 'bg-emerald-100 dark:bg-emerald-950/70', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-emerald-200 dark:border-emerald-700/80', dot: '#2FA37A' },
    'DESIGN AUDIT': { bg: 'bg-pink-100 dark:bg-pink-950/70', text: 'text-pink-800 dark:text-pink-200', border: 'border-pink-200 dark:border-pink-700/80', dot: '#ec4899' },
    'UI UX AUDIT': { bg: 'bg-cyan-100 dark:bg-cyan-950/70', text: 'text-cyan-800 dark:text-cyan-200', border: 'border-cyan-200 dark:border-cyan-700/80', dot: '#06b6d4' },
    'UI/UX AUDIT': { bg: 'bg-cyan-100 dark:bg-cyan-950/70', text: 'text-cyan-800 dark:text-cyan-200', border: 'border-cyan-200 dark:border-cyan-700/80', dot: '#06b6d4' },
    'INSTRUCTION AUDIT': { bg: 'bg-emerald-100 dark:bg-emerald-950/70', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-emerald-200 dark:border-emerald-700/80', dot: '#10b981' },
    'INSTRUCTIONS AUDIT': { bg: 'bg-emerald-100 dark:bg-emerald-950/70', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-emerald-200 dark:border-emerald-700/80', dot: '#10b981' },
    'FUNNEL AUDIT': { bg: 'bg-amber-100 dark:bg-amber-950/70', text: 'text-amber-800 dark:text-amber-200', border: 'border-amber-200 dark:border-amber-700/80', dot: '#f59e0b' },
  };
  return hexMap[up] || { bg: 'bg-zinc-200/80 dark:bg-zinc-800', text: 'text-zinc-800 dark:text-zinc-200', border: 'border-zinc-300 dark:border-zinc-700', dot: '#71717a' };
};

const normalizePoolSubStatusLabel = (status: string, isAvailablePool: boolean) => {
  const clean = (status || '').trim();
  const compact = clean.toUpperCase().replace(/[\s_-]+/g, '');
  if (isAvailablePool && (compact === 'HANDOVER' || compact === 'HANDOVERIN' || compact === 'HANDOVEROUT')) {
    return 'Hand-over';
  }
  if (!isAvailablePool && compact === 'HANDOVER') {
    return 'Hand-over In';
  }
  return clean;
};

export const matchesSubStatusFilter = (task: TaskMapItem, filter: string, columnId?: string) => {
  if (!filter || filter === 'ALL') return true;
  const isAvailablePool = columnId === 'available-pool';
  const target = filter.trim().toLowerCase();
  const statuses = (task.taskMap?.statuses || []).map((s: string) =>
    normalizePoolSubStatusLabel(s || '', isAvailablePool).toLowerCase()
  );
  if (target === 'none') {
    return statuses.length === 0;
  }
  return statuses.includes(target) || (task.status || '').trim().toLowerCase() === target;
};

export const getColumnSubStatusCounts = (items: TaskMapItem[], columnId?: string) => {
  const isAvailablePool = columnId === 'available-pool';
  const counts: Record<string, number> = { ALL: items.length };
  for (const t of items) {
    const statuses = t.taskMap?.statuses || [];
    if (statuses.length === 0) {
      counts['None'] = (counts['None'] || 0) + 1;
    } else {
      for (const st of statuses) {
        const clean = normalizePoolSubStatusLabel(st, isAvailablePool);
        counts[clean] = (counts[clean] || 0) + 1;
      }
    }
  }
  return counts;
};

export const ColumnSubStatusDropdown: React.FC<{
  columnId: string;
  tasks: TaskMapItem[];
  activeFilter: string;
  onSelectFilter: (columnId: string, filter: string) => void;
}> = ({ columnId, tasks, activeFilter, onSelectFilter }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const counts = getColumnSubStatusCounts(tasks, columnId);
  const currentKey = activeFilter || 'ALL';

  const calcPos = (rect: DOMRect) => {
    const width = 180;
    const height = 260;
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
    if (currentKey === 'ALL') {
      return {
        label: '',
        tagClass: 'text-zinc-400',
        btnClass: 'bg-card hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700',
      };
    }
    const colorStyle = getSubStatusColor(currentKey);
    return {
      label: currentKey,
      tagClass: colorStyle.text,
      btnClass: `${colorStyle.bg} ${colorStyle.text} ${colorStyle.border}`,
    };
  };

  const details = getDisplayDetails();

  // Distinct substatus options from actual tasks in this column + core substatuses
  const distinctStatuses = React.useMemo(() => {
    const set = new Set<string>();
    Object.keys(counts).forEach((k) => {
      if (k !== 'ALL') set.add(k);
    });
    return Array.from(set).sort((a, b) => {
      if (a === 'None') return 1;
      if (b === 'None') return -1;
      return a.localeCompare(b);
    });
  }, [counts]);

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
        title={details.label ? `Filtered by Sub-Status: ${details.label}` : 'Filter by sub-status'}
      >
        <Tag className={`size-3 shrink-0 ${details.tagClass}`} />
        {details.label && <span className="font-semibold max-w-[90px] truncate">{details.label}</span>}
      </button>

      {isOpen &&
        coords &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed w-48 bg-card border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none z-[999999]"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-zinc-500 dark:text-zinc-400 uppercase border-b border-zinc-200 dark:border-zinc-800/80 mb-1 flex items-center justify-between">
              <span>Sub-Status</span>
              {currentKey !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectFilter(columnId, 'ALL');
                    setIsOpen(false);
                  }}
                  className="text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200 text-[10px] lowercase cursor-pointer"
                >
                  reset
                </button>
              )}
            </div>

            <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-0.5">
              {/* All Option */}
              <button
                type="button"
                onClick={() => {
                  onSelectFilter(columnId, 'ALL');
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                  currentKey === 'ALL'
                    ? 'bg-blue-600/15 text-blue-700 dark:text-blue-300 font-semibold border border-blue-500/30'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Tag className="size-3 text-zinc-400 dark:text-zinc-500" />
                  <span>All Sub-Statuses</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{counts.ALL || 0}</span>
                  {currentKey === 'ALL' && <Check className="size-3.5 text-blue-600 dark:text-blue-400" />}
                </div>
              </button>

              {distinctStatuses.map((st) => {
                const isSelected = currentKey.toLowerCase() === st.toLowerCase();
                const colorInfo = getSubStatusColor(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      onSelectFilter(columnId, isSelected ? 'ALL' : st);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                      isSelected
                        ? `${colorInfo.bg} ${colorInfo.text} font-semibold border ${colorInfo.border}`
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: colorInfo.dot }}
                      />
                      <span className="truncate">{st}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{counts[st] || 0}</span>
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

