'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UploadCloud, Search, X, Flag, Play } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { TaskMapItem, isTaskUnderAdmin, taskMapApi, extractTaskLinkIdentifiers, matchesTaskLinkOrId } from '@/api/taskMap';

interface Props {
  userId: string;
  userName: string;
  availableTasks: TaskMapItem[];
  allAvailableTasks?: TaskMapItem[];
  allTasks?: TaskMapItem[];
  queuedTasks: TaskMapItem[];
  onSelectTask: (taskId: string, task?: TaskMapItem) => Promise<void> | void;
  disabled?: boolean;
  canBrowse?: boolean;
  roleLabel?: string;
}

export const TaskMapInProgressDropCard: React.FC<Props> = ({
  userId,
  userName,
  availableTasks,
  allAvailableTasks,
  allTasks,
  queuedTasks,
  onSelectTask,
  disabled = false,
  canBrowse,
  roleLabel,
}) => {
  const allowBrowse = canBrowse !== undefined ? canBrowse : !disabled;
  const role = roleLabel || 'MA';
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
  const [remoteAdminTasks, setRemoteAdminTasks] = useState<TaskMapItem[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const togglePopover = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!isOpen) {
      const anchor = cardRef.current;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const popoverWidth = 300;
        const popoverHeight = 320;

        let top = rect.bottom + 6;
        if (top + popoverHeight > window.innerHeight - 10) {
          top = Math.max(10, rect.top - popoverHeight - 6);
        }

        let left = rect.left + (rect.width - popoverWidth) / 2;
        if (left + popoverWidth > window.innerWidth - 10) {
          left = Math.max(10, window.innerWidth - popoverWidth - 10);
        }
        if (left < 10) left = 10;

        setCoords({ top, left });
      }
    }
    setIsOpen(!isOpen);
    setSearch('');
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (e: MouseEvent) => {
      if (cardRef.current && cardRef.current.contains(e.target as Node)) {
        return;
      }
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleResize = () => {
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  const cleanSearch = search.toLowerCase().trim();

  // Live remote search for Admin tasks across all statuses (Closed, Daily, In Progress, etc.)
  useEffect(() => {
    if (!isOpen) {
      setRemoteAdminTasks([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const results = await taskMapApi.searchAdminTasks(cleanSearch || undefined, 100);
        setRemoteAdminTasks(results);
      } catch (err) {
        console.warn('Error fetching admin tasks:', err);
      }
    }, cleanSearch ? 150 : 0);

    return () => clearTimeout(timer);
  }, [isOpen, cleanSearch]);

  const isSearchMatching = (t: TaskMapItem) => {
    if (!cleanSearch) return true;
    if (matchesTaskLinkOrId(t, cleanSearch)) return true;
    const title = (t.title || '').toLowerCase();
    const client = (t.progress?.client || t.list?.name || '').toLowerCase();
    const folder = (t.list?.folder?.name || '').toLowerCase();
    const desc = ((t as any).description || '').toLowerCase();

  /**
   * -1 = no match. Otherwise lower ranks first: 0 = title contains the whole search,
   * 1 = every word is in the title, 2 = every word is somewhere (client, folder, description, tags).
   * Every typed word must match, so "fix vip" no longer returns every VIP Scale task.
   */
  const searchRank = (t: TaskMapItem): number => {
    if (searchWords.length === 0) return 0;
    const title = normalizeForSearch(t.title || '');
    const client = normalizeForSearch(t.progress?.client || t.list?.name || '');
    const folder = normalizeForSearch(t.list?.folder?.name || '');
    const desc = normalizeForSearch((t as any).description || '');
    const tags = ((t as any).tags || [])
      .map((tag: any) => normalizeForSearch(typeof tag === 'string' ? tag : tag?.name || ''))
      .join(' ');
    const admin = isTaskUnderAdmin(t) ? 'admin' : '';
    const everywhere = `${title} ${client} ${folder} ${desc} ${tags} ${admin}`;

    if (title.includes(searchWords.join(' '))) return 0;
    if (searchWords.every((w) => title.includes(w))) return 1;
    if (searchWords.every((w) => everywhere.includes(w))) return 2;
    return -1;
  };

  /** Matches only, best matches first (stable, so the board's own order breaks ties). */
  const rankBySearch = (tasks: TaskMapItem[]) =>
    !cleanSearch
      ? tasks
      : tasks
          .map((t, i) => ({ t, i, r: searchRank(t) }))
          .filter((x) => x.r >= 0)
          .sort((a, b) => a.r - b.r || a.i - b.i)
          .map((x) => x.t);

  const filteredQueued = rankBySearch(queuedTasks);

  // Candidate pool for available tasks:
  // When cleanSearch is empty: display availableTasks (clean active pool, e.g. 119 client tasks).
  // When cleanSearch has input: search across availableTasks, allAvailableTasks, allTasks, and remoteAdminTasks (NO status restrictions for Admin tasks!).
  const searchableAvailablePool = React.useMemo(() => {
    if (!cleanSearch) {
      return availableTasks;
    }

    const map = new Map<string, TaskMapItem>();
    const queuedIdSet = new Set(queuedTasks.map((t) => t.id));

    // 1. Regular available tasks
    for (const t of availableTasks) {
      if (t && t.id) map.set(t.id, t);
    }

    // 2. Full unfiltered available pool
    const extraPool = allAvailableTasks || [];
    for (const t of extraPool) {
      if (t && t.id && !queuedIdSet.has(t.id)) {
        map.set(t.id, t);
      }
    }

    // 3. Admin tasks from allTasks regardless of status (or all tasks when searching by link)
    const { isLink: isLinkQuery } = extractTaskLinkIdentifiers(cleanSearch);
    const extraTasks = allTasks || [];
    for (const t of extraTasks) {
      if (!t || !t.id || map.has(t.id) || queuedIdSet.has(t.id)) continue;
      if (!isLinkQuery && !isTaskUnderAdmin(t)) continue;
      map.set(t.id, t);
    }

    // 4. Remote Admin tasks fetched from server (all 565 admin tasks in ClickUp/DB regardless of status)
    for (const t of remoteAdminTasks) {
      if (!t || !t.id || map.has(t.id) || queuedIdSet.has(t.id)) continue;
      map.set(t.id, t);
    }

    return Array.from(map.values());
  }, [cleanSearch, availableTasks, allAvailableTasks, allTasks, queuedTasks, remoteAdminTasks]);

  const filteredAvailable = rankBySearch(searchableAvailablePool);

  return (
    <>
      <div
        ref={(node) => {
          setNodeRef(node);
          (cardRef as any).current = node;
        }}
        data-in-progress-dropzone="true"
        data-no-drag-scroll="true"
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          if (!allowBrowse) return;
          togglePopover(e);
        }}
        className={`relative group w-full rounded-xl border-2 border-dashed transition-all duration-150 select-none flex flex-col items-center justify-center text-center p-3 min-h-[112px] ${
          allowBrowse
            ? 'cursor-pointer hover:border-zinc-500/90 hover:bg-zinc-800/60 active:scale-[0.99]'
            : 'cursor-default'
        } ${
          isOver && !allowBrowse
            ? 'border-red-500/70 bg-red-950/20 ring-2 ring-red-500/40 shadow-lg shadow-red-950/20'
            : isOver
              ? 'border-[#D04A7C] bg-[#D04A7C]/15 ring-2 ring-[#D04A7C]/50 shadow-lg shadow-[#D04A7C]/20'
              : 'border-zinc-700/70 bg-zinc-900/40 shadow-xs'
        }`}
      >
        {/* Upload / Cloud Icon */}
        <div
          className={`size-7 rounded-full flex items-center justify-center mb-1 transition-colors ${
            isOver && !allowBrowse
              ? 'bg-red-500/20 text-red-400'
              : isOver
                ? 'bg-[#D04A7C]/25 text-[#D04A7C]'
                : 'bg-zinc-800 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 group-hover:bg-zinc-700'
          }`}
        >
          <UploadCloud className="size-4" />
        </div>

        {/* Primary Text */}
        <p
          className={`text-xs font-bold transition-colors ${
            isOver && !allowBrowse
              ? 'text-red-400'
              : isOver
                ? 'text-[#D04A7C]'
                : 'text-zinc-800 dark:text-zinc-200 group-hover:text-zinc-950 dark:group-hover:text-white'
          }`}
        >
          {isOver && !allowBrowse
            ? `Only the assigned ${role} or PM can move tasks to In Progress`
            : isOver
              ? 'Drop task to start In Progress'
              : 'Choose a task or drag & drop it here'}
        </p>

        {/* Subtitle Text */}
        <p className="text-[10px] text-zinc-500 mt-0.5 mb-1.5">
          {allowBrowse
            ? 'Click whole block to browse · Drop to set In Progress'
            : `Only the assigned ${role} or PM can start In Progress`}
        </p>

        {/* Browse Tasks Action Pill (whole block triggers browse) */}
        {allowBrowse && (
          <div
            className="px-3 py-1 rounded-md border border-zinc-700/80 bg-zinc-800 group-hover:bg-zinc-700 text-[11px] font-semibold text-zinc-300 group-hover:text-white group-hover:border-zinc-500 transition-all shadow-xs flex items-center gap-1.5 pointer-events-none select-none"
          >
            <Search className="size-3 text-zinc-400 group-hover:text-zinc-200" />
            <span>Browse Tasks</span>
          </div>
        )}
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
            <div className="flex items-center justify-between pb-2 border-b border-border mb-2">
              <span className="text-xs font-bold text-foreground">Select In Progress Task</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="flex items-center bg-background border border-border rounded-lg px-2 py-1 mb-2">
              <Search className="size-3 text-muted-foreground shrink-0 mr-1.5" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks..."
                className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-muted-foreground hover:text-foreground ml-1 p-0.5"
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
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block px-1 mb-1">
                    Assigned Queue ({filteredQueued.length})
                  </span>
                  <div className="space-y-1">
                    {filteredQueued.map((task) => {
                      const isAdmin = isTaskUnderAdmin(task);
                      const clientName = task.progress?.client || task.list?.name || (isAdmin ? 'Admin' : 'General');
                      const rawStatus = task.status || (task.isClosed ? 'Closed' : '');
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={async () => {
                            setIsOpen(false);
                            await onSelectTask(task.id, task);
                          }}
                          className="w-full text-left p-1.5 rounded-lg bg-card hover:bg-hover-subtle border border-border hover:border-border transition-all flex items-center justify-between gap-2 group cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-medium text-foreground truncate max-w-[190px]">
                                {task.title}
                              </p>
                              {isAdmin && (
                                <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                                  Admin
                                </span>
                              )}
                              {rawStatus && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60 shrink-0">
                                  {rawStatus}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {clientName}
                            </p>
                          </div>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#D04A7C]/15 text-[#D04A7C] border border-[#D04A7C]/30 shrink-0 flex items-center gap-1">
                            <Play className="size-2.5 fill-current" />
                            Start
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Tasks from Available Pool */}
              {filteredAvailable.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block px-1 mb-1">
                    Available Pool ({filteredAvailable.length})
                  </span>
                  <div className="space-y-1">
                    {filteredAvailable.slice(0, 60).map((task) => {
                      const isAdmin = isTaskUnderAdmin(task);
                      const clientName = task.progress?.client || task.list?.name || (isAdmin ? 'Admin' : 'General');
                      const rawStatus = task.status || (task.isClosed ? 'Closed' : '');
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={async () => {
                            setIsOpen(false);
                            await onSelectTask(task.id, task);
                          }}
                          className="w-full text-left p-1.5 rounded-lg bg-card hover:bg-hover-subtle border border-border hover:border-border transition-all flex items-center justify-between gap-2 group cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-medium text-foreground truncate max-w-[190px]">
                                {task.title}
                              </p>
                              {isAdmin && (
                                <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                                  Admin
                                </span>
                              )}
                              {rawStatus && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60 shrink-0">
                                  {rawStatus}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {clientName}
                            </p>
                          </div>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0 flex items-center gap-1">
                            <Play className="size-2.5 fill-current" />
                            Assign & Start
                          </span>
                        </button>
                      );
                    })}
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

