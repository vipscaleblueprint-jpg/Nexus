'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAppStore } from '@/lib/store';
import { useEffect, useRef, Suspense } from 'react';

import { authApi } from '@/api';
import { notificationsApi } from '@/api/notifications';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { io } from 'socket.io-client';
import { API_BASE_URL } from '@/api';
import { initPerfMonitor, isPerfEnabled, markNavigation, recordSocketEvent } from '@/lib/perfMonitor';

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

  useEffect(() => {
    // Instantly populate from localStorage cache (no flash)
    hydrateFromCache();
    hydrateTasksFromCache();
    // Not on the login page: the API needs a session, and a failed load there still marks spaces as loaded, so
    // after signing in (router.push keeps the store) the sidebar would never fetch them.
    // Only refetch spaces when the cached data is stale (older than 5 min) — prevents a fresh
    // API call on every single client-side navigation.
    if (pathname !== '/login' && !loadingSpaces) {
      const isStale = Date.now() - lastSpacesFetchRef.current > SPACES_STALE_MS;
      if (isStale) {
        lastSpacesFetchRef.current = Date.now();
        loadSpaces();
      }
    }
    if (!currentUser && pathname !== '/login') {
      authApi
        .getMe()
        .then(({ user }) => {
          setCurrentUser(user);
          notificationsApi.getNotifications().then((res) => {
            const unread = res.notifications.filter(n => !n.isRead).length;
            setUnreadNotifications(unread);
          });
        })
        .catch(() => {
          // Token expired or invalid — redirect to login
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        });
    }
  }, [pathname]);

  // Global Socket Connection for Real-time Notifications
  useEffect(() => {
    if (!currentUser?.id) return;
    
    const s = io(API_BASE_URL, { withCredentials: true });
    s.on('connect', () => {
      s.emit('join_user', currentUser.id);
    });
    if (isPerfEnabled()) s.onAny((event) => recordSocketEvent(event));

    s.on('notification_received', () => {
      setUnreadNotifications(useAppStore.getState().unreadNotifications + 1);
      window.dispatchEvent(new CustomEvent('notification_received'));
    });

    s.on('task_activity', () => {
      window.dispatchEvent(new CustomEvent('task_activity'));
    });

    s.on('task:comment_added', () => {
      window.dispatchEvent(new CustomEvent('task:comment_added'));
    });

    s.on('task:created', (task) => {
      // Into the shared store (and its localStorage copy) too: updateTask ignores tasks the store doesn't hold,
      // so without this a new task's mentions (e.g. on the journal) miss its live updates until a full reload.
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

    return () => {
      s.disconnect();
    };
  }, [currentUser?.id, setUnreadNotifications]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      <Suspense fallback={<div className="w-[260px] h-full bg-background" />}>
        <Sidebar spaces={spaces} />
      </Suspense>
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-background">
        <Header />
        <main id="main-scroll-container" className="flex-1 overflow-y-auto bg-background">
          {children}
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
