'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { User } from '@/lib/types';
import { authApi } from '@/api';
import { ExternalLink, LogOut, ChevronDown } from 'lucide-react';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Nexus Workspace',
  '/team': 'Member Directory',
  '/settings': 'Account Settings',
};

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentUser, setCurrentUser } = useAppStore();

  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const title = PAGE_TITLES[pathname] ?? 'Nexus';

  const handleLogout = async () => {
    try {
      // Only call the server when there is a session to end; otherwise it
      // answers 401 and the console fills with noise.
      if (currentUser) {
        await authApi.logout();
      }
    } catch (e) {
      console.warn('Logout server call failed:', e);
    } finally {
      setCurrentUser(null);
      router.push('/login');
    }
  };

  if (!currentUser) {
    return (
      <header className="bg-zinc-950/90 border-b border-zinc-800/60 px-6 py-3 backdrop-blur-md relative z-30">
        <span className="text-xs font-semibold text-zinc-200">{title}</span>
      </header>
    );
  }

  const activeUser: User = currentUser;

  return (
    <header className="bg-zinc-950/90 border-b border-zinc-800/60 text-zinc-100 backdrop-blur-md relative z-30">
      <div className="px-6 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200">{title}</span>

        <div className="relative text-xs">
          <button
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className="flex items-center gap-2 p-1 pr-2 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800/80 transition-all cursor-pointer group"
          >
            <div className="relative">
              {activeUser.imageUrl || activeUser.avatarUrl ? (
                <img
                  src={activeUser.imageUrl || activeUser.avatarUrl}
                  alt={activeUser.name}
                  className="w-7 h-7 rounded-full object-cover border border-zinc-700"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 text-white font-bold flex items-center justify-center text-xs">
                  {activeUser.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="w-2 h-2 bg-emerald-500 rounded-full absolute bottom-0 right-0 border border-zinc-950" />
            </div>

            <span className="font-semibold text-zinc-200 text-xs truncate max-w-[100px] hidden sm:inline">
              {activeUser.name.split(' ')[0]}
            </span>

            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 transition-colors" />
          </button>

          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-[#18181c] border border-zinc-800/80 rounded-xl shadow-2xl p-3 z-50 text-xs space-y-3">
              <div className="flex items-center gap-3 pb-3 border-b border-zinc-800/60">
                <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 text-white font-bold flex items-center justify-center text-xs shrink-0">
                  {activeUser.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="truncate">
                  <div className="font-bold text-zinc-100 truncate flex items-center gap-1.5">
                    {activeUser.name}
                    {activeUser.systemRole === 'ADMIN' && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-zinc-200 text-zinc-950 font-extrabold rounded">
                        ADMIN
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate">{activeUser.email}</div>
                </div>
              </div>

              <div className="space-y-1.5 text-[11px] text-zinc-300">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Star Rating:</span>
                  <span className="text-amber-400 font-bold">
                    {'⭐'.repeat(activeUser.starRating || 1)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Employment:</span>
                  <span className="font-mono text-[10px] text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded">
                    {activeUser.employmentType}
                  </span>
                </div>

                {activeUser.dailySheetUrl && (
                  <div className="pt-1">
                    <a
                      href={activeUser.dailySheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors"
                    >
                      <span>Google Daily Sheet</span>
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                    </a>
                  </div>
                )}
              </div>

              <div className="pt-2 space-y-1.5 border-t border-zinc-800/60">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-900/50 font-semibold transition-colors text-xs cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
