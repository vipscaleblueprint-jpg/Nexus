'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAppStore } from '@/lib/store';
import { useEffect } from 'react';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { spaces, loadSpaces, loadingSpaces } = useAppStore();

  useEffect(() => {
    if (spaces.length === 0 && !loadingSpaces) {
      loadSpaces();
    }
  }, [spaces.length, loadSpaces, loadingSpaces]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-[#131316] text-[#e4e4e7] overflow-hidden font-sans">
      <Sidebar spaces={spaces} />
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#131316]">
        <Header />
        <main className="flex-1 overflow-y-auto bg-[#131316]">
          {children}
        </main>
      </div>
    </div>
  );
}
