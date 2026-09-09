'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAppStore } from '@/lib/store';
import { useEffect, Suspense } from 'react';

import { authApi } from '@/api';
import { notificationsApi } from '@/api/notifications';
import { ToastContainer } from '@/components/ui/ToastContainer';
import { io } from 'socket.io-client';
import { API_BASE_URL } from '@/api';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    spaces,
    loadSpaces,
    loadingSpaces,
    hasLoadedSpaces,
    hydrateFromCache,
    currentUser,
    setCurrentUser,
    setUnreadNotifications,
  } = useAppStore();

  useEffect(() => {
    // Instantly populate from localStorage cache (no flash)
    hydrateFromCache();
    if (!hasLoadedSpaces && !loadingSpaces) {
      loadSpaces();
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
        .catch(() => {});
    }
  }, [pathname]);

  // Global Socket Connection for Real-time Notifications
  useEffect(() => {
    if (!currentUser?.id) return;
    
    const s = io(API_BASE_URL, { withCredentials: true });
    s.on('connect', () => {
      s.emit('join_user', currentUser.id);
    });

    s.on('notification_received', () => {
      setUnreadNotifications(useAppStore.getState().unreadNotifications + 1);
      window.dispatchEvent(new CustomEvent('notification_received'));
    });

    return () => {
      s.disconnect();
    };
  }, [currentUser?.id, setUnreadNotifications]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-[#131316] text-[#e4e4e7] overflow-hidden font-sans">
      <Suspense fallback={<div className="w-[260px] h-full bg-[#0a0a0b]" />}>
        <Sidebar spaces={spaces} />
      </Suspense>
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#131316]">
        <Header />
        <main className="flex-1 overflow-y-auto bg-[#131316]">
          {children}
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
