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
  isSessionProjectBased,
  getDefaultTaskMapSubStatuses,
  isTaskMapItemOnHold,
  toCanonicalTaskStatus,
  applyOptimisticTaskMapAssignment,
  syncTaskPmReviewsWithAssignee,
  markTaskSavingToDb,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
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
const TaskDetailModal = dynamic(
  () => import('@/components/modals/TaskDetailModal').then((m) => m.TaskDetailModal),
  { ssr: false }
);
const UncheckedAuditsModal = dynamic(
  () => import('@/components/modals/UncheckedAuditsModal').then((m) => m.UncheckedAuditsModal),
  { ssr: false }
);
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { hasCrmAccess, canTransitionTaskStatus } from '@/lib/permissions';

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

  // Load spaces & teams if not already in store
  useEffect(() => {
    if (!spaces || spaces.length === 0) {
      loadSpaces();
    }
  }, [spaces, loadSpaces]);

  useEffect(() => {
    if (!workspaceTeams || workspaceTeams.length === 0) {
      loadTeams();
    }
  }, [workspaceTeams?.length, loadTeams]);

  // Auditor Type filter state & dynamic DB roles
  const [auditorTypeFilter, setAuditorTypeFilter] = useState<string>('ALL');
  const auditorRoles = React.useMemo(() => {
    return extractAuditorRoles(workspaceTeams, allUsers);
  }, [workspaceTeams, allUsers]);

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
  const [currentView, setCurrentView] = useState<'BOARD' | 'AUDITING' | 'CRM' | 'UPWORK'>('BOARD');
  const [selectedClients, setSelectedClients] = useState<string[] | 'ALL'>('ALL');
  const [selectedCustomMAs, setSelectedCustomMAs] = useState<string[]>([]);
  const [showAdminTasks, setShowAdminTasks] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');

  // Daily Rollover & Historical Archive State
  const [isHistoryView, setIsHistoryView] = useState<boolean>(false);
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [isRollingOver, setIsRollingOver] = useState<boolean>(false);

  const [loading, setLoading] = useState(true);

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
    if (!silent) setLoading(true);
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
      });

      if (res.success) {
        // Sanitize sub-statuses: strip CRM tag (CRM is main board routing status, not a substatus label)
        // and apply innate default sub-statuses (e.g. 'Available Task' for active Task Map tasks).
        const sanitizeStatuses = (statuses?: string[], taskStatus?: string): string[] => {
          if (!statuses || statuses.length === 0) {
            return getDefaultTaskMapSubStatuses(taskStatus);
          }
          const clean = statuses.filter((s) => s.toUpperCase().trim() !== 'CRM');
          if (clean.length > 0) return clean.slice(0, 1);
          return getDefaultTaskMapSubStatuses(taskStatus);
        };

        // Merge with local pending optimistic updates so background refreshes never flicker or uncheck
        setTasks(() => {
          const serverTasks = res.tasks || [];
          return serverTasks.map((st) => {
            const pendingAssign = pendingAssignRef.current.get(st.id);
            if (pendingAssign && Date.now() - pendingAssign.timestamp < 3500) {
              return pendingAssign.task;
            }
            const pending = pendingUpdatesRef.current.get(st.id);
            const rawStatuses = pending && Date.now() - pending.timestamp < 4000 ? pending.statuses : st.taskMap?.statuses;
            return {
              ...st,
              taskMap: {
                ...st.taskMap,
                statuses: sanitizeStatuses(rawStatuses, st.status),
              },
            };
          });
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
            return {
              ...st,
              taskMap: {
                ...st.taskMap,
                statuses: sanitizeStatuses(rawStatuses, st.status),
              },
            };
          });
        });

        setOptions(res.options || []);
        setShifts(res.shifts || []);
        setAllUsers(res.allUsers || []);
        setShiftUsers(res.shiftUsers || []);
        setActiveUpworkSessions(res.activeUpworkSessions || []);
        if (res.upworkClients) {
          useAppStore.getState().setUpworkClients(res.upworkClients);
        }
        if (res.upworkProjectClients) {
          useAppStore.getState().setUpworkProjectClients(res.upworkProjectClients);
        }
        const enrichedSessions = { ...(res.maActiveSessions || {}) };
        (res.tasks || []).forEach((t: any) => {
          if (t.progress?.maName && t.progress?.timeIn && !t.progress?.timeOut && !t.progress?.isMissingTime) {
            const key = t.progress.maName.toLowerCase().trim();
            if (!enrichedSessions[key]) {
              enrichedSessions[key] = {
                maName: t.progress.maName,
                taskId: t.id,
                timeIn: t.progress.timeIn,
                timeOut: null,
                client: t.progress.client || t.list?.name || 'No client inputted',
                taskName: t.progress.taskDeliverables || t.title || 'No task inputted',
                date: t.progress.date,
                status: t.progress.status || 'In progress',
                isUpwork: Boolean(t.progress.isUpwork),
                rowNumber: t.progress.sheetRow,
                active: true,
              };
            }
          }
        });
        useAppStore.getState().setMaActiveSessions(enrichedSessions);
        if (res.allClients) {
          setAllDbClients(res.allClients);
        }
        if (res.activeShift) {
          setActiveShift(res.activeShift);
        }
        if (!hasManuallySelectedShiftRef.current && res.activeShift && res.activeShift !== currentShift) {
          setCurrentShift(res.activeShift);
        }
        setIsHistoryView(Boolean(res.isHistory));
      }
    } catch (err: any) {
      console.error('Failed to load task map data:', err);
      toast.error('Failed to load Task Map data');
    } finally {
      setLoading(false);
    }
  }, [currentShift, currentDate]);

  // Initial load & when shift or date changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load history dates for journal & ensure Task Map opens on latest date
  useEffect(() => {
    taskMapApi.getHistoryDates().then((res) => {
      if (res.success && res.dates) {
        setHistoryDates(res.dates);
        const latest = res.latestDate || (res.dates.length > 0 ? res.dates[0] : null);
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

  // Clean up pending debounce timers on unmount
  useEffect(() => {
    return () => {
      pendingUpdatesRef.current.forEach((val) => {
        if (val.timer) clearTimeout(val.timer);
      });
    };
  }, []);

  // Auto-refresh every 45 seconds silently
  useEffect(() => {
    const timer = setInterval(() => {
      loadData(true);
    }, 45000);
    return () => clearInterval(timer);
  }, [loadData]);

  // Socket.io & Window events listeners for real-time synchronization
  useEffect(() => {
    let reloadTimer: NodeJS.Timeout | null = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        loadData(true);
      }, 400);
    };

    const handleTaskUpdated = (e: any) => {
      const data = e?.detail || e;
      const task = data?.task || data;
      const taskId = task?.id;
      if (!taskId) {
        scheduleReload();
        return;
      }
      if (pendingUpdatesRef.current.has(taskId)) {
        return;
      }
      // Patch the task in memory to avoid triggering a full network reload
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...task } : t))
      );
      setAvailablePool((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...task } : t))
      );
    };

    const handleTaskMapUpdated = (e: any) => {
      const data = e.detail || e;
      if (!data?.taskId) {
        scheduleReload();
        return;
      }

      const {
        taskId,
        statuses,
        taskMap,
        upworkStartedAt,
        upworkSession,
        activeUpworkSessions: incomingActiveSessions,
      } = data;

      // If this client is actively debouncing a local status change for this task, ignore older broadcast
      const pending = pendingUpdatesRef.current.get(taskId);
      if (pending?.timer) {
        return;
      }

      // If an assignment or handover occurred and a full re-bucket may be needed, trigger a silent sync
      if (data.assigneeId !== undefined || data.handedOver !== undefined) {
        scheduleReload();
      }

      const nextStatuses = statuses !== undefined ? statuses : taskMap?.statuses;
      const nextHandedOver = data.handedOver !== undefined ? data.handedOver : taskMap?.handedOver;

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            assigneeId: data.assigneeId !== undefined ? data.assigneeId : t.assigneeId,
            assignee: data.assignee !== undefined ? data.assignee : t.assignee,
            assignees: data.assignee !== undefined ? (data.assignee ? [data.assignee] : t.assignees) : t.assignees,
            upworkStartedAt: upworkStartedAt !== undefined ? upworkStartedAt : t.upworkStartedAt,
            upworkSession: upworkSession !== undefined ? upworkSession : t.upworkSession,
            progress: data.progress !== undefined ? data.progress : t.progress,
            taskMap: {
              ...t.taskMap,
              ...(taskMap || {}),
              ...(nextHandedOver !== undefined ? { handedOver: nextHandedOver } : {}),
              statuses: nextStatuses !== undefined ? nextStatuses : t.taskMap.statuses,
            },
          };
        })
      );

      setAvailablePool((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            assigneeId: data.assigneeId !== undefined ? data.assigneeId : t.assigneeId,
            assignee: data.assignee !== undefined ? data.assignee : t.assignee,
            assignees: data.assignee !== undefined ? (data.assignee ? [data.assignee] : t.assignees) : t.assignees,
            upworkStartedAt: upworkStartedAt !== undefined ? upworkStartedAt : t.upworkStartedAt,
            upworkSession: upworkSession !== undefined ? upworkSession : t.upworkSession,
            progress: data.progress !== undefined ? data.progress : t.progress,
            taskMap: {
              ...t.taskMap,
              ...(taskMap || {}),
              ...(nextHandedOver !== undefined ? { handedOver: nextHandedOver } : {}),
              statuses: nextStatuses !== undefined ? nextStatuses : t.taskMap.statuses,
            },
          };
        })
      );

      if (incomingActiveSessions) {
        setActiveUpworkSessions(incomingActiveSessions);
      }
    };

    const handleProgressUpdated = (e: any) => {
      const data = e?.detail || e;
      if (!data?.taskId) return;
      const { taskId, progress } = data;
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, progress: progress !== undefined ? progress : t.progress } : t))
      );
      setAvailablePool((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, progress: progress !== undefined ? progress : t.progress } : t))
      );
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
        useAppStore.getState().updateMaActiveSession(data.maName, data);
      }
    };

    const handleShiftsUpdated = () => {
      scheduleReload();
    };

    window.addEventListener('task:updated', handleTaskUpdated);
    window.addEventListener('task_map:updated', handleTaskMapUpdated);
    window.addEventListener('task_map:shifts_updated', handleShiftsUpdated);
    window.addEventListener('audit_shifts:updated', handleShiftsUpdated);
    window.addEventListener('task:progress_updated', handleProgressUpdated);
    window.addEventListener('upwork:status_changed', handleUpworkChanged);
    window.addEventListener('ma:session_updated', handleMaSessionUpdated);

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      window.removeEventListener('task:updated', handleTaskUpdated);
      window.removeEventListener('task_map:updated', handleTaskMapUpdated);
      window.removeEventListener('task_map:shifts_updated', handleShiftsUpdated);
      window.removeEventListener('audit_shifts:updated', handleShiftsUpdated);
      window.removeEventListener('task:progress_updated', handleProgressUpdated);
      window.removeEventListener('upwork:status_changed', handleUpworkChanged);
      window.removeEventListener('ma:session_updated', handleMaSessionUpdated);
    };
  }, [loadData]);

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
    const isHandoverSelected = upStatuses.includes('HANDOVER') || upStatuses.includes('AVAILABLETASK');

    // 1. Update Frontend First on both tasks and availablePool immediately
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
            ...t,
            ...(isHandoverSelected ? { assigneeId: null, assignee: null } : {}),
            upworkStartedAt: optimisticStartedAt,
            upworkSession: optimisticSession,
            taskMap: {
              ...t.taskMap,
              ...(isHandoverSelected ? { handedOver: true } : {}),
              statuses: finalStatuses,
            },
          }
          : t
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
          ['WAITING', 'CRM', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'INREVIEW', 'TOREVIEW', 'CHECKING', 'INCHECKING'].includes(st) ||
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
      const exists = prev.some((t) => t.id === taskId);
      if (!isNowAvailable) {
        return prev.filter((t) => t.id !== taskId);
      }
      if (exists) {
        return prev.map((t) =>
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
            upworkStartedAt: optimisticStartedAt,
            upworkSession: optimisticSession,
            taskMap: { ...existingTask.taskMap, statuses: finalStatuses },
          },
          ...prev,
        ];
      }
      return prev;
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
        const res = await taskMapApi.updateTaskStatuses(taskId, finalStatuses);
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
        ...(isMovingToAvailable ? { assigneeId: null, assignee: null, assignees: [] } : {}),
        ...(matchedTargetUser
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
          ...(nextHandedOverState !== undefined ? { handedOver: nextHandedOverState } : {}),
        },
        _previousStatus: resolvePrevStatus(t),
      } as TaskMapItem;
    };

    if (currentTask) {
      pendingAssignRef.current.set(taskId, {
        task: buildUpdatedTaskItem(currentTask),
        targetUserId: normalizedFields.assigneeId !== undefined ? normalizedFields.assigneeId : currentTask.assigneeId || null,
        timestamp: Date.now(),
      });
    }

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? buildUpdatedTaskItem(t) : t))
    );

    setAvailablePool((prev) => {
      if (isMovingOutOfAvailable) {
        return prev.filter((t) => t.id !== taskId);
      }
      const exists = prev.some((t) => t.id === taskId);
      if (exists) {
        return prev.map((t) => (t.id === taskId ? buildUpdatedTaskItem(t) : t));
      }
      if (isMovingToAvailable && currentTask) {
        return [...prev, buildUpdatedTaskItem(currentTask)];
      }
      return prev;
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

  // Handler for optimistic drag-and-drop task assignment on Task Map Board View
  const handleAssignTask = async (
    taskId: string,
    targetUserId: string | null,
    mode: 'IN_PROGRESS' | 'QUEUE' = 'QUEUE'
  ) => {
    const currentTask = [...tasks, ...availablePool].find((t) => t.id === taskId);
    if (!currentTask) return;

    const targetUser = targetUserId
      ? [...allUsers, ...shiftUsers].find((u) => u && u.id === targetUserId) || {
          id: targetUserId,
          name: 'Team Member',
        }
      : null;

    const optimisticTask = applyOptimisticTaskMapAssignment(currentTask, targetUser, mode);
    pendingAssignRef.current.set(taskId, {
      task: optimisticTask,
      targetUserId,
      timestamp: Date.now(),
    });

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
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === taskId);
      const mapped = prev.map((t) => {
        if (t.id === taskId) return optimisticTask;
        return demoteDisplacedInProgress(t);
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
      await taskMapApi.assignTask(taskId, targetUserId, mode);
      setTimeout(() => {
        pendingAssignRef.current.delete(taskId);
      }, 2000);
      loadData(true);
    } catch (err: any) {
      pendingAssignRef.current.delete(taskId);
      toast.error(err?.message || 'Failed to update task assignment');
      loadData(true);
      throw err;
    }
  };

  // Compute distinct clients from "Client Dashboard" in sidebar/database and their active task counts
  const clients = React.useMemo(() => {
    const clientMap = new Map<string, { id: string; name: string; count: number }>();

    // 1. Seed from all lists under "Client Dashboard" folders/spaces (matching the sidebar)
    const walkFolders = (folders: any[], inClientTree = false) => {
      for (const f of folders || []) {
        const isClient = inClientTree || (f.name || '').trim().toLowerCase().includes('client dashboard');
        if (isClient) {
          (f.lists || []).forEach((l: any) => {
            if (!clientMap.has(l.id)) {
              clientMap.set(l.id, { id: l.id, name: l.name, count: 0 });
            }
          });
        }
        if (f.subfolders) walkFolders(f.subfolders, isClient);
      }
    };

    for (const s of spaces || []) {
      const isClientSpace = (s.name || '').trim().toLowerCase().includes('client dashboard');
      if (isClientSpace) {
        (s.lists || []).forEach((l: any) => {
          if (!clientMap.has(l.id)) {
            clientMap.set(l.id, { id: l.id, name: l.name, count: 0 });
          }
        });
      }
      walkFolders(s.folders || [], isClientSpace);
    }

    // 2. Also merge from allLists in store (which contains spaceName and folderName for every list)
    for (const item of allLists || []) {
      const folderName = (item.folderName || '').toLowerCase();
      const spaceName = (item.spaceName || '').toLowerCase();
      if (folderName.includes('client dashboard') || spaceName.includes('client dashboard')) {
        const l = item.list;
        if (l && !clientMap.has(l.id)) {
          clientMap.set(l.id, { id: l.id, name: l.name, count: 0 });
        }
      }
    }

    // 3. Also merge clients fetched directly from database API
    for (const c of allDbClients) {
      if (!clientMap.has(c.id)) {
        clientMap.set(c.id, { id: c.id, name: c.name, count: 0 });
      }
    }

    // Admin list names from sidebar Admin folder
    const ADMIN_LIST_NAMES = new Set([
      'admin | jenesia red',
      'harmony',
      'jenesia red',
      'jenesia red | personal',
      'snaply',
      'vip scale',
      'xfnite',
    ]);

    const isTaskUnderAdmin = (t: TaskMapItem): boolean => {
      if (t.isAdminTask) return true;
      const folderName = (t.list?.folder?.name || '').trim().toLowerCase();
      const listName = (t.list?.name || '').trim().toLowerCase();
      if (folderName === 'admin' || folderName.includes('admin') || listName === 'admin') return true;
      if (ADMIN_LIST_NAMES.has(listName)) return true;
      return false;
    };

    // 4. Count active tasks for each client (excluding Admin tasks)
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

  // Compute Admin tasks count and distinct Admin folder clients
  const { adminTasksCount, adminClients } = React.useMemo(() => {
    const ADMIN_LIST_NAMES = new Set([
      'admin | jenesia red',
      'harmony',
      'jenesia red',
      'jenesia red | personal',
      'snaply',
      'vip scale',
      'xfnite',
    ]);

    const isTaskUnderAdmin = (t: TaskMapItem): boolean => {
      if (t.isAdminTask) return true;
      const folderName = (t.list?.folder?.name || '').trim().toLowerCase();
      const listName = (t.list?.name || '').trim().toLowerCase();
      if (folderName === 'admin' || folderName.includes('admin') || listName === 'admin') return true;
      if (ADMIN_LIST_NAMES.has(listName)) return true;
      return false;
    };

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

  // Instant 0ms frontend filtering by selected clients and showAdminTasks
  const isTaskVisible = React.useCallback(
    (t: TaskMapItem) => {
      const ADMIN_LIST_NAMES = new Set([
        'admin | jenesia red',
        'harmony',
        'jenesia red',
        'jenesia red | personal',
        'snaply',
        'vip scale',
        'xfnite',
      ]);
      const folderName = (t.list?.folder?.name || '').trim().toLowerCase();
      const listName = (t.list?.name || '').trim().toLowerCase();
      const isAdmin =
        t.isAdminTask ||
        folderName === 'admin' ||
        folderName.includes('admin') ||
        listName === 'admin' ||
        ADMIN_LIST_NAMES.has(listName);

      // Hide all admin tasks by default unless showAdminTasks is toggled ON.
      // (Their active work is represented cleanly via the General Task block in the user's column)
      if (isAdmin && !showAdminTasks) return false;

      if (selectedClients === 'ALL') {
        return true;
      }

      if (Array.isArray(selectedClients)) {
        const listId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
        const lName = t.list?.name || 'General';
        const matchesClient = selectedClients.includes(listId) || selectedClients.includes(lName);
        if (!matchesClient) return false;
      }

      return true;
    },
    [showAdminTasks, selectedClients]
  );

  const displayedTasks = React.useMemo(() => {
    return tasks.filter(isTaskVisible);
  }, [tasks, isTaskVisible]);

  const displayedPool = React.useMemo(() => {
    return availablePool.filter(isTaskVisible);
  }, [availablePool, isTaskVisible]);

  // Compute count of tasks waiting for review / auditing
  const auditingCount = React.useMemo(() => {
    const allPoolAndTasks = [...tasks, ...availablePool];
    const seenIds = new Set<string>();
    let count = 0;
    for (const t of allPoolAndTasks) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      if (t.isClosed || isTaskMapItemOnHold(t)) continue;
      const s = (t.status || '').toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
        x.toUpperCase().replace(/[\s_-]+/g, '')
      );
      if (
        s === 'TOREVIEW' ||
        s === 'INREVIEW' ||
        mapStatuses.includes('TOREVIEW') ||
        mapStatuses.includes('INREVIEW') ||
        mapStatuses.includes('CHE') ||
        mapStatuses.includes('PAU') ||
        mapStatuses.includes('HAN')
      ) {
        count++;
      }
    }
    return count;
  }, [tasks, availablePool]);

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

  const isInitialBoardLoading = loading && tasks.length === 0 && availablePool.length === 0;
  const showJournalLoader = isInitialBoardLoading && !selectedTaskModal && !restoringUrlTask;

  return (
    <>
      {showJournalLoader ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 h-full bg-background text-zinc-400">
          <Loader2 className="size-8 animate-spin text-[#0099ff] mb-3" />
          <p className="text-sm font-medium">Loading Task Map Journal...</p>
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
        {/* Historical Archive Banner */}
        {isHistoryView && (
          <div className="w-full px-6 pt-3 pb-0 shrink-0">
            <div className="w-full flex items-center justify-between gap-3 px-4 py-2 rounded-xl bg-purple-950/40 border border-purple-800/60 text-purple-200 shadow-md">
              <div className="flex items-center gap-2.5 text-xs sm:text-sm font-medium">
                <span className="text-base">📜</span>
                <span>
                  <strong>Historical Journal Archive</strong> · Viewing preserved board from{' '}
                  <span className="text-purple-300 font-semibold">{currentDate}</span>. Tasks and statuses are retained as they were.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  userSelectedDateRef.current = false;
                  const latest = historyDates[0] || getTodayDateStr();
                  setCurrentDate(latest);
                }}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors cursor-pointer shrink-0"
              >
                Return to Today
              </button>
            </div>
          </div>
        )}

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
          onViewChange={setCurrentView}
          clients={clients}
          adminClients={adminClients}
          adminCount={adminTasksCount}
          showAdmin={showAdminTasks}
          onToggleAdmin={() => setShowAdminTasks((prev) => !prev)}
          selectedClients={selectedClients}
          onSelectClients={setSelectedClients}
          auditingCount={auditingCount}
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
        />

        {/* Viewport: Board View OR Auditing View OR CRM View OR Upwork Tab View */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {currentView === 'BOARD' ? (
            <TaskMapBoardView
              tasks={displayedTasks}
              availablePool={displayedPool}
              options={options}
              allUsers={allUsers}
              shiftUsers={shiftUsers}
              currentShift={currentShift}
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
              isHistory={isHistoryView}
              search={search}
            />
          ) : currentView === 'AUDITING' ? (
            <TaskMapAuditingView
              tasks={displayedTasks.filter((t) => !t.isSubtask)}
              availablePool={displayedPool.filter((t) => !t.isSubtask)}
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
              onSwitchToBoard={() => setCurrentView('BOARD')}
              clients={clients}
              showAdminTasks={showAdminTasks}
              onToggleAdminTasks={() => setShowAdminTasks((prev) => !prev)}
              search={search}
            />
          ) : (
            <TaskMapUpworkView
              tasks={displayedTasks.filter((t) => !t.isSubtask)}
              availablePool={displayedPool.filter((t) => !t.isSubtask)}
              activeUpworkSessions={activeUpworkSessions}
              allUsers={allUsers}
              onStatusChange={handleStatusChange}
              onOpenDetail={handleOpenTaskDetail}
              onRefresh={() => loadData(true)}
            />
          )}
        </div>
      </main>
        </div>
      )}

      {/* Task Detail Modal */}
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
    </>
  );
};
