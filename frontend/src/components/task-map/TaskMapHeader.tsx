import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { TaskMapShift, UpworkSession } from '@/api/taskMap';
import { Users, Clock } from 'lucide-react';

interface Props {
  currentDate: string;
  currentShift: string;
  onShiftChange: (shift: string) => void;
  shifts?: TaskMapShift[];
  search: string;
  onSearchChange: (search: string) => void;
  activeUpworkSessions?: UpworkSession[];
}

function formatElapsed(startedAt: string, now: Date): string {
  const startMs = new Date(startedAt).getTime();
  const diffMs = Math.max(0, now.getTime() - startMs);
  const totalMins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

function formatManilaTime(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return '';
  try {
    const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
}

function getCleanUpworkName(session: UpworkSession): string {
  // Prefer specific target name (e.g. HANNAH, BLESSIE, CHE, PAU, SHEMUEL)
  if (session.pmName && session.pmName !== 'Active' && session.pmName !== 'General') {
    return session.pmName.toUpperCase();
  }
  const raw = session.userName || '';
  if (raw.includes('@')) {
    return raw.split('@')[0].toUpperCase();
  }
  return (raw || 'USER').toUpperCase();
}

export const TaskMapHeader: React.FC<Props> = ({
  currentDate,
  currentShift,
  onShiftChange,
  shifts = [],
  search,
  onSearchChange,
  activeUpworkSessions = [],
}) => {
  // Live ticking timer for elapsed duration (Reverse-engineered from Teammap.js)
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Format selected date
  const dateObj = currentDate ? new Date(currentDate) : new Date();
  const formattedDate = format(dateObj, 'MMMM d, yyyy');
  const dayOfWeek = format(dateObj, 'EEEE');

  const shiftOptions = [
    { key: 'DAY', label: 'Day' },
    { key: 'NOON', label: 'Noon' },
    { key: 'NIGHT', label: 'Night' },
  ];

  return (
    <header className="px-6 pt-5 pb-3 flex flex-col gap-3 select-none">
      {/* Top Row: Date, Shift switcher & Search */}
      <div className="flex items-start justify-between gap-4">
        {/* Left: Date & Day of Week */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-100 tracking-tight">
            {formattedDate}
          </h1>
          <p className="text-sm font-medium text-zinc-400 mt-0.5">
            {dayOfWeek}
          </p>
        </div>

        {/* Right: Shift Switcher & Search Bar */}
        <div className="flex items-center gap-3">
          {/* Shift pills [Day] [Noon] [Night] */}
          <div className="flex items-center bg-[#18191e] border border-zinc-800/80 rounded-lg p-1">
            {shiftOptions.map((opt) => {
              const isActive = currentShift.toUpperCase() === opt.key;

              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onShiftChange(opt.key)}
                  className={`px-4 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#0099ff] text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Link to Shift Members configuration UI */}
          <Link
            href="/settings/users?tab=shifts"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#18191e] border border-zinc-800/80 hover:border-zinc-700 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
            title="Configure Shift Members (Day, Noon, Night)"
          >
            <Users className="size-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Manage Shifts</span>
          </Link>

          {/* Clean Search Input */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search"
              className="w-36 sm:w-44 px-3 py-1.5 bg-[#18191e] border border-zinc-800/80 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Upwork Live Master Banner (Reverse-engineered from Teammap.js Row 1 A1:N1) */}
      <div className="w-full">
        {activeUpworkSessions.length > 0 ? (
          <div className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-red-950/80 border border-red-800/80 text-red-200 shadow-lg shadow-red-950/40 animate-in fade-in duration-200">
            <div className="flex items-center gap-2.5 truncate text-xs sm:text-sm font-bold tracking-wide">
              <span className="relative flex size-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2.5 bg-red-500" />
              </span>
              <span className="truncate">
                {activeUpworkSessions.map((s) => {
                  const name = getCleanUpworkName(s);
                  const sinceTime = formatManilaTime(s.startedAt);
                  const elapsed = formatElapsed(s.startedAt, now);
                  const timePart = sinceTime ? `(since ${sinceTime} UTC+8 · ${elapsed})` : `(${elapsed})`;
                  return `${name} - UPWORK ACTIVE ${timePart}`;
                }).join('  |  ')}
              </span>
            </div>
            <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-900/80 border border-red-700/60 text-red-100 shrink-0">
              Contract In Use
            </span>
          </div>
        ) : (
          <div className="w-full flex items-center justify-between gap-3 px-4 py-2 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 shadow-sm">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold tracking-wide">
              <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
              <span>UPWORK AVAILABLE</span>
            </div>
            <span className="text-[10px] font-medium text-emerald-400/80 shrink-0">
              Ready for assignment
            </span>
          </div>
        )}
      </div>
    </header>
  );
};
