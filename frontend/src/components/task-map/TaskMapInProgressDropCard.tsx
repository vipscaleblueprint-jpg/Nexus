'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UploadCloud, Search, X, Flag, Play } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { TaskMapItem } from '@/api/taskMap';

interface Props {
  userId: string;
  userName: string;
  availableTasks: TaskMapItem[];
  queuedTasks: TaskMapItem[];
  onSelectTask: (taskId: string) => Promise<void> | void;
  disabled?: boolean;
}

export const TaskMapInProgressDropCard: React.FC<Props> = ({
  userId,
  userName,
  availableTasks,
  queuedTasks,
  onSelectTask,
  disabled = false,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `in-progress-${userId}`,
    data: {
      type: 'in-progress-slot',
      userId,
      userName,
    },
    disabled,
  });

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const togglePopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popoverWidth = 300;
      const popoverHeight = 320;

      let top = rect.bottom + 6;
      if (top + popoverHeight > window.innerHeight - 10) {
        top = Math.max(10, rect.top - popoverHeight - 6);
      }

      let left = rect.left - 40;
      if (left + popoverWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - popoverWidth - 10);
      }
      if (left < 10) left = 10;

      setCoords({ top, left });
    }
    setIsOpen(!isOpen);
    setSearch('');
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (e: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = (e: Event) => {
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
        return;
      }
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen]);

  const cleanSearch = search.toLowerCase().trim();
  const filteredQueued = queuedTasks.filter((t) => {
    if (!cleanSearch) return true;
    const titleMatch = (t.title || '').toLowerCase().includes(cleanSearch);
    const clientMatch = (t.progress?.client || t.list?.name || '').toLowerCase().includes(cleanSearch);
    return titleMatch || clientMatch;
  });

  const filteredAvailable = availableTasks.filter((t) => {
    if (!cleanSearch) return true;
    const titleMatch = (t.title || '').toLowerCase().includes(cleanSearch);
    const clientMatch = (t.progress?.client || t.list?.name || '').toLowerCase().includes(cleanSearch);
    return titleMatch || clientMatch;
  });

  return (
    <>
      <div
        ref={setNodeRef}
        className={`relative group w-full rounded-xl border-2 border-dashed transition-all duration-200 select-none flex flex-col items-center justify-center text-center p-3 min-h-[112px] ${
          isOver
            ? 'border-[#D04A7C] bg-[#D04A7C]/15 ring-2 ring-[#D04A7C]/50 shadow-lg shadow-[#D04A7C]/20 scale-[1.01]'
            : 'border-zinc-700/70 hover:border-zinc-500/90 bg-zinc-900/40 hover:bg-zinc-900/70 shadow-xs'
        }`}
      >
        {/* Upload / Cloud Icon */}
        <div
          className={`size-7 rounded-full flex items-center justify-center mb-1 transition-colors ${
            isOver
              ? 'bg-[#D04A7C]/25 text-[#D04A7C]'
              : 'bg-zinc-800 text-zinc-400 group-hover:text-zinc-200 group-hover:bg-zinc-750'
          }`}
        >
          <UploadCloud className="size-4" />
        </div>

        {/* Primary Text */}
        <p
          className={`text-xs font-bold transition-colors ${
            isOver ? 'text-[#D04A7C]' : 'text-zinc-200 group-hover:text-white'
          }`}
        >
          {isOver ? 'Drop task to start In Progress' : 'Choose a task or drag & drop it here'}
        </p>

        {/* Subtitle Text */}
        <p className="text-[10px] text-zinc-500 mt-0.5 mb-1.5">
          Drop to set In Progress · Prioritized at top
        </p>

        {/* Browse Tasks Button */}
        <button
          ref={buttonRef}
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={togglePopover}
          className="px-3 py-1 rounded-md border border-zinc-700/80 bg-zinc-800 hover:bg-zinc-750 text-[11px] font-semibold text-zinc-300 hover:text-white hover:border-zinc-500 transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
        >
          <Search className="size-3 text-zinc-400" />
          <span>Browse Tasks</span>
        </button>
      </div>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="w-72 max-h-80 bg-popover border border-zinc-700/90 rounded-xl shadow-2xl p-2.5 flex flex-col text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
              <span className="text-xs font-bold text-zinc-200">Select In Progress Task</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-white p-0.5 rounded cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 mb-2">
              <Search className="size-3 text-zinc-500 shrink-0 mr-1.5" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks..."
                className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-zinc-500 hover:text-zinc-300 ml-1 p-0.5"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Task Options List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-0.5 max-h-56">
              {/* 1. Tasks already queued under this user */}
              {filteredQueued.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block px-1 mb-1">
                    Assigned Queue ({filteredQueued.length})
                  </span>
                  <div className="space-y-1">
                    {filteredQueued.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={async () => {
                          setIsOpen(false);
                          await onSelectTask(task.id);
                        }}
                        className="w-full text-left p-1.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800/80 hover:border-zinc-700 transition-all flex items-center justify-between gap-2 group cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-zinc-200 group-hover:text-white truncate">
                            {task.title}
                          </p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            {task.progress?.client || task.list?.name || 'General'}
                          </p>
                        </div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#D04A7C]/15 text-[#D04A7C] border border-[#D04A7C]/30 shrink-0 flex items-center gap-1">
                          <Play className="size-2.5 fill-current" />
                          Start
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Tasks from Available Pool */}
              {filteredAvailable.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block px-1 mb-1">
                    Available Pool ({filteredAvailable.length})
                  </span>
                  <div className="space-y-1">
                    {filteredAvailable.slice(0, 15).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={async () => {
                          setIsOpen(false);
                          await onSelectTask(task.id);
                        }}
                        className="w-full text-left p-1.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800/80 hover:border-zinc-700 transition-all flex items-center justify-between gap-2 group cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-zinc-200 group-hover:text-white truncate">
                            {task.title}
                          </p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            {task.progress?.client || task.list?.name || 'General'}
                          </p>
                        </div>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0 flex items-center gap-1">
                          <Play className="size-2.5 fill-current" />
                          Assign & Start
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredQueued.length === 0 && filteredAvailable.length === 0 && (
                <p className="text-xs text-zinc-500 italic text-center py-6">
                  {search ? `No tasks match "${search}"` : 'No tasks available to start.'}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

