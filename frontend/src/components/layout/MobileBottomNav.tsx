'use client';

import React, { useState, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckSquare,
  Rocket,
  FolderKanban,
  Bell,
  Plus,
  X,
  ExternalLink,
  ChevronDown,
  Calendar,
  Filter,
  Check,
  ArrowRight,
  ListTodo,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { isGalaxyTask } from '@/lib/galaxyTask';
import { getPriorityConfig } from '@/lib/priority';
import { tasksApi } from '@/api/tasks';
import { toast } from '@/lib/toast';
import { ClickUpMobileCreateModal } from '@/components/mobile/ClickUpMobileCreateModal';

const STATUS_OPTIONS = ['PENDING', 'IN PROGRESS', 'CHECKING', 'DONE', 'CLOSED'];

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const {
    tasks,
    spaces,
    allLists,
    unreadNotifications,
    activeMobileTask,
    setActiveMobileTask,
    isGalaxyFilterActive,
    toggleGalaxyFilter,
    updateTask,
    mobileActiveTab,
    setMobileActiveTab,
    isMobileCreateOpen,
    setIsMobileCreateOpen,
  } = useAppStore();

  const [isGalaxySheetOpen, setIsGalaxySheetOpen] = useState(false);
  const [isListsSheetOpen, setIsListsSheetOpen] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Compute all tasks originating from Galaxy AI / VIP Scale
  const galaxyTasks = useMemo(() => {
    return (tasks || []).filter((t) => isGalaxyTask(t));
  }, [tasks]);

  const priorityConfig = useMemo(() => {
    return activeMobileTask ? getPriorityConfig(activeMobileTask.priority) : null;
  }, [activeMobileTask]);

  const handleStatusChange = async (newStatus: string) => {
    if (!activeMobileTask || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    setIsStatusDropdownOpen(false);

    try {
      const res = await tasksApi.updateTask(activeMobileTask.id, { status: newStatus });
      const updated = res.task || { ...activeMobileTask, status: newStatus };
      updateTask(updated);
      setActiveMobileTask(updated);
      toast.success(`Task moved to ${newStatus}`);
    } catch {
      toast.error('Failed to update task status');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleOpenFullTask = (task: any) => {
    if (!task) return;
    router.push(`/tasks/${task.id}`);
  };

  const isInboxActive =
    (mobileActiveTab === 'inbox' && pathname === '/') || pathname.startsWith('/activity');
  const isMyTasksActive =
    (mobileActiveTab === 'my_tasks' && pathname === '/') ||
    (!isInboxActive && pathname === '/');

  return (
    <>
      {/* ── GALAXY TASK SELECTION SHEET ───────────────────────── */}
      <AnimatePresence>
        {isGalaxySheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsGalaxySheetOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 md:hidden"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="fixed inset-x-0 bottom-0 z-50 bg-card border-t border-border rounded-t-3xl max-h-[82vh] flex flex-col md:hidden shadow-2xl safe-bottom text-foreground"
            >
              <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-sky-500/15 text-sky-400">
                    <Rocket className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Galaxy Tasks</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {galaxyTasks.length} task{galaxyTasks.length !== 1 ? 's' : ''} from VIP Scale Galaxy
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsGalaxySheetOpen(false)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Action Toolbar */}
              <div className="px-4 py-2.5 bg-secondary/50 border-b border-border flex items-center justify-between gap-2 shrink-0">
                <button
                  onClick={toggleGalaxyFilter}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    isGalaxyFilterActive
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'bg-card border border-border text-foreground hover:bg-hover-subtle'
                  }`}
                >
                  <Filter className="size-3.5" />
                  <span>{isGalaxyFilterActive ? 'Showing Galaxy Tasks Only' : 'Filter View to Galaxy'}</span>
                </button>

                <a
                  href="https://tools.vipscaleph.com/protected/galaxy-task"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg text-xs text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 transition-colors flex items-center gap-1 font-medium"
                >
                  <span>VIP Scale Portal</span>
                  <ExternalLink className="size-3" />
                </a>
              </div>

              {/* Galaxy Tasks List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {galaxyTasks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-xs">
                    <Rocket className="size-8 mx-auto mb-2 opacity-40 text-sky-400" />
                    <p>No Galaxy tasks found in workspace.</p>
                  </div>
                ) : (
                  galaxyTasks.map((task) => {
                    const isSelected = activeMobileTask?.id === task.id;
                    return (
                      <div
                        key={task.id}
                        onClick={() => {
                          setActiveMobileTask(task);
                          setIsGalaxySheetOpen(false);
                          router.push(`/tasks/${task.id}`);
                        }}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 ${
                          isSelected
                            ? 'bg-sky-500/10 border-sky-500/50 shadow-xs'
                            : 'bg-card border-border hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-xs leading-snug line-clamp-2 text-foreground">
                            {task.title || 'Untitled Galaxy Task'}
                          </span>
                          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
                            {task.status}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── LISTS & SPACES QUICK JUMP SHEET ───────────────────── */}
      <AnimatePresence>
        {isListsSheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsListsSheetOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 md:hidden"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="fixed inset-x-0 bottom-0 z-50 bg-card border-t border-border rounded-t-3xl max-h-[75vh] flex flex-col md:hidden shadow-2xl safe-bottom text-foreground"
            >
              <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400">
                    <ListTodo className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Jump to List</h3>
                    <p className="text-[11px] text-muted-foreground">Select a client list or board</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsListsSheetOpen(false)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {spaces.map((space) => {
                  const spaceLists = (allLists || []).filter(
                    (item: any) => item.list?.spaceId === space.id
                  );
                  if (spaceLists.length === 0) return null;

                  return (
                    <div key={space.id} className="space-y-1.5">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                        {space.name}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {spaceLists.map((item: any) => {
                          const l = item.list;
                          const isCurrent = pathname === `/lists/${l.id}`;
                          return (
                            <button
                              key={l.id}
                              onClick={() => {
                                router.push(`/lists/${l.id}`);
                                setIsListsSheetOpen(false);
                              }}
                              className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-0.5 cursor-pointer ${
                                isCurrent
                                  ? 'bg-indigo-600/15 border-indigo-500 text-indigo-400 font-semibold'
                                  : 'bg-card border-border hover:bg-hover-subtle text-foreground'
                              }`}
                            >
                              <span className="text-xs font-bold truncate">{l.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {l._count?.tasks || 0} tasks
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── GLOBAL MOBILE BOTTOM NAVBAR ───────────────────────── */}
      <nav
        aria-label="Mobile application navigation"
        className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-card/95 border-t border-border backdrop-blur-xl shadow-2xl transition-all duration-300"
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}
      >
        {activeMobileTask ? (
          /* ── ACTIVE TASK QUICK INSPECTOR ── */
          <div className="p-3 flex flex-col gap-2.5 animate-mobile-sheet-up">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                    Active Task
                  </span>
                  {isGalaxyTask(activeMobileTask) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                      <Rocket className="size-2.5" />
                      Galaxy
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
                  {activeMobileTask.title || 'Untitled Task'}
                </h4>
              </div>

              <button
                onClick={() => setActiveMobileTask(null)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Deselect task"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Chips row */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
              <div className="relative shrink-0">
                <button
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  disabled={isUpdatingStatus}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center gap-1 cursor-pointer"
                >
                  <span className="size-1.5 rounded-full bg-indigo-400" />
                  <span className="truncate max-w-[100px]">{activeMobileTask.status}</span>
                  <ChevronDown className="size-3 opacity-70" />
                </button>

                {isStatusDropdownOpen && (
                  <div className="absolute bottom-full left-0 mb-1 w-44 bg-card border border-border rounded-xl shadow-2xl p-1 z-50 text-xs space-y-0.5 max-h-48 overflow-y-auto">
                    {STATUS_OPTIONS.map((status) => (
                      <button
                        key={status}
                        onClick={() => handleStatusChange(status)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                          activeMobileTask.status === status
                            ? 'bg-indigo-600 text-white font-semibold'
                            : 'hover:bg-hover-subtle text-foreground'
                        }`}
                      >
                        <span className="truncate">{status}</span>
                        {activeMobileTask.status === status && <Check className="size-3.5" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {priorityConfig && (
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary text-foreground border border-border">
                  <span className="capitalize">{String(activeMobileTask.priority).toLowerCase()}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleOpenFullTask(activeMobileTask)}
                className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-98 transition-transform"
              >
                <span>Open Full Details</span>
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          /* ── NEXUS 5-POSITION DOCK ────────────────────────────── */
          <div className="grid grid-cols-5 items-center px-2 py-1 max-w-md mx-auto">
            {/* 1. Tasks / Hub */}
            <button
              onClick={() => {
                setMobileActiveTab('my_tasks');
                if (pathname !== '/') router.push('/');
              }}
              className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
                isMyTasksActive
                  ? 'text-indigo-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <CheckSquare className="size-4 mb-0.5" />
              <span className="text-[10px]">Tasks</span>
            </button>

            {/* 2. Galaxy Tasks */}
            <button
              onClick={() => setIsGalaxySheetOpen(true)}
              className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all relative cursor-pointer ${
                isGalaxyFilterActive
                  ? 'text-sky-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="relative">
                <Rocket className="size-4 mb-0.5 text-sky-400" />
                {galaxyTasks.length > 0 && (
                  <span className="absolute -top-1 -right-2 px-1 py-0.1 min-w-[14px] text-center rounded-full text-[8px] font-bold bg-sky-500 text-white">
                    {galaxyTasks.length}
                  </span>
                )}
              </div>
              <span className="text-[10px]">Galaxy</span>
            </button>

            {/* 3. Quick Create (+) */}
            <button
              onClick={() => setIsMobileCreateOpen(true)}
              className="flex flex-col items-center justify-center py-0.5 cursor-pointer"
              title="Create in Nexus"
            >
              <div className="size-9 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-md active:scale-95 transition-transform">
                <Plus className="size-5" />
              </div>
            </button>

            {/* 4. Lists */}
            <button
              onClick={() => setIsListsSheetOpen(true)}
              className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
                pathname.startsWith('/lists')
                  ? 'text-indigo-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FolderKanban className="size-4 mb-0.5" />
              <span className="text-[10px]">Lists</span>
            </button>

            {/* 5. Activity */}
            <button
              onClick={() => {
                setMobileActiveTab('inbox');
                if (pathname !== '/') router.push('/');
              }}
              className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all relative cursor-pointer ${
                isInboxActive
                  ? 'text-indigo-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="relative">
                <Bell className="size-4 mb-0.5" />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-2 px-1 py-0.1 min-w-[14px] text-center rounded-full text-[8px] font-bold bg-rose-500 text-white">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </div>
              <span className="text-[10px]">Activity</span>
            </button>
          </div>
        )}
      </nav>

      {/* ── NEXUS CREATE MODAL ────────────────────────────────── */}
      <ClickUpMobileCreateModal
        isOpen={isMobileCreateOpen}
        onClose={() => setIsMobileCreateOpen(false)}
        onOpenCreateList={() => setIsListsSheetOpen(true)}
        onOpenGalaxyTasks={() => setIsGalaxySheetOpen(true)}
      />
    </>
  );
}
