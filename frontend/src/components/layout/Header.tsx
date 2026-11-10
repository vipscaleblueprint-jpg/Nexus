"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { User } from "@/lib/types";
import { authApi } from "@/api";
import { ExternalLink, LogOut, ChevronDown, PanelLeft } from "lucide-react";
import { ClickUpStatusPanel } from "./ClickUpStatusPanel";
import { motion, AnimatePresence } from "framer-motion";
import { NotificationBell } from "./NotificationBell";

const PAGE_TITLES: Record<string, string> = {
  "/": "Nexus Workspace",
  "/team": "Member Directory",
  "/role-map": "Role Map",
  "/settings": "Account Settings",
  "/settings/users": "Admin Settings",
};

const MAX_UPWORK_CONTINUOUS_MS = 14 * 60 * 60 * 1000; // 14 hours max continuous shift window

function formatUpworkElapsed(startedAt: string | Date | undefined, now: Date): string {
  if (!startedAt) return '0 hr 00 mins';
  const startMs = new Date(startedAt).getTime();
  if (isNaN(startMs)) return '0 hr 00 mins';
  const diffMs = Math.max(0, now.getTime() - startMs);
  // Guard against runaway / stale sessions
  if (diffMs > MAX_UPWORK_CONTINUOUS_MS) {
    return '0 hr 00 mins';
  }
  const totalMins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs} hr ${String(mins).padStart(2, '0')} mins`;
}

function getSessionDisplayName(session: any): string {
  const rawUser = session.userName || '';
  const cleanUser = rawUser.includes('@') ? rawUser.split('@')[0] : rawUser;
  const pm = session.pmName || session.clientName || '';
  const cleanClient = pm && pm !== 'Active' && pm !== 'General' && pm !== 'UPWORK' ? pm : '';

  if (cleanClient) {
    return `${cleanUser} ${cleanClient}`;
  }
  return cleanUser || 'Team Member';
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const currentUser = useAppStore(state => state.currentUser);
  const setCurrentUser = useAppStore(state => state.setCurrentUser);
  const isSidebarCollapsed = useAppStore(state => state.isSidebarCollapsed);
  const toggleSidebar = useAppStore(state => state.toggleSidebar);
  const toggleMobileSidebar = useAppStore(state => state.toggleMobileSidebar);
  const activeUpworkSessions = useAppStore(state => state.activeUpworkSessions);

  const resetStore = useAppStore(state => state.resetStore);

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const pageTitle = useAppStore(state => state.pageTitle);

  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    if (!activeUpworkSessions || activeUpworkSessions.length === 0) return;
    const interval = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(interval);
  }, [activeUpworkSessions?.length]);

  // Filter out Lauren (unless explicitly marked UPWORK), sessions with a recorded timeOut or stoppedAt,
  // and runaway stale sessions exceeding maximum shift duration (> 14h)
  const validUpworkSessions = (activeUpworkSessions || []).filter((s) => {
    if (s.timeOut || s.stoppedAt || (s as any).active === false) {
      return false;
    }
    if (s.startedAt) {
      const startMs = new Date(s.startedAt).getTime();
      if (!isNaN(startMs) && (now.getTime() - startMs > MAX_UPWORK_CONTINUOUS_MS)) {
        return false;
      }
    }
    const name = `${s.clientName || ''} ${s.pmName || ''} ${s.taskTitle || ''}`.toLowerCase();
    if (name.includes('lauren')) {
      return Boolean((s as any).isManuallyMarkedUpwork);
    }
    return true;
  });

  const upworkTickerText = validUpworkSessions
    .map((s) => {
      const name = getSessionDisplayName(s);
      const elapsed = formatUpworkElapsed(s.startedAt, now);
      return `${name} ${elapsed}`;
    })
    .join(' | ');

  const title = pageTitle || PAGE_TITLES[pathname] || "Nexus";

  const handleLogout = async () => {
    try {
      if (currentUser) {
        await authApi.logout();
      }
    } catch (e) {
      console.warn("Logout server call failed:", e);
    } finally {
      resetStore();
      window.location.replace("/login");
    }
  };

  if (!currentUser) {
    return (
      <header className="nexus-mobile-header bg-card/90 border-b border-border px-3.5 py-2.5 sm:px-6 sm:py-3 backdrop-blur-md relative z-[150]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (typeof window !== 'undefined' && window.innerWidth <= 768 ? toggleMobileSidebar() : toggleSidebar())}
            className="hidden md:inline-flex p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          <span className="nexus-header-title text-xs font-semibold text-zinc-200 truncate">{title}</span>
        </div>
      </header>
    );
  }

  const activeUser: User = currentUser;

  return (
    <header className="nexus-mobile-header bg-card/90 border-b border-border text-zinc-100 backdrop-blur-md relative z-[150]">
      <div className="px-3.5 py-2.5 sm:px-6 sm:py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (typeof window !== 'undefined' && window.innerWidth <= 768 ? toggleMobileSidebar() : toggleSidebar())}
            className="hidden md:inline-flex p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors -ml-2"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          <div className="hidden md:block h-4 w-px bg-zinc-800 mx-1"></div>
          <span className="nexus-header-title text-xs font-semibold text-zinc-200 truncate">{title}</span>
        </div>

        <div className="flex items-center gap-2">
          <NotificationBell />

          {/* Active Upwork Live Ticker next to Profile (Available to everyone, Non-clickable) */}
          {(() => {
            const count = validUpworkSessions.length;
            // 0 active = green (available), 1 active = orange, 2+ = red double-blink conflict alert
            const tone =
              count === 0
                ? {
                  pill: 'border-emerald-500/40 bg-emerald-500/10',
                  dot: 'bg-emerald-500',
                  isConflict: false,
                  text: 'text-emerald-300',
                  label: 'Upwork: not active',
                }
                : count === 1
                  ? {
                    pill: 'border-orange-500/50 bg-orange-500/10',
                    dot: 'bg-orange-500',
                    isConflict: false,
                    text: 'text-orange-300 font-medium',
                    label: upworkTickerText,
                  }
                  : {
                    pill: 'border-red-500/80 bg-red-500/20 ring-1 ring-red-500/50 shadow-[0_0_16px_rgba(239,68,68,0.4)] animate-pulse',
                    dot: 'bg-red-500 ring-2 ring-red-400',
                    isConflict: true,
                    text: 'text-red-200 font-bold',
                    label: `⚠️ CONFLICT (${count} ACTIVE): ${upworkTickerText}`,
                  };
            return (
              <div
                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs shadow-xs max-w-[220px] sm:max-w-xs md:max-w-md lg:max-w-xl truncate cursor-default select-none transition-all ${tone.pill}`}
                title={
                  count === 0
                    ? 'No one is on Upwork (available)'
                    : count === 1
                      ? 'Upwork in use by 1 person'
                      : `Upwork Conflict: ${count} recorded sessions active simultaneously! Upwork recorded sessions cannot overlap.`
                }
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {tone.isConflict ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-80" />
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 [animation-delay:400ms]" />
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${tone.dot}`} />
                    </>
                  ) : count === 1 ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${tone.dot}`} />
                    </>
                  ) : (
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${tone.dot}`} />
                  )}
                </span>
                <span className={`text-[11px] sm:text-xs truncate ${tone.text}`}>
                  {tone.label}
                </span>
              </div>
            );
          })()}

          <div className="relative text-xs">
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center gap-2 p-1 pr-2 rounded-full bg-secondary/90 hover:bg-zinc-800 border border-zinc-800/80 transition-all cursor-pointer group"
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

              <span className="font-semibold text-zinc-200 text-xs truncate max-w-25 hidden sm:inline">
                {activeUser.name.split(" ")[0]}
              </span>

              <motion.div animate={{ rotate: isProfileOpen ? -180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 transition-colors" />
              </motion.div>
            </button>

            <AnimatePresence>
              {isProfileOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="nexus-profile-dropdown absolute right-0 mt-2 w-64 max-w-[calc(100vw-24px)] bg-card border border-border rounded-xl shadow-2xl p-3 z-50 text-xs space-y-3 origin-top-right"
                >
                  <div className="flex items-center gap-3 pb-3 border-b border-zinc-800/60">
                    <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 text-white font-bold flex items-center justify-center text-xs shrink-0">
                      {activeUser.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="truncate">
                      <div className="font-bold text-zinc-100 truncate flex items-center gap-1.5">
                        {activeUser.name}
                        {activeUser.systemRole === "ADMIN" && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-zinc-200 text-zinc-950 font-extrabold rounded">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {activeUser.email}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-[11px] text-zinc-300">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Star Rating:</span>
                      <span className="text-amber-400 font-bold">
                        {"⭐".repeat(activeUser.starRating || 1)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Employment:</span>
                      <span className="font-mono text-[10px] text-zinc-300 bg-secondary px-1.5 py-0.5 rounded">
                        {activeUser.employmentType}
                      </span>
                    </div>

                    {activeUser.dailySheetUrl && (
                      <div className="pt-1">
                        <a
                          href={activeUser.dailySheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="w-full flex items-center justify-between p-2 rounded-lg bg-secondary hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors"
                        >
                          <span>Google Daily Sheet</span>
                          <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 space-y-1.5 border-t border-zinc-800/60">
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        router.push("/settings");
                      }}
                      className="w-full flex items-center justify-start gap-2 p-2 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors text-xs cursor-pointer"
                    >
                      <span className="truncate">Account Settings</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        router.push("/settings#api");
                      }}
                      className="w-full flex items-center justify-start gap-2 p-2 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors text-xs cursor-pointer"
                    >
                      <span className="truncate text-indigo-400">API Settings</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        router.push("/role-map");
                      }}
                      className="w-full flex items-center justify-start gap-2 p-2 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors text-xs cursor-pointer"
                    >
                      <span className="truncate text-[var(--accent)] font-medium">View Role Map</span>
                    </button>

                    {activeUser.systemRole === "ADMIN" && (
                      <button
                        onClick={() => {
                          setIsProfileOpen(false);
                          router.push("/settings/users");
                        }}
                        className="w-full flex items-center justify-start gap-2 p-2 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors text-xs cursor-pointer"
                      >
                        <span className="truncate text-yellow-400">
                          Admin Settings
                        </span>
                      </button>
                    )}

                    {Array.isArray((activeUser as any).roles) && (activeUser as any).roles.includes('DEV') && (
                      <div className="w-full">
                        <ClickUpStatusPanel isDropdownItem={true} />
                      </div>
                    )}

                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 hover:bg-rose-500/20 dark:hover:bg-rose-500/30 font-semibold transition-colors text-xs cursor-pointer mt-2"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

    </header>
  );
}
