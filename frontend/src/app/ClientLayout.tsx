'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useAppStore } from '@/lib/store';
import { useEffect, useRef, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { authApi } from '@/api';
import { notificationsApi } from '@/api/notifications';
import { taskMapApi } from '@/api/taskMap';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { MentionConfetti } from '@/components/ui/MentionConfetti';
import { DraftBeggingReminder } from '@/components/ui/DraftBeggingReminder';
import { io } from 'socket.io-client';
import { API_BASE_URL } from '@/api';
import { initPerfMonitor, isPerfEnabled, markNavigation, recordSocketEvent } from '@/lib/perfMonitor';
import { formatTabTitle, resolveRouteTitle, updateFaviconBadge } from '@/lib/tabManager';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';
import { applyTheme, getStoredTheme } from '@/lib/theme';
import { playNotificationSound, preloadCustomSound } from '@/lib/soundNotification';
import { initGlobalTaskNewTabListeners } from '@/lib/taskNavigation';
import { normalizeAuditName, isNexusAuditChecklist } from '@/lib/auditChecklist';

const GalaxyTaskModal = dynamic(
  () => import('@/components/modals/GalaxyTaskModal').then((mod) => mod.GalaxyTaskModal),
  { ssr: false },
);

// Global guard for browsers/Next.js devtools releasing inactive pointer capture
if (typeof window !== 'undefined' && typeof Element !== 'undefined' && Element.prototype.releasePointerCapture) {
  const origReleasePointerCapture = Element.prototype.releasePointerCapture;
  Element.prototype.releasePointerCapture = function (pointerId: number) {
    try {
      if (typeof this.hasPointerCapture === 'function' && !this.hasPointerCapture(pointerId)) {
        return;
      }
      return origReleasePointerCapture.call(this, pointerId);
    } catch {
      // Gracefully ignore DOMException when pointerId was already released by browser
    }
  };
}

function TabTitleSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    pageTitle,
    modalTitle,
    setPageTitle,
    setModalTitle,
    spaces,
    allLists,
    allDocs,
    tasksIndex,
    unreadNotifications,
  } = useAppStore();

  // Reset titles on navigation if pathname changes
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      setModalTitle(null);
      setPageTitle(null);
    }
  }, [pathname, setModalTitle, setPageTitle]);

  // Compute and apply dynamic tab title
  useEffect(() => {
    const fallback = resolveRouteTitle(pathname, searchParams, { spaces, allLists, allDocs, tasksIndex });
    const effectiveTitle = modalTitle || pageTitle || fallback;
    const formatted = formatTabTitle(effectiveTitle);
    if (document.title !== formatted) {
      document.title = formatted;
    }
  }, [pathname, searchParams, modalTitle, pageTitle, spaces, allLists, allDocs, tasksIndex]);

  // Dynamic Favicon Notification Badge
  useEffect(() => {
    updateFaviconBadge(unreadNotifications > 0);
  }, [unreadNotifications]);

  return null;
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    spaces,
    loadSpaces,
    loadingSpaces,
    hydrateFromCache,
    hydrateTasksFromCache,
    currentUser,
    setCurrentUser,
    setAuthStatus,
    resetStore,
    setUnreadNotifications,
    loadDrafts,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
    isGalaxyModalOpen,
    galaxyModalData,
    closeGalaxyModal,
  } = useAppStore();

  useEffect(() => {
    const handler = (e: any) => {
      useAppStore.getState().openGalaxyModal(e?.detail);
    };
    window.addEventListener('nexus:open-galaxy-task', handler);
    return () => window.removeEventListener('nexus:open-galaxy-task', handler);
  }, []);

  // Track when spaces were last fetched so we don't refetch on every navigation.
  // Spaces are considered stale after 5 minutes.
  const lastSpacesFetchRef = useRef<number>(0);
  const SPACES_STALE_MS = 5 * 60 * 1000;

  // Opt-in performance monitor (?perf=1): logs request timings, freezes and memory to the console
  useEffect(() => {
    initPerfMonitor();
  }, []);

  // Global capture listeners for Ctrl+RightClick, Ctrl+Click, and MiddleClick to open tasks in new tab
  useEffect(() => {
    return initGlobalTaskNewTabListeners();
  }, []);

  useEffect(() => {
    markNavigation(pathname);
    if (isMobileSidebarOpen) {
      setMobileSidebarOpen(false);
    }
  }, [pathname]);

  // Synchronize active theme for current user
  useEffect(() => {
    const config = getStoredTheme(currentUser?.id);
    applyTheme(config);
  }, [currentUser?.id]);

  // Preload custom notification sound for instantaneous playback
  useEffect(() => {
    if (currentUser?.notificationPreferences?.soundUrl) {
      preloadCustomSound(currentUser.notificationPreferences.soundUrl);
    }
  }, [currentUser?.notificationPreferences?.soundUrl]);

  // Deployment Auto-Recovery: Reload immediately if old chunks fail to load after a new deployment
  useEffect(() => {
    const handleChunkError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const error = 'error' in event ? event.error : (event as PromiseRejectionEvent).reason;
      const msg = error?.message || (typeof error === 'string' ? error : '');
      if (
        msg.includes('Loading chunk') ||
        msg.includes('ChunkLoadError') ||
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed')
      ) {
        console.warn('[Deployment Sync] Stale chunk detected, reloading latest code...', msg);
        const lastReload = sessionStorage.getItem('nexus_chunk_reload');
        const now = Date.now();
        if (!lastReload || now - Number(lastReload) > 10000) {
          sessionStorage.setItem('nexus_chunk_reload', String(now));
          window.location.reload();
        }
      }
    };

    window.addEventListener('error', handleChunkError);
    window.addEventListener('unhandledrejection', handleChunkError);
    return () => {
      window.removeEventListener('error', handleChunkError);
      window.removeEventListener('unhandledrejection', handleChunkError);
    };
  }, []);

  // Tab Focus Version Sync: If tab was left open across deployments, verify version when user returns
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetch(`${API_BASE_URL}/api/version?_t=${Date.now()}`, { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!data?.deployId) return;
            const currentDeploy = sessionStorage.getItem('nexus_server_deploy_id');
            if (currentDeploy && currentDeploy !== data.deployId) {
              sessionStorage.setItem('nexus_server_deploy_id', data.deployId);
              window.location.reload();
            }
          })
          .catch(() => { });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Auth Gate & Session Verification (with deep-link persistence & sliding refresh)
  useEffect(() => {
    if (pathname === '/login') {
      return;
    }

    if (!currentUser) {
      setAuthStatus('loading');
      authApi
        .session()
        .then((sess) => {
          if (!sess.authenticated || !sess.user) {
            throw new Error('Unauthenticated session');
          }

          setCurrentUser(sess.user);
          setAuthStatus('authenticated');
          // Only hydrate sensitive cached spaces and tasks once authenticated
          hydrateFromCache();
          hydrateTasksFromCache();

          // Fetch fresh spaces
          lastSpacesFetchRef.current = Date.now();
          loadSpaces();
          loadDrafts();

          notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then((res) => {
            setUnreadNotifications(res.unreadCount ?? res.notifications.filter((n) => !n.isRead).length);
            if (typeof res.taskMapUnreadCount === 'number') {
              useAppStore.getState().setTaskMapUnreadCount(res.taskMapUnreadCount);
            }
          }).catch(() => { });
        })
        .catch(() => {
          // Truly unauthenticated or session revoked — preserve destination link so login returns to it
          resetStore();
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            const currentPath = window.location.pathname + window.location.search + window.location.hash;
            const returnTo = currentPath && currentPath !== '/' ? `?returnTo=${encodeURIComponent(currentPath)}` : '';
            window.location.replace(`/login${returnTo}`);
          }
        });
      return;
    }

    // When already authenticated, only refetch spaces when stale
    if (!loadingSpaces) {
      const isStale = Date.now() - lastSpacesFetchRef.current > SPACES_STALE_MS;
      if (isStale) {
        lastSpacesFetchRef.current = Date.now();
        loadSpaces();
      }
    }
  }, [pathname, currentUser]);

  // Active User Activity Tracking & Session Sliding Expiration
  // ("proper handling of the session when it ends or not like if the user moved the mouse and etc")
  useEffect(() => {
    if (!currentUser?.id || pathname === '/login') return;

    let lastTouchAt = Date.now();
    let isIdle = false;
    const TOUCH_INTERVAL_MS = 2 * 60 * 1000; // Touch backend at most every 2 minutes while actively working
    const IDLE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes without interaction marks idle
    const MAX_IDLE_TIMEOUT_MS = 12 * 3600 * 1000; // 12 hours of total inactivity before session ends

    let idleCheckInterval: NodeJS.Timeout | null = null;

    const handleUserActivity = () => {
      const now = Date.now();
      const timeSinceLastTouch = now - lastTouchAt;

      // If user was away/idle (e.g. went to CR for 10-15 mins) and just moved mouse:
      if (isIdle) {
        isIdle = false;
        // Verify and refresh session immediately upon returning from idle
        authApi.session().then((sess) => {
          if (!sess.authenticated) {
            // Session was revoked or expired while away
            resetStore();
            const currentPath = window.location.pathname + window.location.search + window.location.hash;
            const returnTo = currentPath && currentPath !== '/' ? `?returnTo=${encodeURIComponent(currentPath)}` : '';
            window.location.replace(`/login${returnTo}`);
          } else if (sess.user) {
            setCurrentUser(sess.user);
          }
        }).catch(() => { });
        lastTouchAt = now;
        return;
      }

      // While continuously active, throttle session touch to once every 2 minutes
      if (timeSinceLastTouch >= TOUCH_INTERVAL_MS) {
        lastTouchAt = now;
        authApi.touchSession().catch(() => { });
      }
    };

    // Periodic check to mark idle or expire session after prolonged inactivity
    idleCheckInterval = setInterval(() => {
      const elapsed = Date.now() - lastTouchAt;
      if (elapsed > IDLE_THRESHOLD_MS && !isIdle) {
        isIdle = true;
      }
      if (elapsed > MAX_IDLE_TIMEOUT_MS) {
        // Extended idle timeout (12h) — cleanly end session
        resetStore();
        const currentPath = window.location.pathname + window.location.search + window.location.hash;
        const returnTo = currentPath && currentPath !== '/' ? `?returnTo=${encodeURIComponent(currentPath)}` : '';
        window.location.replace(`/login${returnTo}`);
      }
    }, 60 * 1000);

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'focus'];
    events.forEach((ev) => window.addEventListener(ev, handleUserActivity, { passive: true }));

    return () => {
      if (idleCheckInterval) clearInterval(idleCheckInterval);
      events.forEach((ev) => window.removeEventListener(ev, handleUserActivity));
    };
  }, [currentUser?.id, pathname]);

  // Preload custom or sample notification sound for instant zero-lag playback
  useEffect(() => {
    if (currentUser?.notificationPreferences?.soundUrl) {
      preloadCustomSound(currentUser.notificationPreferences.soundUrl);
    }
  }, [currentUser?.notificationPreferences?.soundUrl]);

  // Global Socket Connection for Real-time Notifications & Force Logout
  useEffect(() => {
    if (!currentUser?.id) return;

    const s = io(API_BASE_URL, { withCredentials: true });
    s.on('connect', () => {
      s.emit('join_user', currentUser.id);
      notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then((res) => {
        if (typeof res.taskMapUnreadCount === 'number') {
          useAppStore.getState().setTaskMapUnreadCount(res.taskMapUnreadCount);
        }
        if (typeof res.unreadCount === 'number') {
          const lastViewed =
            typeof window !== 'undefined'
              ? parseInt(localStorage.getItem('nexus_notif_last_viewed') || '0', 10)
              : 0;
          const latestNotif = res.notifications?.[0];
          const hasUnseen =
            latestNotif &&
            !latestNotif.isRead &&
            new Date(latestNotif.createdAt).getTime() > lastViewed;
          if (hasUnseen) {
            setUnreadNotifications(res.unreadCount);
          } else {
            setUnreadNotifications(0);
          }
        }
      }).catch(() => { });
      taskMapApi.getUpworkActiveSessions().then((res) => {
        if (res?.activeUpworkSessions) {
          useAppStore.getState().setActiveUpworkSessions(res.activeUpworkSessions);
        }
      }).catch(() => { });
      taskMapApi.getUpworkClients().then((res) => {
        if (res?.clients) {
          useAppStore.getState().setUpworkClients(res.clients);
        }
        if (res?.projectClients) {
          useAppStore.getState().setUpworkProjectClients(res.projectClients);
        }
      }).catch(() => { });
    });
    if (isPerfEnabled()) s.onAny((event) => recordSocketEvent(event));

    // Handle server deployment notifications to ensure latest code is executed across all PCs
    s.on('system:deploy_info', (data: { deployId: string }) => {
      if (!data?.deployId) return;
      const storedDeploy = sessionStorage.getItem('nexus_server_deploy_id');
      if (!storedDeploy) {
        sessionStorage.setItem('nexus_server_deploy_id', data.deployId);
      } else if (storedDeploy !== data.deployId) {
        console.info('[Deployment Sync] New server deployment detected, refreshing to load latest code...', data.deployId);
        sessionStorage.setItem('nexus_server_deploy_id', data.deployId);
        const isEditing = typeof document !== 'undefined' && document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
        if (!isEditing) {
          window.location.reload();
        }
      }
    });

    // Instant cross-app logout event dispatched by backend when tools/viptools logs out
    s.on('force_logout', () => {
      resetStore();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    });

    // The server emits notification_received for every TaskNotification row, but the cowbell only shows
    // "For Me" notifications (forMeCondition in notification.controller). Only chime when the filtered
    // unread count actually grows, so users never hear a sound for a notification they can't see.
    // Debounce socket-triggered badge polls so burst sweeps (e.g. CRM follow-ups) collapse into one request.
    let lastSoundAt = 0;
    let notifPollTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingSoundCheck = false;
    let pendingNotifType: string | undefined;

    const scheduleNotifBadgeRefresh = (options?: { checkSound?: boolean; notifType?: string; checkLastViewed?: boolean }) => {
      if (options?.checkSound) {
        pendingSoundCheck = true;
        if (options.notifType) pendingNotifType = options.notifType;
      }
      if (notifPollTimer) clearTimeout(notifPollTimer);
      notifPollTimer = setTimeout(() => {
        notifPollTimer = null;
        const shouldCheckSound = pendingSoundCheck;
        const notifType = pendingNotifType;
        pendingSoundCheck = false;
        pendingNotifType = undefined;

        const prevUnread = useAppStore.getState().unreadNotifications;
        notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then((res) => {
          if (typeof res.taskMapUnreadCount === 'number') {
            useAppStore.getState().setTaskMapUnreadCount(res.taskMapUnreadCount);
          }
          if (typeof res.unreadCount !== 'number') return;

          if (options?.checkLastViewed) {
            const lastViewed =
              typeof window !== 'undefined'
                ? parseInt(localStorage.getItem('nexus_notif_last_viewed') || '0', 10)
                : 0;
            const latestNotif = res.notifications?.[0];
            const hasUnseen =
              latestNotif &&
              !latestNotif.isRead &&
              new Date(latestNotif.createdAt).getTime() > lastViewed;
            setUnreadNotifications(hasUnseen ? res.unreadCount : 0);
          } else {
            setUnreadNotifications(res.unreadCount);
          }

          if (shouldCheckSound) {
            const now = Date.now();
            if (res.unreadCount > prevUnread && now - lastSoundAt > 1500) {
              lastSoundAt = now;
              const resolvedType = res.notifications?.[0]?.type || notifType;
              playNotificationSound(undefined, undefined, undefined, resolvedType);
            }
          }
        }).catch(() => { });
      }, 400);
    };

    s.on('notification_received', (data?: { type?: string;[key: string]: any }) => {
      window.dispatchEvent(new CustomEvent('notification_received', { detail: data }));
      scheduleNotifBadgeRefresh({ checkSound: true, notifType: data?.type });
    });

    s.on('notification_read', (data: { id: string }) => {
      useAppStore.getState().decrementUnreadNotifications();
      scheduleNotifBadgeRefresh();
      window.dispatchEvent(new CustomEvent('notification_read', { detail: data }));
    });

    s.on('notifications_all_read', () => {
      setUnreadNotifications(0);
      useAppStore.getState().setTaskMapUnreadCount(0);
      window.dispatchEvent(new CustomEvent('notifications_all_read'));
    });

    s.on('task_map_notifications_read', () => {
      useAppStore.getState().setTaskMapUnreadCount(0);
      window.dispatchEvent(new CustomEvent('task_map_notifications_read'));
    });

    s.on('notification_cleared', (data: { id: string }) => {
      window.dispatchEvent(new CustomEvent('notification_cleared', { detail: data }));
    });

    s.on('notifications_all_cleared', () => {
      setUnreadNotifications(0);
      useAppStore.getState().setTaskMapUnreadCount(0);
      window.dispatchEvent(new CustomEvent('notifications_all_cleared'));
    });

    s.on('task_activity', (data: any) => {
      window.dispatchEvent(new CustomEvent('task_activity', { detail: data }));
      if (data?.activity?.type === 'status_change' && data?.taskId && data?.activity?.newStatus) {
        if (!data.activity.subtaskId && !data.activity.subtaskTitle) {
          useAppStore.getState().updateTask({ id: data.taskId, status: data.activity.newStatus } as any);
          window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: { id: data.taskId, status: data.activity.newStatus } } }));
        }
      }
    });

    s.on('task:comment_added', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:comment_added', { detail: payload }));
    });

    s.on('task:comment_updated', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:comment_updated', { detail: payload }));
    });

    s.on('task:comment_deleted', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:comment_deleted', { detail: payload }));
      scheduleNotifBadgeRefresh({ checkLastViewed: true });
    });

    s.on('otp:used', (payload: any) => {
      window.dispatchEvent(new CustomEvent('otp:used', { detail: payload }));
    });

    s.on('task:comment_reaction', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:comment_reaction', { detail: payload }));
    });

    s.on('task:checklist_created', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:checklist_created', { detail: payload }));
    });

    s.on('task:checklist_item_created', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:checklist_item_created', { detail: payload }));
      if (payload?.taskId && payload?.item) {
        const store = useAppStore.getState();
        const existingTask = store.tasks.find((t: any) => t.id === payload.taskId);
        if (existingTask) {
          const normText = normalizeAuditName((payload.item.text || '').replace(/^!\s*/, ''));
          const updateLists = (lists: any[] = []) => lists.map((c: any) => {
            const isAudit = isNexusAuditChecklist(c) || c.name?.trim().toLowerCase() === 'audit';
            if (c.id === payload.checklistId || isAudit) {
              const hasItem = (c.items || []).some((i: any) => i.id === payload.item.id || (isAudit && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normText));
              const items = hasItem
                ? (c.items || []).map((i: any) => (i.id === payload.item.id || (isAudit && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normText)) ? { ...i, ...payload.item } : i)
                : [...(c.items || []), payload.item];
              return { ...c, items };
            }
            return c;
          });

          if (payload.subtaskId) {
            const subtasks = (existingTask.subtasks || []).map((st: any) =>
              st.id === payload.subtaskId ? { ...st, checklists: updateLists(st.checklists) } : st
            );
            store.updateTask({ ...existingTask, subtasks });
          } else {
            store.updateTask({ ...existingTask, checklists: updateLists(existingTask.checklists) });
          }
        }
      }
    });

    s.on('task:checklist_item_updated', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:checklist_item_updated', { detail: payload }));
      if (payload?.taskId && payload?.item) {
        const store = useAppStore.getState();
        const existingTask = store.tasks.find((t: any) => t.id === payload.taskId);
        if (existingTask) {
          const normText = normalizeAuditName((payload.item.text || '').replace(/^!\s*/, ''));
          const updateLists = (lists: any[] = []) => lists.map((c: any) => {
            const isAudit = isNexusAuditChecklist(c) || c.name?.trim().toLowerCase() === 'audit';
            if (c.id === payload.checklistId || isAudit) {
              const hasItem = (c.items || []).some((i: any) => i.id === payload.item.id || (isAudit && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normText));
              const items = hasItem
                ? (c.items || []).map((i: any) => (i.id === payload.item.id || (isAudit && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normText)) ? { ...i, ...payload.item } : i)
                : [...(c.items || []), payload.item];
              return { ...c, items };
            }
            return c;
          });

          if (payload.subtaskId) {
            const subtasks = (existingTask.subtasks || []).map((st: any) =>
              st.id === payload.subtaskId ? { ...st, checklists: updateLists(st.checklists) } : st
            );
            store.updateTask({ ...existingTask, subtasks });
          } else {
            store.updateTask({ ...existingTask, checklists: updateLists(existingTask.checklists) });
          }
        }
      }
    });

    s.on('task:checklist_item_deleted', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:checklist_item_deleted', { detail: payload }));
      if (payload?.taskId && (payload?.itemId || payload?.text)) {
        const store = useAppStore.getState();
        const existingTask = store.tasks.find((t: any) => t.id === payload.taskId);
        if (existingTask) {
          const normText = payload.text ? normalizeAuditName((payload.text || '').replace(/^!\s*/, '')) : null;
          const filterLists = (lists: any[] = []) => lists.map((c: any) => {
            const isAudit = isNexusAuditChecklist(c) || c.name?.trim().toLowerCase() === 'audit';
            if (c.id === payload.checklistId || isAudit) {
              const items = (c.items || []).filter((i: any) => {
                if (payload.itemId && i.id === payload.itemId) return false;
                if (isAudit && normText && normalizeAuditName((i.text || '').replace(/^!\s*/, '')) === normText) return false;
                return true;
              });
              return { ...c, items };
            }
            return c;
          });

          if (payload.subtaskId) {
            const subtasks = (existingTask.subtasks || []).map((st: any) =>
              st.id === payload.subtaskId ? { ...st, checklists: filterLists(st.checklists) } : st
            );
            store.updateTask({ ...existingTask, subtasks });
          } else {
            store.updateTask({ ...existingTask, checklists: filterLists(existingTask.checklists) });
          }
        }
      }
    });

    s.on('task:checklist_deleted', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:checklist_deleted', { detail: payload }));
    });

    s.on('task:created', (task) => {
      useAppStore.getState().addTask(task);
      window.dispatchEvent(new CustomEvent('task:created', { detail: { task } }));
    });

    s.on('task:updated', (task) => {
      useAppStore.getState().updateTask(task);
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task } }));
    });

    s.on('upwork:status_changed', (data) => {
      window.dispatchEvent(new CustomEvent('upwork:status_changed', { detail: data }));
      if (data?.taskId) {
        useAppStore.getState().setActiveUpworkSessions((prev) => {
          if (data.active) {
            const idx = prev.findIndex((x) => x.taskId === data.taskId);
            const sessionItem = {
              taskId: data.taskId,
              taskTitle: data.taskTitle || 'Task',
              userId: data.userId || '',
              userName: data.userName || 'MA Member',
              pmName: data.clientName || data.pmName || 'UPWORK',
              clientName: data.clientName || data.pmName || 'UPWORK',
              timeIn: data.timeIn,
              date: data.date,
              startedAt: data.startedAt || new Date().toISOString(),
              isProjectBased: Boolean(data.isProjectBased),
            };
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...sessionItem };
              return copy;
            }
            return [...prev, sessionItem];
          } else {
            return prev.filter((x) => x.taskId !== data.taskId);
          }
        });
      }
    });

    s.on('upwork:clients_updated', (data) => {
      window.dispatchEvent(new CustomEvent('upwork:clients_updated', { detail: data }));
      if (Array.isArray(data?.clients)) {
        useAppStore.getState().setUpworkClients(data.clients);
      }
      if (Array.isArray(data?.projectClients)) {
        useAppStore.getState().setUpworkProjectClients(data.projectClients);
      }
    });

    s.on('task_map:updated', (data) => {
      window.dispatchEvent(new CustomEvent('task_map:updated', { detail: data }));
    });

    s.on('crm:follow_up_alert', (data) => {
      window.dispatchEvent(new CustomEvent('crm:follow_up_alert', { detail: data }));
    });

    s.on('crm:follow_up_responded', (data) => {
      window.dispatchEvent(new CustomEvent('crm:follow_up_responded', { detail: data }));
    });

    s.on('task_map:shifts_updated', (data) => {
      window.dispatchEvent(new CustomEvent('task_map:shifts_updated', { detail: data }));
    });

    s.on('audit_shifts:updated', (data) => {
      window.dispatchEvent(new CustomEvent('audit_shifts:updated', { detail: data }));
    });

    s.on('task_map:daily_rollover', (data) => {
      window.dispatchEvent(new CustomEvent('task_map:daily_rollover', { detail: data }));
    });

    s.on('task_map:ma_progress_changed', (data) => {
      window.dispatchEvent(new CustomEvent('task_map:ma_progress_changed', { detail: data }));
      if (data?.maName) {
        useAppStore.getState().updateMaActiveSession(data.maName, data?.cleared ? null : data);
      }
    });

    s.on('ma:session_updated', (data) => {
      window.dispatchEvent(new CustomEvent('ma:session_updated', { detail: data }));
      if (data?.maName) {
        useAppStore.getState().updateMaActiveSession(data.maName, data?.cleared ? null : data);
      }
    });

    s.on('task:progress_updated', (data) => {
      window.dispatchEvent(new CustomEvent('task:progress_updated', { detail: data }));
    });

    s.on('daily_sheet_log:updated', (data) => {
      window.dispatchEvent(new CustomEvent('daily_sheet_log:updated', { detail: data }));
    });

    s.on('supervise:updated', (data) => {
      window.dispatchEvent(new CustomEvent('supervise:updated', { detail: data }));
    });

    s.on('task:deleted', ({ id }) => {
      useAppStore.getState().removeTask(id);
      window.dispatchEvent(new CustomEvent('task:deleted', { detail: { id } }));
    });

    s.on('spaces:reordered', () => {
      useAppStore.getState().loadSpaces();
      window.dispatchEvent(new CustomEvent('spaces:reordered'));
    });

    s.on('spaces_updated', () => {
      useAppStore.getState().loadSpaces();
    });

    const handleDraftEvent = () => {
      useAppStore.getState().loadDrafts();
    };
    window.addEventListener('draft:updated', handleDraftEvent);
    window.addEventListener('draft:deleted', handleDraftEvent);

    return () => {
      if (notifPollTimer) clearTimeout(notifPollTimer);
      window.removeEventListener('draft:updated', handleDraftEvent);
      window.removeEventListener('draft:deleted', handleDraftEvent);
      s.disconnect();
    };
  }, [currentUser?.id, setUnreadNotifications, resetStore]);

  if (pathname === '/login') {
    return (
      <>
        <Suspense fallback={null}><TabTitleSync /></Suspense>
        {children}
      </>
    );
  }

  // Security Auth Gate: Never render layout, sidebar, or protected children until session is verified
  if (!currentUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground font-sans select-none">
        <Suspense fallback={null}><TabTitleSync /></Suspense>
        <NexusLogoLoader size={52} label="Please wait..." />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      <Suspense fallback={null}><TabTitleSync /></Suspense>
      <Suspense fallback={<div className="w-[260px] h-full bg-background" />}>
        {isMobileSidebarOpen && (
          <div
            onClick={() => setMobileSidebarOpen(false)}
            className="nexus-mobile-backdrop animate-mobile-fade-in"
            aria-label="Close navigation"
          />
        )}
        <Sidebar spaces={spaces} />
      </Suspense>
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-background min-w-0">
        <Header />
        <div className="flex-1 relative overflow-hidden">
          <main
            id="main-scroll-container"
            className={`w-full h-full ${pathname?.startsWith('/lists') || pathname?.includes('/task-map') || pathname?.includes('/launch-map') ? 'overflow-hidden' : 'overflow-y-auto pb-20 md:pb-0'} bg-background relative z-0 isolate`}
          >
            {children}
          </main>
          <div id="nexus-task-modal-portal" className="absolute inset-0 z-[80] pointer-events-none [&>*]:pointer-events-auto" />
        </div>
      </div>
      <MobileBottomNav />
      {isGalaxyModalOpen && (
        <GalaxyTaskModal
          isOpen={isGalaxyModalOpen}
          onClose={closeGalaxyModal}
          initialData={galaxyModalData}
        />
      )}
      <ToastContainer />
      <MentionConfetti />
      <DraftBeggingReminder />
    </div>
  );
}
