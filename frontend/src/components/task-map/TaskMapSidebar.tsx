import React, { useState } from 'react';
import { format, subDays } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  currentDate: string;
  onSelectDate: (dateStr: string) => void;
}

export const TaskMapSidebar: React.FC<Props> = ({ currentDate, onSelectDate }) => {
  // Fixed reference for consistent journal dates (anchored around Nov 2026 as per design mockup)
  const today = new Date();
  
  // November 2026 days (5 down to 1)
  const novDays = [
    new Date(2026, 10, 5),
    new Date(2026, 10, 4),
    new Date(2026, 10, 3),
    new Date(2026, 10, 2),
    new Date(2026, 10, 1),
  ];

  const months = [
    {
      title: 'November 2026',
      days: novDays,
      defaultExpanded: true,
    },
    {
      title: 'October 2026',
      days: [
        new Date(2026, 9, 31),
        new Date(2026, 9, 30),
      ],
      defaultExpanded: false,
    },
    {
      title: 'September 2026',
      days: [
        new Date(2026, 8, 30),
      ],
      defaultExpanded: false,
    },
  ];

  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({
    'November 2026': true,
    'October 2026': false,
    'September 2026': false,
  });

  const toggleMonth = (title: string) => {
    setExpandedMonths((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const pagesCount = novDays.length;

  return (
    <aside className="w-[210px] shrink-0 bg-[#0d0d10] border-r border-zinc-800/60 flex flex-col h-full select-none text-zinc-300">
      {/* Sidebar Header */}
      <div className="pt-5 px-4 pb-4">
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
          DOCUMENT
        </span>
        <h2 className="text-sm font-bold text-zinc-100">Task Map Journal</h2>
      </div>

      {/* Pages Label & Counter */}
      <div className="px-4 py-2 flex items-center justify-between text-xs">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">PAGES</span>
        <span className="text-[11px] font-semibold text-zinc-400">{pagesCount}</span>
      </div>

      {/* Month Folders & Date Items */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pt-1 space-y-2 pb-6">
        {months.map((month) => {
          const isExpanded = expandedMonths[month.title];

          return (
            <div key={month.title} className="space-y-1">
              {/* Month Header */}
              <button
                type="button"
                onClick={() => toggleMonth(month.title)}
                className="w-full flex items-center justify-between px-2 py-1 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <span className="truncate">{month.title}</span>
                {isExpanded ? (
                  <ChevronDown className="size-3 text-zinc-500 shrink-0" />
                ) : (
                  <ChevronRight className="size-3 text-zinc-500 shrink-0" />
                )}
              </button>

              {/* Day Items */}
              {isExpanded && (
                <div className="space-y-0.5">
                  {month.days.map((dayDate) => {
                    const formatted = format(dayDate, 'MMMM d, yyyy');
                    const isoDate = dayDate.toISOString().split('T')[0];
                    const isSelected =
                      currentDate.split('T')[0] === isoDate ||
                      currentDate.toLowerCase().includes(format(dayDate, 'MMMM d').toLowerCase());

                    return (
                      <div
                        key={isoDate}
                        onClick={() => onSelectDate(isoDate)}
                        className={`w-full px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer truncate ${
                          isSelected
                            ? 'bg-[#212229] text-white font-medium shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                        }`}
                      >
                        {formatted}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
