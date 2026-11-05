'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Calendar,
  Flag,
  Clock,
  CheckCircle2,
  MessageSquare,
  ChevronRight,
  CornerDownRight,
} from 'lucide-react';
import { getPriorityConfig } from '@/lib/priority';

export interface ClickUpMobileFilteredTasksSheetProps {
  isOpen: boolean;
  onClose: () => void;
  category: 'today' | 'overdue' | 'priorities' | 'upcoming' | 'my_tasks' | 'comments' | null;
  tasks: any[];
  onSelectTask?: (task: any) => void;
}

const CATEGORY_META: Record<
  string,
  { title: string; icon: any; colorCls: string; bgCls: string; badgeCls: string }
> = {
  today: {
    title: 'Today',
    icon: Calendar,
    colorCls: 'text-indigo-400',
    bgCls: 'bg-indigo-500/15 border-indigo-500/30',
    badgeCls: 'bg-indigo-500/20 text-indigo-300',
  },
  overdue: {
    title: 'Overdue',
    icon: Clock,
    colorCls: 'text-rose-400',
    bgCls: 'bg-rose-500/15 border-rose-500/30',
    badgeCls: 'bg-rose-500/20 text-rose-300',
  },
  priorities: {
    title: 'My Priorities',
    icon: Flag,
    colorCls: 'text-amber-400',
    bgCls: 'bg-amber-500/15 border-amber-500/30',
    badgeCls: 'bg-amber-500/20 text-amber-300',
  },
  upcoming: {
    title: 'Upcoming',
    icon: Calendar,
    colorCls: 'text-sky-400',
    bgCls: 'bg-sky-500/15 border-sky-500/30',
    badgeCls: 'bg-sky-500/20 text-sky-300',
  },
  my_tasks: {
    title: 'My Tasks',
    icon: CheckCircle2,
    colorCls: 'text-zinc-200',
    bgCls: 'bg-secondary border-border',
    badgeCls: 'bg-secondary text-foreground',
  },
  comments: {
    title: 'Comments',
    icon: MessageSquare,
    colorCls: 'text-emerald-400',
    bgCls: 'bg-emerald-500/15 border-emerald-500/30',
    badgeCls: 'bg-emerald-500/20 text-emerald-300',
  },
};

export function ClickUpMobileFilteredTasksSheet({
  isOpen,
  onClose,
  category,
  tasks,
  onSelectTask,
}: ClickUpMobileFilteredTasksSheetProps) {
  const router = useRouter();

  if (!category) return null;
  const meta = CATEGORY_META[category] || CATEGORY_META.my_tasks;
  const IconComponent = meta.icon;

  const handleItemClick = (item: any) => {
    if (onSelectTask) {
      onSelectTask(item);
    }
    // Proper redirection to task or subtask route
    if (item.isSubtask && item.parentId) {
      router.push(`/tasks/${item.parentId}?subtask=${item.id}`);
    } else {
      router.push(`/tasks/${item.id}`);
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 md:hidden"
          />

          {/* Drawer Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="fixed inset-x-0 bottom-0 z-50 bg-card border-t border-border rounded-t-3xl max-h-[85vh] flex flex-col md:hidden shadow-2xl safe-bottom text-foreground"
          >
            {/* Sheet Handle */}
            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full mx-auto mt-3 mb-1" />

            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl border ${meta.bgCls} ${meta.colorCls}`}>
                  <IconComponent className="size-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-foreground">{meta.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${meta.badgeCls}`}>
                      {tasks.length}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {category === 'overdue'
                      ? 'Requires immediate attention'
                      : category === 'today'
                      ? 'Due before end of day'
                      : 'Filtered workspace items'}
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="size-8 rounded-full bg-secondary border border-border text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Task / Subtask List */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 custom-scrollbar">
              {tasks.length === 0 ? (
                <div className="text-center py-12 px-4 text-muted-foreground">
                  <IconComponent className={`size-10 mx-auto mb-2 opacity-30 ${meta.colorCls}`} />
                  <p className="text-sm font-semibold text-foreground">No items in {meta.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">You are completely up to date!</p>
                </div>
              ) : (
                tasks.map((item) => {
                  const priorityConfig = getPriorityConfig(item.priority);
                  const isDone =
                    item.status === 'DONE' ||
                    item.status === 'CLOSED' ||
                    item.status === 'Closed' ||
                    Boolean(item.completed);

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleItemClick(item)}
                      className="p-3.5 rounded-2xl bg-secondary/40 border border-border hover:border-zinc-700 active:scale-[0.99] transition-all cursor-pointer flex items-start justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        {/* Title & Status */}
                        <div className="flex items-start gap-2">
                          <span
                            className={`size-3 rounded-full mt-1 shrink-0 ${
                              isDone
                                ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                                : category === 'overdue'
                                ? 'bg-rose-500 ring-2 ring-rose-500/20'
                                : 'bg-indigo-500 ring-2 ring-indigo-500/20'
                            }`}
                          />
                          <h4
                            className={`text-sm font-semibold leading-snug line-clamp-2 ${
                              isDone ? 'line-through text-muted-foreground' : 'text-foreground'
                            }`}
                          >
                            {item.title || 'Untitled'}
                          </h4>
                        </div>

                        {/* Metadata row */}
                        <div className="flex items-center gap-2 mt-2 ml-5 text-[11px] text-muted-foreground flex-wrap">
                          {/* Subtask indicator tag */}
                          {item.isSubtask && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-400 text-[10px] font-bold border border-indigo-500/30">
                              <CornerDownRight className="size-2.5" />
                              Subtask
                            </span>
                          )}

                          {/* Status pill */}
                          <span className="px-2 py-0.5 rounded-md bg-secondary border border-border text-[10px] font-bold text-foreground">
                            {item.status || 'PENDING'}
                          </span>

                          {/* Priority badge */}
                          {priorityConfig && (
                            <span
                              className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1 ${
                                item.priority === 'URGENT'
                                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                  : item.priority === 'HIGH'
                                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              <Flag className="size-2.5" />
                              <span className="capitalize">{String(item.priority).toLowerCase()}</span>
                            </span>
                          )}

                          {/* Due Date */}
                          {item.dueDate && (
                            <span
                              className={`flex items-center gap-1 ${
                                category === 'overdue' ? 'text-rose-400 font-semibold' : 'text-muted-foreground'
                              }`}
                            >
                              <Calendar className="size-3" />
                              {new Date(item.dueDate).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          )}

                          {/* Context / Parent Title or List Name */}
                          {item.parentTitle ? (
                            <span className="truncate max-w-[130px] text-muted-foreground">
                              • in {item.parentTitle}
                            </span>
                          ) : item.listName || item.list?.name ? (
                            <span className="truncate max-w-[130px] text-muted-foreground">
                              • {item.listName || item.list?.name}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
