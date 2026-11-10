'use client';

import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Tag, Check } from 'lucide-react';
import { TaskMapItem } from '@/api/taskMap';

export const getSubStatusColor = (status: string) => {
  const up = status.toUpperCase().trim();
  const hexMap: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    'HAND-OVER': { bg: 'bg-purple-950/70', text: 'text-purple-200', border: 'border-purple-750/80', dot: '#a855f7' },
    'HANDOVER': { bg: 'bg-purple-950/70', text: 'text-purple-200', border: 'border-purple-750/80', dot: '#a855f7' },
    PAUSED: { bg: 'bg-yellow-950/70', text: 'text-yellow-200', border: 'border-yellow-750/80', dot: '#eab308' },
    'ASK CLIENT': { bg: 'bg-cyan-950/70', text: 'text-cyan-200', border: 'border-cyan-750/80', dot: '#06b6d4' },
    'TO REVIEW': { bg: 'bg-blue-950/70', text: 'text-blue-200', border: 'border-blue-750/80', dot: '#2563eb' },
    WAITING: { bg: 'bg-red-950/70', text: 'text-red-200', border: 'border-red-750/80', dot: '#ef4444' },
    'ON-HOLD': { bg: 'bg-zinc-800', text: 'text-zinc-200', border: 'border-zinc-700', dot: '#8a8f98' },
    ONHOLD: { bg: 'bg-zinc-800', text: 'text-zinc-200', border: 'border-zinc-700', dot: '#8a8f98' },
    REVISION: { bg: 'bg-indigo-950/70', text: 'text-indigo-200', border: 'border-indigo-750/80', dot: '#5B6BD6' },
    'TO SEND': { bg: 'bg-teal-950/70', text: 'text-teal-200', border: 'border-teal-750/80', dot: '#22A3AE' },
    SENT: { bg: 'bg-emerald-950/70', text: 'text-emerald-200', border: 'border-emerald-750/80', dot: '#10b981' },
    'FOLLOW UP': { bg: 'bg-amber-950/70', text: 'text-amber-200', border: 'border-amber-750/80', dot: '#f59e0b' },
    'DESIGN AUDIT': { bg: 'bg-pink-950/70', text: 'text-pink-200', border: 'border-pink-750/80', dot: '#ec4899' },
    'UI UX AUDIT': { bg: 'bg-cyan-950/70', text: 'text-cyan-200', border: 'border-cyan-750/80', dot: '#06b6d4' },
    'UI/UX AUDIT': { bg: 'bg-cyan-950/70', text: 'text-cyan-200', border: 'border-cyan-750/80', dot: '#06b6d4' },
    'INSTRUCTION AUDIT': { bg: 'bg-emerald-950/70', text: 'text-emerald-200', border: 'border-emerald-750/80', dot: '#10b981' },
    'INSTRUCTIONS AUDIT': { bg: 'bg-emerald-950/70', text: 'text-emerald-200', border: 'border-emerald-750/80', dot: '#10b981' },
    'FUNNEL AUDIT': { bg: 'bg-amber-950/70', text: 'text-amber-200', border: 'border-amber-750/80', dot: '#f59e0b' },
  };
  return hexMap[up] || { bg: 'bg-zinc-800', text: 'text-zinc-200', border: 'border-zinc-700', dot: '#71717a' };
};

export const matchesSubStatusFilter = (task: TaskMapItem, filter: string) => {
  if (!filter || filter === 'ALL') return true;
  const target = filter.trim().toLowerCase();
  const statuses = (task.taskMap?.statuses || []).map((s: string) => (s || '').trim().toLowerCase());
  if (target === 'none') {
    return statuses.length === 0;
  }
  return statuses.includes(target) || (task.status || '').trim().toLowerCase() === target;
};

export const getColumnSubStatusCounts = (items: TaskMapItem[]) => {
  const counts: Record<string, number> = { ALL: items.length };
  for (const t of items) {
    const statuses = t.taskMap?.statuses || [];
    if (statuses.length === 0) {
      counts['None'] = (counts['None'] || 0) + 1;
    } else {
      for (const st of statuses) {
        const clean = st.trim();
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
  const counts = getColumnSubStatusCounts(tasks);
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
        btnClass: 'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700',
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
            className="fixed w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none z-[999999]"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase border-b border-zinc-800/80 mb-1 flex items-center justify-between">
              <span>Sub-Status</span>
              {currentKey !== 'ALL' && (
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
                    ? 'bg-blue-600/20 text-blue-300 font-semibold border border-blue-500/30'
                    : 'text-zinc-300 hover:bg-zinc-800/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Tag className="size-3 text-zinc-400" />
                  <span>All Sub-Statuses</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">{counts.ALL || 0}</span>
                  {currentKey === 'ALL' && <Check className="size-3.5 text-blue-400" />}
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
                        : 'text-zinc-300 hover:bg-zinc-800/80'
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
                      <span className="text-[10px] text-zinc-500">{counts[st] || 0}</span>
                      {isSelected && <Check className="size-3.5 text-white" />}
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

