'use client';

import { usePathname, useSearchParams } from 'next/navigation';
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
import { applyTheme, getStoredTheme } from '@/lib/theme';
import { playNotificationSound, preloadCustomSound } from '@/lib/soundNotification';

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
  } = useAppStore();

  // Track when spaces were last fetched so we don't refetch on every navigation.
  // Spaces are considered stale after 5 minutes.
  const lastSpacesFetchRef = useRef<number>(0);
  const SPACES_STALE_MS = 5 * 60 * 1000;

  // Opt-in performance monitor (?perf=1): logs request timings, freezes and memory to the console
  useEffect(() => {
    initPerfMonitor();
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
          }).catch(() => {});
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
        }).catch(() => {});
        lastTouchAt = now;
        return;
      }

      // While continuously active, throttle session touch to once every 2 minutes
      if (timeSinceLastTouch >= TOUCH_INTERVAL_MS) {
        lastTouchAt = now;
        authApi.touchSession().catch(() => {});
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
        if (typeof res.unreadCount === 'number') {
          setUnreadNotifications(res.unreadCount);
        }
      }).catch(() => {});
      taskMapApi.getUpworkActiveSessions().then((res) => {
        if (res?.activeUpworkSessions) {
          useAppStore.getState().setActiveUpworkSessions(res.activeUpworkSessions);
        }
      }).catch(() => {});
      taskMapApi.getUpworkClients().then((res) => {
        if (res?.clients) {
          useAppStore.getState().setUpworkClients(res.clients);
        }
      }).catch(() => {});
    });
    if (isPerfEnabled()) s.onAny((event) => recordSocketEvent(event));

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
    let lastSoundAt = 0;
    s.on('notification_received', (data?: { type?: string; [key: string]: any }) => {
      const prevUnread = useAppStore.getState().unreadNotifications;
      window.dispatchEvent(new CustomEvent('notification_received', { detail: data }));
      notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then((res) => {
        if (typeof res.unreadCount !== 'number') return;
        setUnreadNotifications(res.unreadCount);
        const now = Date.now();
        if (res.unreadCount > prevUnread && now - lastSoundAt > 1500) {
          lastSoundAt = now;
          const notifType = res.notifications?.[0]?.type || data?.type;
          playNotificationSound(undefined, undefined, undefined, notifType);
        }
      }).catch(() => {});
    });

    s.on('notification_read', (data: { id: string }) => {
      useAppStore.getState().decrementUnreadNotifications();
      window.dispatchEvent(new CustomEvent('notification_read', { detail: data }));
    });

    s.on('notifications_all_read', () => {
      setUnreadNotifications(0);
      window.dispatchEvent(new CustomEvent('notifications_all_read'));
    });

    s.on('notification_cleared', (data: { id: string }) => {
      window.dispatchEvent(new CustomEvent('notification_cleared', { detail: data }));
    });

    s.on('notifications_all_cleared', () => {
      setUnreadNotifications(0);
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
      notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then((res) => {
        if (typeof res.unreadCount === 'number') {
          setUnreadNotifications(res.unreadCount);
        }
      }).catch(() => {});
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
          const checklists = (existingTask.checklists || []).map((c: any) => {
            if (c.id === payload.checklistId || c.name?.toLowerCase() === 'audit') {
              const items = (c.items || []).some((i: any) => i.id === payload.item.id)
                ? (c.items || []).map((i: any) => i.id === payload.item.id ? payload.item : i)
                : [...(c.items || []), payload.item];
              return { ...c, items };
            }
            return c;
          });
          store.updateTask({ ...existingTask, checklists });
        }
      }
    });

    s.on('task:checklist_item_updated', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:checklist_item_updated', { detail: payload }));
      if (payload?.taskId && payload?.item) {
        const store = useAppStore.getState();
        const existingTask = store.tasks.find((t: any) => t.id === payload.taskId);
        if (existingTask) {
          const checklists = (existingTask.checklists || []).map((c: any) => {
            if (c.id === payload.checklistId || c.name?.toLowerCase() === 'audit') {
              const items = (c.items || []).map((i: any) => i.id === payload.item.id ? { ...i, ...payload.item } : i);
              return { ...c, items };
            }
            return c;
          });
          store.updateTask({ ...existingTask, checklists });
        }
      }
    });

    s.on('task:checklist_item_deleted', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:checklist_item_deleted', { detail: payload }));
      if (payload?.taskId && payload?.itemId) {
        const store = useAppStore.getState();
        const existingTask = store.tasks.find((t: any) => t.id === payload.taskId);
        if (existingTask) {
          const checklists = (existingTask.checklists || []).map((c: any) => {
            if (c.id === payload.checklistId || c.name?.toLowerCase() === 'audit') {
              const items = (c.items || []).filter((i: any) => i.id !== payload.itemId);
              return { ...c, items };
            }
            return c;
          });
          store.updateTask({ ...existingTask, checklists });
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
              startedAt: data.startedAt || new Date().toISOString(),
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
    });

    s.on('task_map:updated', (data) => {
      window.dispatchEvent(new CustomEvent('task_map:updated', { detail: data }));
    });

    s.on('task:deleted', ({ id }) => {
      useAppStore.getState().removeTask(id);
      window.dispatchEvent(new CustomEvent('task:deleted', { detail: { id } }));
    });

    s.on('spaces:reordered', () => {
      useAppStore.getState().loadSpaces();
      window.dispatchEvent(new CustomEvent('spaces:reordered'));
    });

    const handleDraftEvent = () => {
      useAppStore.getState().loadDrafts();
    };
    window.addEventListener('draft:updated', handleDraftEvent);
    window.addEventListener('draft:deleted', handleDraftEvent);

    return () => {
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
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          <span className="text-sm font-medium text-zinc-400 tracking-wide">Please wait...</span>
        </div>
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
            className={`w-full h-full ${pathname?.startsWith('/lists') ? 'overflow-hidden' : 'overflow-y-auto pb-20 md:pb-0'} bg-background relative z-0 isolate`}
          >
            {children}
          </main>
          <div id="nexus-task-modal-portal" className="absolute inset-0 z-[80] pointer-events-none [&>*]:pointer-events-auto" />
        </div>
      </div>
      <MobileBottomNav />
      <ToastContainer />
      <MentionConfetti />
      <DraftBeggingReminder />
    </div>
  );
}
