'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  taskMapApi,
  TaskMapItem,
  TaskMapOption,
  TaskMapShift,
  UpworkSession,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { TaskMapSidebar } from './TaskMapSidebar';
import { TaskMapHeader } from './TaskMapHeader';
import { TaskMapBoardView } from './TaskMapBoardView';
import { TaskMapAuditingView } from './TaskMapAuditingView';
import { TaskMapCrmView } from './TaskMapCrmView';
import { TaskMapUpworkView } from './TaskMapUpworkView';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { hasCrmAccess } from '@/lib/permissions';

export const TaskMapContainer: React.FC = () => {
  const [tasks, setTasks] = useState<TaskMapItem[]>([]);
  const [availablePool, setAvailablePool] = useState<TaskMapItem[]>([]);
  const [options, setOptions] = useState<TaskMapOption[]>([]);
  const [shifts, setShifts] = useState<TaskMapShift[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [shiftUsers, setShiftUsers] = useState<any[]>([]);
  const [activeUpworkSessions, setActiveUpworkSessions] = useState<UpworkSession[]>([]);
  const [allDbClients, setAllDbClients] = useState<Array<{ id: string; name: string }>>([]);
  const currentUser = useAppStore((s) => s.currentUser);
  const upworkClients = useAppStore((s) => s.upworkClients);
  const spaces = useAppStore((s) => s.spaces);
  const allLists = useAppStore((s) => s.allLists);
  const loadSpaces = useAppStore((s) => s.loadSpaces);

  // Load spaces if not already in store to ensure all sidebar Client Dashboard lists are available
  useEffect(() => {
    if (!spaces || spaces.length === 0) {
      loadSpaces();
    }
  }, [spaces, loadSpaces]);

  // Track pending optimistic status updates to avoid race conditions & background fetch overwrites
  const pendingUpdatesRef = useRef<
    Map<string, { statuses: string[]; timer?: NodeJS.Timeout | null; timestamp: number }>
  >(new Map());

  // Shift, Date, Client & View mode state (defaults to Nov 5, 2026 or today)
  const [currentShift, setCurrentShift] = useState<string>('DAY');
  const [currentDate, setCurrentDate] = useState<string>('2026-11-05');
  const [currentView, setCurrentView] = useState<'BOARD' | 'AUDITING' | 'CRM' | 'UPWORK'>('BOARD');
  const [selectedClient, setSelectedClient] = useState<string>('ALL');
  const [selectedCustomMAs, setSelectedCustomMAs] = useState<string[]>([]);
  const [showAdminTasks, setShowAdminTasks] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');

  const [loading, setLoading] = useState(true);

  // Task Detail Modal
  const [selectedTaskModal, setSelectedTaskModal] = useState<any | null>(null);

  // Fetch data
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const shiftTokens = (currentShift || 'ALL')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const isCustomOnly = shiftTokens.length === 1 && shiftTokens[0] === 'CUSTOM';
      const apiShift = isCustomOnly
        ? 'ALL'
        : shiftTokens.filter((s) => s !== 'CUSTOM').join(',') || 'ALL';

      const res = await taskMapApi.getData({
        shift: apiShift,
        date: currentDate,
        search,
        client: selectedClient !== 'ALL' ? selectedClient : undefined,
      });

      if (res.success) {
        // Sanitize sub-statuses: strip CRM tag (CRM is main board status, not a substatus label)
        const sanitizeStatuses = (statuses?: string[], taskStatus?: string): string[] => {
          if (!statuses || statuses.length === 0) {
            return taskStatus?.toUpperCase().trim() === 'CRM' ? ['To send'] : [];
          }
          const clean = statuses.filter((s) => s.toUpperCase().trim() !== 'CRM');
          if (clean.length > 0) return clean.slice(0, 1);
          if (taskStatus?.toUpperCase().trim() === 'CRM') return ['To send'];
          return [];
        };

        // Merge with local pending optimistic updates so background refreshes never flicker or uncheck
        setTasks(() => {
          const serverTasks = res.tasks || [];
          return serverTasks.map((st) => {
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
          return serverPool.map((st) => {
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
        if (res.maActiveSessions) {
          useAppStore.getState().setMaActiveSessions(res.maActiveSessions);
        }
        if (res.allClients) {
          setAllDbClients(res.allClients);
        }
        if (!currentShift && res.activeShift) {
          setCurrentShift(res.activeShift);
        }
      }
    } catch (err: any) {
      console.error('Failed to load task map data:', err);
      toast.error('Failed to load Task Map data');
    } finally {
      setLoading(false);
    }
  }, [currentShift, currentDate, search, selectedClient]);

  // Initial load & when shift or date changes
  useEffect(() => {
    loadData();
  }, [loadData]);

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
    const handleTaskUpdated = (e: any) => {
      const data = e?.detail || e;
      const taskId = data?.task?.id || data?.id;
      if (taskId && pendingUpdatesRef.current.has(taskId)) {
        return;
      }
      loadData(true);
    };

    const handleTaskMapUpdated = (e: any) => {
      const data = e.detail || e;
      if (!data?.taskId) {
        loadData(true);
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

      const nextStatuses = statuses !== undefined ? statuses : taskMap?.statuses;

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            upworkStartedAt: upworkStartedAt !== undefined ? upworkStartedAt : t.upworkStartedAt,
            upworkSession: upworkSession !== undefined ? upworkSession : t.upworkSession,
            progress: data.progress !== undefined ? data.progress : t.progress,
            taskMap: {
              ...t.taskMap,
              ...(taskMap || {}),
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
            upworkStartedAt: upworkStartedAt !== undefined ? upworkStartedAt : t.upworkStartedAt,
            upworkSession: upworkSession !== undefined ? upworkSession : t.upworkSession,
            progress: data.progress !== undefined ? data.progress : t.progress,
            taskMap: {
              ...t.taskMap,
              ...(taskMap || {}),
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

    window.addEventListener('task:updated', handleTaskUpdated);
    window.addEventListener('task_map:updated', handleTaskMapUpdated);
    window.addEventListener('task:progress_updated', handleProgressUpdated);
    window.addEventListener('task_activity', handleTaskUpdated);
    window.addEventListener('upwork:status_changed', handleUpworkChanged);
    window.addEventListener('ma:session_updated', handleMaSessionUpdated);

    return () => {
      window.removeEventListener('task:updated', handleTaskUpdated);
      window.removeEventListener('task_map:updated', handleTaskMapUpdated);
      window.removeEventListener('task:progress_updated', handleProgressUpdated);
      window.removeEventListener('task_activity', handleTaskUpdated);
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

    // 1. Update Frontend First on both tasks and availablePool immediately
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              upworkStartedAt: optimisticStartedAt,
              upworkSession: optimisticSession,
              taskMap: { ...t.taskMap, statuses: finalStatuses },
            }
          : t
      )
    );

    // Available Tasks pool strictly holds Pending and Revision statuses only.
    // Explicitly exclude Waiting, Recurring, Daily, Weekly, Monthly, and On-Hold tasks.
    const s = (existingTask?.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    const upStatuses = finalStatuses.map((st) => st.toUpperCase().replace(/[\s_-]+/g, ''));
    const isExcluded =
      s === 'WAITING' ||
      s.includes('WAITING') ||
      s === 'DAILY' ||
      s.includes('DAILY') ||
      s === 'WEEKLY' ||
      s.includes('WEEKLY') ||
      s === 'MONTHLY' ||
      s.includes('MONTHLY') ||
      s === 'RECURRING' ||
      s.includes('RECURRING') ||
      s === 'ONHOLD' ||
      s.includes('ONHOLD') ||
      s.includes('HOLD') ||
      !!(existingTask as any)?.recurringConfig ||
      upStatuses.some(
        (st) =>
          ['WAITING', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'ONHOLD'].includes(st) ||
          st.includes('WAITING') ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING') ||
          st.includes('ONHOLD') ||
          st.includes('HOLD')
      );

    const isNowAvailable =
      !isExcluded &&
      (s === 'PENDING' ||
        s === 'REVISION' ||
        upStatuses.includes('PENDING') ||
        upStatuses.includes('REVISION'));

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
    // 1. Optimistically update local tasks & availablePool while tracking previous status for undo/misclick support
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...fields,
              _previousStatus:
                fields.status && fields.status !== t.status
                  ? t.status
                  : (t as any)._previousStatus,
            }
          : t
      )
    );
    setAvailablePool((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...fields,
              _previousStatus:
                fields.status && fields.status !== t.status
                  ? t.status
                  : (t as any)._previousStatus,
            }
          : t
      )
    );

    // 2. Persist to backend
    try {
      await tasksApi.updateTask(taskId, fields as any);
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { id: taskId, ...fields } }));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update task');
      loadData(true);
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

    // 4. Count active tasks for each client (excluding Admin tasks)
    const allPoolAndTasks = [...tasks, ...availablePool];
    const seenTaskIds = new Set<string>();

    for (const t of allPoolAndTasks) {
      if (seenTaskIds.has(t.id)) continue;
      seenTaskIds.add(t.id);

      // Skip admin tasks from client task count
      const folderName = (t.list?.folder?.name || '').toLowerCase();
      const listName = (t.list?.name || '').toLowerCase();
      const isAdmin =
        t.isAdminTask ||
        folderName === 'admin' ||
        folderName.includes('admin') ||
        listName === 'admin';
      if (isAdmin) continue;

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

  // Instant 0ms frontend filtering by selected client
  const displayedTasks = React.useMemo(() => {
    if (selectedClient === 'ALL') return tasks;
    return tasks.filter((t) => {
      const listId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
      return listId === selectedClient || t.list?.name === selectedClient;
    });
  }, [tasks, selectedClient]);

  const displayedPool = React.useMemo(() => {
    if (selectedClient === 'ALL') return availablePool;
    return availablePool.filter((t) => {
      const listId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
      return listId === selectedClient || t.list?.name === selectedClient;
    });
  }, [availablePool, selectedClient]);

  // Compute count of tasks waiting for review / auditing
  const auditingCount = React.useMemo(() => {
    const allPoolAndTasks = [...tasks, ...availablePool];
    const seenIds = new Set<string>();
    let count = 0;
    for (const t of allPoolAndTasks) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      if (t.isClosed) continue;
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
    const list = [...activeUpworkSessions];
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
        list.push({
          taskId: t.id,
          taskTitle: t.title,
          userId: t.assigneeId || '',
          userName,
          pmName: t.progress?.client ? t.progress.client.toUpperCase() : 'UPWORK',
          startedAt: t.progress?.updatedAt || t.upworkStartedAt || new Date().toISOString(),
        });
      }
    }
    return list;
  }, [activeUpworkSessions, tasks, upworkClients]);

  useEffect(() => {
    useAppStore.getState().setActiveUpworkSessions(effectiveUpworkSessions);
  }, [effectiveUpworkSessions]);

  if (loading && tasks.length === 0 && availablePool.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 h-full bg-background text-zinc-400">
        <Loader2 className="size-8 animate-spin text-[#0099ff] mb-3" />
        <p className="text-sm font-medium">Loading Task Map Journal...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-background overflow-hidden select-none">
      {/* 1. Left: Dedicated Date Sidebar (Matches Image 1) */}
      <TaskMapSidebar
        currentDate={currentDate}
        onSelectDate={(newDate) => {
          setCurrentDate(newDate);
        }}
      />

      {/* 2. Right: Main Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
        {/* Above-Header Master Upwork Alert Banner */}
        {effectiveUpworkSessions.length > 0 && (
          <div className="w-full px-6 pt-3 pb-0 shrink-0">
            <div className="w-full flex items-center justify-between gap-3 px-4 py-2 rounded-xl bg-red-950/90 border border-red-700/80 text-white shadow-lg shadow-red-950/50 animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5 truncate text-xs sm:text-sm font-bold tracking-wide">
                <span className="relative flex size-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-2.5 bg-red-500" />
                </span>
                <span className="truncate">
                  {effectiveUpworkSessions.map((s) => {
                    const rawName = s.userName || 'MA';
                    const name = rawName.toUpperCase();
                    const taskName = s.taskTitle ? ` · ${s.taskTitle}` : '';
                    return `⚡ ${name} is actively doing an UPWORK task${taskName}`;
                  }).join('   |   ')}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded bg-white text-zinc-950 shadow-xs">
                  Upwork Active
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Top Header Bar: Date, Day, Shift Pills [All] [Day] [Noon] [Night] [Custom], Client selector, View tabs, Search */}
        <TaskMapHeader
          currentDate={currentDate}
          currentShift={currentShift}
          onShiftChange={setCurrentShift}
          shifts={shifts}
          search={search}
          onSearchChange={setSearch}
          activeUpworkSessions={effectiveUpworkSessions}
          currentView={currentView}
          onViewChange={setCurrentView}
          clients={clients}
          selectedClient={selectedClient}
          onClientChange={setSelectedClient}
          auditingCount={auditingCount}
          availableMAs={availableMAs}
          selectedMAs={selectedCustomMAs}
          onSelectedMAsChange={setSelectedCustomMAs}
          hasCrmAccess={hasCrmAccess(currentUser)}
        />

        {/* Viewport: Board View OR Auditing View OR CRM View OR Upwork Tab View */}
        <div className="flex-1 overflow-hidden">
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
              onOpenDetail={setSelectedTaskModal}
              onDataRefresh={() => loadData(true)}
              showAdminTasks={showAdminTasks}
              onToggleAdminTasks={() => setShowAdminTasks((prev) => !prev)}
              selectedCustomMAs={selectedCustomMAs}
              clients={clients}
              onTaskUpdate={handleTaskUpdate}
            />
          ) : currentView === 'AUDITING' ? (
            <TaskMapAuditingView
              tasks={displayedTasks}
              availablePool={displayedPool}
              options={options}
              allUsers={allUsers}
              shiftUsers={shiftUsers}
              onStatusChange={handleStatusChange}
              onOptionsUpdated={() => loadData(true)}
              onOpenDetail={setSelectedTaskModal}
              onDataRefresh={() => loadData(true)}
              onTaskUpdate={handleTaskUpdate}
            />
          ) : currentView === 'CRM' ? (
            <TaskMapCrmView
              tasks={displayedTasks}
              availablePool={displayedPool}
              options={options}
              allUsers={allUsers}
              shiftUsers={shiftUsers}
              onStatusChange={handleStatusChange}
              onOptionsUpdated={() => loadData(true)}
              onOpenDetail={setSelectedTaskModal}
              onDataRefresh={() => loadData(true)}
              onTaskUpdate={handleTaskUpdate}
              onSwitchToBoard={() => setCurrentView('BOARD')}
            />
          ) : (
            <TaskMapUpworkView
              tasks={displayedTasks}
              availablePool={displayedPool}
              activeUpworkSessions={activeUpworkSessions}
              allUsers={allUsers}
              onStatusChange={handleStatusChange}
              onOpenDetail={setSelectedTaskModal}
              onRefresh={() => loadData(true)}
            />
          )}
        </div>
      </main>

      {/* Task Detail Modal */}
      {selectedTaskModal && (
        <TaskDetailModal
          isOpen={!!selectedTaskModal}
          onClose={() => setSelectedTaskModal(null)}
          task={selectedTaskModal}
          mode="full"
          onUpdateTask={() => loadData(true)}
        />
      )}
    </div>
  );
};
