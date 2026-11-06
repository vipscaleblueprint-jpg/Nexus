'use client';

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Flag, ChevronDown, Check, CheckCircle2 } from 'lucide-react';
import { CustomCircleDot, CustomCircleDotted } from '@/lib/taskTokens';
import { getPriorityConfig } from '@/lib/priority';
import { TaskMapItem } from '@/api/taskMap';

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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const counts = getColumnPriorityCounts(tasks);
  const currentKey = activeFilter || 'ALL';

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      ref={dropdownRef}
      className="relative inline-block text-left shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${details.btnClass}`}
        title={details.label ? `Filtered by ${details.label}` : 'Filter by priority'}
      >
        <Flag className={`size-3 shrink-0 ${details.flagClass}`} />
        {details.label && <span className="font-semibold">{details.label}</span>}
        {details.count > 0 && (
          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${details.badgeClass}`}>
            {details.count}
          </span>
        )}
        <ChevronDown
          className={`size-3 text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-40 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 text-zinc-200 z-50 animate-in fade-in zoom-in-95 duration-100">
          <button
            type="button"
            onClick={() => {
              onSelectFilter(columnId, 'ALL');
              setIsOpen(false);
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              currentKey === 'ALL'
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
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              currentKey === 'URGENT'
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
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                  currentKey === 'URGENT' ? 'bg-red-900/50 text-red-300' : 'bg-zinc-800/80 text-zinc-400'
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
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              currentKey === 'HIGH'
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
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                  currentKey === 'HIGH' ? 'bg-amber-900/50 text-amber-300' : 'bg-zinc-800/80 text-zinc-400'
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
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              currentKey === 'NORMAL'
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
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                  currentKey === 'NORMAL' ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-800/80 text-zinc-400'
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
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              currentKey === 'LOW'
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
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                  currentKey === 'LOW' ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800/80 text-zinc-400'
                }`}
              >
                {counts.LOW}
              </span>
              {currentKey === 'LOW' && <Check className="size-3.5 text-zinc-400" />}
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

export const CardStatusDropdown: React.FC<{
  taskId: string;
  currentStatus: string;
  onSelect: (newStatus: string) => void;
}> = ({ taskId, currentStatus, onSelect }) => {
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

    const handleScrollOrResize = () => {
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
            {statusList.map((item) => {
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
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                    isSelected
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

    const handleScrollOrResize = () => {
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
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                    isSelected
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

