'use client';

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Flag, ChevronDown, Check, CheckCircle2, Infinity as InfinityIcon } from 'lucide-react';
import { CustomCircleDot, CustomCircleDotted } from '@/lib/taskTokens';
import { getPriorityConfig } from '@/lib/priority';
import { TaskMapItem } from '@/api/taskMap';
import { format } from 'date-fns';
import { useAppStore } from '@/lib/store';
export { ColumnSubStatusDropdown, matchesSubStatusFilter, getColumnSubStatusCounts, getSubStatusColor } from './ColumnSubStatusDropdown';


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
    'TO REVIEW': '#1d4ed8',
    'TO_REVIEW': '#1d4ed8',
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
  return customStatuses.some((cs) => cs.toUpperCase().includes('URGENT'));
};

export const isTaskHigh = (task: TaskMapItem) => {
  const p = (task.priority || '').toUpperCase();
  return p === 'HIGH';
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
  const q = query.trim().toLowerCase();
  const title = (task.title || '').toLowerCase();
  const clientName = (task.list?.name || '').toLowerCase();
  const folderName = (task.list?.folder?.name || '').toLowerCase();
  const desc = (task.description || '').toLowerCase();
  const statuses = (task.taskMap?.statuses || []).map((s: string) => (s || '').toLowerCase());
  return (
    title.includes(q) ||
    clientName.includes(q) ||
    folderName.includes(q) ||
    desc.includes(q) ||
    statuses.some((s: string) => s.includes(q))
  );
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
          flagClass: 'text-red-400',
          btnClass: 'bg-red-950/70 hover:bg-red-950 text-red-200 border-red-700/80',
          badgeClass: 'bg-black/40 text-red-300',
          count: counts.URGENT,
        };
      case 'HIGH':
        return {
          label: 'High',
          flagClass: 'text-amber-400',
          btnClass: 'bg-amber-950/70 hover:bg-amber-950 text-amber-200 border-amber-700/80',
          badgeClass: 'bg-black/40 text-amber-300',
          count: counts.HIGH,
        };
      case 'NORMAL':
        return {
          label: 'Normal',
          flagClass: 'text-blue-400',
          btnClass: 'bg-blue-950/70 hover:bg-blue-950 text-blue-200 border-blue-700/80',
          badgeClass: 'bg-black/40 text-blue-300',
          count: counts.NORMAL,
        };
      case 'LOW':
        return {
          label: 'Low',
          flagClass: 'text-zinc-400',
          btnClass: 'bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border-zinc-700',
          badgeClass: 'bg-black/40 text-zinc-300',
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
  onSelect: (newStatus: string) => void;
  excludeStatuses?: string[];
}> = ({ taskId, currentStatus, onSelect, excludeStatuses = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const statusList = [
    { label: 'In progress', color: '#D04A7C' },
    { label: 'Pending', color: '#D29A2A' },
    { label: 'To review', color: '#1d4ed8' },
    { label: 'Revision', color: '#5B6BD6' },
    { label: 'Done', color: '#166534' },
    { label: 'Closed', color: '#10b981', isClosed: true },
    { label: 'KYC', color: '#059669', isKyc: true },
  ];

  const excludeSet = new Set(excludeStatuses.map((s) => s.toUpperCase().trim()));
  const filteredStatusList = statusList.filter(
    (item) => !excludeSet.has(item.label.toUpperCase().trim())
  );

  const calcPos = (rect: DOMRect) => {
    const width = 160;
    const height = 240;
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
  const isClosed = clean.toUpperCase() === 'CLOSED' || clean.toUpperCase() === 'DONE';
  const isKyc = clean.toUpperCase() === 'KYC';

  return (
    <div
      className="relative inline-flex items-center"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center p-1 -m-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer select-none"
        title={`Status: ${clean} (click to change)`}
      >
        {isClosed ? (
          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
        ) : isKyc ? (
          <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" />
        ) : (
          <CustomCircleDot
            className="size-3.5 shrink-0"
            style={{ color: getDotColor(clean) }}
          />
        )}
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
            className="w-40 p-1.5 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl flex flex-col gap-0.5 text-zinc-200 animate-in fade-in zoom-in-95 duration-75"
          >
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider px-2 py-1">
              Change Status
            </span>
            {filteredStatusList.map((item) => {
              const isSelected = clean.toUpperCase() === item.label.toUpperCase();
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setCoords(null);
                    onSelect(item.label);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${isSelected
                      ? 'bg-zinc-800 text-white font-semibold'
                      : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
                    }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {item.isClosed ? (
                      <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    ) : item.isKyc ? (
                      <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <CustomCircleDot
                        className="size-3.5 shrink-0"
                        style={{ color: item.color }}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
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

export const CardPriorityDropdown: React.FC<{
  taskId: string;
  priority: string;
  onSelect: (newPriority: string) => void;
}> = ({ taskId, priority, onSelect }) => {
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
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1 font-medium text-[11px] px-1.5 py-0.5 rounded hover:bg-zinc-800/80 transition-colors cursor-pointer select-none"
        title={`Priority: ${priorityConfig.label} (click to change)`}
      >
        <Flag className={`size-3 ${priorityConfig.iconColor}`} />
        <span className={priorityConfig.color}>{priorityConfig.label}</span>
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
    return `${h}h ${remM}m`;
  }
  return `${remM}m`;
}

/** Checks whether a live session exceeds the maximum allowable shift window (>14h) */
export function isStaleLiveSession(timeInStr?: string | null, dateStr?: string | null, now = new Date()): boolean {
  if (!timeInStr) return true;
  const m = timeInStr.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return true;

  let hrs = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hrs < 12) hrs += 12;
  if (ampm === 'AM' && hrs === 12) hrs = 0;

  const start = dateStr ? new Date(dateStr) : new Date(now);
  start.setHours(hrs, mins, 0, 0);

  let diffMs = now.getTime() - start.getTime();
  if (!dateStr && diffMs < 0) {
    start.setDate(start.getDate() - 1);
    diffMs = now.getTime() - start.getTime();
  }
  return diffMs > MAX_LIVE_SHIFT_MS;
}

export function computeElapsed(timeInStr?: string | null, dateStr?: string | null, now = new Date()): string {
  if (!timeInStr) return '';
  const m = timeInStr.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return '';

  let hrs = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && hrs < 12) hrs += 12;
  if (ampm === 'AM' && hrs === 12) hrs = 0;

  const start = dateStr ? new Date(dateStr) : new Date(now);
  start.setHours(hrs, mins, 0, 0);

  let diffMs = now.getTime() - start.getTime();
  if (!dateStr && diffMs < 0) {
    // If clocked in before midnight and current time is after midnight
    start.setDate(start.getDate() - 1);
    diffMs = now.getTime() - start.getTime();
  }
  if (diffMs < 0) diffMs = 0;

  // Stale / runaway session guard: stop live ticking if older than 14 hours
  if (diffMs > MAX_LIVE_SHIFT_MS) {
    return '';
  }

  const totalMins = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMins / 60);
  const remM = totalMins % 60;

  if (totalMins === 0) {
    return '0hr 0m';
  }
  if (h > 0) {
    return `${h}h ${remM}m`;
  }
  return `${remM}m`;
}

export interface TaskTimeProgressSlotProps {
  task: TaskMapItem;
  now: Date;
  isLive?: boolean;
}

export const TaskTimeProgressSlot: React.FC<TaskTimeProgressSlotProps> = ({ task, now, isLive = true }) => {
  const prog = task.progress;
  const upworkClients = useAppStore((s) => s.upworkClients);

  const clientName = prog?.client || task.list?.name || '';
  const isClientConfiguredUpwork = upworkClients.some((c) => c.toLowerCase() === clientName.toLowerCase());
  const hasManualUpworkTag = (task.taskMap?.statuses || []).some((s) => s.toLowerCase().startsWith('upwork'));
  const isLauren = clientName.toLowerCase().includes('lauren');

  // Upwork determination: Lauren is project-based (only Upwork if manually marked); otherwise check configured list/tracker/tag
  const isUpwork = isLauren
    ? hasManualUpworkTag
    : Boolean(
      isClientConfiguredUpwork ||
      prog?.isUpwork ||
      prog?.timeTracker?.toLowerCase().includes('upwork') ||
      task.list?.name?.toLowerCase().includes('upwork') ||
      hasManualUpworkTag
    );

  // 1. Missing Time Alert: Red badge with infinity icon
  if (prog?.isMissingTime) {
    return (
      <div
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-400 font-bold text-[10px] shadow-xs select-none"
        title="Missing Time! Status/Client entered without Time In"
      >
        <InfinityIcon className="size-3 text-red-500 animate-pulse shrink-0" />
        <span className="font-mono">∞</span>
      </div>
    );
  }

  // 2. Completed Time: Time In - Time Out (or Time Out alone)
  // When a task has a timeout, display the actual logged time range (e.g. 9:40 AM - 10:38 AM or 8:20 PM)
  if (prog?.timeOut) {
    const timeOutDisplay = cleanDisplayTime(prog.timeOut);
    const timeInDisplay = cleanDisplayTime(prog.timeIn);
    const duration = prog.timeIn ? computeDuration(prog.timeIn, prog.timeOut) : '';
    const label = timeInDisplay ? `${timeInDisplay} - ${timeOutDisplay}` : timeOutDisplay;

    return (
      <div
        className="text-[9.5px] font-mono text-zinc-300 font-medium truncate max-w-full px-1.5 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/60 shadow-xs select-none tracking-tight"
        title={`Logged time: ${prog.timeIn ? `${prog.timeIn} - ` : ''}${prog.timeOut}${duration ? ` (${duration})` : ''}${prog.maName ? ` • ${prog.maName}` : ''}`}
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
    if (!isLive || isStale || !elapsed) {
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

    // If it's an Upwork task, highlight the time badge in pure white!
    if (isUpwork) {
      return (
        <div
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 border border-white/50 text-white font-bold text-[10px] shadow-[0_0_8px_rgba(255,255,255,0.12)] select-none truncate max-w-full"
          title={`Upwork task in progress since ${prog.timeIn} (${elapsed} elapsed)`}
        >
          <span className="relative flex size-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full size-1.5 bg-white" />
          </span>
          <span className="font-mono truncate">{liveText}</span>
        </div>
      );
    }

    // Typical In-Progress task: Highlight the time badge in canonical #D04A7C magenta!
    return (
      <div
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#D04A7C]/15 border border-[#D04A7C]/40 text-[#D04A7C] font-bold text-[10px] shadow-[0_0_8px_rgba(208,74,124,0.12)] select-none truncate max-w-full"
        title={`In progress since ${prog.timeIn} (${elapsed} elapsed)`}
      >
        <span className="relative flex size-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D04A7C] opacity-75" />
          <span className="relative inline-flex rounded-full size-1.5 bg-[#D04A7C]" />
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
