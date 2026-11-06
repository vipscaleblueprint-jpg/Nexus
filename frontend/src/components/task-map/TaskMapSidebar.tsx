import React, { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, FileText } from 'lucide-react';

interface Props {
  currentDate: string;
  onSelectDate: (dateStr: string) => void;
}

export const TaskMapSidebar: React.FC<Props> = ({ currentDate, onSelectDate }) => {
  // Collapse state matching Image 2
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('nexus_taskmap_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('nexus_taskmap_sidebar_collapsed', String(next));
      } catch (e) {
        console.error('Failed to save sidebar collapsed state', e);
      }
      return next;
    });
  };

  // Fixed reference for consistent journal dates (anchored around Nov 2026 as per design mockup)
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

  // Collapsed slim rail matching Image 2
  if (isCollapsed) {
    return (
      <aside className="w-12 shrink-0 bg-card border-r border-zinc-800/60 py-3 flex flex-col items-center gap-2 h-full select-none text-zinc-300">
        <button
          type="button"
          onClick={toggleCollapse}
          title="Expand sidebar"
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
        <div className="w-6 border-t border-zinc-800/60" />
        <button
          type="button"
          onClick={toggleCollapse}
          title="Task Map Journal"
          className="p-1 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <FileText className="w-4 h-4 text-purple-400" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[210px] shrink-0 bg-card/70 border-r border-zinc-800/60 flex flex-col h-full select-none text-zinc-300">
      {/* Sidebar Header matching Image 2 */}
      <div className="pt-4 px-4 pb-3 border-b border-zinc-800/60 mb-1">
        <div className="flex items-center gap-2 text-zinc-400 mb-1">
          <FileText className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 truncate">
            DOCUMENT
          </span>
          <button
            type="button"
            onClick={toggleCollapse}
            title="Collapse sidebar"
            className="ml-auto -my-1 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        </div>
        <h2 className="text-sm font-bold text-zinc-100 truncate">
          Task Map Journal
        </h2>
      </div>

      {/* Pages Label & Counter */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs">
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
                            ? 'bg-zinc-800 text-zinc-100 font-medium shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
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
