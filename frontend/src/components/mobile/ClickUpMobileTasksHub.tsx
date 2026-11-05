'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Calendar,
  Clock,
  Flag,
  CheckCircle2,
  MessageSquare,
  CheckCheck,
  Plus,
  X,
  Sparkles,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { ClickUpMobileFilteredTasksSheet } from './ClickUpMobileFilteredTasksSheet';
import { toast } from '@/lib/toast';

export interface ClickUpMobileTasksHubProps {
  onOpenCreateTask?: () => void;
  onOpenCreateList?: () => void;
  onSelectTask?: (task: any) => void;
}

interface NormalizedItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  completed?: boolean;
  isSubtask: boolean;
  parentId?: string;
  parentTitle?: string;
  listName?: string;
  listId?: string;
  raw: any;
}

export function ClickUpMobileTasksHub({
  onOpenCreateTask,
  onOpenCreateList,
  onSelectTask,
}: ClickUpMobileTasksHubProps) {
  const router = useRouter();
  const {
    currentUser,
    tasks,
    allLists,
    unreadNotifications,
    setActiveMobileTask,
    loadTasks,
    loadSpaces,
    hydrateFromCache,
    hydrateTasksFromCache,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilterCategory, setActiveFilterCategory] = useState<
    'today' | 'overdue' | 'priorities' | 'upcoming' | 'my_tasks' | 'comments' | null
  >(null);

  // Hydrate cache and load fresh spaces/tasks on mount so data is always real from DB
  React.useEffect(() => {
    hydrateFromCache?.();
    hydrateTasksFromCache?.();
    loadSpaces?.();
    loadTasks?.(true);
  }, [hydrateFromCache, hydrateTasksFromCache, loadSpaces, loadTasks]);

  // Normalize all tasks AND subtasks assigned to currentUser
  const myItems = useMemo<NormalizedItem[]>(() => {
    if (!currentUser) return [];
    const items: NormalizedItem[] = [];

    (tasks || []).forEach((t: any) => {
      const isDirect =
        t.assigneeId === currentUser.id ||
        t.assignee?.id === currentUser.id ||
        (currentUser.email && t.assignee?.email === currentUser.email);
      const isMulti = t.assignees?.some(
        (a: any) =>
          a.id === currentUser.id ||
          (currentUser.email && a.email === currentUser.email)
      );

      if (isDirect || isMulti) {
        items.push({
          id: t.id,
          title: t.title || 'Untitled Task',
          status: t.status || 'PENDING',
          priority: t.priority || 'NORMAL',
          dueDate: t.dueDate,
          completed: Boolean(t.completed || t.status === 'DONE' || t.status === 'CLOSED'),
          isSubtask: false,
          listName: t.list?.name,
          listId: t.listId,
          raw: t,
        });
      }

      // Check subtasks inside task
      if (t.subtasks && Array.isArray(t.subtasks)) {
        t.subtasks.forEach((st: any) => {
          const isSubAssignee =
            st.assigneeId === currentUser.id ||
            st.assignee?.id === currentUser.id ||
            (currentUser.email && st.assignee?.email === currentUser.email);

          if (isSubAssignee) {
            items.push({
              id: st.id,
              title: st.title || 'Untitled Subtask',
              status: st.status || 'PENDING',
              priority: st.priority || 'NORMAL',
              dueDate: st.dueDate,
              completed: Boolean(st.completed || st.status === 'DONE' || st.status === 'CLOSED'),
              isSubtask: true,
              parentId: t.id,
              parentTitle: t.title,
              listName: t.list?.name,
              listId: t.listId,
              raw: st,
            });
          }
        });
      }
    });

    return items;
  }, [tasks, currentUser]);

  // Active (non-closed) items
  const activeItems = useMemo(() => {
    return myItems.filter((i) => {
      if (i.completed) return false;
      const s = (i.status || '').trim().toUpperCase();
      return s !== 'CLOSED' && s !== 'DONE' && s !== 'COMPLETED' && s !== 'RESOLVED' && s !== 'CANCELLED';
    });
  }, [myItems]);

  // Today items (due today)
  const todayItems = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return activeItems.filter((i) => {
      if (!i.dueDate) return false;
      try {
        const d = new Date(i.dueDate).toISOString().split('T')[0];
        return d === todayStr;
      } catch {
        return false;
      }
    });
  }, [activeItems]);

  // Overdue items (due before start of today)
  const overdueItems = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return activeItems.filter((i) => {
      if (!i.dueDate) return false;
      try {
        const d = new Date(i.dueDate);
        return d.getTime() < startOfToday.getTime();
      } catch {
        return false;
      }
    });
  }, [activeItems]);

  // Priority items (URGENT or HIGH)
  const priorityItems = useMemo(() => {
    return activeItems.filter(
      (i) => i.priority === 'URGENT' || i.priority === 'HIGH'
    );
  }, [activeItems]);

  // Upcoming items (due after today)
  const upcomingItems = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return activeItems.filter((i) => {
      if (!i.dueDate) return false;
      try {
        const d = new Date(i.dueDate);
        return d.getTime() > endOfToday.getTime();
      } catch {
        return false;
      }
    });
  }, [activeItems]);

  // Items with comments from the database
  const commentedItems = useMemo(() => {
    return activeItems.filter((i) => {
      const c = i.raw?.comments;
      const count = i.raw?._count?.comments || 0;
      return (Array.isArray(c) && c.length > 0) || count > 0;
    });
  }, [activeItems]);

  const commentsCount = commentedItems.length || unreadNotifications || 0;

  // Filter items for bottom sheet based on active card & search
  const filteredItemsForSheet = useMemo(() => {
    let sourceList: NormalizedItem[] = [];
    switch (activeFilterCategory) {
      case 'today':
        sourceList = todayItems;
        break;
      case 'overdue':
        sourceList = overdueItems;
        break;
      case 'priorities':
        sourceList = priorityItems;
        break;
      case 'upcoming':
        sourceList = upcomingItems;
        break;
      case 'my_tasks':
        sourceList = activeItems;
        break;
      case 'comments':
        sourceList = commentedItems.length > 0 ? commentedItems : activeItems;
        break;
      default:
        sourceList = [];
    }

    if (!searchQuery.trim()) return sourceList;
    const q = searchQuery.toLowerCase();
    return sourceList.filter((i) =>
      i.title.toLowerCase().includes(q) ||
      (i.parentTitle && i.parentTitle.toLowerCase().includes(q))
    );
  }, [
    activeFilterCategory,
    todayItems,
    overdueItems,
    priorityItems,
    upcomingItems,
    activeItems,
    commentedItems,
    searchQuery,
  ]);

  // Actual lists from Nexus database (no fake personal list)
  const dbLists = useMemo(() => {
    return (allLists || [])
      .map((item: any) => item.list || item)
      .filter((l: any) => l && l.id && l.id !== 'personal');
  }, [allLists]);

  const handleItemSelect = (item: NormalizedItem) => {
    if (onSelectTask) {
      onSelectTask(item.raw);
    } else {
      setActiveMobileTask(item.raw);
    }
    // Proper redirection:
    if (item.isSubtask && item.parentId) {
      router.push(`/tasks/${item.parentId}?subtask=${item.id}`);
    } else {
      router.push(`/tasks/${item.id}`);
    }
  };

  const handleAiWhatsNext = () => {
    const nextItem = overdueItems[0] || priorityItems[0] || todayItems[0] || activeItems[0];
    if (nextItem) {
      toast.info(`Next up: ${nextItem.title}`);
      handleItemSelect(nextItem);
    } else {
      toast.success("All caught up! Tap '+' to create your next task.");
    }
  };

  return (
    <div className="w-full min-h-full bg-background text-foreground flex flex-col pb-28 select-none">
      {/* ── 1. HEADER (Clean My Tasks title, NO AA avatar, NO plus) ── */}
      <div className="px-5 pt-4 pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
          My Tasks
        </h1>
      </div>

      {/* ── 2. SEARCH BAR ────────────────────────────────────── */}
      <div className="px-5 py-2">
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
            <Search className="size-4" />
          </div>
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-card border border-border rounded-2xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-indigo-500/70 transition-all shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── 3. 2-COLUMN SUMMARY CARDS GRID ───────────────────── */}
      <div className="px-5 py-3 grid grid-cols-2 gap-3">
        {/* Card 1: Today */}
        <button
          onClick={() => setActiveFilterCategory('today')}
          className="p-3.5 rounded-2xl bg-card border border-border hover:bg-hover-subtle active:scale-[0.98] transition-all text-left flex flex-col justify-between h-[84px] cursor-pointer shadow-xs"
        >
          <div className="flex items-center justify-between w-full">
            <div className="size-8 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
              <Calendar className="size-4" />
            </div>
            <span className="text-lg font-bold text-foreground font-sans">
              {todayItems.length}
            </span>
          </div>
          <span className="text-xs font-semibold text-foreground">Today</span>
        </button>

        {/* Card 2: Overdue */}
        <button
          onClick={() => setActiveFilterCategory('overdue')}
          className="p-3.5 rounded-2xl bg-card border border-border hover:bg-hover-subtle active:scale-[0.98] transition-all text-left flex flex-col justify-between h-[84px] cursor-pointer shadow-xs"
        >
          <div className="flex items-center justify-between w-full">
            <div className="size-8 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center">
              <Clock className="size-4" />
            </div>
            <span className="text-lg font-bold text-rose-400 font-sans">
              {overdueItems.length}
            </span>
          </div>
          <span className="text-xs font-semibold text-rose-400">Overdue</span>
        </button>

        {/* Card 3: My Priorities */}
        <button
          onClick={() => setActiveFilterCategory('priorities')}
          className="p-3.5 rounded-2xl bg-card border border-border hover:bg-hover-subtle active:scale-[0.98] transition-all text-left flex flex-col justify-between h-[84px] cursor-pointer shadow-xs"
        >
          <div className="flex items-center justify-between w-full">
            <div className="size-8 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <Flag className="size-4" />
            </div>
            <span className="text-lg font-bold text-foreground font-sans">
              {priorityItems.length}
            </span>
          </div>
          <span className="text-xs font-semibold text-foreground">My Priorities</span>
        </button>

        {/* Card 4: Upcoming */}
        <button
          onClick={() => setActiveFilterCategory('upcoming')}
          className="p-3.5 rounded-2xl bg-card border border-border hover:bg-hover-subtle active:scale-[0.98] transition-all text-left flex flex-col justify-between h-[84px] cursor-pointer shadow-xs"
        >
          <div className="flex items-center justify-between w-full">
            <div className="size-8 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
              <Calendar className="size-4" />
            </div>
            <span className="text-lg font-bold text-foreground font-sans">
              {upcomingItems.length}
            </span>
          </div>
          <span className="text-xs font-semibold text-foreground">Upcoming</span>
        </button>

        {/* Card 5: My Tasks */}
        <button
          onClick={() => setActiveFilterCategory('my_tasks')}
          className="p-3.5 rounded-2xl bg-card border border-border hover:bg-hover-subtle active:scale-[0.98] transition-all text-left flex flex-col justify-between h-[84px] cursor-pointer shadow-xs"
        >
          <div className="flex items-center justify-between w-full">
            <div className="size-8 rounded-xl bg-secondary text-foreground flex items-center justify-center border border-border">
              <CheckCircle2 className="size-4 text-indigo-400" />
            </div>
            <span className="text-lg font-bold text-foreground font-sans">
              {activeItems.length}
            </span>
          </div>
          <span className="text-xs font-semibold text-foreground">My Tasks</span>
        </button>

        {/* Card 6: Comments */}
        <button
          onClick={() => setActiveFilterCategory('comments')}
          className="p-3.5 rounded-2xl bg-card border border-border hover:bg-hover-subtle active:scale-[0.98] transition-all text-left flex flex-col justify-between h-[84px] cursor-pointer shadow-xs"
        >
          <div className="flex items-center justify-between w-full">
            <div className="size-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <MessageSquare className="size-4" />
            </div>
            <span className="text-lg font-bold text-foreground font-sans">
              {commentsCount}
            </span>
          </div>
          <span className="text-xs font-semibold text-foreground">Comments</span>
        </button>
      </div>

      {/* ── 4. "MY LISTS" SECTION ────────────────────────────── */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-muted-foreground">My Lists</h2>
          <button
            onClick={() => (onOpenCreateList ? onOpenCreateList() : null)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="space-y-1">
          {dbLists.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No lists found
            </div>
          ) : (
            dbLists.slice(0, 10).map((item: any) => {
              const count =
                item._count?.tasks ??
                (tasks || []).filter((t: any) => t.listId === item.id).length;
              return (
                <div
                  key={item.id}
                  onClick={() => router.push(`/lists/${item.id}`)}
                  className="py-2.5 px-2 flex items-center justify-between hover:bg-hover-subtle rounded-xl transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <CheckCheck className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {item.name}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground font-sans shrink-0">
                    {count}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 5. FLOATING AI PILL ("What's next?") ──────────────── */}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30">
        <button
          onClick={handleAiWhatsNext}
          className="px-4 py-2 rounded-full bg-card/95 border border-border shadow-2xl backdrop-blur-xl flex items-center gap-2 text-xs font-semibold text-foreground hover:text-white active:scale-95 transition-all"
        >
          <Sparkles className="size-4 text-indigo-400 fill-indigo-400/20" />
          <span>What's next?</span>
        </button>
      </div>

      {/* Filtered Tasks Sheet */}
      <ClickUpMobileFilteredTasksSheet
        isOpen={!!activeFilterCategory}
        onClose={() => setActiveFilterCategory(null)}
        category={activeFilterCategory}
        tasks={filteredItemsForSheet}
        onSelectTask={handleItemSelect}
      />
    </div>
  );
}
