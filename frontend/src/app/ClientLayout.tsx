'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAppStore } from '@/lib/store';
import { useEffect, useRef, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { authApi } from '@/api';
import { notificationsApi } from '@/api/notifications';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { MentionConfetti } from '@/components/ui/MentionConfetti';
import { io } from 'socket.io-client';
import { API_BASE_URL } from '@/api';
import { initPerfMonitor, isPerfEnabled, markNavigation, recordSocketEvent } from '@/lib/perfMonitor';
import { formatTabTitle, resolveRouteTitle, updateFaviconBadge } from '@/lib/tabManager';
import { applyTheme, getStoredTheme } from '@/lib/theme';
import { playNotificationSound, preloadCustomSound } from '@/lib/soundNotification';

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

  // Auth Gate & Session Verification
  useEffect(() => {
    if (pathname === '/login') {
      return;
    }

    if (!currentUser) {
      setAuthStatus('loading');
      authApi
        .getMe()
        .then(({ user }) => {
          setCurrentUser(user);
          setAuthStatus('authenticated');
          // Only hydrate sensitive cached spaces and tasks once authenticated
          hydrateFromCache();
          hydrateTasksFromCache();

          // Fetch fresh spaces
          lastSpacesFetchRef.current = Date.now();
          loadSpaces();

          notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then((res) => {
            setUnreadNotifications(res.unreadCount ?? res.notifications.filter((n) => !n.isRead).length);
          });
        })
        .catch(() => {
          // Token expired, revoked, or invalid — clear all caches and redirect to login
          resetStore();
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.replace('/login');
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
    s.on('notification_received', () => {
      const prevUnread = useAppStore.getState().unreadNotifications;
      window.dispatchEvent(new CustomEvent('notification_received'));
      notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then((res) => {
        if (typeof res.unreadCount !== 'number') return;
        setUnreadNotifications(res.unreadCount);
        const now = Date.now();
        if (res.unreadCount > prevUnread && now - lastSoundAt > 1500) {
          lastSoundAt = now;
          playNotificationSound();
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
    });

    s.on('task:comment_added', (payload: any) => {
      window.dispatchEvent(new CustomEvent('task:comment_added', { detail: payload }));
    });

    s.on('task:created', (task) => {
      useAppStore.getState().addTask(task);
      window.dispatchEvent(new CustomEvent('task:created', { detail: { task } }));
    });

    s.on('task:updated', (task) => {
      useAppStore.getState().updateTask(task);
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task } }));
    });

    s.on('task:deleted', ({ id }) => {
      useAppStore.getState().removeTask(id);
      window.dispatchEvent(new CustomEvent('task:deleted', { detail: { id } }));
    });

    s.on('spaces:reordered', () => {
      useAppStore.getState().loadSpaces();
      window.dispatchEvent(new CustomEvent('spaces:reordered'));
    });

    return () => {
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
        <Sidebar spaces={spaces} />
      </Suspense>
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-background">
        <Header />
        <div className="flex-1 relative overflow-hidden">
          <main
            id="main-scroll-container"
            className={`w-full h-full ${pathname?.startsWith('/lists') ? 'overflow-hidden' : 'overflow-y-auto'} bg-background relative z-0 isolate`}
          >
            {children}
          </main>
          <div id="nexus-task-modal-portal" className="absolute inset-0 z-[80] pointer-events-none [&>*]:pointer-events-auto" />
        </div>
      </div>
      <ToastContainer />
      <MentionConfetti />
    </div>
  );
}
