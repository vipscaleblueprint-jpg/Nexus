'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  taskMapApi,
  TaskMapItem,
  TaskMapOption,
  TaskMapShift,
  UpworkSession,
  extractAuditorRoles,
  AuditorRoleOption,
  isDeveloperUser,
  getEffectiveTaskMapHandlerId,
  hasPmAssignmentForUser,
  isTaskHandedOver,
  isSessionProjectBased,
  getDefaultTaskMapSubStatuses,
  normalizeTaskMapSubStatuses,
  isTaskMapItemOnHold,
  toCanonicalTaskStatus,
  applyOptimisticTaskMapAssignment,
  syncTaskPmReviewsWithAssignee,
  markTaskSavingToDb,
  isTaskSavingToDb,
  subscribeTaskMapSaving,
  collectClientDashboardLists,
  isTaskUnderAdmin,
  hasSpreadsheetTaskInput,
  applyLiveWorkingTaskStatus,
  formatManilaTime,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { notificationsApi } from '@/api/notifications';
import dynamic from 'next/dynamic';
import { TaskMapSidebar } from './TaskMapSidebar';
import { TaskMapHeader } from './TaskMapHeader';
import { TaskMapBoardView } from './TaskMapBoardView';
import { isModalHistoryBackPending } from '@/lib/taskNavigation';

const TaskMapAuditingView = dynamic(
  () => import('./TaskMapAuditingView').then((m) => m.TaskMapAuditingView),
  { ssr: false }
);
const TaskMapCrmView = dynamic(
  () => import('./TaskMapCrmView').then((m) => m.TaskMapCrmView),
  { ssr: false }
);
const TaskMapUpworkView = dynamic(
  () => import('./TaskMapUpworkView').then((m) => m.TaskMapUpworkView),
  { ssr: false }
);
const TaskMapDailyTrackerView = dynamic(
  () => import('./TaskMapDailyTrackerView').then((m) => m.TaskMapDailyTrackerView),
  { ssr: false }
);
import { TaskModalLoadingOverlay } from '@/components/modals/TaskModalLoadingOverlay';

const TaskDetailModal = dynamic(
  () => import('@/components/modals/TaskDetailModal').then((m) => m.TaskDetailModal),
  { ssr: false, loading: () => <TaskModalLoadingOverlay /> }
);
const UncheckedAuditsModal = dynamic(
  () => import('@/components/modals/UncheckedAuditsModal').then((m) => m.UncheckedAuditsModal),
  { ssr: false }
);
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { NexusLogoLoader, NexusFullScreenLoader } from '@/components/ui/NexusLogo';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { hasCrmAccess, canTransitionTaskStatus } from '@/lib/permissions';
import { isClosedStatus } from '@/lib/taskTokens';
import { isOtherBoardWorkflowStatus } from '@/lib/taskMapPermissions';

const getTodayDateStr = () => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
};

export const TaskMapContainer: React.FC = () => {
  const [tasks, setTasks] = useState<TaskMapItem[]>([]);
  const [availablePool, setAvailablePool] = useState<TaskMapItem[]>([]);
  const availablePoolRef = useRef<TaskMapItem[]>([]);
  useEffect(() => {
    availablePoolRef.current = availablePool;
  }, [availablePool]);
  const [options, setOptions] = useState<TaskMapOption[]>([]);
  const [shifts, setShifts] = useState<TaskMapShift[]>([]);
  const [activeShift, setActiveShift] = useState<string>('');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [shiftUsers, setShiftUsers] = useState<any[]>([]);
  const [activeUpworkSessions, setActiveUpworkSessions] = useState<UpworkSession[]>(() => useAppStore.getState().activeUpworkSessions || []);
  const [allDbClients, setAllDbClients] = useState<Array<{ id: string; name: string }>>([]);
  const currentUser = useAppStore((s) => s.currentUser);
  const upworkClients = useAppStore((s) => s.upworkClients);
  const upworkProjectClients = useAppStore((s) => s.upworkProjectClients);
  const spaces = useAppStore((s) => s.spaces);
  const allLists = useAppStore((s) => s.allLists);
  const loadSpaces = useAppStore((s) => s.loadSpaces);
  const workspaceTeams = useAppStore((s) => s.workspaceTeams);
  const loadTeams = useAppStore((s) => s.loadTeams);
  const workspaceRoles = useAppStore((s) => s.workspaceRoles);
  const loadRoles = useAppStore((s) => s.loadRoles);

  // Load spaces, teams & roles if not already in store
  useEffect(() => {
    if (!spaces || spaces.length === 0) {
      loadSpaces();
    }
  }, [spaces, loadSpaces]);

  // Clear Task Map unread notifications when viewing Task Map
  useEffect(() => {
    if (useAppStore.getState().taskMapUnreadCount > 0) {
      useAppStore.getState().setTaskMapUnreadCount(0);
      notificationsApi.markTaskMapAsRead().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!workspaceTeams || workspaceTeams.length === 0) {
      loadTeams();
    }
  }, [workspaceTeams?.length, loadTeams]);

  useEffect(() => {
    if (!workspaceRoles || workspaceRoles.length === 0) {
      loadRoles();
    }
  }, [workspaceRoles?.length, loadRoles]);

  // Auditor Type filter state & dynamic DB roles
  const [auditorTypeFilter, setAuditorTypeFilter] = useState<string>('ALL');
  const [trackFilter, setTrackFilter] = useState<'ALL' | 'LIVE' | 'ACTIVE'>('ALL');
  const auditorRoles = React.useMemo(() => {
    return extractAuditorRoles(workspaceTeams, allUsers, workspaceRoles);
  }, [workspaceTeams, allUsers, workspaceRoles]);

  // Track pending optimistic status updates to avoid race conditions & background fetch overwrites
  const pendingUpdatesRef = useRef<
    Map<string, { statuses: string[]; timer?: NodeJS.Timeout | null; timestamp: number }>
  >(new Map());

  // User manual selection tracker: ensures automatic latest-date navigation & initial active-shift sync only apply before manual change
  const userSelectedDateRef = useRef<boolean>(false);
  const hasManuallySelectedShiftRef = useRef<boolean>(false);

  // Shift, Date, Client & View mode state (defaults to live Audit Shift from Manila Time unless ?shift= is passed)
  const [currentShift, setCurrentShift] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const qShift = new URLSearchParams(window.location.search).get('shift');
        if (qShift) {
          hasManuallySelectedShiftRef.current = true;
          return qShift.trim().toUpperCase();
        }
      } catch { }
    }
    return '';
  });

  const handleShiftChange = useCallback((nextShift: string) => {
    hasManuallySelectedShiftRef.current = true;
    setCurrentShift(nextShift);
  }, []);
  const [currentDate, setCurrentDate] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const qDate = urlParams.get('date');
        if (qDate) {
          userSelectedDateRef.current = true;
          return qDate.trim();
        }
      } catch { }
    }
    return getTodayDateStr();
  });
  const [currentView, setCurrentView] = useState<'BOARD' | 'AUDITING' | 'CRM' | 'UPWORK' | 'DAILY_TRACKER' | 'SHEETS'>('BOARD');
  const [hasOpenedDailyTracker, setHasOpenedDailyTracker] = useState(false);
  const [dailySheetLogs, setDailySheetLogs] = useState<any[]>([]);
  const [superviseChecks, setSuperviseChecks] = useState<any[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[] | 'ALL'>('ALL');
  const [selectedCustomMAs, setSelectedCustomMAs] = useState<string[]>([]);
  const [showAdminTasks, setShowAdminTasks] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [maSortMode, setMaSortMode] = useState<'DEFAULT' | 'QUEUE_DESC' | 'QUEUE_ASC'>(() => {
    if (typeof window === 'undefined') return 'DEFAULT';
    const saved = localStorage.getItem('nexus_taskmap_ma_sort');
    return saved === 'QUEUE_DESC' || saved === 'QUEUE_ASC' ? saved : 'DEFAULT';
  });
  const handleMaSortModeChange = useCallback((mode: 'DEFAULT' | 'QUEUE_DESC' | 'QUEUE_ASC') => {
    setMaSortMode(mode);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('nexus_taskmap_ma_sort', mode);
      } catch {}
    }
  }, []);

  // Daily Rollover & Historical Archive State
  const [isHistoryView, setIsHistoryView] = useState<boolean>(false);
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [isRollingOver, setIsRollingOver] = useState<boolean>(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef<boolean>(false);
  const loadAbortRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryAttemptRef = useRef<number>(0);
  const skipNextAutoLoadKeyRef = useRef<string | null>(null);

  // Task Detail Modal
  const [selectedTaskModal, setSelectedTaskModal] = useState<any | null>(null);
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

  const handleOpenTaskDetail = useCallback(
    (item: any) => {
      if (item?.isSubtask && item?.parentTaskId) {
        closedTaskIdRef.current = null;
        lastUrlTaskIdRef.current = item.parentTaskId;
        const parentTask =
          [...tasks, ...availablePool].find((t) => !t.isSubtask && t.id === item.parentTaskId) || {
            id: item.parentTaskId,
            title: item.parentTaskTitle || item.title,
            listId: item.listId,
            list: item.list,
            status: 'IN PROGRESS',
            priority: item.priority || 'NORMAL',
          };
        setSelectedSubtaskTargetId(item.subtaskId);
        setSelectedTaskModal(parentTask);
        return;
      }
      closedTaskIdRef.current = null;
      lastUrlTaskIdRef.current = item?.id ?? null;
      setSelectedSubtaskTargetId(undefined);
      setSelectedTaskModal(item);
    },
    [tasks, availablePool]
  );

  // Restore opened task modal from ?task=<id>&subtask=<id> on initial load / reload and popstate
  useEffect(() => {
    const syncTaskFromUrl = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlTaskParam = params.get('task');
      const urlSubtaskParam = params.get('subtask') || undefined;

      if (!urlTaskParam) {
        closedTaskIdRef.current = null;
        lastUrlTaskIdRef.current = null;
        setRestoringUrlTask(false);
        setSelectedTaskModal((prev: any) => (prev ? null : prev));
        setSelectedSubtaskTargetId(undefined);
        return;
      }

      if (urlTaskParam === closedTaskIdRef.current) {
        setRestoringUrlTask(false);
        return;
      }

      const rawTaskId = urlTaskParam.startsWith('subtask:')
        ? urlTaskParam.slice('subtask:'.length)
        : urlTaskParam;

      if (
        lastUrlTaskIdRef.current === rawTaskId &&
        selectedTaskModal &&
        (selectedTaskModal.id === rawTaskId || selectedTaskModal.id === urlTaskParam)
      ) {
        return;
      }

      const localMatch = [...tasks, ...availablePool].find(
        (t) =>
          (!t.isSubtask && t.id === rawTaskId) ||
          (t.isSubtask && (t.id === urlTaskParam || t.subtaskId === rawTaskId))
      );

      if (localMatch) {
        if (localMatch.isSubtask && localMatch.parentTaskId) {
          const parentMatch = [...tasks, ...availablePool].find(
            (t) => !t.isSubtask && t.id === localMatch.parentTaskId
          );
          lastUrlTaskIdRef.current = localMatch.parentTaskId;
          setSelectedSubtaskTargetId(urlSubtaskParam || localMatch.subtaskId);
          setSelectedTaskModal(
            parentMatch || {
              id: localMatch.parentTaskId,
              title: localMatch.parentTaskTitle || localMatch.title,
              listId: localMatch.listId,
              list: localMatch.list,
              status: 'IN PROGRESS',
              priority: localMatch.priority || 'NORMAL',
            }
          );
        } else {
          lastUrlTaskIdRef.current = localMatch.id;
          setSelectedSubtaskTargetId(urlSubtaskParam);
          setSelectedTaskModal(localMatch);
        }
        setRestoringUrlTask(false);
        return;
      }

      lastUrlTaskIdRef.current = rawTaskId;
      try {
        const res = await tasksApi.getTask(rawTaskId);
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

    syncTaskFromUrl();

    const handlePopState = () => {
      if (isModalHistoryBackPending()) {
        return;
      }
      closedTaskIdRef.current = null;
      syncTaskFromUrl();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // Intentionally re-check when tasks/availablePool populate only if selectedTaskModal is not yet open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, availablePool.length]);
  const [blockedAuditAlert, setBlockedAuditAlert] = useState<{
    isOpen: boolean;
    task: TaskMapItem | null;
    targetStatus: string;
    uncheckedAudits: string[];
    openSubtasks: string[];
  }>({
    isOpen: false,
    task: null,
    targetStatus: '',
    uncheckedAudits: [],
    openSubtasks: [],
  });

  // Track pending optimistic drag-and-drop assignments so background refreshes never snap cards back
  const pendingAssignRef = useRef<Map<string, { task: TaskMapItem; targetUserId: string | null; timestamp: number }>>(new Map());

  // Fetch data
  const loadData = useCallback(async (silent = false) => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (loadAbortRef.current) {
      loadAbortRef.current.abort();
    }
    const controller = new AbortController();
    loadAbortRef.current = controller;

    if (!silent) {
      setLoading(true);
    }
    try {
      const shiftTokens = (currentShift || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const isCustomOnly = shiftTokens.length === 1 && shiftTokens[0] === 'CUSTOM';
      const apiShift = shiftTokens.length === 0
        ? undefined
        : isCustomOnly
        ? 'ALL'
        : shiftTokens.filter((s) => s !== 'CUSTOM').join(',') || 'ALL';

      const res = await taskMapApi.getData({
        ...(apiShift ? { shift: apiShift } : {}),
        date: currentDate,
        signal: controller.signal,
        timeoutMs: 25000,
      });

      if (controller.signal.aborted || loadAbortRef.current !== controller) {
        return;
      }

      if (res.success) {
        hasLoadedOnceRef.current = true;
        lastLoadedAtRef.current = Date.now();
        retryAttemptRef.current = 0;
        setLoadError(null);
        // Sanitize sub-statuses: strip CRM tag (CRM is main board routing status, not a substatus label)
        // and apply innate default sub-statuses (only unassigned active tasks default to 'Available Task').
        const sanitizeStatuses = (statuses?: string[], taskStatus?: string, isAssigned = false): string[] => {
          return normalizeTaskMapSubStatuses(taskStatus, statuses, { isAssigned });
        };

        // Merge with local pending optimistic updates so background refreshes never flicker or uncheck
        setTasks(() => {
          const serverTasks = res.tasks || [];
          const nowTs = Date.now();
          const mapped = serverTasks.map((st) => {
            const pendingAssign = pendingAssignRef.current.get(st.id);
            if (pendingAssign && nowTs - pendingAssign.timestamp < 3500) {
              return pendingAssign.task;
            }
            const pending = pendingUpdatesRef.current.get(st.id);
            const rawStatuses = pending && nowTs - pending.timestamp < 4000 ? pending.statuses : st.taskMap?.statuses;
            const isAssigned = Boolean(getEffectiveTaskMapHandlerId(st));
            return applyLiveWorkingTaskStatus({
              ...st,
              taskMap: {
                ...st.taskMap,
                statuses: sanitizeStatuses(rawStatuses, st.status, isAssigned),
              },
            });
          });
          // Preserve tasks optimistically dragged out of Available Pool that aren't in serverTasks yet
          pendingAssignRef.current.forEach((pendingAssign, pId) => {
            if (
              nowTs - pendingAssign.timestamp < 3500 &&
              pendingAssign.targetUserId !== null &&
              !mapped.some((t) => t.id === pId)
            ) {
              mapped.unshift(pendingAssign.task);
            }
          });
          return mapped;
        });

        setAvailablePool(() => {
          const serverPool = res.availablePool || [];
          const filteredServerPool = serverPool.filter((st) => {
            const pendingAssign = pendingAssignRef.current.get(st.id);
            if (pendingAssign && Date.now() - pendingAssign.timestamp < 3500 && pendingAssign.targetUserId !== null) {
              return false;
            }
            return true;
          });
          return filteredServerPool.map((st) => {
            const pendingAssign = pendingAssignRef.current.get(st.id);
            if (pendingAssign && Date.now() - pendingAssign.timestamp < 3500) {
              return pendingAssign.task;
            }
            const pending = pendingUpdatesRef.current.get(st.id);
            const rawStatuses = pending && Date.now() - pending.timestamp < 4000 ? pending.statuses : st.taskMap?.statuses;
            const isAssigned = Boolean(getEffectiveTaskMapHandlerId(st));
            return applyLiveWorkingTaskStatus({
              ...st,
              taskMap: {
                ...st.taskMap,
                statuses: sanitizeStatuses(rawStatuses, st.status, isAssigned),
              },
            });
          });
        });

        setOptions(res.options || []);
        setShifts(res.shifts || []);
        setAllUsers(res.allUsers || []);
        setShiftUsers(res.shiftUsers || []);
        if (Array.isArray(res.workspaceTeams) && res.workspaceTeams.length > 0 && useAppStore.getState().workspaceTeams.length === 0) {
          useAppStore.setState({ workspaceTeams: res.workspaceTeams });
        }
        if (Array.isArray(res.workspaceRoles) && res.workspaceRoles.length > 0 && useAppStore.getState().workspaceRoles.length === 0) {
          useAppStore.setState({ workspaceRoles: res.workspaceRoles as any });
        }
        setActiveUpworkSessions(res.activeUpworkSessions || []);
        if (res.upworkClients) {
          useAppStore.getState().setUpworkClients(res.upworkClients);
        }
        if (res.upworkProjectClients) {
          useAppStore.getState().setUpworkProjectClients(res.upworkProjectClients);
        }
        const enrichedSessions: Record<string, any> = { ...(res.maActiveSessions || {}) };
        (res.tasks || []).forEach((t: any) => {
          if (t.progress?.maName && t.progress?.timeIn && !t.progress?.timeOut && !t.progress?.isMissingTime && t.progress?.isLive !== false) {
            const key = t.progress.maName.toLowerCase().trim();
            const existing = enrichedSessions[key];
            const existingHasTimeOut = Boolean(existing?.timeOut && String(existing.timeOut).trim());
            const existingRowNum = existing?.rowNumber ? Number(existing.rowNumber) : -1;
            const incomingRowNum = t.progress.sheetRow ? Number(t.progress.sheetRow) : -1;
            const incomingUpdatedMs = t.progress.updatedAt ? new Date(t.progress.updatedAt).getTime() : 0;
            const existingUpdatedMs = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            const isStaleComparedToTimedOut =
              existingHasTimeOut &&
              ((incomingRowNum > 0 && existingRowNum > 0 && incomingRowNum <= existingRowNum) ||
                incomingUpdatedMs <= existingUpdatedMs);
            const existingIsLive = Boolean(existing && existing.active && existing.timeIn && !existingHasTimeOut && !existing.isMissingTime);
            if (!isStaleComparedToTimedOut && (!existing || (!existingIsLive && !existingHasTimeOut) || incomingUpdatedMs > existingUpdatedMs)) {
              enrichedSessions[key] = {
                maName: t.progress.maName,
                taskId: t.id,
                listId: t.listId || t.list?.id || null,
                listName: t.list?.name || null,
                listStatuses: Array.isArray(t.list?.statuses) ? t.list.statuses : undefined,
                taskStatus: t.status || null,
                priority: t.priority || null,
                subStatuses: Array.isArray(t.taskMap?.statuses) ? t.taskMap.statuses : undefined,
                timeIn: t.progress.timeIn,
                timeOut: null,
                client: t.progress.client || t.list?.name || 'No client inputted',
                taskName: t.progress.taskDeliverables || t.title || 'No task inputted',
                date: t.progress.date,
                status: t.progress.status || 'In progress',
                isUpwork: Boolean(t.progress.isUpwork),
                rowNumber: t.progress.sheetRow,
                updatedAt: t.progress.updatedAt,
                active: true,
              };
            }
          }
        });
        // Ensure any open live row in dailySheetLogs is also reflected in enrichedSessions
        if (Array.isArray(res.dailySheetLogs)) {
          res.dailySheetLogs.forEach((l: any) => {
            if (!l?.maName || !l.isLive || !l.timeIn || l.timeOut || l.isMissingTime) return;
            const key = l.maName.toLowerCase().trim();
            const existing = enrichedSessions[key];
            const existingHasTimeOut = Boolean(existing?.timeOut && String(existing.timeOut).trim());
            const existingRowNum = existing?.rowNumber ? Number(existing.rowNumber) : -1;
            const incomingRowNum = l.sheetRow ? Number(l.sheetRow) : -1;
            const incomingUpdatedMs = l.submittedAt ? new Date(l.submittedAt).getTime() : 0;
            const existingUpdatedMs = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            const isStaleComparedToTimedOut =
              existingHasTimeOut &&
              ((incomingRowNum > 0 && existingRowNum > 0 && incomingRowNum <= existingRowNum) ||
                incomingUpdatedMs <= existingUpdatedMs);
            const existingIsLive = Boolean(existing && existing.active && existing.timeIn && !existingHasTimeOut && !existing.isMissingTime);
            if (!isStaleComparedToTimedOut && (!existing || (!existingIsLive && !existingHasTimeOut) || incomingUpdatedMs > existingUpdatedMs)) {
              enrichedSessions[key] = {
                maName: l.maName,
                taskId: l.subtaskId ? `subtask:${l.subtaskId}` : (l.taskId || null),
                subtaskId: l.subtaskId || null,
                timeIn: l.timeIn,
                timeOut: null,
                client: l.client || 'No client inputted',
                taskName: l.taskName || l.taskDeliverables || 'No task inputted',
                date: l.dateKey || currentDate,
                status: l.status || 'IN PROGRESS',
                isUpwork: Boolean(l.isUpwork),
                rowNumber: l.sheetRow || null,
                updatedAt: l.submittedAt || new Date().toISOString(),
                active: true,
              };
            }
          });
        }

        // Preserve any newer socket-delivered MA sessions that arrived while GET /api/task-map was in flight
        const currentStoreSessions = useAppStore.getState().maActiveSessions || {};
        Object.entries(currentStoreSessions).forEach(([key, curSess]: [string, any]) => {
          if (!curSess || !curSess.maName) return;
          const serverSess = enrichedSessions[key];
          if (!serverSess) {
            const curUpdatedMs = curSess.updatedAt ? new Date(curSess.updatedAt).getTime() : 0;
            if (curUpdatedMs && Date.now() - curUpdatedMs < 15000) {
              enrichedSessions[key] = curSess;
            }
            return;
          }
          const curUpdatedMs = curSess.updatedAt ? new Date(curSess.updatedAt).getTime() : 0;
          const srvUpdatedMs = serverSess.updatedAt ? new Date(serverSess.updatedAt).getTime() : 0;
          if (curUpdatedMs > srvUpdatedMs) {
            enrichedSessions[key] = curSess;
          }
        });
        useAppStore.getState().setMaActiveSessions(enrichedSessions);
        if (Array.isArray(res.dailySheetLogs)) {
          setDailySheetLogs(res.dailySheetLogs);
        }
        if (Array.isArray((res as any).superviseChecks)) {
          setSuperviseChecks((res as any).superviseChecks);
        }
        if (res.allClients) {
          setAllDbClients(res.allClients);
        }
        if (res.activeShift) {
          setActiveShift(res.activeShift);
        }
        if (!hasManuallySelectedShiftRef.current && res.activeShift && res.activeShift !== currentShift) {
          // Server already filtered/computed for activeShift on initial empty-shift request; avoid immediate double-fetch
          skipNextAutoLoadKeyRef.current = `${res.activeShift}::${currentDate}`;
          setCurrentShift(res.activeShift);
        }
        setIsHistoryView(Boolean(res.isHistory));
      } else {
        throw new Error((res as any)?.error || 'Task Map returned an unsuccessful response.');
      }
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        return;
      }
      const message = err?.message || 'Failed to load Task Map data';
      console.error('Failed to load task map data:', err);
      if (!hasLoadedOnceRef.current) {
        setLoadError(message);
        const delayMs = Math.min(15000, 3000 * Math.pow(2, Math.min(retryAttemptRef.current, 3)));
        retryAttemptRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          loadData(true);
        }, delayMs);
      } else if (!silent) {
        toast.error(message);
      }
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [currentShift, currentDate]);

  // Initial load & when shift or date changes
  useEffect(() => {
    const key = `${currentShift}::${currentDate}`;
    if (skipNextAutoLoadKeyRef.current === key) {
      skipNextAutoLoadKeyRef.current = null;
      return;
    }
    loadData();
  }, [loadData, currentShift, currentDate]);

  // Load history dates for journal & ensure Task Map stays on today's operational date unless explicitly chosen
  useEffect(() => {
    taskMapApi.getHistoryDates().then((res) => {
      if (res.success && res.dates) {
        setHistoryDates(res.dates);
        const latest = res.currentDate || res.latestDate || getTodayDateStr();
        if (latest && !userSelectedDateRef.current) {
          setCurrentDate((prev) => (prev !== latest ? latest : prev));
        }
      }
    }).catch(() => { });
  }, []);

  const handleTriggerDailyRollover = async () => {
    if (isRollingOver) return;
    setIsRollingOver(true);
    try {
      const res = await taskMapApi.runDailyRollover({
        fromDate: currentDate,
      });
      if (res.success) {
        toast.success(`Daily rollover complete! Retained ${res.retainedDate} with ${res.retainedTasksCount} tasks.`);
        if (res.newDate) {
          userSelectedDateRef.current = false;
          setCurrentDate(res.newDate);
        }
        await loadData();
        const datesRes = await taskMapApi.getHistoryDates();
        if (datesRes.success && datesRes.dates) {
          setHistoryDates(datesRes.dates);
        }
      } else {
        toast.error('Failed to execute daily rollover');
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Error executing daily rollover');
    } finally {
      setIsRollingOver(false);
    }
  };

  // Clean up pending debounce timers, active fetches, and retry timers on unmount
  useEffect(() => {
    return () => {
      if (loadAbortRef.current) {
        loadAbortRef.current.abort();
        loadAbortRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      pendingUpdatesRef.current.forEach((val) => {
        if (val.timer) clearTimeout(val.timer);
      });
    };
  }, []);

  const lastLoadedAtRef = useRef<number>(initialCache ? Date.now() : 0);

  // Auto-refresh every 2 minutes silently as a fallback (WebSockets deliver live updates in real time)
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      loadData(true);
    }, 120000);
    return () => clearInterval(timer);
  }, [loadData]);

  // Socket.io & Window events listeners for real-time synchronization
  useEffect(() => {
    let reloadTimer: NodeJS.Timeout | null = null;
    const scheduleReload = (opts?: { fromDbWatcher?: boolean }) => {
      // Skip redundant DB-watcher reloads if we just refreshed via direct socket event or initial load
      if (opts?.fromDbWatcher && Date.now() - lastLoadedAtRef.current < 3500) {
        return;
      }
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        loadData(true);
      }, 500);
    };

    const handleTaskUpdated = (e: any) => {
      const data = e?.detail || e;
      const task = data?.task || data;
      const taskId = task?.id;
      if (!taskId) {
        scheduleReload();
        return;
      }
      if (pendingUpdatesRef.current.has(taskId) || isTaskSavingToDb(taskId)) {
        return;
      }
      const pendingAssign = pendingAssignRef.current.get(taskId);
      if (pendingAssign && Date.now() - pendingAssign.timestamp < 3500) {
        return;
      }
      const isClosed = task.isClosed || isClosedStatus(task.status);
      // Patch the task in memory to avoid triggering a full network reload
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const nextStatus = task.status ?? t.status;
          const nextAssigneeId = task.assigneeId !== undefined ? task.assigneeId : t.assigneeId;
          const nextAssignees = task.assignees !== undefined ? task.assignees : t.assignees;
          const nextStatuses = normalizeTaskMapSubStatuses(
            nextStatus,
            task.taskMap?.statuses ?? t.taskMap?.statuses,
            { isAssigned: Boolean(nextAssigneeId || (nextAssignees && nextAssignees.length > 0)) }
          );
          return {
            ...t,
            ...task,
            taskMap: {
              ...t.taskMap,
              ...(task.taskMap || {}),
              statuses: nextStatuses,
            },
            ...(isClosed ? { isClosed: true, assigneeId: null, assignee: null, assignees: [] } : {}),
          };
        })
      );
      setAvailablePool((prev) => {
        if (isClosed) {
          return prev.filter((t) => t.id !== taskId);
        }
        return prev.map((t) => (t.id === taskId ? { ...t, ...task } : t));
      });
    };

    const stripInProgressStatus = (statuses?: string[]): string[] =>
      (Array.isArray(statuses) ? statuses : []).filter(
        (s) => (s || '').trim().toUpperCase().replace(/[\s_-]+/g, '') !== 'INPROGRESS'
      );

    const handleTaskMapUpdated = (e: any) => {
      const data = e.detail || e;
      if (data?.maSession?.maName) {
        useAppStore.getState().updateMaActiveSession(
          data.maSession.maName,
          data.maSession?.cleared ? null : data.maSession
        );
      }
      if (!data?.taskId) {
        scheduleReload({ fromDbWatcher: Boolean(data?.fromDbWatcher) });
        return;
      }

      const {
        taskId,
        statuses,
        taskMap,
        launchMeta,
        effectiveLaunchDate,
        dueDate,
        upworkStartedAt,
        upworkSession,
        activeUpworkSessions: incomingActiveSessions,
      } = data;

      // If this client is actively debouncing a local status change or saving a drag/assign for this task, ignore older broadcast
      // (NEVER ignore explicit clock-out / cleared-session realtime updates so live progress never sticks)
      const isClockOutBroadcast = Boolean(data.maSession?.cleared || (data.progress?.timeOut && !data.progress?.isMissingTime));
      const pending = pendingUpdatesRef.current.get(taskId);
      const pendingAssign = pendingAssignRef.current.get(taskId);
      if (
        !isClockOutBroadcast &&
        (pending?.timer ||
          isTaskSavingToDb(taskId) ||
          (pendingAssign && Date.now() - pendingAssign.timestamp < 3500))
      ) {
        return;
      }

      // If an assignment, handover, or clock-out occurred and a full re-bucket may be needed, trigger a silent sync
      if (data.assigneeId !== undefined || data.handedOver !== undefined || isClockOutBroadcast) {
        scheduleReload();
      }

      const nextStatuses = statuses !== undefined ? statuses : taskMap?.statuses;
      const nextHandedOver = data.handedOver !== undefined ? data.handedOver : taskMap?.handedOver;
      const nextTaskObj = data.task;
      const nextAssignee =
        data.assignee !== undefined
          ? data.assignee
          : nextTaskObj?.assignee !== undefined
            ? nextTaskObj.assignee
            : undefined;
      const nextAssignees =
        nextTaskObj?.assignees !== undefined
          ? nextTaskObj.assignees
          : nextAssignee !== undefined
            ? (nextAssignee ? [nextAssignee] : [])
            : undefined;

      const patchItem = (t: TaskMapItem): TaskMapItem => {
        if (t.id !== taskId) return t;
        const resolvedProgress =
          data.progress !== undefined
            ? data.progress
            : data.maSession?.cleared && t.progress && !t.progress.timeOut
              ? { ...t.progress, timeOut: formatManilaTime(new Date()) }
              : t.progress;
        const isTimedOut = Boolean(resolvedProgress?.timeOut && !resolvedProgress?.isMissingTime);
        const resolvedStatuses =
          nextStatuses !== undefined
            ? nextStatuses
            : isTimedOut
              ? stripInProgressStatus(t.taskMap.statuses)
              : t.taskMap.statuses;
        return applyLiveWorkingTaskStatus({
          ...t,
          status: data.status ?? nextTaskObj?.status ?? t.status,
          assigneeId: data.assigneeId !== undefined ? data.assigneeId : (nextTaskObj?.assigneeId !== undefined ? nextTaskObj.assigneeId : t.assigneeId),
          assignee: nextAssignee !== undefined ? nextAssignee : t.assignee,
          assignees: nextAssignees !== undefined ? nextAssignees : t.assignees,
          dueDate: dueDate !== undefined ? dueDate : t.dueDate,
          launchMeta: launchMeta !== undefined ? launchMeta : t.launchMeta,
          effectiveLaunchDate: effectiveLaunchDate !== undefined ? effectiveLaunchDate : t.effectiveLaunchDate,
          isLaunchDate: launchMeta !== undefined ? Boolean(launchMeta?.isLaunchDate) : t.isLaunchDate,
          upworkStartedAt: upworkStartedAt !== undefined ? upworkStartedAt : t.upworkStartedAt,
          upworkSession: upworkSession !== undefined ? upworkSession : t.upworkSession,
          progress: resolvedProgress,
          taskMap: {
            ...t.taskMap,
            ...(taskMap || {}),
            ...(nextHandedOver !== undefined ? { handedOver: nextHandedOver } : {}),
            statuses: resolvedStatuses,
          },
        });
      };

      const assignedOutOfPool = Boolean(data.assigneeId && data.assigneeId !== null && !nextHandedOver);
      setTasks((prev) => {
        const mapped = prev.map(patchItem);
        if (assignedOutOfPool && !mapped.some((t) => t.id === taskId)) {
          const fromPool = availablePoolRef.current.find((t) => t.id === taskId);
          if (fromPool) {
            return [patchItem(fromPool), ...mapped];
          }
        }
        return mapped;
      });
      setAvailablePool((prev) => {
        if (assignedOutOfPool) {
          return prev.filter((t) => t.id !== taskId);
        }
        return prev.map(patchItem);
      });

      if (incomingActiveSessions) {
        setActiveUpworkSessions(incomingActiveSessions);
      }
    };

    const handleProgressUpdated = (e: any) => {
      const data = e?.detail || e;
      if (!data?.taskId) {
        scheduleReload({ fromDbWatcher: Boolean(data?.fromDbWatcher) });
        return;
      }
      const { taskId, progress } = data;
      let foundInLocalState = false;
      const applyProg = (t: TaskMapItem) => {
        if (t.id !== taskId) return t;
        foundInLocalState = true;
        return applyLiveWorkingTaskStatus({ ...t, progress: progress !== undefined ? progress : t.progress });
      };
      setTasks((prev) => prev.map(applyProg));
      setAvailablePool((prev) => prev.map(applyProg));
      if (!foundInLocalState) {
        scheduleReload();
      }
    };

    const handleDailySheetLogUpdated = (e: any) => {
      const data = e?.detail || e;
      const log = data?.log;
      const targetItemId = log?.subtaskId ? `subtask:${log.subtaskId}` : (log?.taskId || null);
      if (log?.maName) {
        const isLogTimedOut = Boolean(log.timeOut && !log.isMissingTime);
        useAppStore.getState().updateMaActiveSession(
          log.maName,
          isLogTimedOut
            ? null
            : {
                maName: log.maName,
                client: log.client || null,
                taskName: log.taskName || null,
                taskId: targetItemId,
                subtaskId: log.subtaskId || null,
                timeIn: log.timeIn || null,
                timeOut: log.timeOut || null,
                date: log.dateKey || currentDate,
                status: log.status || (log.timeOut ? 'CLOSED' : 'IN PROGRESS'),
                isUpwork: Boolean(log.isUpwork),
                rowNumber: log.sheetRow || null,
                updatedAt: log.submittedAt || log.updatedAt || new Date().toISOString(),
                active: Boolean(log.timeIn && !log.timeOut && !log.isMissingTime),
              }
        );
      }
      if (targetItemId) {
        const nextProgress = {
          maName: log.maName,
          timeIn: log.timeIn || null,
          timeOut: log.timeOut || null,
          date: log.dateKey || currentDate,
          client: log.client || null,
          status: log.status || null,
          sheetRow: log.sheetRow || undefined,
          isMissingTime: Boolean(log.isMissingTime),
          isUpwork: Boolean(log.isUpwork),
          timeTracker: log.timeTracker || null,
        };
        const patchLog = (t: TaskMapItem) => {
          if (t.id !== targetItemId) return t;
          const isTimedOut = Boolean(nextProgress.timeOut && !nextProgress.isMissingTime);
          return applyLiveWorkingTaskStatus({
            ...t,
            progress: nextProgress,
            taskMap: isTimedOut
              ? { ...t.taskMap, statuses: stripInProgressStatus(t.taskMap?.statuses) }
              : t.taskMap,
          });
        };
        setTasks((prev) => prev.map(patchLog));
        setAvailablePool((prev) => prev.map(patchLog));
      }
      scheduleReload({ fromDbWatcher: Boolean(data?.fromDbWatcher) });
    };

    const handleUpworkChanged = (e: any) => {
      const data = e.detail || e;
      if (!data) return;

      if (data.active) {
        toast.info(`⚡ ${data.userName || 'A user'} is now active on Upwork!`, 6000);
        setActiveUpworkSessions((prev) => {
          const filtered = prev.filter((s) => s.taskId !== data.taskId);
          return [
            ...filtered,
            {
              taskId: data.taskId,
              taskTitle: data.taskTitle,
              userId: data.userId,
              userName: data.userName,
              pmName: data.pmName,
              startedAt: data.startedAt,
            },
          ];
        });
      } else {
        const mins = data.durationS ? Math.floor(data.durationS / 60) : 0;
        const durStr = mins > 0 ? `worked ${mins}m` : 'completed';
        toast.success(`✓ ${data.userName || 'User'} stopped Upwork (${durStr}) — Upwork is now available!`, 5000);
        setActiveUpworkSessions((prev) => prev.filter((s) => s.taskId !== data.taskId));
      }
    };

    const handleMaSessionUpdated = (e: any) => {
      const data = e.detail || e;
      if (data?.maName) {
        useAppStore.getState().updateMaActiveSession(
          data.maName,
          data?.cleared
            ? null
            : { ...data, updatedAt: data.updatedAt || new Date().toISOString() }
        );
      }
      if (data?.cleared || (data?.timeOut && !data?.active)) {
        const targetId = data?.subtaskId ? `subtask:${data.subtaskId}` : data?.taskId;
        const resolvedTimeOut = data?.timeOut || formatManilaTime(new Date());
        const maKey = (data?.maName || '').trim().toLowerCase();
        const maFirst = maKey.split(/\s+/)[0] || maKey;
        const patchTimedOut = (t: TaskMapItem): TaskMapItem => {
          const matchesId = Boolean(targetId && t.id === targetId);
          const progMa = (t.progress?.maName || '').trim().toLowerCase();
          const progFirst = progMa.split(/\s+/)[0] || progMa;
          const matchesMa = Boolean(
            maKey &&
            progMa &&
            (progMa === maKey || progFirst === maFirst) &&
            t.progress?.timeIn &&
            !t.progress?.timeOut
          );
          if (!matchesId && !matchesMa) return t;
          if (t.progress?.timeOut) return t;
          return {
            ...t,
            progress: t.progress ? { ...t.progress, timeOut: resolvedTimeOut } : t.progress,
            taskMap: {
              ...t.taskMap,
              statuses: stripInProgressStatus(t.taskMap?.statuses),
            },
          };
        };
        setTasks((prev) => prev.map(patchTimedOut));
        setAvailablePool((prev) => prev.map(patchTimedOut));
        scheduleReload();
      }
    };

    const handleShiftsUpdated = () => {
      scheduleReload({ fromDbWatcher: Boolean(data?.fromDbWatcher) });
    };

    const handleDailyRollover = (e: any) => {
      const data = e?.detail || e;
      useAppStore.getState().setMaActiveSessions({});
      if (data?.newDate && !userSelectedDateRef.current) {
        setCurrentDate(data.newDate);
      }
      taskMapApi.getHistoryDates().then((res) => {
        if (res.success && res.dates) {
          setHistoryDates(res.dates);
        }
      }).catch(() => {});
      scheduleReload({ fromDbWatcher: Boolean(data?.fromDbWatcher) });
    };

    const handleTaskMapReload = () => {
      closedTaskIdRef.current = null;
      lastUrlTaskIdRef.current = null;
      setRestoringUrlTask(false);
      setSelectedTaskModal(null);
      setSelectedSubtaskTargetId(undefined);
      setCurrentView('BOARD');
      userSelectedDateRef.current = false;
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('task');
        url.searchParams.delete('subtask');
        window.history.replaceState(window.history.state || {}, '', `${url.pathname}${url.search}`);
      }
      const latestDate = getTodayDateStr();
      if (currentDate !== latestDate) {
        setCurrentDate(latestDate);
      } else {
        void loadData(false);
      }
    };

    window.addEventListener('task:updated', handleTaskUpdated);
    const handleSuperviseUpdated = (e: any) => {
      const data = e?.detail || e;
      if (!data) return;
      if (data.action === 'check' && data.check) {
        setSuperviseChecks((prev) => {
          const filtered = prev.filter((c) => c.sessionKey !== data.check.sessionKey);
          return [data.check, ...filtered];
        });
      } else if (data.action === 'uncheck' && data.sessionKey) {
        setSuperviseChecks((prev) => prev.filter((c) => c.sessionKey !== data.sessionKey));
      }
    };

    window.addEventListener('task_map:updated', handleTaskMapUpdated);
    window.addEventListener('supervise:updated', handleSuperviseUpdated);
    window.addEventListener('task_map:shifts_updated', handleShiftsUpdated);
    window.addEventListener('audit_shifts:updated', handleShiftsUpdated);
    window.addEventListener('task:progress_updated', handleProgressUpdated);
    window.addEventListener('daily_sheet_log:updated', handleDailySheetLogUpdated);
    window.addEventListener('upwork:status_changed', handleUpworkChanged);
    window.addEventListener('ma:session_updated', handleMaSessionUpdated);
    window.addEventListener('task_map:ma_progress_changed', handleMaSessionUpdated);
    window.addEventListener('task_map:daily_rollover', handleDailyRollover);
    window.addEventListener('task_map:reload', handleTaskMapReload);

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      window.removeEventListener('task:updated', handleTaskUpdated);
      window.removeEventListener('task_map:updated', handleTaskMapUpdated);
      window.removeEventListener('supervise:updated', handleSuperviseUpdated);
      window.removeEventListener('task_map:shifts_updated', handleShiftsUpdated);
      window.removeEventListener('audit_shifts:updated', handleShiftsUpdated);
      window.removeEventListener('task:progress_updated', handleProgressUpdated);
      window.removeEventListener('daily_sheet_log:updated', handleDailySheetLogUpdated);
      window.removeEventListener('upwork:status_changed', handleUpworkChanged);
      window.removeEventListener('ma:session_updated', handleMaSessionUpdated);
      window.removeEventListener('task_map:ma_progress_changed', handleMaSessionUpdated);
      window.removeEventListener('task_map:daily_rollover', handleDailyRollover);
      window.removeEventListener('task_map:reload', handleTaskMapReload);
    };
  }, [loadData, currentDate, historyDates]);

  const handleViewChange = useCallback(
    (nextView: 'BOARD' | 'AUDITING' | 'CRM' | 'UPWORK' | 'DAILY_TRACKER' | 'SHEETS') => {
      setCurrentView(nextView);
      if (nextView === 'DAILY_TRACKER' || nextView === 'SHEETS') {
        setHasOpenedDailyTracker(true);
      }
      if (nextView === 'BOARD') {
        setSelectedTaskModal(null);
        setSelectedSubtaskTargetId(undefined);
        setRestoringUrlTask(false);
        // Only trigger a background refresh if data is older than 15s (avoid redundant fetches on tab switch)
        if (Date.now() - lastLoadedAtRef.current > 15000) {
          void loadData(true);
        }
      }
    },
    [loadData]
  );

  // Status Change Handler with Optimistic Updates (Frontend First) & Instant Realtime
  const handleStatusChange = async (taskId: string, newStatuses: string[]) => {
    // Strip CRM tag from substatus (CRM is main board routing status, not a substatus label)
    const cleanStatuses = newStatuses.filter((s) => s.toUpperCase().trim() !== 'CRM');
    const finalStatuses = cleanStatuses.length > 0 ? cleanStatuses.slice(0, 1) : [];

    const existingTask = tasks.find((t) => t.id === taskId) || availablePool.find((t) => t.id === taskId);
    const upworkStatus = finalStatuses.find((s) => s.toUpperCase().startsWith('UPWORK'));

    let optimisticStartedAt: string | null = null;
    let optimisticSession: UpworkSession | null = null;

    if (upworkStatus) {
      const m = upworkStatus.match(/^UPWORK\s*\|\s*(.+)$/i);
      const pmName = m && m[1] ? m[1].trim().toUpperCase() : 'General';
      optimisticStartedAt = existingTask?.upworkStartedAt || new Date().toISOString();
      const rawUser = currentUser?.name || existingTask?.assignee?.name || (currentUser?.email ? currentUser.email.split('@')[0] : '') || 'User';
      const cleanUser = rawUser.includes('@') ? rawUser.split('@')[0] : rawUser;
      const userName = (pmName && pmName !== 'General' && pmName !== 'Active') ? pmName : cleanUser.toUpperCase();
      optimisticSession = {
        taskId,
        taskTitle: existingTask?.title || 'Task',
        userId: currentUser?.id || '',
        userName,
        pmName,
        startedAt: optimisticStartedAt,
      };
    }

    const upStatuses = finalStatuses.map((st) => st.toUpperCase().replace(/[\s_-]+/g, ''));
    const isRevisionTransfer = upStatuses.includes('REVISION') || upStatuses.includes('REVISIONS');
    const isCrmTransfer =
      upStatuses.includes('ASKCLIENT') ||
      upStatuses.includes('READYTOSEND') ||
      upStatuses.includes('TOSEND');
    const isHandoverSelected =
      upStatuses.includes('HANDOVER') ||
      upStatuses.includes('AVAILABLETASK') ||
      isCrmTransfer;
    const isSentWaitingSelected = upStatuses.includes('SENTBUTWAITING') || upStatuses.includes('SENT');
    const isParentOnHoldSubStatus =
      !taskId.startsWith('subtask:') &&
      !existingTask?.isSubtask &&
      upStatuses.includes('ONHOLD');

    const applyParentOnHoldToSubtask = (item: TaskMapItem): TaskMapItem => {
      if (!isParentOnHoldSubStatus) return item;
      if (!item.isSubtask || item.parentTaskId !== taskId || item.isClosed) return item;
      return {
        ...item,
        status: 'ON-HOLD',
        taskMap: {
          ...item.taskMap,
          statuses: ['On-hold'],
        },
      };
    };

    // 1. Update Frontend First on both tasks and availablePool immediately
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
            ...t,
            ...(isHandoverSelected
              ? {
                  assigneeId: null,
                  assignee: null,
                  assignees: [],
                  progress: t.progress
                    ? {
                        ...t.progress,
                        timeOut: t.progress.timeOut || formatManilaTime(new Date()),
                      }
                    : null,
                }
              : {}),
            upworkStartedAt: optimisticStartedAt,
            upworkSession: optimisticSession,
            ...(isSentWaitingSelected && !t.crmWaitingMeta
              ? {
                  crmWaitingMeta: {
                    waitingSince: new Date().toISOString(),
                    daysPassed: 0,
                    rule: {
                      tier: 'TODAY' as const,
                      label: 'Today',
                      colorName: 'neutral' as const,
                      hex: '#71717a',
                      breathe: false,
                      requiresModal: false,
                    },
                  },
                }
              : {}),
            taskMap: {
              ...t.taskMap,
              ...(isHandoverSelected ? { handedOver: true } : {}),
              statuses: finalStatuses,
            },
          }
          : applyParentOnHoldToSubtask(t)
      )
    );

    // Available Tasks pool holds Pending, Revision, Hand-over, and On-hold tasks.
    // Exclude Review/Checking/Waiting/CRM and recurring, daily, weekly, monthly tasks.
    const s = (existingTask?.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const isExcluded =
      s === 'WAITING' ||
      s.includes('WAITING') ||
      s === 'CRM' ||
      s.includes('CRM') ||
      s === 'INREVIEW' ||
      s === 'TOREVIEW' ||
      s === 'REVIEW' ||
      s === 'CHECKING' ||
      s === 'INCHECKING' ||
      s === 'DAILY' ||
      s.includes('DAILY') ||
      s === 'WEEKLY' ||
      s.includes('WEEKLY') ||
      s === 'MONTHLY' ||
      s.includes('MONTHLY') ||
      s === 'RECURRING' ||
      s.includes('RECURRING') ||
      !!(existingTask as any)?.recurringConfig ||
      upStatuses.some(
        (st) =>
          ['WAITING', 'CRM', 'ASKCLIENT', 'READYTOSEND', 'TOSEND', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'INREVIEW', 'TOREVIEW', 'CHECKING', 'INCHECKING'].includes(st) ||
          st.includes('WAITING') ||
          st.includes('CRM') ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING')
      );

    const isNowAvailable =
      !isExcluded &&
      (!existingTask?.assigneeId ||
        isHandoverSelected ||
        upStatuses.some((st) => st.includes('AVAILABLE')));

    setAvailablePool((prev) => {
      const cascadedPrev = isParentOnHoldSubStatus ? prev.map(applyParentOnHoldToSubtask) : prev;
      const exists = cascadedPrev.some((t) => t.id === taskId);
      if (!isNowAvailable) {
        return cascadedPrev.filter((t) => t.id !== taskId);
      }
      if (exists) {
        return cascadedPrev.map((t) =>
          t.id === taskId
            ? {
              ...t,
              upworkStartedAt: optimisticStartedAt,
              upworkSession: optimisticSession,
              taskMap: { ...t.taskMap, statuses: finalStatuses },
            }
            : t
        );
      }
      if (isNowAvailable && existingTask) {
        return [
          {
            ...existingTask,
            ...(isHandoverSelected
              ? {
                  assigneeId: null,
                  assignee: null,
                  assignees: [],
                  progress: existingTask.progress
                    ? {
                        ...existingTask.progress,
                        timeOut: existingTask.progress.timeOut || formatManilaTime(new Date()),
                      }
                    : null,
                }
              : {}),
            upworkStartedAt: optimisticStartedAt,
            upworkSession: optimisticSession,
            taskMap: {
              ...existingTask.taskMap,
              ...(isHandoverSelected ? { handedOver: true } : {}),
              statuses: finalStatuses,
            },
          },
          ...cascadedPrev,
        ];
      }
      return cascadedPrev;
    });

    // 2. Optimistically update activeUpworkSessions for instant Header Banner change
    if (optimisticSession) {
      setActiveUpworkSessions((prev) => {
        const withoutThis = prev.filter((s) => s.taskId !== taskId);
        return [...withoutThis, optimisticSession!];
      });
    } else {
      setActiveUpworkSessions((prev) => prev.filter((s) => s.taskId !== taskId));
    }

    // 3. Debounce DB update per task to avoid concurrent requests & race conditions
    const existing = pendingUpdatesRef.current.get(taskId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(async () => {
      try {
        const res: any = await taskMapApi.updateTaskStatuses(taskId, finalStatuses);
        if (res.activeUpworkSessions) {
          setActiveUpworkSessions(res.activeUpworkSessions);
        }
        if (res.upworkStartedAt !== undefined) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? { ...t, upworkStartedAt: res.upworkStartedAt, upworkSession: res.upworkSession }
                : t
            )
          );
          setAvailablePool((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? { ...t, upworkStartedAt: res.upworkStartedAt, upworkSession: res.upworkSession }
                : t
            )
          );
        }
        if (res.originalMaId !== undefined || res.assigneeId !== undefined || res.taskMap) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    ...(res.assigneeId !== undefined ? { assigneeId: res.assigneeId } : {}),
                    ...(res.assignee !== undefined ? { assignee: res.assignee, assignees: res.assignee ? [res.assignee] : [] } : {}),
                    ...(res.taskMap ? { taskMap: { ...t.taskMap, ...res.taskMap } } : {}),
                  }
                : t
            )
          );
          if (isRevisionTransfer || isHandoverSelected || isCrmTransfer) {
            void loadData(true);
          }
        }
        const cur = pendingUpdatesRef.current.get(taskId);
        if (cur) {
          cur.timer = null;
        }
        // Retain in pending set briefly (1.5s) to guard against any trailing background GETs
        setTimeout(() => {
          pendingUpdatesRef.current.delete(taskId);
        }, 1500);
      } catch (err: any) {
        pendingUpdatesRef.current.delete(taskId);
        toast.error(err?.message || 'Failed to update statuses');
        loadData(true);
      }
    }, 250);

    pendingUpdatesRef.current.set(taskId, {
      statuses: finalStatuses,
      timer,
      timestamp: Date.now(),
    });
  };

  // Handler for direct task property updates (e.g. main workflow status, priority)
  const handleTaskUpdate = async (taskId: string, fields: Partial<TaskMapItem>) => {
    const normalizedFields: Partial<TaskMapItem> = { ...fields };
    if (normalizedFields.status !== undefined) {
      normalizedFields.status = toCanonicalTaskStatus(normalizedFields.status);
    }

    const currentTask = [...tasks, ...availablePool].find((t) => t.id === taskId);
    if (
      normalizedFields.status &&
      currentTask &&
      toCanonicalTaskStatus(normalizedFields.status) !== toCanonicalTaskStatus(currentTask.status)
    ) {
      const transitionCheck = canTransitionTaskStatus(currentTask, normalizedFields.status);
      if (!transitionCheck.allowed) {
        if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
          window.dispatchEvent(
            new CustomEvent('task:highlight-audits', {
              detail: {
                taskId,
                targetStatus: normalizedFields.status,
                uncheckedAudits: transitionCheck.uncheckedAudits,
                openSubtasks: transitionCheck.openSubtasks,
              },
            })
          );
        }
        setBlockedAuditAlert({
          isOpen: true,
          task: currentTask,
          targetStatus: normalizedFields.status,
          uncheckedAudits: transitionCheck.uncheckedAudits,
          openSubtasks: transitionCheck.openSubtasks,
        });
        toast.error(transitionCheck.reason || `Cannot move task to ${normalizedFields.status}`);
        return;
      }
    }

    // 1. Optimistically update local tasks & availablePool while tracking previous status for undo/misclick support
    const nextStatusUp = toCanonicalTaskStatus(normalizedFields.status);
    const isClosing = isClosedStatus(nextStatusUp) || isClosedStatus(normalizedFields.status);
    if (isClosing) {
      normalizedFields.assigneeId = null;
    }
    const isMovingToAvailable =
      normalizedFields.assigneeId === null || nextStatusUp === 'ON-HOLD' || nextStatusUp === 'ONHOLD';
    const isMovingOutOfAvailable =
      nextStatusUp === 'IN REVIEW' ||
      nextStatusUp === 'CHECKING' ||
      nextStatusUp === 'WAITING' ||
      nextStatusUp === 'CRM' ||
      Boolean(normalizedFields.assigneeId && normalizedFields.assigneeId !== null);

    const resolvePrevStatus = (t: TaskMapItem) => {
      if (
        normalizedFields.status &&
        toCanonicalTaskStatus(normalizedFields.status) !== toCanonicalTaskStatus(t.status)
      ) {
        return toCanonicalTaskStatus(t.status);
      }
      return (t as any)._previousStatus;
    };

    const nextHandedOverState = isMovingToAvailable
      ? true
      : normalizedFields.assigneeId
      ? false
      : undefined;

    const matchedTargetUser =
      normalizedFields.assigneeId
        ? [...allUsers, ...shiftUsers].find((u) => u && u.id === normalizedFields.assigneeId)
        : null;

    const buildUpdatedTaskItem = (t: TaskMapItem): TaskMapItem => {
      const syncedTaskMap =
        normalizedFields.assigneeId !== undefined
          ? syncTaskPmReviewsWithAssignee(t, normalizedFields.assigneeId, matchedTargetUser?.name)
          : t.taskMap;

      return {
        ...t,
        ...normalizedFields,
        ...(isClosing
          ? {
              isClosed: true,
              assigneeId: null,
              assignee: null,
              assignees: [],
            }
          : isMovingToAvailable
          ? { assigneeId: null, assignee: null, assignees: [] }
          : {}),
        ...(matchedTargetUser && !isClosing
          ? {
              assigneeId: matchedTargetUser.id,
              assignee: matchedTargetUser,
              assignees: [
                matchedTargetUser,
                ...(t.assignees || []).filter((u: any) => u && u.id !== matchedTargetUser.id),
              ],
            }
          : {}),
        taskMap: {
          ...syncedTaskMap,
          ...(normalizedFields.status !== undefined && !isClosing
            ? {
                statuses: normalizeTaskMapSubStatuses(
                  normalizedFields.status,
                  syncedTaskMap?.statuses,
                  {
                    isAssigned: Boolean(
                      normalizedFields.assigneeId !== undefined
                        ? normalizedFields.assigneeId
                        : t.assigneeId || (t.assignees && t.assignees.length > 0)
                    ),
                  }
                ),
              }
            : {}),
          ...(isClosing
            ? { statuses: ['Closed'], handedOver: false }
            : nextHandedOverState !== undefined
            ? { handedOver: nextHandedOverState }
            : {}),
        },
        _previousStatus: resolvePrevStatus(t),
      } as unknown as TaskMapItem;
    };

    if (currentTask) {
      if (isClosing) {
        pendingAssignRef.current.delete(taskId);
      } else {
        pendingAssignRef.current.set(taskId, {
          task: buildUpdatedTaskItem(currentTask),
          targetUserId: normalizedFields.assigneeId !== undefined ? normalizedFields.assigneeId : currentTask.assigneeId || null,
          timestamp: Date.now(),
        });
      }
    }

    const isParentBecomingOnHold =
      !taskId.startsWith('subtask:') &&
      !currentTask?.isSubtask &&
      (nextStatusUp === 'ON-HOLD' || nextStatusUp === 'ONHOLD');

    const cascadeOnHoldChild = (t: TaskMapItem): TaskMapItem => {
      if (!isParentBecomingOnHold || !t.isSubtask || t.parentTaskId !== taskId || t.isClosed) {
        return t;
      }
      return {
        ...t,
        status: normalizedFields.status || 'ON-HOLD',
        taskMap: {
          ...t.taskMap,
          statuses: ['On-hold'],
        },
      };
    };

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? buildUpdatedTaskItem(t) : cascadeOnHoldChild(t)))
    );

    setAvailablePool((prev) => {
      const cascadedPrev = isParentBecomingOnHold ? prev.map(cascadeOnHoldChild) : prev;
      if (isClosing || isMovingOutOfAvailable) {
        return cascadedPrev.filter((t) => t.id !== taskId);
      }
      const exists = cascadedPrev.some((t) => t.id === taskId);
      if (exists) {
        return cascadedPrev.map((t) => (t.id === taskId ? buildUpdatedTaskItem(t) : t));
      }
      if (isMovingToAvailable && currentTask) {
        return [...cascadedPrev, buildUpdatedTaskItem(currentTask)];
      }
      return cascadedPrev;
    });

    // 2. Persist to backend (skip no-op status-only update when already exact canonical status)
    const onlyStatusField =
      normalizedFields.status !== undefined && Object.keys(normalizedFields).length === 1;
    if (onlyStatusField && currentTask && normalizedFields.status === currentTask.status) {
      return;
    }

    const isSubtaskTarget = Boolean(
      (currentTask as any)?.isSubtask || taskId.startsWith('subtask:')
    );
    const resolvedSubtaskId =
      (currentTask as any)?.subtaskId ||
      (taskId.startsWith('subtask:') ? taskId.slice('subtask:'.length) : undefined);
    const resolvedParentTaskId = (currentTask as any)?.parentTaskId;

    markTaskSavingToDb(taskId, true);
    try {
      if (isSubtaskTarget && resolvedParentTaskId && resolvedSubtaskId) {
        await tasksApi.updateSubtask(resolvedParentTaskId, resolvedSubtaskId, normalizedFields as any);
        window.dispatchEvent(
          new CustomEvent('task:updated', { detail: { id: resolvedParentTaskId, subtaskId: resolvedSubtaskId, ...normalizedFields } })
        );
      } else {
        await tasksApi.updateTask(taskId, normalizedFields as any);
        window.dispatchEvent(new CustomEvent('task:updated', { detail: { id: taskId, ...normalizedFields } }));
      }
      setTimeout(() => {
        pendingAssignRef.current.delete(taskId);
      }, 1800);
    } catch (err: any) {
      pendingAssignRef.current.delete(taskId);
      toast.error(err?.message || 'Failed to update task');
      loadData(true);
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  };

  const handleOptimisticClockOut = useCallback(
    (
      taskId: string,
      updates: {
        timeOut: string;
        targetStatus: string;
        targetMainStatus?: string;
        taskDeliverablesDescription?: string;
        taskUpdateAndDeliverables?: string;
        handedOver?: boolean;
        clearAssignee?: boolean;
      }
    ) => {
      const patchClockOut = (t: TaskMapItem): TaskMapItem => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          ...(updates.targetMainStatus ? { status: updates.targetMainStatus } : {}),
          ...(updates.clearAssignee ? { assigneeId: null, assignee: null, assignees: [] } : {}),
          progress: t.progress
            ? {
                ...t.progress,
                timeOut: updates.timeOut,
                ...(updates.taskDeliverablesDescription !== undefined
                  ? { taskDeliverablesDescription: updates.taskDeliverablesDescription }
                  : {}),
                ...(updates.taskUpdateAndDeliverables !== undefined
                  ? { taskUpdateAndDeliverables: updates.taskUpdateAndDeliverables }
                  : {}),
              }
            : t.progress,
          taskMap: {
            ...t.taskMap,
            statuses: [updates.targetStatus],
            ...(updates.handedOver !== undefined ? { handedOver: updates.handedOver } : {}),
          },
        };
      };
      setTasks((prev) => prev.map(patchClockOut));
      setAvailablePool((prev) => prev.map(patchClockOut));
    },
    []
  );

  // Handler for optimistic drag-and-drop task assignment on Task Map Board View
  const handleAssignTask = async (
    taskId: string,
    targetUserId: string | null,
    mode: 'IN_PROGRESS' | 'QUEUE' = 'QUEUE',
    assigneeRoleRestrictions?: string[],
    otp?: string,
    taskOverride?: TaskMapItem,
    preserveHandover?: boolean
  ) => {
    const currentTask = [...tasks, ...availablePool].find((t) => t.id === taskId) || taskOverride;
    if (!currentTask) return;

    const prevTasks = tasks;
    const prevPool = availablePool;

    const targetUser = targetUserId
      ? [...allUsers, ...shiftUsers].find((u) => u && u.id === targetUserId) || {
          id: targetUserId,
          name: 'Team Member',
        }
      : null;

    const optimisticTask = applyOptimisticTaskMapAssignment(
      currentTask,
      targetUser,
      mode,
      assigneeRoleRestrictions,
      preserveHandover
    );
    pendingAssignRef.current.set(taskId, {
      task: optimisticTask,
      targetUserId,
      timestamp: Date.now(),
    });

    if (mode === 'IN_PROGRESS' && targetUser?.name) {
      useAppStore.getState().updateMaActiveSession(targetUser.name, {
        maName: targetUser.name,
        taskId,
        subtaskId: currentTask.subtaskId || null,
        listId: currentTask.listId || currentTask.list?.id || null,
        listName: currentTask.list?.name || null,
        taskStatus: optimisticTask.status || 'IN PROGRESS',
        priority: currentTask.priority || null,
        subStatuses: optimisticTask.taskMap?.statuses,
        timeIn: optimisticTask.progress?.timeIn || formatManilaTime(new Date()),
        timeOut: null,
        client: optimisticTask.progress?.client || currentTask.list?.name || 'General',
        taskName: currentTask.title,
        date: currentDate,
        status: 'In progress',
        isUpwork: Boolean(optimisticTask.progress?.isUpwork),
        rowNumber: null,
        updatedAt: new Date().toISOString(),
        active: true,
      });
    }

    // Helper: if dropping into IN_PROGRESS slot for targetUserId, demote any previous IN_PROGRESS task of that user to QUEUE
    const demoteDisplacedInProgress = (item: TaskMapItem): TaskMapItem => {
      if (mode !== 'IN_PROGRESS' || !targetUserId || item.id === taskId) return item;
      const itemStatusNorm = (item.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const itemMapStatuses = (item.taskMap?.statuses || []).map((s) =>
        s.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );
      const isCadence =
        ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(itemStatusNorm) ||
        Boolean((item as any).recurringConfig);
      if (isCadence) return item;
      const isSameUser =
        item.assigneeId === targetUserId ||
        item.assignee?.id === targetUserId ||
        (item.progress?.maName || '').trim().toLowerCase() === (targetUser?.name || '').trim().toLowerCase();
      const isCurrentlyInProgress =
        itemStatusNorm === 'INPROGRESS' ||
        itemMapStatuses.includes('INPROGRESS') ||
        Boolean(item.progress?.timeIn && !item.progress?.timeOut);
      if (!isSameUser || !isCurrentlyInProgress) return item;

      return applyOptimisticTaskMapAssignment(item, targetUser, 'QUEUE');
    };

    // 1. Instant 0ms frontend state update across tasks and availablePool
    const displacedIds: string[] = [];
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === taskId);
      const mapped = prev.map((t) => {
        if (t.id === taskId) return optimisticTask;
        const demoted = demoteDisplacedInProgress(t);
        if (demoted !== t) {
          displacedIds.push(t.id);
          pendingAssignRef.current.set(t.id, {
            task: demoted,
            targetUserId,
            timestamp: Date.now(),
          });
        }
        return demoted;
      });
      if (!exists && targetUserId !== null) {
        return [optimisticTask, ...mapped];
      }
      return mapped;
    });

    setAvailablePool((prev) => {
      if (targetUserId !== null) {
        return prev.filter((t) => t.id !== taskId);
      }
      const exists = prev.some((t) => t.id === taskId);
      if (exists) {
        return prev.map((t) => (t.id === taskId ? optimisticTask : t));
      }
      return [optimisticTask, ...prev];
    });

    // 2. Persist to backend via taskMapApi.assignTask (which automatically tracks saving state in taskMap.ts)
    try {
      const assignRes = await taskMapApi.assignTask(
        taskId,
        targetUserId,
        mode,
        {
          ...(assigneeRoleRestrictions ? { assigneeRoleRestrictions } : {}),
          ...(otp ? { otp } : {}),
          ...(preserveHandover ? { preserveHandover } : {}),
        }
      );

      if (assignRes?.maSession?.maName) {
        useAppStore.getState().updateMaActiveSession(assignRes.maSession.maName, assignRes.maSession);
      }

      if (assignRes?.progress || assignRes?.taskMap) {
        const syncedTask: TaskMapItem = applyLiveWorkingTaskStatus({
          ...optimisticTask,
          ...(assignRes.progress ? { progress: assignRes.progress } : {}),
          ...(assignRes.taskMap
            ? {
                taskMap: {
                  ...optimisticTask.taskMap,
                  ...assignRes.taskMap,
                },
              }
            : {}),
        });
        pendingAssignRef.current.set(taskId, {
          task: syncedTask,
          targetUserId,
          timestamp: Date.now(),
        });
        setTasks((prev) => prev.map((t) => (t.id === taskId ? syncedTask : t)));
      }

      await loadData(true);
      setTimeout(() => {
        pendingAssignRef.current.delete(taskId);
        displacedIds.forEach((dId) => pendingAssignRef.current.delete(dId));
      }, 1000);
    } catch (err: any) {
      pendingAssignRef.current.delete(taskId);
      displacedIds.forEach((dId) => pendingAssignRef.current.delete(dId));
      // Immediately revert the card in the UI if the server rejects the move
      setTasks(prevTasks);
      setAvailablePool(prevPool);
      const errData = err?.response?.data || err?.data;
      const isClientLocked =
        err?.isClientLocked ||
        errData?.isClientLocked ||
        errData?.error === 'CLIENT_LOCKED' ||
        err?.error === 'CLIENT_LOCKED' ||
        err?.message?.includes('CLIENT_LOCKED') ||
        err?.message?.toLowerCase().includes('exceeded weekly');
      if (!isClientLocked) {
        toast.error(err?.message || 'Failed to update task assignment');
      }
      loadData(true);
      throw err;
    }
  };

  // Handler for PM-only direct task transfer (lands in target MA's To Do / Queue, never In Progress)
  const handleTransferTask = async (taskId: string, targetUserId: string) => {
    const currentTask = [...tasks, ...availablePool].find((t) => t.id === taskId);
    if (!currentTask) return;

    const prevTasks = tasks;
    const prevPool = availablePool;

    const targetUser = [...allUsers, ...shiftUsers].find((u) => u && u.id === targetUserId) || {
      id: targetUserId,
      name: 'Team Member',
    };

    const optimisticTask = applyOptimisticTaskMapAssignment(currentTask, targetUser, 'QUEUE');
    pendingAssignRef.current.set(taskId, {
      task: optimisticTask,
      targetUserId,
      timestamp: Date.now(),
    });

    setTasks((prev) => {
      const exists = prev.some((t) => t.id === taskId);
      const mapped = prev.map((t) => (t.id === taskId ? optimisticTask : t));
      return exists ? mapped : [optimisticTask, ...mapped];
    });
    setAvailablePool((prev) => prev.filter((t) => t.id !== taskId));

    try {
      await taskMapApi.transferTask(taskId, targetUserId);
      setTimeout(() => {
        pendingAssignRef.current.delete(taskId);
      }, 2500);
      loadData(true);
    } catch (err: any) {
      pendingAssignRef.current.delete(taskId);
      setTasks(prevTasks);
      setAvailablePool(prevPool);
      const errData = err?.response?.data || err?.data;
      const isClientLocked =
        err?.isClientLocked ||
        errData?.isClientLocked ||
        errData?.error === 'CLIENT_LOCKED' ||
        err?.error === 'CLIENT_LOCKED' ||
        err?.message?.includes('CLIENT_LOCKED') ||
        err?.message?.toLowerCase().includes('exceeded weekly');
      if (!isClientLocked) {
        toast.error(err?.message || 'Failed to transfer task');
      }
      loadData(true);
      throw err;
    }
  };

  // Compute distinct clients from "Client Dashboard" in sidebar/database and their active task counts
  const clients = React.useMemo(() => {
    const clientMap = new Map<string, { id: string; name: string; count: number }>();

    // 1. Seed from all lists under "Client Dashboard" folders/spaces (matching the sidebar)
    for (const c of collectClientDashboardLists(spaces, allLists)) {
      if (!clientMap.has(c.id)) {
        clientMap.set(c.id, { id: c.id, name: c.name, count: 0 });
      }
    }

    // 2. Also merge clients fetched directly from database API
    for (const c of allDbClients) {
      if (!clientMap.has(c.id)) {
        clientMap.set(c.id, { id: c.id, name: c.name, count: 0 });
      }
    }

    // 4. Count active tasks for each client (excluding Admin/internal tasks)
    const allPoolAndTasks = [...tasks, ...availablePool];
    const seenTaskIds = new Set<string>();

    for (const t of allPoolAndTasks) {
      if (seenTaskIds.has(t.id)) continue;
      seenTaskIds.add(t.id);

      // Do not count On-Hold or Admin tasks in client task number indicators
      if (isTaskMapItemOnHold(t)) continue;
      if (isTaskUnderAdmin(t)) continue;

      const listId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
      const name = t.list?.name || 'General';

      const existing = clientMap.get(listId);
      if (existing) {
        existing.count++;
      } else {
        clientMap.set(listId, { id: listId, name, count: 1 });
      }
    }

    return Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [spaces, allLists, allDbClients, tasks, availablePool]);

  // Compute Admin tasks count and distinct Admin/internal folder lists
  const { adminTasksCount, adminClients } = React.useMemo(() => {
    const adminClientMap = new Map<string, { id: string; name: string; count: number }>();
    let totalAdminCount = 0;

    // Seed the 7 known Admin lists so they always appear in the dropdown
    const knownAdminNames = [
      'Admin | Jenesia Red',
      'Harmony',
      'Jenesia Red',
      'Jenesia Red | Personal',
      'Snaply',
      'VIP Scale',
      'Xfnite',
    ];
    for (const name of knownAdminNames) {
      adminClientMap.set(name.toLowerCase(), { id: `admin-${name}`, name, count: 0 });
    }

    const allPoolAndTasks = [...tasks, ...availablePool];
    const seenTaskIds = new Set<string>();

    for (const t of allPoolAndTasks) {
      if (seenTaskIds.has(t.id)) continue;
      seenTaskIds.add(t.id);

      if (isTaskMapItemOnHold(t)) continue;
      if (isTaskUnderAdmin(t)) {
        totalAdminCount++;
        const listId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
        const listName = t.list?.name || 'Admin';
        const key = listName.toLowerCase();

        const existing = adminClientMap.get(key);
        if (existing) {
          existing.id = listId;
          existing.count++;
        } else {
          adminClientMap.set(key, { id: listId, name: listName, count: 1 });
        }
      }
    }

    return {
      adminTasksCount: totalAdminCount,
      adminClients: Array.from(adminClientMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [tasks, availablePool]);

  const matchesClientFilter = React.useCallback(
    (t: TaskMapItem) => {
      if (selectedClients === 'ALL') return true;
      const listId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
      const lName = t.list?.name || 'General';
      return selectedClients.includes(listId) || selectedClients.includes(lName);
    },
    [selectedClients]
  );

  // Instant 0ms frontend filtering by selected clients and showAdminTasks
  const isTaskVisible = React.useCallback(
    (t: TaskMapItem, forPool = false) => {
      const isAdmin = isTaskUnderAdmin(t);

      // Hide all admin/dormant/startups/HR tasks by default unless showAdminTasks is toggled ON,
      // EXCEPT for tasks assigned to developer roles or inputted for an MA from the spreadsheet.
      if (isAdmin && !showAdminTasks) {
        if (forPool) {
          // Never display admin tasks in Available Tasks by default; only pass live-working
          // spreadsheet tasks through so TaskMapBoardView can route them to the MA column.
          const isLiveSheet = Boolean(
            t.progress?.maName &&
            !t.progress?.timeOut &&
            t.progress?.timeIn &&
            hasSpreadsheetTaskInput(t, { isHistory: isHistoryView, targetDate: currentDate })
          );
          return isLiveSheet && matchesClientFilter(t);
        }
        const handlerId = getEffectiveTaskMapHandlerId(t);
        const handlerUser =
          (t.assignee && t.assignee.id === handlerId ? t.assignee : null) ||
          allUsers.find((u: any) => u.id === handlerId);
        const hasSheetInput = hasSpreadsheetTaskInput(t, { isHistory: isHistoryView, targetDate: currentDate });
        const isInProgress =
          (t.status || '').toUpperCase().includes('PROGRESS') ||
          (t.taskMap?.statuses || []).some((s: string) => s.toUpperCase().includes('PROGRESS')) ||
          Boolean(t.progress?.timeIn && !t.progress?.timeOut);
        const isPausedAssigned =
          Boolean(handlerId) &&
          (t.taskMap?.statuses || []).some(
            (s: string) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'PAUSED'
          );
        const hasExplicitQueueAssignment = Boolean(
          handlerId && hasPmAssignmentForUser(t, handlerId)
        );
        if (!isDeveloperUser(handlerUser, workspaceTeams) && !hasSheetInput && !isInProgress && !isPausedAssigned && !hasExplicitQueueAssignment && !search) {
          return false;
        }
      }

      return matchesClientFilter(t);
    },
    [showAdminTasks, isHistoryView, currentDate, allUsers, workspaceTeams, matchesClientFilter]
  );

  const displayedTasks = React.useMemo(() => {
    return tasks.filter((t) => isTaskVisible(t, false));
  }, [tasks, isTaskVisible]);

  const displayedPool = React.useMemo(() => {
    return availablePool.filter((t) => isTaskVisible(t, true));
  }, [availablePool, isTaskVisible]);

  // Compute count of active Task Map tasks assigned/queued to the current user only
  const taskMapQueueCount = React.useMemo(() => {
    const userId = currentUser?.id;
    if (!userId) return 0;
    const seenIds = new Set<string>();
    let count = 0;
    for (const t of [...displayedTasks, ...displayedPool]) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      if (t.isClosed || isTaskMapItemOnHold(t) || isOtherBoardWorkflowStatus(t)) continue;
      if (getEffectiveTaskMapHandlerId(t) === userId) {
        count++;
      }
    }
    return count;
  }, [displayedTasks, displayedPool, currentUser?.id]);

  // Compute count of review/auditing tasks assigned to the current user only
  const auditingCount = React.useMemo(() => {
    const userId = currentUser?.id;
    if (!userId) return 0;
    const allPoolAndTasks = [...tasks, ...availablePool];
    const seenIds = new Set<string>();
    let count = 0;
    for (const t of allPoolAndTasks) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      if (t.isSubtask || t.isClosed || isTaskMapItemOnHold(t) || isTaskHandedOver(t)) continue;
      if (getEffectiveTaskMapHandlerId(t) !== userId) continue;
      const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
        x.toUpperCase().replace(/[\s_-]+/g, '')
      );
      if (
        s === 'TOREVIEW' ||
        s === 'INREVIEW' ||
        s === 'REVIEW' ||
        s === 'CHECKING' ||
        s === 'INCHECKING' ||
        mapStatuses.includes('TOREVIEW') ||
        mapStatuses.includes('INREVIEW') ||
        mapStatuses.includes('REVIEW') ||
        mapStatuses.includes('CHECKING') ||
        mapStatuses.includes('INCHECKING')
      ) {
        count++;
      }
    }
    return count;
  }, [tasks, availablePool, currentUser?.id]);

  // Compute count of active CRM tasks assigned to the current user only (excluding Sent/Waiting, Closed, On-hold)
  const crmCount = React.useMemo(() => {
    const userId = currentUser?.id;
    if (!userId) return 0;
    const allPoolAndTasks = [...tasks, ...availablePool];
    const seenIds = new Set<string>();
    let count = 0;
    for (const t of allPoolAndTasks) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      if (t.isSubtask || t.isClosed || isTaskMapItemOnHold(t) || isTaskHandedOver(t)) continue;
      if (getEffectiveTaskMapHandlerId(t) !== userId) continue;
      const s = (t.status || '').toUpperCase().trim();
      const mapStatusesNorm = (t.taskMap?.statuses || []).map((st) =>
        st.toUpperCase().replace(/[\s_-]+/g, '')
      );
      const hasAskClient = mapStatusesNorm.includes('ASKCLIENT');
      const isSentOrWaiting = s === 'WAITING' || mapStatusesNorm.includes('SENTBUTWAITING') || mapStatusesNorm.includes('SENT');
      if (!isSentOrWaiting && (s === 'CRM' || hasAskClient)) {
        count++;
      }
    }
    return count;
  }, [tasks, availablePool, currentUser?.id]);

  // Compute available MAs for custom shift selection
  const availableMAs = React.useMemo(() => {
    const list = shiftUsers.length > 0 ? shiftUsers : allUsers;
    return list.map((u) => ({
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      roles: u.roles,
    }));
  }, [shiftUsers, allUsers]);

  // Merge activeUpworkSessions with any open tasks actively in progress under Upwork
  const effectiveUpworkSessions = React.useMemo(() => {
    // Purge any session that has a recorded timeOut or belongs to a task that clocked out
    const list = (activeUpworkSessions || []).filter((s) => {
      if (s.timeOut || s.stoppedAt || (s as any).active === false) return false;
      const matchingTask = tasks.find((t) => t.id === s.taskId);
      if (matchingTask?.progress?.timeOut) return false;
      return true;
    });
    const seenTaskIds = new Set(list.map((s) => s.taskId));

    for (const t of tasks) {
      if (t.isClosed) continue;
      const clientName = t.progress?.client || t.list?.name || '';
      const isClientConfiguredUpwork = upworkClients.some(
        (c) => c.toLowerCase() === clientName.toLowerCase()
      );
      const isUpwork = t.progress?.timeTracker
        ? Boolean(t.progress?.isUpwork)
        : Boolean(
          t.progress?.isUpwork ||
          isClientConfiguredUpwork ||
          t.list?.name?.toLowerCase().includes('upwork') ||
          (t.taskMap?.statuses || []).some((s) => s.toLowerCase().startsWith('upwork'))
        );
      // Only count as live when the MA clocked in and has not clocked out
      const isActivelyWorking = Boolean(
        t.progress?.timeIn && !t.progress?.timeOut && !t.progress?.isMissingTime
      );

      if (isUpwork && isActivelyWorking && !seenTaskIds.has(t.id)) {
        seenTaskIds.add(t.id);
        const userName = t.progress?.maName || t.assignee?.name || 'Team Member';
        const clientDisplayName = t.progress?.client || t.list?.name || '';
        const pmDisplayName = t.progress?.client ? t.progress.client.toUpperCase() : 'UPWORK';
        const isProj = isSessionProjectBased({
          taskId: t.id,
          taskTitle: t.title,
          clientName: clientDisplayName,
          pmName: pmDisplayName,
        } as any, upworkProjectClients);

        list.push({
          taskId: t.id,
          taskTitle: t.title,
          userId: t.assigneeId || '',
          userName,
          pmName: pmDisplayName,
          clientName: clientDisplayName,
          startedAt: t.progress?.updatedAt || t.upworkStartedAt || new Date().toISOString(),
          isProjectBased: isProj,
        });
      }
    }
    return list;
  }, [activeUpworkSessions, tasks, upworkClients, upworkProjectClients]);

  useEffect(() => {
    useAppStore.getState().setActiveUpworkSessions(effectiveUpworkSessions);
  }, [effectiveUpworkSessions]);

  const [hasSavingTasks, setHasSavingTasks] = useState(false);
  useEffect(() => subscribeTaskMapSaving((ids) => setHasSavingTasks(ids.size > 0)), []);

  const isInitialBoardLoading = loading && !hasLoadedOnceRef.current && tasks.length === 0 && availablePool.length === 0;
  const isInitialLoadFailed = !hasLoadedOnceRef.current && Boolean(loadError) && tasks.length === 0 && availablePool.length === 0;
  const showJournalLoader = (isInitialBoardLoading || isInitialLoadFailed) && !selectedTaskModal && !restoringUrlTask;

  return (
    <>
      {showJournalLoader ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 h-full bg-background text-zinc-400">
          {isInitialLoadFailed && !loading ? (
            <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center space-y-3">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                <AlertTriangle className="size-5" />
              </div>
              <h2 className="text-sm font-semibold text-zinc-100">Task Map is temporarily unavailable</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">{loadError}</p>
              <p className="text-[11px] text-zinc-500">Retrying automatically in the background…</p>
              <button
                type="button"
                onClick={() => loadData(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0099ff] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#0088e6] transition-colors"
              >
                <RefreshCw className="size-3.5" />
                Retry now
              </button>
            </div>
          ) : (
            <NexusLogoLoader size={52} label="Loading Task Map Journal..." />
          )}
        </div>
      ) : isInitialBoardLoading ? (
        <div className="flex-1 h-full bg-background" />
      ) : (
        <div className="flex h-full w-full bg-background overflow-hidden select-none">
      {/* 1. Left: Dedicated Date Sidebar (Matches Image 1) */}
      <TaskMapSidebar
        currentDate={currentDate}
        historyDates={historyDates}
        onSelectDate={(newDate) => {
          userSelectedDateRef.current = true;
          setCurrentDate(newDate);
        }}
      />

      {/* 2. Right: Main Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
        {/* Top Header Bar: Date, Day, Shift Pills [All] [Day] [Noon] [Night] [Custom], Client selector, View tabs, Search */}
        <TaskMapHeader
          currentDate={currentDate}
          currentShift={currentShift}
          activeShift={activeShift}
          onShiftChange={handleShiftChange}
          shifts={shifts}
          search={search}
          onSearchChange={setSearch}
          activeUpworkSessions={effectiveUpworkSessions}
          currentView={currentView}
          onViewChange={handleViewChange}
          clients={clients}
          adminClients={adminClients}
          adminCount={adminTasksCount}
          showAdmin={showAdminTasks}
          onToggleAdmin={() => setShowAdminTasks((prev) => !prev)}
          selectedClients={selectedClients}
          onSelectClients={setSelectedClients}
          taskMapQueueCount={taskMapQueueCount}
          auditingCount={auditingCount}
          crmCount={crmCount}
          maSortMode={maSortMode}
          onMaSortModeChange={handleMaSortModeChange}
          availableMAs={availableMAs}
          selectedMAs={selectedCustomMAs}
          onSelectedMAsChange={setSelectedCustomMAs}
          hasCrmAccess={hasCrmAccess(currentUser)}
          onTriggerDailyRollover={handleTriggerDailyRollover}
          isRollingOver={isRollingOver}
          isHistory={isHistoryView}
          auditorRoles={auditorRoles}
          auditorTypeFilter={auditorTypeFilter}
          onAuditorTypeFilterChange={setAuditorTypeFilter}
          isFilterLoading={loading}
          trackFilter={trackFilter}
          onTrackFilterChange={setTrackFilter}
        />

        {/* Viewport: Board View OR Auditing View OR CRM View OR Upwork Tab View */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {currentView === 'BOARD' ? (
            <TaskMapBoardView
              tasks={displayedTasks}
              availablePool={displayedPool}
              allAvailablePool={availablePool}
              allTasks={tasks}
              options={options}
              allUsers={allUsers}
              shiftUsers={shiftUsers}
              currentShift={currentShift}
              currentDate={currentDate}
              isHistory={isHistoryView}
              onStatusChange={handleStatusChange}
              onOptionsUpdated={() => loadData(true)}
              onOpenDetail={handleOpenTaskDetail}
              onDataRefresh={() => loadData(true)}
              showAdminTasks={showAdminTasks}
              onToggleAdminTasks={() => setShowAdminTasks((prev) => !prev)}
              selectedCustomMAs={selectedCustomMAs}
              clients={clients}
              onTaskUpdate={handleTaskUpdate}
              onAssignTask={handleAssignTask}
              onOptimisticClockOut={handleOptimisticClockOut}
              onTransferTask={handleTransferTask}
              search={search}
              trackFilter={trackFilter}
              maSortMode={maSortMode}
              superviseChecks={superviseChecks}
              onSuperviseCheck={async (payload) => {
                const res = await taskMapApi.checkSuperviseSession(payload);
                if (res?.check) {
                  setSuperviseChecks((prev) => [
                    res.check,
                    ...prev.filter((c) => c.sessionKey !== res.check.sessionKey),
                  ]);
                }
              }}
              onSuperviseUncheck={async (sessionKey) => {
                setSuperviseChecks((prev) => prev.filter((c) => c.sessionKey !== sessionKey));
                await taskMapApi.uncheckSuperviseSession(sessionKey);
              }}
            />
          ) : currentView === 'AUDITING' ? (
            <TaskMapAuditingView
              tasks={displayedTasks.filter((t) => !t.isSubtask)}
              availablePool={displayedPool.filter((t) => !t.isSubtask)}
              allAvailablePool={availablePool.filter((t) => !t.isSubtask)}
              allTasks={tasks.filter((t) => !t.isSubtask)}
              options={options}
              allUsers={allUsers}
              shiftUsers={shiftUsers}
              currentShift={currentShift}
              selectedCustomMAs={selectedCustomMAs}
              onStatusChange={handleStatusChange}
              onOptionsUpdated={() => loadData(true)}
              onOpenDetail={handleOpenTaskDetail}
              onDataRefresh={() => loadData(true)}
              onTaskUpdate={handleTaskUpdate}
              auditorTypeFilter={auditorTypeFilter}
              clients={clients}
              showAdminTasks={showAdminTasks}
              onToggleAdminTasks={() => setShowAdminTasks((prev) => !prev)}
              search={search}
            />
          ) : currentView === 'CRM' ? (
            <TaskMapCrmView
              tasks={displayedTasks.filter((t) => !t.isSubtask)}
              availablePool={displayedPool.filter((t) => !t.isSubtask)}
              allAvailablePool={availablePool.filter((t) => !t.isSubtask)}
              allTasks={tasks.filter((t) => !t.isSubtask)}
              options={options}
              allUsers={allUsers}
              shiftUsers={shiftUsers}
              currentShift={currentShift}
              selectedCustomMAs={selectedCustomMAs}
              onStatusChange={handleStatusChange}
              onOptionsUpdated={() => loadData(true)}
              onOpenDetail={handleOpenTaskDetail}
              onDataRefresh={() => loadData(true)}
              onTaskUpdate={handleTaskUpdate}
              onSwitchToBoard={() => handleViewChange('BOARD')}
              clients={clients}
              showAdminTasks={showAdminTasks}
              onToggleAdminTasks={() => setShowAdminTasks((prev) => !prev)}
              search={search}
            />
          ) : currentView === 'UPWORK' ? (
            <TaskMapUpworkView
              tasks={displayedTasks.filter((t) => !t.isSubtask)}
              availablePool={displayedPool.filter((t) => !t.isSubtask)}
              activeUpworkSessions={activeUpworkSessions}
              allUsers={allUsers}
              onStatusChange={handleStatusChange}
              onOpenDetail={handleOpenTaskDetail}
              onRefresh={() => loadData(true)}
            />
          ) : null}

          {/* Keep Daily Tracker mounted once visited so the embedded Google Sheets iframe is cached across tab switches */}
          {(hasOpenedDailyTracker || currentView === 'DAILY_TRACKER' || currentView === 'SHEETS') && (
            <div
              className={
                currentView === 'DAILY_TRACKER' || currentView === 'SHEETS'
                  ? 'flex-1 h-full flex flex-col min-h-0 overflow-hidden'
                  : 'hidden'
              }
            >
              <TaskMapDailyTrackerView
                tasks={displayedTasks.filter((t) => !t.isSubtask)}
                allTasks={tasks}
                allUsers={allUsers}
                currentUser={currentUser}
                initialDate={currentDate}
                initialLogs={dailySheetLogs}
                clients={clients}
                onOpenDetail={handleOpenTaskDetail}
                onRefresh={() => loadData(true)}
              />
            </div>
          )}
        </div>
      </main>
        </div>
      )}

      {/* Task Detail Modal */}
      {!selectedTaskModal && restoringUrlTask && <TaskModalLoadingOverlay />}
      {selectedTaskModal && (
        <TaskDetailModal
          isOpen={!!selectedTaskModal}
          onClose={() => {
            closedTaskIdRef.current =
              new URLSearchParams(window.location.search).get('task') || selectedTaskModal?.id || null;
            lastUrlTaskIdRef.current = null;
            setRestoringUrlTask(false);
            setSelectedTaskModal(null);
            setSelectedSubtaskTargetId(undefined);
            const url = new URL(window.location.href);
            url.searchParams.delete('task');
            url.searchParams.delete('subtask');
            window.history.replaceState(window.history.state || {}, '', `${url.pathname}${url.search}`);
            void loadData(true);
          }}
          task={selectedTaskModal}
          targetSubtaskId={selectedSubtaskTargetId}
          mode="full"
          onUpdateTask={() => loadData(true)}
        />
      )}

      {/* Blocked Audits / Subtasks Modal */}
      <UncheckedAuditsModal
        isOpen={blockedAuditAlert.isOpen}
        onClose={() => setBlockedAuditAlert((prev) => ({ ...prev, isOpen: false }))}
        taskTitle={blockedAuditAlert.task?.title || ''}
        targetStatus={blockedAuditAlert.targetStatus}
        uncheckedAudits={blockedAuditAlert.uncheckedAudits}
        openSubtasks={blockedAuditAlert.openSubtasks}
        onReviewAudits={() => {
          if (blockedAuditAlert.task) {
            handleOpenTaskDetail(blockedAuditAlert.task);
            if (blockedAuditAlert.uncheckedAudits && blockedAuditAlert.uncheckedAudits.length > 0) {
              const pendingHighlight = {
                taskId: blockedAuditAlert.task.id,
                targetStatus: blockedAuditAlert.targetStatus,
                uncheckedAudits: blockedAuditAlert.uncheckedAudits,
                openSubtasks: blockedAuditAlert.openSubtasks,
              };
              if (typeof window !== 'undefined') {
                (window as any).__pendingAuditHighlight = pendingHighlight;
              }
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent('task:highlight-audits', { detail: pendingHighlight })
                );
              }, 350);
            }
          }
        }}
        reviewButtonText={
          blockedAuditAlert.uncheckedAudits.length > 0
            ? 'Open Task & Review Audits'
            : 'Open Task & Review Subtasks'
        }
      />

      <NexusFullScreenLoader isOpen={hasSavingTasks} label="Please wait..." />
    </>
  );
};
