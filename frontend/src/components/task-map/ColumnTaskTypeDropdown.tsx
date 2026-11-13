'use client';

import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ListTree, Check, Layers, CornerDownRight } from 'lucide-react';
import { TaskMapItem } from '@/api/taskMap';

export type TaskTypeFilterValue = 'ALL' | 'MAIN' | 'SUBTASK';

export const matchesTaskTypeFilter = (task: TaskMapItem, filter: string) => {
  if (!filter || filter === 'ALL') return true;
  if (filter === 'MAIN') return !task.isSubtask;
  if (filter === 'SUBTASK') return Boolean(task.isSubtask);
  return true;
};

export const getColumnTaskTypeCounts = (items: TaskMapItem[]) => {
  let mainCount = 0;
  let subtaskCount = 0;
  for (const t of items) {
    if (t.isSubtask) subtaskCount++;
    else mainCount++;
  }
  return { ALL: items.length, MAIN: mainCount, SUBTASK: subtaskCount };
};

export const ColumnTaskTypeDropdown: React.FC<{
  columnId: string;
  tasks: TaskMapItem[];
  activeFilter: string;
  onSelectFilter: (columnId: string, filter: string) => void;
}> = ({ columnId, tasks, activeFilter, onSelectFilter }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const counts = getColumnTaskTypeCounts(tasks);
  const currentKey = activeFilter || 'ALL';

  const calcPos = (rect: DOMRect) => {
    const width = 180;
    const height = 160;
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

  const getDisplayDetails = () => {
    if (currentKey === 'MAIN') {
      return {
        label: 'Main',
        iconClass: 'text-blue-400',
        btnClass: 'bg-blue-950/70 text-blue-200 border-blue-700/80',
      };
    }
    if (currentKey === 'SUBTASK') {
      return {
        label: 'Subtasks',
        iconClass: 'text-indigo-300',
        btnClass: 'bg-indigo-950/70 text-indigo-200 border-indigo-700/80',
      };
    }
    return {
      label: '',
      iconClass: 'text-zinc-400',
      btnClass: 'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700',
    };
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
        title={details.label ? `Filtered by Type: ${details.label}` : 'Filter by task type (Main / Subtask)'}
      >
        <ListTree className={`size-3 shrink-0 ${details.iconClass}`} />
        {details.label && <span className="font-semibold max-w-[75px] truncate">{details.label}</span>}
      </button>

      {isOpen &&
        coords &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none z-[999999]"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-zinc-400 uppercase border-b border-zinc-800/80 mb-1 flex items-center justify-between">
              <span>Task Type</span>
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

            <div className="space-y-0.5">
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
                  <ListTree className="size-3 text-zinc-400" />
                  <span>All Tasks</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">{counts.ALL}</span>
                  {currentKey === 'ALL' && <Check className="size-3.5 text-blue-400" />}
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectFilter(columnId, currentKey === 'MAIN' ? 'ALL' : 'MAIN');
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                  currentKey === 'MAIN'
                    ? 'bg-blue-950/70 text-blue-200 font-semibold border border-blue-700/80'
                    : 'text-zinc-300 hover:bg-zinc-800/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Layers className="size-3 text-blue-400" />
                  <span>Main Tasks</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">{counts.MAIN}</span>
                  {currentKey === 'MAIN' && <Check className="size-3.5 text-blue-400" />}
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectFilter(columnId, currentKey === 'SUBTASK' ? 'ALL' : 'SUBTASK');
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                  currentKey === 'SUBTASK'
                    ? 'bg-indigo-950/70 text-indigo-200 font-semibold border border-indigo-700/80'
                    : 'text-zinc-300 hover:bg-zinc-800/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CornerDownRight className="size-3 text-indigo-400" />
                  <span>Subtasks</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">{counts.SUBTASK}</span>
                  {currentKey === 'SUBTASK' && <Check className="size-3.5 text-indigo-300" />}
                </div>
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

