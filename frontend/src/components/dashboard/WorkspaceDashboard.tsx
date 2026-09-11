'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  List as ListIcon,
  FileText,
  Plus,
  Search,
  CheckSquare,
  Layers,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Clock,
  Calendar,
  Flag,
  User as UserIcon,
  X,
  Check,
  CheckCircle2,
  Circle,
  MoreHorizontal,
  Folder as FolderIcon,
  Tag,
  SlidersHorizontal,
  CheckCheck,
  ExternalLink,
} from 'lucide-react';
import { Space, Folder, List, Doc, Task } from '@/lib/types';
import type { WorkspaceRole } from '@/types/models';
import { EntityType } from '@/components/modals/CreateEntityModal';
import {
  ListSkeleton,
  DocSkeleton,
  DashboardSkeleton,
} from '@/components/ui/Skeleton';
import { useAppStore } from '@/lib/store';
import { tasksApi } from '@/api';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/api/client';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { getRoles } from '@/api/roles';
import { toast } from '@/lib/toast';

export interface WorkspaceDashboardProps {
  activeView?: 'all' | 'my' | 'spaces' | 'lists' | 'docs' | 'folders';
  spaces: Space[];
  loading: boolean;
  onOpenCreate: (type: EntityType, spaceId?: string, folderId?: string, docId?: string) => void;
}



const isRecentItem = (dateStr?: string, maxDays = 30) => {
  if (!dateStr) return false;
  const itemDate = new Date(dateStr).getTime();
  if (isNaN(itemDate)) return false;
  const now = Date.now();
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  return now - itemDate <= maxMs;
};

// ClickUp-style Status Badges & Colors
const STATUS_STYLES: Record<string, { label: string; pill: string; dot: string; border: string }> = {
  'IN PROGRESS': {
    label: 'IN PROGRESS',
    pill: 'bg-[#D82C7C] text-white',
    dot: 'bg-[#D82C7C]',
    border: 'border-[#D82C7C]',
  },
  'IN_PROGRESS': {
    label: 'IN PROGRESS',
    pill: 'bg-[#D82C7C] text-white',
    dot: 'bg-[#D82C7C]',
    border: 'border-[#D82C7C]',
  },
  'PENDING': {
    label: 'PENDING',
    pill: 'bg-[#D97706] text-white',
    dot: 'bg-[#D97706]',
    border: 'border-[#D97706]',
  },
  'DAILY': {
    label: 'DAILY',
    pill: 'bg-[#2563EB] text-white',
    dot: 'bg-[#2563EB]',
    border: 'border-[#2563EB]',
  },
  'KYC': {
    label: 'KYC',
    pill: 'bg-[#0284C7] text-white',
    dot: 'bg-[#0284C7]',
    border: 'border-[#0284C7]',
  },
  'TODO': {
    label: 'TO DO',
    pill: 'bg-[#475569] text-white',
    dot: 'bg-[#475569]',
    border: 'border-[#475569]',
  },
  'REVIEW': {
    label: 'REVIEW',
    pill: 'bg-[#7C3AED] text-white',
    dot: 'bg-[#7C3AED]',
    border: 'border-[#7C3AED]',
  },
  'COMPLETE': {
    label: 'COMPLETE',
    pill: 'bg-[#059669] text-white',
    dot: 'bg-[#059669]',
    border: 'border-[#059669]',
  },
  'COMPLETED': {
    label: 'COMPLETED',
    pill: 'bg-[#059669] text-white',
    dot: 'bg-[#059669]',
    border: 'border-[#059669]',
  },
};

function getStatusConfig(statusName: string) {
  const normalized = (statusName || 'TODO').trim().toUpperCase();
  if (STATUS_STYLES[normalized]) {
    return STATUS_STYLES[normalized];
  }
  return {
    label: normalized,
    pill: 'bg-indigo-600 text-white',
    dot: 'bg-indigo-500',
    border: 'border-indigo-500',
  };
}

const PRIORITY_FLAGS: Record<string, { label: string; color: string; iconColor: string }> = {
  URGENT: { label: 'Urgent', color: 'text-rose-400', iconColor: 'text-rose-500 fill-rose-500' },
  HIGH: { label: 'High', color: 'text-amber-400', iconColor: 'text-amber-500 fill-amber-500' },
  MEDIUM: { label: 'Normal', color: 'text-blue-400', iconColor: 'text-blue-500 fill-blue-500' },
  NORMAL: { label: 'Normal', color: 'text-blue-400', iconColor: 'text-blue-500 fill-blue-500' },
  LOW: { label: 'Low', color: 'text-zinc-400', iconColor: 'text-zinc-400 fill-zinc-400' },
};

function WorkspaceDashboardContent({
  activeView = 'all',
  spaces = [],
  loading = false,
  onOpenCreate,
}: WorkspaceDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, allLists, allDocs } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [currentTab, setCurrentTab] = useState<'all' | 'my'>(
    searchParams?.get('filter') === 'my' || activeView === 'my' ? 'my' : 'all'
  );
  const [isRecentFilter, setIsRecentFilter] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [workspaceRoles, setWorkspaceRoles] = useState<WorkspaceRole[]>([]);

  // Inline Add Task state
  const [addingStatus, setAddingStatus] = useState<string | null>(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [isCreatingInline, setIsCreatingInline] = useState(false);

  // Sync tab with URL query parameter
  useEffect(() => {
    const filter = searchParams?.get('filter');
    if (filter === 'my' || activeView === 'my') {
      setCurrentTab('my');
    } else {
      setCurrentTab('all');
    }
  }, [searchParams, activeView]);

  // Load workspace roles for permissions inside TaskDetailModal
  useEffect(() => {
    let cancelled = false;
    getRoles()
      .then((roles) => {
        if (!cancelled && Array.isArray(roles)) setWorkspaceRoles(roles);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);


  // Set default list for inline task creation
  useEffect(() => {
    if (allLists.length > 0 && !selectedListId) {
      setSelectedListId(allLists[0].list.id);
    }
  }, [allLists, selectedListId]);

  // 1. Fetch all tasks from API
  const fetchTasks = useCallback(async () => {
    try {
      setLoadingTasks(true);
      const res = await tasksApi.getTasks();
      if (res?.tasks) {
        setTasks(res.tasks);
      }
    } catch (err) {
      console.error('Failed to load tasks for dashboard:', err);
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // 2. Real-time Synchronization via Socket.io
  useEffect(() => {
    const s = io(API_BASE_URL, { withCredentials: true });
    setSocket(s);

    s.on('connect', () => {
      // connected to global socket
    });

    s.on('task:created', (newTask: Task) => {
      setTasks((prev) => {
        if (prev.some((t) => t.id === newTask.id)) return prev;
        return [newTask, ...prev];
      });
    });

    s.on('task:updated', (updatedTask: Task) => {
      setTasks((prev) => {
        const exists = prev.some((t) => t.id === updatedTask.id);
        if (!exists) {
          return [updatedTask, ...prev];
        }
        return prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } : t));
      });
      setSelectedTask((prev) => (prev?.id === updatedTask.id ? { ...prev, ...updatedTask } : prev));
    });

    s.on('task:deleted', ({ id }: { id: string }) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setSelectedTask((prev) => (prev?.id === id ? null : prev));
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // Refresh tasks on window focus (guarantees instant sync if coming back from another tab)
  useEffect(() => {
    const handleFocus = () => {
      fetchTasks();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchTasks]);

  const handleTabChange = (tab: 'all' | 'my') => {
    setCurrentTab(tab);
    if (tab === 'my') {
      router.replace('/tasks?filter=my');
    } else {
      router.replace('/');
    }
  };

  // Filter & sort lists
  const filteredLists = useMemo(() => {
    let listItems = allLists.filter((item) =>
      item.list.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (isRecentFilter) {
      listItems = listItems
        .filter((item) => isRecentItem(item.list.updatedAt || item.list.createdAt, 30))
        .sort((a, b) => {
          const dateA = new Date(a.list.updatedAt || a.list.createdAt || 0).getTime();
          const dateB = new Date(b.list.updatedAt || b.list.createdAt || 0).getTime();
          return dateB - dateA;
        });
    }

    return listItems;
  }, [allLists, searchQuery, isRecentFilter]);

  // Filter & sort docs
  const filteredDocs = useMemo(() => {
    let docItems = allDocs.filter((item) =>
      item.doc.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (isRecentFilter) {
      docItems = docItems
        .filter((item) => isRecentItem(item.doc.updatedAt || item.doc.createdAt, 30))
        .sort((a, b) => {
          const dateA = new Date(a.doc.updatedAt || a.doc.createdAt || 0).getTime();
          const dateB = new Date(b.doc.updatedAt || b.doc.createdAt || 0).getTime();
          return dateB - dateA;
        });
    }

    return docItems;
  }, [allDocs, searchQuery, isRecentFilter]);

  // Filter & sort spaces
  const filteredSpaces = useMemo(() => {
    let spaceItems = spaces
      .filter((s) => s.id !== 'root-space')
      .filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()));

    if (isRecentFilter) {
      spaceItems = spaceItems
        .filter((s) => isRecentItem((s as any).updatedAt || (s as any).createdAt, 30))
        .sort((a, b) => {
          const dateA = new Date((a as any).updatedAt || (a as any).createdAt || 0).getTime();
          const dateB = new Date((b as any).updatedAt || (b as any).createdAt || 0).getTime();
          return dateB - dateA;
        });
    }

    return spaceItems;
  }, [spaces, searchQuery, isRecentFilter]);

  // User's assigned tasks
  const myTasks = useMemo(() => {
    if (!currentUser) return [];
    return tasks.filter((t) => {
      const isDirectAssignee =
        t.assigneeId === currentUser.id ||
        t.assignee?.id === currentUser.id ||
        (currentUser.email && t.assignee?.email === currentUser.email);
      const isMultiAssignee = t.assignees?.some(
        (a) => a.id === currentUser.id || (currentUser.email && a.email === currentUser.email)
      );
      return isDirectAssignee || isMultiAssignee;
    });
  }, [tasks, currentUser]);

  const filteredMyTasks = useMemo(() => {
    if (!searchQuery.trim()) return myTasks;
    const q = searchQuery.toLowerCase();
    return myTasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q) ||
        t.list?.name.toLowerCase().includes(q)
    );
  }, [myTasks, searchQuery]);

  // Group tasks by status (ClickUp Style!)
  const groupedTasksByStatus = useMemo(() => {
    const groups: Record<string, Task[]> = {};

    // Standard ordering priority
    const priorityOrder = ['IN PROGRESS', 'IN_PROGRESS', 'PENDING', 'DAILY', 'KYC', 'TODO', 'REVIEW', 'COMPLETED', 'COMPLETE'];

    // Group active tasks
    filteredMyTasks.forEach((t) => {
      const s = (t.status || 'TODO').trim().toUpperCase();
      if (!groups[s]) {
        groups[s] = [];
      }
      groups[s].push(t);
    });

    // Ensure common active status groups are present if we have tasks or for clean ClickUp view
    const allGroupKeys = Object.keys(groups);
    if (allGroupKeys.length === 0) {
      return [];
    }

    // Sort status groups based on ClickUp standard pipeline
    allGroupKeys.sort((a, b) => {
      const idxA = priorityOrder.indexOf(a);
      const idxB = priorityOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return allGroupKeys.map((statusKey) => ({
      status: statusKey,
      config: getStatusConfig(statusKey),
      tasks: groups[statusKey],
    }));
  }, [filteredMyTasks]);



  // Handle inline quick task creation
  const handleCreateInlineTask = async (status: string) => {
    const trimmed = inlineTaskTitle.trim();
    if (!trimmed) {
      setAddingStatus(null);
      return;
    }
    const targetListId = selectedListId || allLists[0]?.list?.id;
    if (!targetListId) {
      toast.error('Please create a list first.');
      return;
    }

    try {
      setIsCreatingInline(true);
      const res = await tasksApi.createTask({
        title: trimmed,
        status: status,
        listId: targetListId,
        assigneeIds: currentUser ? [currentUser.id] : [],
        assigneeId: currentUser?.id || null,
        priority: 'MEDIUM',
      });

      if (res?.task) {
        setTasks((prev) => [res.task, ...prev]);
        toast.success(`Task "${trimmed}" created!`);
      }
      setInlineTaskTitle('');
      setAddingStatus(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create task');
    } finally {
      setIsCreatingInline(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (selectedTask) {
    return (
      <div className="w-full h-full">
        <TaskDetailModal
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          socket={socket}
          workspaceRoles={workspaceRoles}
          onUpdateTask={(updatedTask) => {
            setSelectedTask(updatedTask);
            setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
          }}
          onStatusChange={(newStatus) => {
            if (selectedTask) {
              const updated = { ...selectedTask, status: newStatus };
              setSelectedTask(updated);
              setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 w-full h-full space-y-6">
      {/* ClickUp Header & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          {/* Breadcrumb Header matching ClickUp */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1">
            <span className="hover:text-zinc-400 cursor-pointer">My Tasks</span>
            <span>/</span>
            <span className="text-zinc-300 font-medium">
              {currentTab === 'my' ? 'Assigned to me' : 'All Tasks'}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            {currentTab === 'my' ? 'Assigned to me' : 'All Tasks'}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenCreate('LIST')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New List
          </button>

          <button
            onClick={() => onOpenCreate('DOC')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Doc
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Main Tabs: All Tasks & My Tasks */}
          <div className="flex items-center gap-1 bg-[#18181c] p-1 rounded-lg border border-zinc-800">
            <button
              onClick={() => handleTabChange('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                currentTab === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              All Tasks
            </button>
            <button
              onClick={() => handleTabChange('my')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                currentTab === 'my'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <span>My Tasks</span>
              {myTasks.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-[10px] text-indigo-200 font-mono font-bold">
                  {myTasks.length}
                </span>
              )}
            </button>
          </div>

          {/* Status View Pill Indicator (ClickUp style) */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#18181c] border border-zinc-800 text-zinc-400 text-xs font-medium">
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Group: Status</span>
          </div>

          {/* Filter for Recent (Visible in All Tasks) */}
          {currentTab === 'all' && (
            <button
              onClick={() => setIsRecentFilter(!isRecentFilter)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                isRecentFilter
                  ? 'bg-indigo-600/25 border-indigo-500/70 text-indigo-300 shadow-sm'
                  : 'bg-[#18181c] border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
              title={isRecentFilter ? 'Showing recent items (click to show all)' : 'Filter to recent items'}
            >
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Recent</span>
              {isRecentFilter && <span className="size-1.5 rounded-full bg-indigo-400" />}
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search your tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-[#18181c] border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* ─── TAB CONTENT: ALL TASKS (OVERVIEW) ─── */}
      {currentTab === 'all' && (
        <>
          {/* Lists Overview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ListIcon className="w-4 h-4 text-blue-400" />
                <h2 className="text-base font-semibold text-zinc-200">
                  Task Lists ({filteredLists.length})
                </h2>
              </div>
              <button
                onClick={() => onOpenCreate('LIST')}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Create List
              </button>
            </div>

            {filteredLists.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-2">
                <ListIcon className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-sm font-medium text-zinc-400">
                  {searchQuery ? 'No lists match your search' : 'No task lists created yet'}
                </p>
                <button
                  onClick={() => onOpenCreate('LIST')}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create First List
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredLists.map(({ list, spaceName, folderName }) => (
                  <Link
                    key={list.id}
                    href={`/lists/${list.id}`}
                    className="group p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 hover:border-blue-500/50 transition-all shadow-md flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-blue-500/15 text-blue-400">
                            <ListIcon className="w-4 h-4" />
                          </div>
                          <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors">
                            {list.name}
                          </h3>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                      </div>

                      <p className="text-[11px] text-zinc-500 truncate">
                        {[spaceName, folderName].filter(Boolean).join(' / ') || 'Workspace List'}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                      <span>{list.tasks?.length ?? 0} tasks</span>
                      <span className="text-blue-400 group-hover:underline">Open Board →</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Docs Overview */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                <h2 className="text-base font-semibold text-zinc-200">
                  Documents ({filteredDocs.length})
                </h2>
              </div>
              <button
                onClick={() => onOpenCreate('DOC')}
                className="text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Document
              </button>
            </div>

            {filteredDocs.length === 0 ? (
              <div className="p-8 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-2">
                <FileText className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-sm font-medium text-zinc-400">
                  {searchQuery ? 'No documents match your search' : 'No documents created yet'}
                </p>
                <button
                  onClick={() => onOpenCreate('DOC')}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create First Document
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredDocs.map(({ doc, spaceName, folderName }) => (
                  <Link
                    key={doc.id}
                    href={`/docs/${doc.id}`}
                    className="group p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 hover:border-purple-500/50 transition-all shadow-md flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-purple-500/15 text-purple-400">
                            <FileText className="w-4 h-4" />
                          </div>
                          <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-purple-400 transition-colors">
                            {doc.title}
                          </h3>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                      </div>

                      <p className="text-[11px] text-zinc-500 truncate">
                        {[spaceName, folderName].filter(Boolean).join(' / ') || 'Workspace Doc'}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                      <span>{doc.pages?.length ?? 0} pages</span>
                      <span className="text-purple-400 group-hover:underline">View Document →</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── TAB CONTENT: MY TASKS (CLICKUP GROUPED STATUS TABLE) ─── */}
      {currentTab === 'my' && (
        <div className="space-y-6">
          {loadingTasks ? (
            <div className="p-12 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-3">
              <div className="animate-spin size-7 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-xs text-zinc-400 font-medium">Syncing tasks in real-time...</p>
            </div>
          ) : filteredMyTasks.length === 0 ? (
            <div className="p-16 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-4 shadow-xl">
              <CheckSquare className="w-12 h-12 text-zinc-600 mx-auto opacity-40" />
              <h3 className="text-base font-semibold text-zinc-200">
                {searchQuery ? 'No matching tasks found' : 'No tasks assigned to you'}
              </h3>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
                {searchQuery
                  ? `No tasks matched your search query "${searchQuery}".`
                  : `Tasks assigned to ${currentUser?.name || 'you'} will appear here in real time.`}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => handleTabChange('all')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-md"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Browse Workspace Lists
                </button>
              )}
            </div>
          ) : (
            /* CLICKUP GROUPED STATUS SECTIONS (Matching User Screenshot 3!) */
            <div className="space-y-6">
              {groupedTasksByStatus.map(({ status, config, tasks: groupTasks }) => (
                <div key={status} className="space-y-0.5">
                  {/* Status Group Header Bar */}
                  <div className="flex items-center justify-between px-1 pb-2">
                    <div className="flex items-center gap-2">
                      {/* Status Pill Badge */}
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${config.pill} shadow-sm flex items-center gap-1`}
                      >
                        {config.label}
                        <ChevronDown className="w-3 h-3 opacity-70" />
                      </span>
                      {/* Count badge */}
                      <span className="text-xs font-semibold text-zinc-500 ml-1">{groupTasks.length}</span>
                    </div>
                  </div>

                  {/* Column Headers matching ClickUp */}
                  <div className="hidden sm:flex items-center justify-between text-[11px] font-medium text-zinc-500 px-1 pb-1.5 border-b border-zinc-800/60 w-full">
                     <span className="w-1/2 text-left pl-8">Name</span>
                     <div className="flex items-center gap-8 pr-10">
                        <span className="w-20 text-left">Priority</span>
                     </div>
                  </div>

                  {/* Task Rows List */}
                  <div className="flex flex-col w-full">
                    {groupTasks.map((task) => {
                      const priorityConfig =
                        task.priority && PRIORITY_FLAGS[task.priority]
                          ? PRIORITY_FLAGS[task.priority]
                          : { label: task.priority || 'Normal', color: 'text-zinc-500', iconColor: 'text-zinc-500' };

                      const taskAssignees =
                        task.assignees && task.assignees.length > 0
                          ? task.assignees
                          : task.assignee
                          ? [task.assignee]
                          : [];

                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          className="group relative flex items-center justify-between px-1 py-1.5 hover:bg-zinc-800/30 border-b border-zinc-800/40 transition-colors cursor-pointer"
                        >
                          {/* Left: Check/Status dot + Title + Context Breadcrumb */}
                          <div className="flex items-center gap-2.5 min-w-0 flex-1 pl-1 pr-4">
                            {/* Checkbox (Square) */}
                            <div 
                              className="w-3.5 h-3.5 rounded-[3px] border border-zinc-600 hover:border-zinc-400 shrink-0 flex items-center justify-center transition-colors shadow-sm"
                              title="Mark complete" 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                // TODO: Call status update to complete
                              }}
                            />
                            
                            {/* Status circle indicator */}
                            <div
                              className={`w-2.5 h-2.5 rounded-full ${config.dot} shrink-0`}
                              title={`Status: ${task.status}`}
                            />

                            {/* Task Title */}
                            <span className="text-[13px] text-zinc-300 group-hover:text-indigo-300 transition-colors truncate font-medium">
                              {task.title}
                            </span>
                            
                            {/* List Name aligned after title */}
                            {task.list && (
                              <span className="hidden md:inline-flex items-center text-[11px] text-zinc-600 shrink-0 max-w-[200px] truncate ml-1 font-medium group-hover:text-zinc-400 transition-colors">
                                ≡ {task.list.name}
                              </span>
                            )}

                            {/* Subtask icon & count */}
                            {task.subtasks && task.subtasks.length > 0 && (
                              <span className="flex items-center gap-1 text-[11px] text-zinc-500 font-mono shrink-0 ml-1">
                                <ListIcon className="w-3 h-3 text-zinc-500" />
                                {task.subtasks.filter((st: any) => st.isCompleted).length}/{task.subtasks.length}
                              </span>
                            )}
                          </div>

                          {/* Right: Assignees + Priority + Due Date + More */}
                          <div className="flex items-center gap-8 shrink-0 pr-2">
                            {/* ClickUp-style Stacked Avatars */}
                            <div
                              className="hidden sm:flex items-center -space-x-1"
                              title={taskAssignees.map((a) => a.name).join(', ') || 'Unassigned'}
                            >
                              {taskAssignees.slice(0, 3).map((a) => (
                                <div
                                  key={a.id}
                                  className="w-5 h-5 rounded-full ring-2 ring-[#18181c] flex items-center justify-center text-[9px] font-bold text-white overflow-hidden bg-indigo-600 shrink-0"
                                >
                                  {a.avatarUrl ? (
                                    <img src={a.avatarUrl} alt={a.name} className="w-full h-full object-cover" />
                                  ) : (
                                    (a.name || 'U').charAt(0).toUpperCase()
                                  )}
                                </div>
                              ))}
                              {taskAssignees.length === 0 && (
                                <div className="w-5 h-5 rounded-full border border-dashed border-zinc-700 flex items-center justify-center text-[10px] text-zinc-500 bg-[#18181c] shadow-sm shrink-0">
                                  <UserIcon className="w-3 h-3" />
                                </div>
                              )}
                            </div>

                            {/* Priority Column */}
                            <div className="hidden sm:flex items-center gap-1.5 w-20">
                              <Flag className={`w-3.5 h-3.5 ${priorityConfig.iconColor}`} />
                              <span className={`text-[11px] font-medium ${priorityConfig.color}`}>
                                {priorityConfig.label}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Inline Task Creation Form for this Status Group */}
                    {addingStatus === status ? (
                      <div className="p-2 border-b border-zinc-800/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-[#18181c]">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Task name"
                          value={inlineTaskTitle}
                          onChange={(e) => setInlineTaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCreateInlineTask(status);
                            } else if (e.key === 'Escape') {
                              setAddingStatus(null);
                            }
                          }}
                          className="flex-1 px-2 py-1 bg-transparent border-none text-[13px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-0"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCreateInlineTask(status)}
                            disabled={!inlineTaskTitle.trim() || isCreatingInline}
                            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                          >
                            {isCreatingInline ? 'Adding...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ClickUp "+ Add Task" row below group tasks */
                      <div className="group flex items-center justify-between px-1 py-1.5 hover:bg-zinc-800/20 border-b border-zinc-800/40 transition-colors cursor-pointer">
                        <button
                          onClick={() => {
                            setAddingStatus(status);
                            setInlineTaskTitle('');
                          }}
                          className="flex items-center gap-2 text-xs font-medium text-zinc-500 group-hover:text-zinc-400 pl-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Task</span>
                        </button>
                        <div className="hidden sm:flex items-center gap-8 pr-10 opacity-0">
                           <span className="w-20"></span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}


        </div>
      )}
    </div>
  );
}

export function WorkspaceDashboard(props: WorkspaceDashboardProps) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <WorkspaceDashboardContent {...props} />
    </Suspense>
  );
}
