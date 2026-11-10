import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  FileText,
  Folder,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  currentDate: string;
  onSelectDate: (dateStr: string) => void;
  historyDates?: string[];
}

export const TaskMapSidebar: React.FC<Props> = ({ currentDate, onSelectDate, historyDates = [] }) => {
  // Collapse state matching Priorities for Today (/docs/[id])
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

  // Base reference mock dates for consistent journal UI layout
  const baseDates = [
    '2026-11-07',
    '2026-11-06',
    '2026-11-05',
    '2026-11-04',
    '2026-11-03',
    '2026-11-02',
    '2026-11-01',
    '2026-10-31',
    '2026-10-30',
    '2026-09-30',
  ];

  const allDateStrings = React.useMemo(() => {
    const set = new Set<string>([...historyDates, ...baseDates]);
    if (currentDate) {
      set.add(currentDate.split('T')[0]);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [historyDates, currentDate]);

  interface DayItem {
    date: Date;
    dateStr: string;
    formatted: string;
  }

  const months = React.useMemo(() => {
    const monthGroups: Record<string, DayItem[]> = {};

    for (const ds of allDateStrings) {
      const [year, month, day] = ds.split('-').map(Number);
      if (!year || !month || !day) continue;
      // Use noon local time to completely prevent any boundary or daylight saving timezone shifts
      const d = new Date(year, month - 1, day, 12, 0, 0);
      const mTitle = format(d, 'MMMM yyyy');
      if (!monthGroups[mTitle]) {
        monthGroups[mTitle] = [];
      }
      monthGroups[mTitle].push({
        date: d,
        dateStr: ds,
        formatted: format(d, 'MMMM d, yyyy'),
      });
    }

    return Object.entries(monthGroups).map(([title, days], index) => ({
      title,
      days,
      defaultExpanded: index === 0 || title.includes('November 2026'),
    }));
  }, [allDateStrings]);

  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [monthLimits, setMonthLimits] = useState<Record<string, number>>({});

  const toggleMonth = (title: string, defaultVal: boolean) => {
    setExpandedMonths((prev) => ({
      ...prev,
      [title]: prev[title] !== undefined ? !prev[title] : !defaultVal,
    }));
  };

  // If the currently selected date is in a month and beyond the initial 5-item limit, auto-expand the limit so it's visible
  React.useEffect(() => {
    const selectedDateStr = (currentDate || '').split('T')[0];
    if (!selectedDateStr) return;

    for (const m of months) {
      const idx = m.days.findIndex((d) => d.dateStr === selectedDateStr);
      if (idx >= 0) {
        const curLimit = monthLimits[m.title] || 5;
        if (idx >= curLimit) {
          setMonthLimits((prev) => ({
            ...prev,
            [m.title]: idx + 5,
          }));
        }
      }
    }
  }, [currentDate, months, monthLimits]);

  const totalTaskMaps = allDateStrings.length;

  // Collapsed slim rail matching Image 2 & /docs/[id]
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
    <aside className="w-60 shrink-0 bg-card border-r border-zinc-800/60 p-4 flex flex-col h-full select-none text-zinc-300">
      {/* Sidebar Header matching Priorities for Today (/docs/[id]) */}
      <div className="mb-4 pb-3 border-b border-zinc-800/60">
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

      {/* Task Maps Label & Counter (Changed from PAGES per user request) */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Task Maps
        </span>
        <span className="text-[10px] text-zinc-500 font-mono">
          {totalTaskMaps}
        </span>
      </div>

      {/* Month Folders & Date Items */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pb-6 pr-0.5">
        {months.map((month) => {
          const isExpanded = expandedMonths[month.title] !== undefined
            ? expandedMonths[month.title]
            : month.defaultExpanded;

          const currentLimit = monthLimits[month.title] || 5;
          const visibleDays = month.days.slice(0, currentLimit);
          const hasMoreDays = month.days.length > currentLimit;

          return (
            <div key={month.title} className="space-y-0.5">
              {/* Month Folder Header with Folder Icon & Hover Chevron */}
              <div
                onClick={() => toggleMonth(month.title, month.defaultExpanded)}
                className="flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 group"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <div className="relative w-4 h-4 flex items-center justify-center shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMonth(month.title, month.defaultExpanded);
                      }}
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer hover:bg-zinc-700/50 rounded"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-zinc-300" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-zinc-300" />
                      )}
                    </button>
                    <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
                      <Folder className="w-3.5 h-3.5 text-zinc-400" />
                    </div>
                  </div>
                  <span className="truncate">{month.title}</span>
                </div>
              </div>

              {/* Day Items (Page Icon & Indented Date Rows) */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="space-y-0.5 mt-0.5 overflow-hidden"
                  >
                    {visibleDays.map((item) => {
                      const isSelected = (currentDate || '').split('T')[0] === item.dateStr;

                      return (
                        <div
                          key={item.dateStr}
                          onClick={() => onSelectDate(item.dateStr)}
                          className={`flex items-center gap-1.5 py-1.5 pr-2 rounded-lg text-xs cursor-pointer transition-colors truncate ${
                            isSelected
                              ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-xs'
                              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 font-medium'
                          }`}
                          style={{ paddingLeft: '22px' }}
                        >
                          <FileText
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isSelected ? 'text-zinc-300' : 'text-zinc-400'
                            }`}
                          />
                          <span className="truncate">{item.formatted}</span>
                        </div>
                      );
                    })}

                    {/* See More Pagination Button matching Image 2 */}
                    {hasMoreDays && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMonthLimits((prev) => ({
                            ...prev,
                            [month.title]: (prev[month.title] || 5) + 15,
                          }));
                        }}
                        className="w-full text-left py-1 pr-2 text-[11px] font-medium text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 rounded flex items-center gap-1.5 transition-colors cursor-pointer group/seemore"
                        style={{ paddingLeft: '22px' }}
                      >
                        <ChevronDown className="w-3 h-3 text-zinc-500 group-hover/seemore:text-zinc-300 transition-colors" />
                        <span>See more ({month.days.length - currentLimit} left)</span>
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
