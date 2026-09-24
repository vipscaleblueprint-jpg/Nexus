"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Suspense,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  List as ListIcon,
  FileText,
  Plus,
  Search,
  CheckSquare,
  Layers,
  Menu,
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
} from "lucide-react";
import { Space, Folder, List, Doc, Task } from "@/lib/types";
import type { WorkspaceRole } from "@/types/models";
import { EntityType } from "@/components/modals/CreateEntityModal";
import {
  ListSkeleton,
  DocSkeleton,
  DashboardSkeleton,
} from "@/components/ui/Skeleton";
import { useAppStore } from "@/lib/store";
import { tasksApi } from "@/api";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "@/api/client";
import { TaskDetailModal } from "@/components/modals/TaskDetailModal";
import { getRoles } from "@/api/roles";
import { toast } from "@/lib/toast";

export interface WorkspaceDashboardProps {
  activeView?: "all" | "my" | "spaces" | "lists" | "docs" | "folders";
  spaces: Space[];
  loading: boolean;
  onOpenCreate: (
    type: EntityType,
    spaceId?: string,
    folderId?: string,
    docId?: string,
  ) => void;
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
const STATUS_STYLES: Record<
  string,
  { label: string; pill: string; dot: string; border: string }
> = {
  "IN PROGRESS": {
    label: "IN PROGRESS",
    pill: "bg-[#D82C7C] text-white",
    dot: "bg-[#D82C7C]",
    border: "border-[#D82C7C]",
  },
  IN_PROGRESS: {
    label: "IN PROGRESS",
    pill: "bg-[#D82C7C] text-white",
    dot: "bg-[#D82C7C]",
    border: "border-[#D82C7C]",
  },
  PENDING: {
    label: "PENDING",
    pill: "bg-[#D97706] text-white",
    dot: "bg-[#D97706]",
    border: "border-[#D97706]",
  },
  DAILY: {
    label: "DAILY",
    pill: "bg-[#2563EB] text-white",
    dot: "bg-[#2563EB]",
    border: "border-[#2563EB]",
  },
  KYC: {
    label: "KYC",
    pill: "bg-[#0284C7] text-white",
    dot: "bg-[#0284C7]",
    border: "border-[#0284C7]",
  },
  TODO: {
    label: "TO DO",
    pill: "bg-[#475569] text-white",
    dot: "bg-[#475569]",
    border: "border-[#475569]",
  },
  REVIEW: {
    label: "REVIEW",
    pill: "bg-[#7C3AED] text-white",
    dot: "bg-[#7C3AED]",
    border: "border-[#7C3AED]",
  },
  COMPLETE: {
    label: "COMPLETE",
    pill: "bg-[#059669] text-white",
    dot: "bg-[#059669]",
    border: "border-[#059669]",
  },
  COMPLETED: {
    label: "COMPLETED",
    pill: "bg-[#059669] text-white",
    dot: "bg-[#059669]",
    border: "border-[#059669]",
  },
};

const getHexColor = (color: string) => {
  const colors: Record<string, string> = {
    slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
    red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
    green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
    blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
    pink: '#ec4899', rose: '#f43f5e'
  };
  return colors[color] || color;
};

function getStatusConfig(statusName: string, allLists?: any[]) {
  const normalized = (statusName || "TODO").trim().toUpperCase();
  
  if (allLists) {
    for (const listData of allLists) {
      if (listData.list && listData.list.statuses) {
        const customStatus = listData.list.statuses.find((s: any) => (s.name || s.status || s.title)?.trim().toUpperCase() === normalized);
        if (customStatus && customStatus.color) {
          return {
            label: customStatus.name || statusName,
            customColor: getHexColor(customStatus.color),
            pill: "text-white",
            dot: "",
            border: ""
          };
        }
      }
    }
  }

  if (STATUS_STYLES[normalized]) {
    return STATUS_STYLES[normalized];
  }
  return {
    label: normalized,
    pill: "bg-indigo-600 text-white",
    dot: "bg-indigo-500",
    border: "border-indigo-500",
  };
}

const PRIORITY_FLAGS: Record<
  string,
  { label: string; color: string; iconColor: string }
> = {
  URGENT: {
    label: "Urgent",
    color: "text-rose-400",
    iconColor: "text-rose-500 fill-rose-500",
  },
  HIGH: {
    label: "High",
    color: "text-amber-400",
    iconColor: "text-amber-500 fill-amber-500",
  },
  MEDIUM: {
    label: "Normal",
    color: "text-blue-400",
    iconColor: "text-blue-500 fill-blue-500",
  },
  NORMAL: {
    label: "Normal",
    color: "text-blue-400",
    iconColor: "text-blue-500 fill-blue-500",
  },
  LOW: {
    label: "Low",
    color: "text-zinc-400",
    iconColor: "text-zinc-400 fill-zinc-400",
  },
};

function WorkspaceDashboardContent({
  activeView = "all",
  spaces = [],
  loading = false,
  onOpenCreate,
}: WorkspaceDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, allLists, allDocs, tasks, loadingTasks, loadTasks, addTask, updateTask, removeTask, hydrateTasksFromCache } = useAppStore();

  const [searchQuery, setSearchQuery] = useState("");
  // All Tasks Filters & Sort
  const [sortBy, setSortBy] = useState<
    "recent" | "client" | "priority" | "status"
  >("recent");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [currentTab, setCurrentTab] = useState<"all" | "my" | "clients" | "priorities">(
    searchParams?.get("filter") === "my" || activeView === "my" ? "my" : "all",
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [workspaceRoles, setWorkspaceRoles] = useState<WorkspaceRole[]>([]);

  // Track local updates to prevent socket echoes from causing UI bouncing
  const pendingTaskUpdatesRef = useRef<Record<string, number>>({});

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  // Inline Add Task state
  const [addingStatus, setAddingStatus] = useState<string | null>(null);
  const [inlineTaskTitle, setInlineTaskTitle] = useState("");
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [isCreatingInline, setIsCreatingInline] = useState(false);

  // Sync tab with URL query parameter
  useEffect(() => {
    const filter = searchParams?.get("filter");
    if (filter === "my" || activeView === "my") {
      setCurrentTab("my");
    } else if (filter === "clients") {
      setCurrentTab("clients");
    } else if (filter === "priorities") {
      setCurrentTab("priorities");
    } else {
      setCurrentTab("all");
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

  // 1. Fetch all tasks from API and Hydrate from Cache
  useEffect(() => {
    hydrateTasksFromCache();
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Real-time Synchronization via Socket.io
  useEffect(() => {
    const s = io(API_BASE_URL, { withCredentials: true });
    setSocket(s);

    s.on("connect", () => {
      // connected to global socket
    });

    s.on("task:created", (newTask: Task) => {
      addTask(newTask);
    });

    s.on("task:updated", (updatedTask: Task) => {
      const lastUpdated = pendingTaskUpdatesRef.current[updatedTask.id];
      if (lastUpdated && Date.now() - lastUpdated < 5000) {
        return;
      }
      
      updateTask(updatedTask);
      setSelectedTask((prev) =>
        prev?.id === updatedTask.id ? { ...prev, ...updatedTask } : prev,
      );
    });

    s.on("task:deleted", ({ id }: { id: string }) => {
      removeTask(id);
      setSelectedTask((prev) => (prev?.id === id ? null : prev));
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // Refresh tasks on window focus (guarantees instant sync if coming back from another tab)
  useEffect(() => {
    const handleFocus = () => {
      loadTasks(true);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadTasks]);

  const handleTabChange = (tab: "all" | "my" | "clients" | "priorities") => {
    setCurrentTab(tab);
    if (tab === "all") {
      router.replace("/");
    } else {
      router.replace(`/tasks?filter=${tab}`);
    }
  };

  // Filter & sort lists
  // Filter & sort lists
  const filteredLists = useMemo(() => {
    return allLists.filter((item) =>
      item.list.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [allLists, searchQuery]);

  // Filter & sort docs
  const filteredDocs = useMemo(() => {
    return allDocs.filter((item) =>
      item.doc.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [allDocs, searchQuery]);

  // Filter & sort spaces
  const filteredSpaces = useMemo(() => {
    return spaces
      .filter((s) => s.id !== "root-space")
      .filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [spaces, searchQuery]);

  // User's assigned tasks
  const myTasks = useMemo(() => {
    if (!currentUser) return [];
    return tasks.filter((t) => {
      const isDirectAssignee =
        t.assigneeId === currentUser.id ||
        t.assignee?.id === currentUser.id ||
        (currentUser.email && t.assignee?.email === currentUser.email);
      const isMultiAssignee = t.assignees?.some(
        (a) =>
          a.id === currentUser.id ||
          (currentUser.email && a.email === currentUser.email),
      );
      return isDirectAssignee || isMultiAssignee;
    });
  }, [tasks, currentUser]);

  const filteredMyTasks = useMemo(() => {
    let result = [...myTasks];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.status.toLowerCase().includes(q) ||
          t.list?.name.toLowerCase().includes(q),
      );
    }

    if (filterPriority !== "all") {
      result = result.filter(
        (t) => (t.priority || "NORMAL").toUpperCase() === filterPriority,
      );
    }

    if (filterStatus !== "all") {
      result = result.filter(
        (t) => (t.status || "TODO").toUpperCase() === filterStatus,
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "recent") {
        return (
          new Date((b as any).updatedAt || b.createdAt || 0).getTime() -
          new Date((a as any).updatedAt || a.createdAt || 0).getTime()
        );
      } else if (sortBy === "client") {
        const clientA = (a.list?.name || "").toLowerCase();
        const clientB = (b.list?.name || "").toLowerCase();
        return clientA.localeCompare(clientB);
      } else if (sortBy === "priority") {
        const pOrder = ["URGENT", "HIGH", "MEDIUM", "NORMAL", "LOW"];
        const pA = pOrder.indexOf((a.priority || "NORMAL").toUpperCase());
        const pB = pOrder.indexOf((b.priority || "NORMAL").toUpperCase());
        return pA - pB;
      } else if (sortBy === "status") {
        const sA = (a.status || "TODO").toUpperCase();
        const sB = (b.status || "TODO").toUpperCase();
        return sA.localeCompare(sB);
      }
      return 0;
    });

    return result;
  }, [myTasks, searchQuery, filterPriority, filterStatus, sortBy]);

  // All Tasks filtering and sorting
  const filteredAllTasks = useMemo(() => {
    let result = [...tasks];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.status.toLowerCase().includes(q) ||
          t.list?.name.toLowerCase().includes(q),
      );
    }

    if (filterAssignee !== "all") {
      result = result.filter(
        (t) =>
          t.assigneeId === filterAssignee ||
          t.assignee?.id === filterAssignee ||
          t.assignees?.some((a) => a.id === filterAssignee),
      );
    }

    if (filterPriority !== "all") {
      result = result.filter(
        (t) => (t.priority || "NORMAL").toUpperCase() === filterPriority,
      );
    }

    if (filterStatus !== "all") {
      result = result.filter(
        (t) => (t.status || "TODO").toUpperCase() === filterStatus,
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "recent") {
        return (
          new Date((b as any).updatedAt || b.createdAt || 0).getTime() -
          new Date((a as any).updatedAt || a.createdAt || 0).getTime()
        );
      } else if (sortBy === "client") {
        const clientA = (a.list?.name || "").toLowerCase();
        const clientB = (b.list?.name || "").toLowerCase();
        return clientA.localeCompare(clientB);
      } else if (sortBy === "priority") {
        const pOrder = ["URGENT", "HIGH", "MEDIUM", "NORMAL", "LOW"];
        const pA = pOrder.indexOf((a.priority || "NORMAL").toUpperCase());
        const pB = pOrder.indexOf((b.priority || "NORMAL").toUpperCase());
        return pA - pB;
      } else if (sortBy === "status") {
        const sA = (a.status || "TODO").toUpperCase();
        const sB = (b.status || "TODO").toUpperCase();
        return sA.localeCompare(sB);
      }
      return 0;
    });

    return result;
  }, [
    tasks,
    searchQuery,
    filterAssignee,
    filterPriority,
    filterStatus,
    sortBy,
  ]);

  const groupedAllTasksByStatus = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    const priorityOrder = [
      "IN PROGRESS",
      "IN_PROGRESS",
      "PENDING",
      "DAILY",
      "KYC",
      "TODO",
      "REVIEW",
      "COMPLETED",
      "COMPLETE",
    ];
    filteredAllTasks.forEach((t) => {
      const s = (t.status || "TODO").trim().toUpperCase();
      if (!groups[s]) groups[s] = [];
      groups[s].push(t);
    });
    const allGroupKeys = Object.keys(groups);
    if (allGroupKeys.length === 0) return [];
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
      config: getStatusConfig(statusKey, allLists),
      tasks: groups[statusKey],
    }));
  }, [filteredAllTasks]);

  const groupedAllTasksByPriority = useMemo(() => {
    const priorityGroups: Record<string, Record<string, Task[]>> = {};
    const priorityOrder = ["URGENT", "HIGH", "MEDIUM", "NORMAL", "LOW", "EMPTY"];
    
    // Initialize all priorities so they show even if empty
    priorityOrder.forEach(p => { priorityGroups[p] = {}; });

    filteredAllTasks.forEach((t) => {
      const p = t.priority ? t.priority.toUpperCase() : "EMPTY";
      const s = (t.status || "TODO").trim().toUpperCase();
      if (!priorityGroups[p]) priorityGroups[p] = {};
      if (!priorityGroups[p][s]) priorityGroups[p][s] = [];
      priorityGroups[p][s].push(t);
    });

    const statusOrder = [
      "IN PROGRESS",
      "IN_PROGRESS",
      "PENDING",
      "DAILY",
      "KYC",
      "TODO",
      "REVIEW",
      "COMPLETED",
      "COMPLETE",
    ];

    const allGroupKeys = Object.keys(priorityGroups);
    if (allGroupKeys.length === 0) return [];
    allGroupKeys.sort((a, b) => {
      const idxA = priorityOrder.indexOf(a);
      const idxB = priorityOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return allGroupKeys.map((priorityKey) => {
      const config = PRIORITY_FLAGS[priorityKey] || {
        label: priorityKey === "EMPTY" ? "No Priority" : priorityKey,
        color: "text-zinc-500",
        iconColor: "text-zinc-500",
      };

      const statusGroups = priorityGroups[priorityKey];
      const statusKeys = Object.keys(statusGroups).sort((a, b) => {
        const idxA = statusOrder.indexOf(a);
        const idxB = statusOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });

      const subGroups = statusKeys.map((statusKey) => ({
        status: statusKey,
        config: getStatusConfig(statusKey, allLists),
        tasks: statusGroups[statusKey],
      }));

      const totalTasks = subGroups.reduce((acc, sg) => acc + sg.tasks.length, 0);

      return {
        priority: priorityKey,
        config,
        tasks: [],
        subGroups,
        totalTasks
      };
    });
  }, [filteredAllTasks]);

  const groupedAllTasksByClient = useMemo(() => {
    const clientGroups: Record<string, Record<string, Task[]>> = {};
    filteredAllTasks.forEach((t) => {
      const c = t.list?.name || "Workspace";
      const s = (t.status || "TODO").trim().toUpperCase();
      if (!clientGroups[c]) clientGroups[c] = {};
      if (!clientGroups[c][s]) clientGroups[c][s] = [];
      clientGroups[c][s].push(t);
    });

    const priorityOrder = [
      "IN PROGRESS",
      "IN_PROGRESS",
      "PENDING",
      "DAILY",
      "KYC",
      "TODO",
      "REVIEW",
      "COMPLETED",
      "COMPLETE",
    ];

    const allClientKeys = Object.keys(clientGroups);
    if (allClientKeys.length === 0) return [];
    allClientKeys.sort((a, b) => a.localeCompare(b));

    return allClientKeys.map((clientKey) => {
      const statusGroups = clientGroups[clientKey];
      const statusKeys = Object.keys(statusGroups).sort((a, b) => {
        const idxA = priorityOrder.indexOf(a);
        const idxB = priorityOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });

      const subGroups = statusKeys.map((statusKey) => ({
        status: statusKey,
        config: getStatusConfig(statusKey, allLists),
        tasks: statusGroups[statusKey],
      }));

      const totalTasks = subGroups.reduce((acc, sg) => acc + sg.tasks.length, 0);

      return {
        client: clientKey,
        tasks: [],
        subGroups,
        totalTasks
      };
    });
  }, [filteredAllTasks]);

  // Group tasks by status (ClickUp Style!)
  const groupedTasksByStatus = useMemo(() => {
    const groups: Record<string, Task[]> = {};

    // Standard ordering priority
    const priorityOrder = [
      "IN PROGRESS",
      "IN_PROGRESS",
      "PENDING",
      "DAILY",
      "KYC",
      "TODO",
      "REVIEW",
      "COMPLETED",
      "COMPLETE",
    ];

    // Group active tasks
    filteredMyTasks.forEach((t) => {
      const s = (t.status || "TODO").trim().toUpperCase();
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
      config: getStatusConfig(statusKey, allLists),
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
      toast.error("Please create a list first.");
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
        priority: "MEDIUM",
      });

      if (res?.task) {
        addTask(res.task);
        toast.success(`Task "${trimmed}" created!`);
      }
      setInlineTaskTitle("");
      setAddingStatus(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to create task");
    } finally {
      setIsCreatingInline(false);
    }
  };

  // Define active groupings based on current tab
  const activeGroups = useMemo(() => {
    if (currentTab === "all") {
      return groupedAllTasksByStatus.map(g => ({
        key: g.status,
        label: g.config.label,
        pillClass: g.config.pill,
        customColor: (g.config as any).customColor,
        tasks: g.tasks,
      }));
    }
    if (currentTab === "priorities") {
      return groupedAllTasksByPriority.map(g => ({
        key: g.priority,
        label: g.config.label,
        pillClass: `bg-zinc-800/80 ${g.config.color}`,
        customColor: undefined,
        tasks: g.tasks,
        subGroups: g.subGroups,
        totalTasks: g.totalTasks
      }));
    }
    if (currentTab === "clients") {
      return groupedAllTasksByClient.map(g => ({
        key: g.client,
        label: g.client,
        pillClass: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
        tasks: g.tasks,
        subGroups: g.subGroups,
        totalTasks: g.totalTasks
      }));
    }
    return [];
  }, [currentTab, groupedAllTasksByStatus, groupedAllTasksByPriority, groupedAllTasksByClient]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="p-6 w-full h-full space-y-6 relative">
      <TaskDetailModal
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        task={selectedTask || null}
        mode="full"
        socket={socket}
        workspaceRoles={workspaceRoles}
        onUpdateTask={(updatedTask) => {
          pendingTaskUpdatesRef.current[updatedTask.id] = Date.now();
          setSelectedTask(updatedTask);
          updateTask(updatedTask);
        }}
        onStatusChange={(newStatus) => {
          if (selectedTask) {
            const updated = { ...selectedTask, status: newStatus };
            pendingTaskUpdatesRef.current[updated.id] = Date.now();
            setSelectedTask(updated);
            updateTask(updated);
          }
        }}
      />

      {/* ClickUp Header & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          {/* Breadcrumb Header matching ClickUp */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1">
            <span className="hover:text-zinc-400 cursor-pointer">My Tasks</span>
            <span>/</span>
            <span className="text-zinc-300 font-medium">
              {currentTab === "my" ? "Assigned to me" : "All Tasks"}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            {currentTab === "my" ? "Assigned to me" : "All Tasks"}
          </h1>
        </div>

      </div>


      {/* ─── TOOLBAR ─── */}
      <div className="flex flex-col gap-3 border-b border-zinc-800/80 pb-4">

        {/* Row 1: Search bar — full width, prominent */}
        <div className="relative w-full">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search tasks, lists, statuses…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 bg-[#18181c] border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Row 2: Tabs (left) + Sort & Filter controls (right) */}
        <div className="flex items-center justify-between gap-3 flex-wrap">

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-[#18181c] p-1 rounded-lg border border-zinc-800 shrink-0">
            <button
              onClick={() => handleTabChange("all")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                currentTab === "all"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }`}
            >
              All Tasks
            </button>
            <button
              onClick={() => handleTabChange("my")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                currentTab === "my"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }`}
            >
              <span>My Tasks</span>
              {myTasks.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/30 text-[10px] text-indigo-200 font-mono font-bold">
                  {myTasks.length}
                </span>
              )}
            </button>
            <button
              onClick={() => handleTabChange("clients")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                currentTab === "clients"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }`}
            >
              Clients
            </button>
            <button
              onClick={() => handleTabChange("priorities")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                currentTab === "priorities"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }`}
            >
              Priorities
            </button>
          </div>

          {/* Sort + Filter controls (uniform pill-selects) */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* Sort */}
            <div className="relative flex items-center group">
              <Menu className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className={`appearance-none h-8 pl-7 pr-7 bg-[#18181c] border text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer ${
                  sortBy !== "recent" ? "border-indigo-500/60 text-indigo-300" : "border-zinc-800 hover:border-zinc-700 text-zinc-300"
                }`}
              >
                <option value="recent">Recent</option>
                <option value="status">Status</option>
              </select>
              {sortBy !== "recent" && (
                <button
                  onClick={(e) => { e.stopPropagation(); setSortBy("recent"); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-zinc-800 border border-zinc-700 rounded-[3px] shadow-sm items-center justify-center hidden group-hover:flex hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
              <ChevronDown className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 ${sortBy !== "recent" ? "group-hover:hidden" : ""}`} />
            </div>

            <div className="w-px h-5 bg-zinc-800 shrink-0" />

            {/* Filter: Assignee (Only on All Tasks) */}
            {currentTab === "all" && (
              <div className="relative flex items-center group">
                <UserIcon className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <select
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className={`appearance-none h-8 pl-7 pr-7 bg-[#18181c] border text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer ${
                    filterAssignee !== "all" ? "border-indigo-500/60 text-indigo-300" : "border-zinc-800 hover:border-zinc-700 text-zinc-300"
                  }`}
                >
                  <option value="all">Assignee</option>
                  {Array.from(
                    new Map(
                      tasks
                        .flatMap((t) => [t.assignee, ...(t.assignees || [])])
                        .filter(Boolean)
                        .map((a: any) => [a.id, a])
                    ).values()
                  ).map((a: any) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                {filterAssignee !== "all" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setFilterAssignee("all"); }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-zinc-800 border border-zinc-700 rounded-[3px] shadow-sm items-center justify-center hidden group-hover:flex hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
                <ChevronDown className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 ${filterAssignee !== "all" ? "group-hover:hidden" : ""}`} />
              </div>
            )}

            {/* Filter: Priority */}
            <div className="relative flex items-center group">
              <Flag className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className={`appearance-none h-8 pl-7 pr-7 bg-[#18181c] border text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer ${
                  filterPriority !== "all" ? "border-indigo-500/60 text-indigo-300" : "border-zinc-800 hover:border-zinc-700 text-zinc-300"
                }`}
              >
                <option value="all">Priority</option>
                <option value="URGENT">Urgent</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
              {filterPriority !== "all" && (
                <button
                  onClick={(e) => { e.stopPropagation(); setFilterPriority("all"); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-zinc-800 border border-zinc-700 rounded-[3px] shadow-sm items-center justify-center hidden group-hover:flex hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
              <ChevronDown className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 ${filterPriority !== "all" ? "group-hover:hidden" : ""}`} />
            </div>

            {/* Filter: Status */}
            <div className="relative flex items-center group">
              <CheckSquare className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className={`appearance-none h-8 pl-7 pr-7 bg-[#18181c] border text-xs font-medium rounded-lg focus:outline-none focus:border-indigo-500/70 transition-all cursor-pointer ${
                  filterStatus !== "all" ? "border-indigo-500/60 text-indigo-300" : "border-zinc-800 hover:border-zinc-700 text-zinc-300"
                }`}
              >
                <option value="all">Status</option>
                <option value="TODO">To Do</option>
                <option value="IN PROGRESS">In Progress</option>
                <option value="DAILY">Daily</option>
                <option value="KYC">KYC</option>
                <option value="PENDING">Pending</option>
                <option value="REVIEW">Review</option>
                <option value="COMPLETED">Completed</option>
              </select>
              {filterStatus !== "all" && (
                <button
                  onClick={(e) => { e.stopPropagation(); setFilterStatus("all"); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-zinc-800 border border-zinc-700 rounded-[3px] shadow-sm items-center justify-center hidden group-hover:flex hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
              <ChevronDown className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 ${filterStatus !== "all" ? "group-hover:hidden" : ""}`} />
            </div>
          </div>
        </div>
      </div>

      {/* ─── TAB CONTENT: ALL TASKS / CLIENTS / PRIORITIES (OVERVIEW) ─── */}
      {["all", "clients", "priorities"].includes(currentTab) && (
        <>
          {/* Tasks Overview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-indigo-400" />
                <h2 className="text-base font-semibold text-zinc-200">
                  {currentTab === "all" ? "Workspace Tasks" : currentTab === "clients" ? "Clients Overview" : "Priorities Overview"} ({filteredAllTasks.length})
                </h2>
              </div>
            </div>

            {loadingTasks ? (
              <div className="p-12 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-3">
                <div className="animate-spin size-7 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
                <p className="text-xs text-zinc-400 font-medium">
                  Loading tasks...
                </p>
              </div>
            ) : activeGroups.length === 0 ? (
              <div className="p-16 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-4 shadow-xl">
                <CheckSquare className="w-12 h-12 text-zinc-600 mx-auto opacity-40" />
                <h3 className="text-base font-semibold text-zinc-200">
                  {searchQuery ? "No matching tasks found" : "No tasks yet"}
                </h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
                  {searchQuery
                    ? `No tasks matched your search query "${searchQuery}".`
                    : "Tasks across your workspace will appear here."}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {activeGroups.map(
                  (groupData) => {
                    const { key, label, pillClass, customColor, tasks: groupTasks, subGroups, totalTasks } = groupData as any;
                    const isCollapsed = collapsedGroups.has(key);
                    const count = totalTasks ?? groupTasks.length;
                    
                    const renderTasks = (tasksToRender: Task[]) => (
                      <>
                        <div className="hidden sm:flex items-center justify-between text-[11px] font-medium text-zinc-500 px-2 pb-1.5 border-b border-zinc-800/60 w-full">
                          <span className="text-left pl-9">Name</span>
                          <span className="w-32 text-left">Priority</span>
                        </div>
                        <div className="flex flex-col w-full">
                          {tasksToRender.map((task) => {
                            const statusConfig = getStatusConfig(task.status, allLists);
                            const priorityConfig =
                              task.priority && PRIORITY_FLAGS[task.priority]
                                ? PRIORITY_FLAGS[task.priority]
                                : {
                                    label: task.priority || "Normal",
                                    color: "text-zinc-500",
                                    iconColor: "text-zinc-500",
                                  };
                            
                            const taskAssignees = task.assignees && task.assignees.length > 0 ? task.assignees : (task.assignee ? [task.assignee] : []);

                            return (
                              <div
                                key={task.id}
                                onClick={() => setSelectedTask(task)}
                                className="group relative flex items-center justify-between px-2 py-2.5 hover:bg-zinc-800/30 border-b border-zinc-800/40 transition-colors cursor-pointer"
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1 pl-4 pr-4">
                                  <div className="w-3.5 h-3.5 rounded-[4px] border border-zinc-700 shrink-0 flex items-center justify-center transition-colors shadow-sm group-hover:border-zinc-500" />
                                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusConfig.dot}`} style={(statusConfig as any).customColor ? { backgroundColor: (statusConfig as any).customColor } : {}} />
                                  <span className="text-[13px] font-medium text-zinc-200 truncate group-hover:text-blue-400 transition-colors">
                                    {task.title}
                                  </span>
                                  <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium group-hover:text-zinc-400 transition-colors text-zinc-500 shrink-0 ml-1">
                                    <ListIcon className="w-3 h-3 opacity-60" />
                                    <span className="truncate max-w-[140px]">
                                      {task.list?.name || "Workspace"}
                                    </span>
                                  </div>
                                </div>
                                <div className="hidden sm:flex items-center gap-4 shrink-0 w-32 pr-2">
                                  {/* Assignees */}
                                  <div className="flex items-center -space-x-1 shrink-0" title={taskAssignees.map(a => a.name).join(", ")}>
                                    {taskAssignees.slice(0, 3).map((a, i) => (
                                      <div key={i} className="w-5 h-5 rounded-full border border-[#18181c] flex items-center justify-center text-[9px] font-bold text-white uppercase bg-red-500">
                                        {a.name?.substring(0, 2) || "U"}
                                      </div>
                                    ))}
                                    {taskAssignees.length === 0 && (
                                      <div className="w-5 h-5 rounded-full bg-zinc-800 border border-dashed border-zinc-600 flex items-center justify-center text-zinc-500">
                                        <UserIcon className="w-3 h-3" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 min-w-[70px]">
                                    <Flag
                                      className={`w-3 h-3 ${priorityConfig.iconColor}`}
                                    />
                                    <span
                                      className={`text-[11px] font-medium ${priorityConfig.color}`}
                                    >
                                      {priorityConfig.label}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );

                    return (
                    <div key={key} className="space-y-0.5">
                      <div 
                        className="flex items-center justify-between px-1 pb-2 cursor-pointer select-none group"
                        onClick={() => toggleGroup(key)}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${pillClass} shadow-sm flex items-center gap-1 transition-transform`}
                            style={(customColor as any) ? { backgroundColor: customColor as any } : {}}
                          >
                            {label}
                            <ChevronDown className={`w-3 h-3 opacity-70 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                          </span>
                          <span className="text-xs font-semibold text-zinc-500 ml-1">
                            {count}
                          </span>
                        </div>
                      </div>
                      
                      {!isCollapsed && (
                        subGroups ? (
                          <div className="pl-2 sm:pl-6 space-y-4 pt-2 border-l-2 border-zinc-800/40 ml-2">
                            {subGroups.map((sg: any) => {
                              const sgKey = `${key}-${sg.status}`;
                              const isSgCollapsed = collapsedGroups.has(sgKey);
                              return (
                                <div key={sgKey} className="space-y-0.5">
                                  <div 
                                    className="flex items-center justify-between px-1 pb-2 cursor-pointer select-none group"
                                    onClick={() => toggleGroup(sgKey)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${sg.config.pill} shadow-sm flex items-center gap-1 transition-transform`}
                                        style={(sg.config as any).customColor ? { backgroundColor: (sg.config as any).customColor } : {}}
                                      >
                                        {sg.config.label}
                                        <ChevronDown className={`w-3 h-3 opacity-70 transition-transform ${isSgCollapsed ? "-rotate-90" : ""}`} />
                                      </span>
                                      <span className="text-xs font-semibold text-zinc-500 ml-1">
                                        {sg.tasks.length}
                                      </span>
                                    </div>
                                  </div>
                                  {!isSgCollapsed && renderTasks(sg.tasks)}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          renderTasks(groupTasks)
                        )
                      )}
                    </div>
                  )}
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── TAB CONTENT: MY TASKS (CLICKUP GROUPED STATUS TABLE) ─── */}
      {currentTab === "my" && (
        <div className="space-y-6">
          {loadingTasks ? (
            <div className="p-12 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-3">
              <div className="animate-spin size-7 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-xs text-zinc-400 font-medium">
                Syncing tasks in real-time...
              </p>
            </div>
          ) : filteredMyTasks.length === 0 ? (
            <div className="p-16 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-4 shadow-xl">
              <CheckSquare className="w-12 h-12 text-zinc-600 mx-auto opacity-40" />
              <h3 className="text-base font-semibold text-zinc-200">
                {searchQuery
                  ? "No matching tasks found"
                  : "No tasks assigned to you"}
              </h3>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
                {searchQuery
                  ? `No tasks matched your search query "${searchQuery}".`
                  : `Tasks assigned to ${currentUser?.name || "you"} will appear here in real time.`}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => handleTabChange("all")}
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
              {groupedTasksByStatus.map(
                ({ status, config, tasks: groupTasks }) => {
                  const isCollapsed = collapsedGroups.has(status);
                  return (
                  <div key={status} className="space-y-0.5">
                    {/* Status Group Header Bar */}
                    <div 
                      className="flex items-center justify-between px-1 pb-2 cursor-pointer select-none group"
                      onClick={() => toggleGroup(status)}
                    >
                      <div className="flex items-center gap-2">
                        {/* Status Pill Badge */}
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${config.pill} shadow-sm flex items-center gap-1 transition-transform`}
                          style={(config as any).customColor ? { backgroundColor: (config as any).customColor } : {}}
                        >
                          {config.label}
                          <ChevronDown className={`w-3 h-3 opacity-70 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                        </span>
                        {/* Count badge */}
                        <span className="text-xs font-semibold text-zinc-500 ml-1">
                          {groupTasks.length}
                        </span>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <>
                        {/* Column Headers matching ClickUp */}
                        <div className="hidden sm:flex items-center justify-between text-[11px] font-medium text-zinc-500 px-1 pb-1.5 border-b border-zinc-800/60 w-full">
                          <span className="w-1/2 text-left pl-6">Name</span>
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
                                : {
                                    label: task.priority || "Normal",
                                    color: "text-zinc-500",
                                    iconColor: "text-zinc-500",
                                  };

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
                                <div className="flex items-center gap-2.5 min-w-0 flex-1 pl-6 pr-4">
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
                                    style={(config as any).customColor ? { backgroundColor: (config as any).customColor } : {}}
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
                                      {
                                        task.subtasks.filter(
                                          (st: any) => st.isCompleted,
                                        ).length
                                      }
                                      /{task.subtasks.length}
                                    </span>
                                  )}
                                </div>

                                {/* Right: Assignees + Priority + Due Date + More */}
                                <div className="flex items-center gap-8 shrink-0 pr-2">
                                  {/* ClickUp-style Stacked Avatars */}
                                  <div
                                    className="hidden sm:flex items-center -space-x-1"
                                    title={
                                      taskAssignees.map((a) => a.name).join(", ") ||
                                      "Unassigned"
                                    }
                                  >
                                    {taskAssignees.slice(0, 3).map((a) => (
                                      <div
                                        key={a.id}
                                        className="w-5 h-5 rounded-full ring-2 ring-[#18181c] flex items-center justify-center text-[9px] font-bold text-white overflow-hidden bg-indigo-600 shrink-0"
                                      >
                                        {a.avatarUrl ? (
                                          <img
                                            src={a.avatarUrl}
                                            alt={a.name}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          (a.name || "U").charAt(0).toUpperCase()
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
                                    <Flag
                                      className={`w-3.5 h-3.5 ${priorityConfig.iconColor}`}
                                    />
                                    <span
                                      className={`text-[11px] font-medium ${priorityConfig.color}`}
                                    >
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
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleCreateInlineTask(status);
                                  } else if (e.key === "Escape") {
                                    setAddingStatus(null);
                                  }
                                }}
                                className="flex-1 px-2 py-1 bg-transparent border-none text-[13px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-0"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleCreateInlineTask(status)}
                                  disabled={
                                    !inlineTaskTitle.trim() || isCreatingInline
                                  }
                                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                                >
                                  {isCreatingInline ? "Adding..." : "Save"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* ClickUp "+ Add Task" row below group tasks */
                            <div className="group flex items-center justify-between px-1 py-1.5 hover:bg-zinc-800/20 border-b border-zinc-800/40 transition-colors cursor-pointer">
                              <button
                                onClick={() => {
                                  setAddingStatus(status);
                                  setInlineTaskTitle("");
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
                      </>
                    )}
                  </div>
                );
              })}
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
