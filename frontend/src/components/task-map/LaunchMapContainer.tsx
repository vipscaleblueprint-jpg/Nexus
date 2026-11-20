'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Search, X, Building2, ChevronDown, Check, Shield, Loader2 } from 'lucide-react';
import {
  taskMapApi,
  LaunchMapLightItem,
  LaunchMapDataResponse,
  LaunchMeta,
  subscribeTaskMapSaving,
  collectClientDashboardLists,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { Task } from '@/lib/types';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { isModalHistoryBackPending } from '@/lib/taskNavigation';
import { LaunchMapView, CalendarViewMode } from './LaunchMapView';

import { TaskModalLoadingOverlay } from '@/components/modals/TaskModalLoadingOverlay';

const TaskDetailModal = dynamic(
  () => import('@/components/modals/TaskDetailModal').then((m) => m.TaskDetailModal),
  { ssr: false, loading: () => <TaskModalLoadingOverlay /> }
);

const MAX_CACHED_RANGES = 12;

export const LaunchMapContainer: React.FC = () => {
  const [items, setItems] = useState<LaunchMapLightItem[]>([]);
  const [apiClients, setApiClients] = useState<Array<{ id: string; name: string; count: number }>>([]);

  const spaces = useAppStore((s) => s.spaces);
  const allLists = useAppStore((s) => s.allLists);
  const loadSpaces = useAppStore((s) => s.loadSpaces);

  useEffect(() => {
    if (!spaces || spaces.length === 0) {
      loadSpaces();
    }
  }, [spaces, loadSpaces]);

  const clients = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();

    for (const c of collectClientDashboardLists(spaces, allLists)) {
      if (!map.has(c.id)) {
        map.set(c.id, { id: c.id, name: c.name, count: 0 });
      }
    }

    for (const c of apiClients) {
      const existing = map.get(c.id);
      if (existing) {
        existing.count = c.count;
      } else {
        map.set(c.id, { id: c.id, name: c.name, count: c.count });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [spaces, allLists, apiClients]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [savingCount, setSavingCount] = useState(0);

  const [rawSearch, setRawSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedClients, setSelectedClients] = useState<string[] | 'ALL'>('ALL');
  const [showAdminTasks, setShowAdminTasks] = useState(false);

  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  // Bounded LRU cache of fetched month/week ranges to prevent redundant network & CPU churn
  const rangeCacheRef = useRef<Map<string, LaunchMapDataResponse>>(new Map());
  const activeRangeRef = useRef<{ start?: string; end?: string; mode: CalendarViewMode } | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);

  // Task Detail Modal + URL ?task= sync
  const [selectedTaskModal, setSelectedTaskModal] = useState<Task | null>(null);
  const [selectedSubtaskTargetId, setSelectedSubtaskTargetId] = useState<string | undefined>(undefined);
  const [restoringUrlTask, setRestoringUrlTask] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean(new URLSearchParams(window.location.search).get('task'));
    } catch {
      return false;
    }
  });
  const closedTaskIdRef = useRef<string | null>(null);
  const lastUrlTaskIdRef = useRef<string | null>(null);

  // Debounce search input (200ms) so typing never lags calendar rendering
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(rawSearch), rawSearch ? 200 : 0);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  useEffect(() => {
    return subscribeTaskMapSaving((ids) => setSavingCount(ids.size));
  }, []);

  useEffect(() => {
    if (!clientDropdownOpen) return;
    const handleOutside = (e: PointerEvent) => {
      const path = e.composedPath?.() || [];
      if (clientDropdownRef.current && !path.includes(clientDropdownRef.current)) {
        setClientDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [clientDropdownOpen]);

  const applyPayload = useCallback((res: LaunchMapDataResponse) => {
    setItems(res.items || []);
    setApiClients(res.clients || []);
  }, []);

  const fetchRange = useCallback(
    async (
      range: { start?: string; end?: string; mode: CalendarViewMode },
      options: { bypassCache?: boolean; silent?: boolean } = {}
    ) => {
      const cacheKey = `${range.start || 'all'}:${range.end || 'all'}`;
      if (!options.bypassCache) {
        const cached = rangeCacheRef.current.get(cacheKey);
        if (cached) {
          // Refresh LRU order
          rangeCacheRef.current.delete(cacheKey);
          rangeCacheRef.current.set(cacheKey, cached);
          applyPayload(cached);
          setInitialLoading(false);
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!options.silent) setRangeLoading(true);
      try {
        const res = await taskMapApi.getLaunchData({
          start: range.start,
          end: range.end,
          signal: controller.signal,
        });
        if (controller.signal.aborted || !res.success) return;

        // Evict oldest cached range if over budget
        if (rangeCacheRef.current.size >= MAX_CACHED_RANGES) {
          const oldestKey = rangeCacheRef.current.keys().next().value;
          if (oldestKey) rangeCacheRef.current.delete(oldestKey);
        }
        rangeCacheRef.current.set(cacheKey, res);
        applyPayload(res);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Failed to load Launch Map range:', err);
        if (!options.silent) toast.error('Failed to load Launch Map');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setInitialLoading(false);
          setRangeLoading(false);
        } else if (!abortRef.current) {
          setInitialLoading(false);
          setRangeLoading(false);
        }
      }
    },
    [applyPayload]
  );

  const handleRangeChange = useCallback(
    (range: { start?: string; end?: string; mode: CalendarViewMode }) => {
      const prev = activeRangeRef.current;
      const prevAborted = Boolean(abortRef.current?.signal.aborted);
      if (
        prev &&
        !prevAborted &&
        prev.start === range.start &&
        prev.end === range.end &&
        prev.mode === range.mode
      ) {
        return;
      }
      activeRangeRef.current = range;
      void fetchRange(range);
    },
    [fetchRange]
  );

  const refreshCurrentRange = useCallback(
    (silent = true) => {
      rangeCacheRef.current.clear();
      if (activeRangeRef.current) {
        void fetchRange(activeRangeRef.current, { bypassCache: true, silent });
      }
    },
    [fetchRange]
  );

  // Light visibility-aware refresh (2m) + Socket.io window event listeners
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        refreshCurrentRange(true);
      }
    }, 120000);

    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => refreshCurrentRange(true), 500);
    };

    const handleTaskUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const task = detail?.task || detail;
      if (!task?.id) {
        scheduleReload();
        return;
      }
      rangeCacheRef.current.clear();
      setItems((prev) => {
        const exists = prev.some((t) => t.id === task.id);
        if (!exists) {
          if (/\blaunch\s*date\b/i.test(task.status || '')) {
            scheduleReload();
          }
          return prev;
        }
        return prev.map((t) => (t.id === task.id ? { ...t, ...task } : t));
      });
    };

    const handleTaskMapUpdated = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (!data?.taskId) {
        scheduleReload();
        return;
      }
      rangeCacheRef.current.clear();
      if (
        data.launchMeta !== undefined ||
        data.effectiveLaunchDate !== undefined ||
        data.targetPeriod !== undefined ||
        data.dueDate !== undefined ||
        Array.isArray(data.statuses)
      ) {
        scheduleReload();
      }
    };

    window.addEventListener('task:updated', handleTaskUpdated);
    window.addEventListener('task_map:updated', handleTaskMapUpdated);
    return () => {
      clearInterval(interval);
      if (reloadTimer) clearTimeout(reloadTimer);
      abortRef.current?.abort();
      abortRef.current = null;
      activeRangeRef.current = null;
      window.removeEventListener('task:updated', handleTaskUpdated);
      window.removeEventListener('task_map:updated', handleTaskMapUpdated);
    };
  }, [refreshCurrentRange]);

  // URL ?task= restoration
  useEffect(() => {
    const syncTaskFromUrl = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlTaskParam = params.get('task');
      const urlSubtaskParam = params.get('subtask') || undefined;

      if (!urlTaskParam) {
        closedTaskIdRef.current = null;
        lastUrlTaskIdRef.current = null;
        setRestoringUrlTask(false);
        setSelectedTaskModal((prev) => (prev ? null : prev));
        setSelectedSubtaskTargetId(undefined);
        return;
      }

      if (urlTaskParam === closedTaskIdRef.current) {
        setRestoringUrlTask(false);
        return;
      }

      if (lastUrlTaskIdRef.current === urlTaskParam && selectedTaskModal) return;

      const localMatch = items.find((t) => t.id === urlTaskParam);
      if (localMatch) {
        lastUrlTaskIdRef.current = localMatch.id;
        setSelectedSubtaskTargetId(urlSubtaskParam);
        setSelectedTaskModal(localMatch as unknown as Task);
        setRestoringUrlTask(false);
        return;
      }

      lastUrlTaskIdRef.current = urlTaskParam;
      try {
        const res = await tasksApi.getTask(urlTaskParam);
        if (res?.task) {
          if (closedTaskIdRef.current === urlTaskParam || closedTaskIdRef.current === res.task.id) {
            return;
          }
          lastUrlTaskIdRef.current = res.task.id;
          setSelectedSubtaskTargetId(urlSubtaskParam || res.subtask?.id || undefined);
          setSelectedTaskModal(res.task);
        }
      } catch {
        lastUrlTaskIdRef.current = null;
        toast.error('Task not found');
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('task');
        cleanUrl.searchParams.delete('subtask');
        window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}`);
      } finally {
        setRestoringUrlTask(false);
      }
    };

    void syncTaskFromUrl();
    const handlePopState = () => {
      closedTaskIdRef.current = null;
      void syncTaskFromUrl();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const handleOpenTaskDetail = useCallback((item: LaunchMapLightItem) => {
    closedTaskIdRef.current = null;
    lastUrlTaskIdRef.current = item.id;
    setSelectedSubtaskTargetId(undefined);
    setSelectedTaskModal(item as unknown as Task);
  }, []);

  const visibleItems = useMemo(() => {
    return items.filter((t) => {
      if (t.isAdminTask && !showAdminTasks) return false;
      if (selectedClients === 'ALL') return true;
      const listId = t.list?.id || t.listId || '';
      const lName = t.list?.name || '';
      return selectedClients.includes(listId) || selectedClients.includes(lName);
    });
  }, [items, showAdminTasks, selectedClients]);

  const handleLaunchMetaUpdated = useCallback(
    (
      taskId: string,
      data: {
        launchMeta: LaunchMeta;
        effectiveLaunchDate: string | null;
        targetPeriod?: string | null;
        dueDate: string | null;
      }
    ) => {
      rangeCacheRef.current.clear();
      setItems((prev) =>
        prev
          .map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  dueDate: data.dueDate,
                  launchMeta: data.launchMeta,
                  effectiveLaunchDate: data.effectiveLaunchDate,
                  targetPeriod: data.targetPeriod ?? data.launchMeta?.targetPeriod ?? null,
                  isLaunchDate: Boolean(data.launchMeta?.isLaunchDate),
                }
              : t
          )
          .filter((t) => {
            const hasMarker =
              Boolean(t.launchMeta?.isLaunchDate) ||
              /\blaunch\s*date\b/i.test(t.status || '') ||
              (t.taskMapStatuses || []).some((s) => /\blaunch\s*date\b/i.test(s || ''));
            const hasDateOrPeriod = Boolean(
              t.effectiveLaunchDate || t.launchMeta?.launchDate || t.targetPeriod || t.launchMeta?.targetPeriod
            );
            return hasMarker && hasDateOrPeriod;
          })
      );
    },
    []
  );

  // Client filter dropdown helpers
  const allClientsChecked =
    selectedClients === 'ALL' ||
    (Array.isArray(selectedClients) && clients.length > 0 && selectedClients.length === clients.length);

  const isClientChecked = (id: string, name: string) => {
    if (selectedClients === 'ALL') return true;
    return selectedClients.includes(id) || selectedClients.includes(name);
  };

  const isClientFiltered = showAdminTasks || !allClientsChecked;
  const clientButtonLabel = useMemo(() => {
    if (!isClientFiltered) return 'All Clients';
    if (showAdminTasks && Array.isArray(selectedClients) && selectedClients.length === 0) return 'Admin';
    if (showAdminTasks && allClientsChecked) return 'All + Admin';
    if (Array.isArray(selectedClients) && selectedClients.length === 1) {
      const match = clients.find(
        (c) => selectedClients.includes(c.id) || selectedClients.includes(c.name)
      );
      return match ? match.name : '1 Client';
    }
    if (Array.isArray(selectedClients)) return `${selectedClients.length} Clients`;
    return 'Filtered';
  }, [isClientFiltered, showAdminTasks, selectedClients, allClientsChecked, clients]);

  const filteredClientOptions = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, clientSearch]);

  const toolbarRightSlot = (
    <div className="flex items-center gap-2">
      {savingCount > 0 && (
        <Loader2 className="size-3.5 animate-spin text-[var(--accent)] shrink-0" aria-label="Saving" />
      )}

      {/* Compact Search */}
      <div className="relative flex items-center">
        <Search className="size-3.5 text-[var(--muted)] absolute left-2.5 pointer-events-none" />
        <input
          type="text"
          value={rawSearch}
          onChange={(e) => setRawSearch(e.target.value)}
          placeholder="Search..."
          className="w-36 sm:w-48 pl-7 pr-7 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-[var(--accent)] transition-colors"
        />
        {rawSearch && (
          <button
            type="button"
            onClick={() => setRawSearch('')}
            className="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Compact Client Dropdown */}
      <div className="relative" ref={clientDropdownRef}>
        <button
          type="button"
          onClick={() => setClientDropdownOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
            isClientFiltered
              ? 'border-[var(--accent)]/50 text-foreground bg-[var(--accent-tint)]'
              : 'bg-[var(--surface)] border-[var(--border)] text-foreground hover:bg-[var(--hover-subtle)]'
          }`}
        >
          <Building2 className="size-3.5 text-[var(--accent)] shrink-0" />
          <span className="max-w-[110px] truncate">{clientButtonLabel}</span>
          <ChevronDown
            className={`size-3 text-muted-foreground transition-transform ${
              clientDropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {clientDropdownOpen && (
          <div className="absolute right-0 top-full mt-1.5 w-68 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-1">
            {clients.length > 4 && (
              <div className="px-1.5 py-0.5 relative">
                <Search className="size-3 text-muted-foreground absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search clients..."
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-7 pr-2 py-1 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedClients(allClientsChecked ? [] : 'ALL')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ${
                allClientsChecked
                  ? 'bg-[var(--accent-tint)] text-foreground font-semibold'
                  : 'text-foreground hover:bg-[var(--hover-subtle)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`size-3.5 rounded border flex items-center justify-center ${
                    allClientsChecked
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-transparent'
                  }`}
                >
                  <Check className="size-2.5" />
                </div>
                <Building2 className="size-3 text-[var(--accent)]" />
                <span>All Clients</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowAdminTasks((v) => !v)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ${
                showAdminTasks
                  ? 'bg-purple-500/15 text-purple-300 [.theme-light_&]:bg-purple-50 [.theme-light_&]:text-purple-700 font-semibold'
                  : 'text-muted-foreground hover:bg-muted/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`size-3.5 rounded border flex items-center justify-center ${
                    showAdminTasks
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'border-border bg-background text-transparent'
                  }`}
                >
                  <Check className="size-2.5" />
                </div>
                <Shield className="size-3 text-purple-400 [.theme-light_&]:text-purple-600" />
                <span>Admin Tasks</span>
              </div>
            </button>

            <div className="h-px bg-border my-0.5" />

            <div className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
              {filteredClientOptions.map((c) => {
                const checked = isClientChecked(c.id, c.name);
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      if (selectedClients === 'ALL') {
                        setSelectedClients(clients.map((cl) => cl.id).filter((id) => id !== c.id));
                      } else {
                        const next = new Set(selectedClients);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        const arr = Array.from(next);
                        setSelectedClients(arr.length === clients.length ? 'ALL' : arr);
                      }
                    }}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ${
                      checked
                        ? 'bg-[var(--hover-subtle)] text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-[var(--hover-subtle)]/70'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                      <div
                        className={`size-3.5 rounded border flex items-center justify-center shrink-0 ${
                          checked
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--on-accent)]'
                            : 'border-[var(--border)] bg-[var(--bg)] text-transparent'
                        }`}
                      >
                        <Check className="size-2.5" />
                      </div>
                      <span className="truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClients([c.id]);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--accent)] hover:underline px-1 cursor-pointer"
                      >
                        only
                      </button>
                      <span className="text-[10px] font-mono text-muted-foreground">{c.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {isClientFiltered && (
              <>
                <div className="h-px bg-border my-0.5" />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClients('ALL');
                    setShowAdminTasks(false);
                    setClientSearch('');
                  }}
                  className="w-full py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-[var(--hover-subtle)] rounded-md cursor-pointer"
                >
                  Reset Filter
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const showOverlayLoader = initialLoading && items.length === 0 && !selectedTaskModal && !restoringUrlTask;

  return (
    <>
      <div className="relative flex flex-col h-full w-full bg-[var(--bg)] overflow-hidden">
        <LaunchMapView
          tasks={visibleItems}
          search={debouncedSearch}
          loadingRange={rangeLoading}
          toolbarRightSlot={toolbarRightSlot}
          onRangeChange={handleRangeChange}
          onOpenDetail={handleOpenTaskDetail}
          onLaunchMetaUpdated={handleLaunchMetaUpdated}
          onDataRefresh={() => refreshCurrentRange(true)}
        />
        {showOverlayLoader && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[1px] pointer-events-none">
            <Loader2 className="size-7 animate-spin text-[var(--accent)] mb-2" />
            <p className="text-xs font-medium text-muted-foreground">Loading Launch Map...</p>
          </div>
        )}
      </div>

      {!selectedTaskModal && restoringUrlTask && <TaskModalLoadingOverlay />}
      {selectedTaskModal && (
        <TaskDetailModal
          isOpen={!!selectedTaskModal}
          onClose={() => {
            closedTaskIdRef.current =
              new URLSearchParams(window.location.search).get('task') ||
              (selectedTaskModal as { id?: string })?.id ||
              null;
            lastUrlTaskIdRef.current = null;
            setRestoringUrlTask(false);
            setSelectedTaskModal(null);
            setSelectedSubtaskTargetId(undefined);
            if (!isModalHistoryBackPending()) {
              const url = new URL(window.location.href);
              url.searchParams.delete('task');
              url.searchParams.delete('subtask');
              window.history.replaceState(window.history.state || {}, '', `${url.pathname}${url.search}`);
            }
          }}
          task={selectedTaskModal}
          targetSubtaskId={selectedSubtaskTargetId}
          mode="full"
          onUpdateTask={() => refreshCurrentRange(true)}
        />
      )}
    </>
  );
};
