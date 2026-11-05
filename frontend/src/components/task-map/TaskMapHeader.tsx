import React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { TaskMapShift } from '@/api/taskMap';
import { Users } from 'lucide-react';

interface Props {
  currentDate: string;
  currentShift: string;
  onShiftChange: (shift: string) => void;
  shifts?: TaskMapShift[];
  search: string;
  onSearchChange: (search: string) => void;
}

export const TaskMapHeader: React.FC<Props> = ({
  currentDate,
  currentShift,
  onShiftChange,
  shifts = [],
  search,
  onSearchChange,
}) => {
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
    <header className="px-6 pt-6 pb-4 flex items-start justify-between gap-4 select-none">
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
    </header>
  );
};
