'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';

export function formatTimelineDate(dateInput: Date | number | string): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';

  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const day = d.getDate();

  const rem100 = day % 100;
  const rem10 = day % 10;
  let suffix = 'th';
  if (rem100 < 11 || rem100 > 13) {
    if (rem10 === 1) suffix = 'st';
    else if (rem10 === 2) suffix = 'nd';
    else if (rem10 === 3) suffix = 'rd';
  }

  return `${weekday}, ${month} ${day}${suffix}`;
}

export function getDayKey(dateInput: Date | number | string): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isTodayDate(dateInput: Date | number | string): boolean {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export interface ActivityDayDividerProps {
  date: Date | number | string;
  isNew?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  itemCount?: number;
  className?: string;
}

export function ActivityDayDivider({
  date,
  isNew = false,
  isCollapsed = false,
  onToggleCollapse,
  itemCount,
  className = '',
}: ActivityDayDividerProps) {
  const formattedDate = formatTimelineDate(date);
  if (!formattedDate) return null;

  return (
    <div className={`my-4 flex items-center gap-2 select-none w-full ${className}`}>
      {isNew ? (
        <>
          <span className="text-[11px] font-bold text-pink-500 uppercase tracking-wider shrink-0 pl-1 mr-1">
            New
          </span>
          <div className="h-[1px] bg-pink-500/50 flex-1 min-w-[8px]" />
          <button
            type="button"
            onClick={onToggleCollapse}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900 border border-pink-500/40 hover:border-pink-500/70 text-zinc-200 text-xs font-medium shadow-sm transition-all cursor-pointer group"
            title={isCollapsed ? 'Expand updates for this day' : 'Collapse updates for this day'}
          >
            <span>{formattedDate}</span>
            {isCollapsed && typeof itemCount === 'number' && itemCount > 0 && (
              <span className="text-[10px] text-pink-400 font-normal animate-in fade-in zoom-in-95 duration-150">
                ({itemCount})
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 transition-transform duration-200 ${
                isCollapsed ? '-rotate-90' : ''
              }`}
            />
          </button>
          <div className="h-[1px] bg-pink-500/50 flex-1 min-w-[8px]" />
        </>
      ) : (
        <>
          <div className="h-[1px] bg-zinc-800/80 flex-1 min-w-[8px]" />
          <button
            type="button"
            onClick={onToggleCollapse}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100 text-xs font-medium shadow-sm transition-all cursor-pointer group"
            title={isCollapsed ? 'Expand updates for this day' : 'Collapse updates for this day'}
          >
            <span>{formattedDate}</span>
            {isCollapsed && typeof itemCount === 'number' && itemCount > 0 && (
              <span className="text-[10px] text-zinc-500 font-normal animate-in fade-in zoom-in-95 duration-150">
                ({itemCount})
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-transform duration-200 ${
                isCollapsed ? '-rotate-90' : ''
              }`}
            />
          </button>
          <div className="h-[1px] bg-zinc-800/80 flex-1 min-w-[8px]" />
        </>
      )}
    </div>
  );
}
