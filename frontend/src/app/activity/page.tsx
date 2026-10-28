'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense, Fragment } from 'react';
import { useAppStore } from '@/lib/store';
import { notificationsApi, TaskNotification } from '@/api/notifications';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Check,
  CheckSquare,
  ShieldCheck,
  MailOpen,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  User,
  Users,
  SlidersHorizontal,
  MessageSquare,
  Activity,
  Globe,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { ImageLightboxModal } from '@/components/modals/ImageLightboxModal';
import { tasksApi } from '@/api/tasks';
import { toast } from '@/lib/toast';
import { CommentContent } from '@/components/ui/CommentContent';
import { extractImagesFromContent } from '@/lib/commentImages';
import { ActivityCard } from '@/components/ui/ActivityCard';

type ViewMode = 'for_me' | 'show_all';
type Category = 'all' | 'assigned' | 'status' | 'checklists' | 'audits' | 'comments';

const VIEW_OPTIONS: { value: ViewMode; label: string; description: string }[] = [
  { value: 'for_me', label: 'For Me', description: 'All your notifications' },
  { value: 'show_all', label: 'Show All', description: 'All workspace activity' },
];

const CATEGORIES: { value: Category; label: string; icon: any }[] = [
  { value: 'all', label: 'All', icon: Activity },
  { value: 'assigned', label: 'Assigned to Me', icon: Users },
  { value: 'status', label: 'Status Updates', icon: Clock },
  { value: 'checklists', label: 'Checklists', icon: CheckSquare },
  { value: 'audits', label: 'Auditor', icon: ShieldCheck },
  { value: 'comments', label: 'Comments', icon: MessageSquare },
];

/**
 * Status word color rendering:
 * - CLOSED: green
 * - IN PROGRESS: blue
 * - Other statuses (In Review, In Checking, CRM, etc.): amber
 */
function renderStyledStatusText(text: string) {
  if (!text) return null;

  const statusRegex =
    /\b(IN PROGRESS|In Progress|CLOSED|Closed|DONE|Done|IN REVIEW|In Review|IN CHECKING|In Checking|CRM|PENDING|Pending|TODO|Todo|OPEN|Open|BLOCKED|Blocked)\b/g;

  const parts: (string | React.ReactNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = statusRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const val = match[0];
    const upper = val.toUpperCase().replace(/[\s\-_]+/g, '');
    let colorClass = 'text-amber-400 font-medium';
    if (upper === 'CLOSED' || upper === 'DONE') {
      colorClass = 'text-emerald-400 font-medium';
    } else if (upper === 'INPROGRESS') {
      colorClass = 'text-blue-400 font-medium';
    }

    parts.push(
      <span key={`${match.index}-${val}`} className={colorClass}>
        {val}
      </span>
    );
    lastIndex = match.index + val.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

const getAvatarBg = (name: string) => {
  const palette = [
    'bg-[#0d9488]', // teal
    'bg-[#4f46e5]', // indigo
    'bg-[#2563eb]', // blue
    'bg-[#7c3aed]', // violet
    'bg-[#059669]', // emerald
    'bg-[#e11d48]', // rose
    'bg-[#d97706]', // amber
    'bg-[#0891b2]', // cyan
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
};

const getInitials = (name: string) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

interface FeedItem {
  id: string;
  sourceId: string;
  childIds?: string[];
  type: string;
  actorId: string;
  actorName: string;
  actorAvatar: string | null;
  taskId?: string;
  taskTitle: string;
  isSubtask: boolean;
  subtaskTitle?: string;
  title: string;
  content?: string;
  isRead: boolean;
  createdAt: string;
  IconToUse: any;
  iconBg: string;
  rawItem: any;
  isAudit: boolean;
}

interface ActivityFeedCache {
  notifications: TaskNotification[];
  auditLogs: any[];
  myAuditLogs: any[];
  timestamp: number;
  scrollY: number;
}

let feedCache: ActivityFeedCache | null = null;
const FEED_CACHE_TTL_MS = 60_000;

function ActivityFeedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { decrementUnreadNotifications, currentUser, tasksIndex, tasks, workspaceRoles } = useAppStore();
  const hadSelectedTask = useRef(false);
  const lastUrlTaskId = useRef<string | null>(null);

  const isPrivileged =
    currentUser?.systemRole === 'ADMIN' ||
    currentUser?.roles?.some((r: string) => /project\s*manager|^pm$|\bsenior\b/i.test(r?.trim()));

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const user = useAppStore.getState().currentUser;
    return user?.notificationPreferences?.defaultView || 'for_me';
  });
  const hasInitializedViewMode = useRef(false);

  useEffect(() => {
    if (currentUser && !hasInitializedViewMode.current) {
      if (currentUser.notificationPreferences?.defaultView) {
        setViewMode(currentUser.notificationPreferences.defaultView);
      }
      hasInitializedViewMode.current = true;
    }
  }, [currentUser]);

  const [category, setCategory] = useState<Category>('all');
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'last7' | 'last30'>('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const initialCacheValid = !!feedCache && Date.now() - feedCache.timestamp < FEED_CACHE_TTL_MS;
  const [notifications, setNotifications] = useState<TaskNotification[]>(() =>
    initialCacheValid ? feedCache!.notifications : []
  );
  const [auditLogs, setAuditLogs] = useState<any[]>(() => (initialCacheValid ? feedCache!.auditLogs : []));
  const [myAuditLogs, setMyAuditLogs] = useState<any[]>(() =>
    initialCacheValid ? feedCache!.myAuditLogs : []
  );
  const [loading, setLoading] = useState<boolean>(() => !initialCacheValid);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [targetCommentInfo, setTargetCommentInfo] = useState<{
    id?: string | null;
    text?: string | null;
    subtaskId?: string | null;
  } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const currentUserIdRef = useRef<string | undefined>(currentUser?.id);
  currentUserIdRef.current = currentUser?.id;

  // Restore scroll position on initial cache mount
  useEffect(() => {
    if (feedCache?.scrollY && feedScrollRef.current) {
      feedScrollRef.current.scrollTop = feedCache.scrollY;
    }
  }, []);

  const fetchData = async (silent = false) => {
    const hasData = notifications.length > 0 || auditLogs.length > 0 || !!feedCache?.notifications.length;
    if (!silent && !hasData) setLoading(true);
    try {
      const userId = currentUserIdRef.current;
      const { activityApi } = await import('@/api/activity');

      if (viewMode === 'show_all') {
        const auditRes = await activityApi.getAuditLogs({
          page,
          limit,
          category,
          timeFilter,
        });
        const newLogs = auditRes.logs || [];
        setAuditLogs(newLogs);
        setTotal(auditRes.total ?? newLogs.length);
        setTotalPages(auditRes.totalPages ?? 1);

        if (feedCache) {
          feedCache.auditLogs = newLogs;
          feedCache.timestamp = Date.now();
        }
      } else {
        const [notifRes, myAuditRes] = await Promise.all([
          notificationsApi.getNotifications({
            page,
            limit,
            tab: 'primary',
            filter: 'all',
          }),
          activityApi.getAuditLogs({
            userId,
            page,
            limit,
            category,
            timeFilter,
          }),
        ]);
        const newNotifs = notifRes.notifications || [];
        const newMyLogs = myAuditRes.logs || [];
        setNotifications(newNotifs);
        setMyAuditLogs(newMyLogs);
        const combinedTotal = (notifRes.total || newNotifs.length) + (myAuditRes.total || newMyLogs.length);
        setTotal(combinedTotal);
        setTotalPages(Math.max(1, Math.ceil(combinedTotal / limit)));

        if (feedCache) {
          feedCache.notifications = newNotifs;
          feedCache.myAuditLogs = newMyLogs;
          feedCache.timestamp = Date.now();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTask = async (n: any, item?: FeedItem) => {
    const rawTaskId = typeof n === 'string' ? n : n.task?.id || n.taskId || n.entityId;
    const taskId = rawTaskId ? String(rawTaskId).split('/')[0].trim() : null;

    const isAuditItem =
      viewMode === 'show_all' ||
      n?.isAudit ||
      !!n?.action ||
      !!n?.entity ||
      String(n?.id || '').startsWith('audit_');

    if (typeof n !== 'string' && !isAuditItem && n.id && n.isRead === false) {
      handleMarkAsRead(n.id, n.childIds);
    }
    if (!taskId) return;

    // Detect if this activity click is specifically for a comment
    const isComment =
      item?.type === 'COMMENT' ||
      item?.type === 'REPLY' ||
      item?.type === 'MENTION' ||
      n?.action === 'COMMENT' ||
      n?.action === 'REPLY' ||
      n?.type === 'COMMENT' ||
      n?.type === 'REPLY' ||
      n?.type === 'MENTION' ||
      Boolean(n?.details?.commentId);

    if (isComment) {
      const cId =
        n?.details?.commentId ||
        n?.commentId ||
        (typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('comment') : null);
      const cText = item?.content || n?.details?.text || n?.content || null;
      const sId = n?.details?.subtaskId || n?.subtaskId || null;
      setTargetCommentInfo({ id: cId, text: cText, subtaskId: sId });
    } else {
      setTargetCommentInfo(null);
    }

    lastUrlTaskId.current = taskId;

    if (feedScrollRef.current) {
      if (feedCache) {
        feedCache.scrollY = feedScrollRef.current.scrollTop;
      } else {
        feedCache = {
          notifications,
          auditLogs,
          myAuditLogs,
          timestamp: Date.now(),
          scrollY: feedScrollRef.current.scrollTop,
        };
      }
    }

    const taskObj =
      typeof n === 'object' && n.task?.id === taskId
        ? n.task
        : tasksIndex[taskId] || tasks.find((t: any) => t.id === taskId);
    if (taskObj) {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('task', taskId);
        if (isComment) {
          const cId = n?.details?.commentId || n?.commentId;
          if (cId) url.searchParams.set('comment', cId);
        } else {
          url.searchParams.delete('comment');
        }
        window.history.replaceState(null, '', url.pathname + url.search);
      }
      hadSelectedTask.current = true;
      setSelectedTask(taskObj);
      return;
    }
    try {
      const res = await tasksApi.getTask(taskId);
      if (res?.task) {
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('task', res.task.id);
          if (res.subtask) {
            url.searchParams.set('subtask', res.subtask.id);
          }
          if (isComment) {
            const cId = n?.details?.commentId || n?.commentId;
            if (cId) url.searchParams.set('comment', cId);
          } else {
            url.searchParams.delete('comment');
          }
          window.history.replaceState(null, '', url.pathname + url.search);
        }
        hadSelectedTask.current = true;
        setSelectedTask(res.task);
        return;
      }
    } catch (err) {
      console.warn('Failed to load task for modal:', err);
      toast.error('Task not found');
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('task');
        url.searchParams.delete('subtask');
        url.searchParams.delete('comment');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
      }
      lastUrlTaskId.current = null;
    }
  };

  // Open task if ?task= param is present in URL
  useEffect(() => {
    const taskIdParam = searchParams.get('task');
    const commentParam = searchParams.get('comment');
    const actualTaskId = taskIdParam ? taskIdParam.split('/')[0].trim() : null;

    if (actualTaskId) {
      if (commentParam && !targetCommentInfo) {
        setTargetCommentInfo({ id: commentParam });
      }
      if (actualTaskId !== lastUrlTaskId.current && actualTaskId !== selectedTask?.id) {
        lastUrlTaskId.current = actualTaskId;
        handleOpenTask(actualTaskId);
      }
    } else if (hadSelectedTask.current && selectedTask) {
      lastUrlTaskId.current = null;
      setSelectedTask(null);
      setTargetCommentInfo(null);
    }
  }, [searchParams]);

  // Sync selectedTask to URL searchParams
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (selectedTask) {
        hadSelectedTask.current = true;
        if (url.searchParams.get('task') !== selectedTask.id) {
          url.searchParams.set('task', selectedTask.id);
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      } else if (hadSelectedTask.current && url.searchParams.has('task')) {
        url.searchParams.delete('task');
        url.searchParams.delete('subtask');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
      }
    }
  }, [selectedTask]);

  // Refetch when page, limit, filters, view mode or user changes
  useEffect(() => {
    fetchData();
  }, [page, limit, category, timeFilter, viewMode, currentUser?.id]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onNew = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => fetchData(true), 400);
    };
    const onClear = () => {
      lastUrlTaskId.current = null;
      setSelectedTask(null);
      const u = new URL(window.location.href);
      u.searchParams.delete('task');
      window.history.pushState({}, '', u.toString());
    };

    const onRead = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
        if (feedCache) {
          feedCache.notifications = feedCache.notifications.map((n) =>
            n.id === id ? { ...n, isRead: true } : n
          );
        }
      }
    };

    const onAllRead = () => {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      if (feedCache) {
        feedCache.notifications = feedCache.notifications.map((n) => ({ ...n, isRead: true }));
      }
      useAppStore.getState().setUnreadNotifications(0);
    };

    const onCleared = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        if (feedCache) {
          feedCache.notifications = feedCache.notifications.filter((n) => n.id !== id);
        }
      }
    };

    const onAllCleared = () => {
      setNotifications([]);
      if (feedCache) feedCache.notifications = [];
      useAppStore.getState().setUnreadNotifications(0);
    };

    window.addEventListener('notification_received', onNew);
    window.addEventListener('task_activity', onNew);
    window.addEventListener('task:comment_added', onNew);
    window.addEventListener('clear_activity_task', onClear);
    window.addEventListener('notification_read', onRead);
    window.addEventListener('notifications_all_read', onAllRead);
    window.addEventListener('notification_cleared', onCleared);
    window.addEventListener('notifications_all_cleared', onAllCleared);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('notification_received', onNew);
      window.removeEventListener('task_activity', onNew);
      window.removeEventListener('task:comment_added', onNew);
      window.removeEventListener('clear_activity_task', onClear);
      window.removeEventListener('notification_read', onRead);
      window.removeEventListener('notifications_all_read', onAllRead);
      window.removeEventListener('notification_cleared', onCleared);
      window.removeEventListener('notifications_all_cleared', onAllCleared);
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleClear = async (id: string, childIds?: string[]) => {
    const idsToClear = childIds && childIds.length > 0 ? childIds : [id];
    for (const targetId of idsToClear) {
      if (!targetId || targetId.startsWith('audit_')) continue;
      try {
        await notificationsApi.clearNotification(targetId);
      } catch (err) {
        console.error(err);
      }
    }
    setNotifications((prev) => {
      const next = prev.filter((n) => !idsToClear.includes(n.id));
      if (feedCache) feedCache.notifications = next;
      return next;
    });
    decrementUnreadNotifications();
  };

  const handleMarkAsRead = async (id: string, childIds?: string[]) => {
    const idsToMark = childIds && childIds.length > 0 ? childIds : [id];
    for (const targetId of idsToMark) {
      if (!targetId || targetId.startsWith('audit_')) continue;
      try {
        await notificationsApi.markAsRead(targetId);
      } catch (err) {
        console.error(err);
      }
    }
    setNotifications((prev) => {
      const next = prev.map((n) => (idsToMark.includes(n.id) ? { ...n, isRead: true } : n));
      if (feedCache) feedCache.notifications = next;
      return next;
    });
    decrementUnreadNotifications();
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications((prev) => {
        const next = prev.map((n) => ({ ...n, isRead: true }));
        if (feedCache) feedCache.notifications = next;
        return next;
      });
      useAppStore.getState().setUnreadNotifications(0);
      toast.success('All notifications marked as read.');
    } catch (err) {
      console.error(err);
    }
  };


  /**
   * Helper to check if a task or subtask is assigned to the current user
   */
  const isTaskAssignedToMe = useCallback(
    (taskId: string | undefined, subtaskId?: string | undefined) => {
      if (!taskId || !currentUser?.id) return false;
      const currentUserId = currentUser.id;
      const task = tasksIndex[taskId] || tasks.find((t: any) => t.id === taskId);
      if (!task) return true; // If task is not cached locally, trust notification recipient
      if (task.assigneeId === currentUserId) return true;
      if (task.assignees?.some((a: any) => a.id === currentUserId)) return true;
      if (subtaskId) {
        const sub = task.subtasks?.find((s: any) => s.id === subtaskId);
        if (sub) {
          if ((sub as any).assigneeId === currentUserId) return true;
          if ((sub.assignees || []).some((a: any) => a.id === currentUserId)) return true;
          if (((sub as any).assigneeIds || []).includes(currentUserId)) return true;
        }
      } else if (task.subtasks) {
        if (
          task.subtasks.some(
            (s: any) =>
              (s as any).assigneeId === currentUserId ||
              (s.assignees || []).some((a: any) => a.id === currentUserId) ||
              ((s as any).assigneeIds || []).includes(currentUserId)
          )
        ) {
          return true;
        }
      }
      return false;
    },
    [currentUser?.id, tasksIndex, tasks]
  );

  /**
   * Universal negative constraints filter:
   * Never show: due date changes, priority changes, comment reactions.
   */
  const passesUniversalNegativeConstraints = (item: any): boolean => {
    const action = (item.action || item.type || '').toUpperCase();
    if (action === 'DUE_DATE_CHANGE' || action === 'DUE_DATE') return false;
    if (action === 'PRIORITY_CHANGE') return false;
    if (action === 'REACTION' || action === 'COMMENT_REACTION') return false;
    const title = (item.title || '').toLowerCase();
    if (title.includes('priority') && (title.includes('changed') || title.includes('priority to'))) return false;
    if (title.includes('due date')) return false;
    return true;
  };

  /**
   * Map raw notification or audit log to normalized FeedItem
   */
  const normalizeItem = useCallback(
    (raw: any, isAuditLog: boolean): FeedItem | null => {
      if (!passesUniversalNegativeConstraints(raw)) return null;

      const isAudit =
        isAuditLog ||
        !!raw.isAudit ||
        !!raw.action ||
        !!raw.entity ||
        String(raw.id || '').startsWith('audit_');

      let actorName = 'Someone';
      let actorAvatar: string | null = null;
      let actorId = '';
      let type = '';
      let title = '';
      let content = '';
      let taskId = '';
      let taskTitle = '';
      let isSubtask = false;
      let subtaskTitle = '';
      let isRead = true;
      let createdAt = raw.createdAt || new Date().toISOString();

      if (isAudit) {
        actorName = raw.user?.name || raw.actor?.name || 'Someone';
        actorAvatar = raw.user?.avatarUrl || raw.actor?.avatarUrl || null;
        actorId = raw.user?.id || raw.userId || '';
        type = (raw.action || raw.type || '').toUpperCase();
        if (type === 'COMMENT_ADDED' || type === 'REPLY') type = 'COMMENT';
        taskId = raw.taskId || raw.entityId || raw.task?.id || '';
        isSubtask = !!raw.details?.subtaskTitle || raw.entity?.toLowerCase() === 'subtask';
        subtaskTitle = raw.details?.subtaskTitle || '';
        taskTitle = subtaskTitle || raw.entityTitle || raw.task?.title || 'task';
        content = raw.details?.text || raw.content || '';
        isRead = true; // Workspace logs default to read

        // Format Title
        if (type === 'STATUS_CHANGE') {
          const oldSt = raw.details?.oldStatus || 'old';
          const newSt = raw.details?.newStatus || 'new';
          const prefix = isSubtask ? 'subtask' : 'task';
          title = `${actorName} changed status from ${oldSt} to ${newSt} on ${prefix} ${taskTitle}`;
        } else if (type === 'AUDIT_ITEM_CHECKED') {
          const itemText = raw.details?.itemName || 'auditing';
          title = `${actorName} has checked ${itemText} on task ${taskTitle}`;
        } else if (type === 'CHECKLIST_ITEM_CHECKED') {
          const itemText = raw.details?.itemName || 'checklist item';
          title = `${actorName} completed ${itemText} in ${taskTitle}`;
        } else if (type === 'CHECKLIST_ITEM_ASSIGNED') {
          title = `${actorName} assigned you an item in ${taskTitle}`;
        } else if (type === 'ASSIGNMENT') {
          title = `${actorName} assigned you to ${isSubtask ? 'subtask' : 'task'} ${taskTitle}`;
        } else if (type === 'UNASSIGNMENT') {
          title = `${actorName} unassigned you from ${isSubtask ? 'subtask' : 'task'} ${taskTitle}`;
        } else if (type === 'COMMENT') {
          title = `${actorName} commented on ${isSubtask ? 'subtask' : 'task'} ${taskTitle}`;
        } else {
          title = raw.title || `${actorName} updated ${taskTitle}`;
        }
      } else {
        const notif = raw as TaskNotification;
        actorName = notif.actor?.name || 'Someone';
        actorAvatar = notif.actor?.imageUrl || notif.actor?.avatarUrl || null;
        actorId = notif.actorId || notif.actor?.id || '';
        type = (notif.type || '').toUpperCase();
        taskId = notif.task?.id || notif.taskId || '';
        taskTitle = notif.task?.title || 'task';
        isSubtask = (notif.title || '').includes('subtask');
        content = notif.content || '';
        isRead = notif.isRead !== false;
        title = notif.title || '';

        // If title needs normalization to user requirements:
        if (type === 'STATUS_CHANGE' && !title.includes('changed status from')) {
          const match = title.match(/status to (.+)$/i);
          const newStatus = match ? match[1].trim() : 'updated';
          title = `${actorName} changed status to ${newStatus} on ${isSubtask ? 'subtask' : 'task'} ${taskTitle}`;
        }
      }

      // Icon & Badge resolution
      let IconToUse = Globe;
      let iconBg = 'bg-zinc-600';

      if (type === 'ASSIGNMENT') {
        IconToUse = UserPlus;
        iconBg = 'bg-blue-600';
      } else if (type === 'UNASSIGNMENT') {
        IconToUse = UserMinus;
        iconBg = 'bg-rose-600';
      } else if (type === 'STATUS_CHANGE') {
        IconToUse = Clock;
        iconBg = 'bg-emerald-600';
      } else if (type === 'COMMENT' || type === 'REPLY' || type === 'MENTION') {
        IconToUse = MessageSquare;
        iconBg = 'bg-amber-600';
      } else if (type === 'AUDIT_ITEM_CHECKED') {
        IconToUse = ShieldCheck;
        iconBg = 'bg-purple-600';
      } else if (type === 'CHECKLIST_ITEM_CHECKED' || type === 'CHECKLIST_ITEM_ASSIGNED') {
        IconToUse = CheckSquare;
        iconBg = 'bg-violet-600';
      }

      return {
        id: raw.id,
        sourceId: raw.id,
        childIds: [raw.id],
        type,
        actorId,
        actorName,
        actorAvatar,
        taskId,
        taskTitle,
        isSubtask,
        subtaskTitle,
        title,
        content,
        isRead,
        createdAt,
        IconToUse,
        iconBg,
        rawItem: raw,
        isAudit,
      };
    },
    []
  );

  /**
   * Tab filter logic with exact constraints:
   * - All: Shows all workspace / user events
   * - Status Updates: Status changes on tasks assigned to you
   * - Checklists: Checklist item assigned to you or completed on tasks assigned to you
   * - Auditor: Audit checklist checked on tasks assigned to you
   * - Assigned to Me: When you were assigned or unassigned
   * - Comments: Comments on tasks assigned to you or mentions
   */
  const matchesTabFilter = useCallback(
    (item: FeedItem, cat: Category): boolean => {
      const type = item.type;
      const isAssigned = isTaskAssignedToMe(item.taskId);
      const prefs = currentUser?.notificationPreferences;

      if (viewMode === 'show_all') {
        if (cat === 'all') return true;
        if (cat === 'status') return type === 'STATUS_CHANGE';
        if (cat === 'checklists') return type === 'CHECKLIST_ITEM_CHECKED' || type === 'CHECKLIST_ITEM_ASSIGNED';
        if (cat === 'audits') return type === 'AUDIT_ITEM_CHECKED';
        if (cat === 'assigned') return type === 'ASSIGNMENT' || type === 'UNASSIGNMENT';
        if (cat === 'comments') return type === 'COMMENT' || type === 'REPLY' || type === 'MENTION';
        return false;
      }

      // For Me mode:
      if (cat === 'all') {
        if (prefs?.status === false && type === 'STATUS_CHANGE') return false;
        if (prefs?.checklists === false && (type === 'CHECKLIST_ITEM_CHECKED' || type === 'CHECKLIST_ITEM_ASSIGNED')) return false;
        if (prefs?.audits === false && type === 'AUDIT_ITEM_CHECKED') return false;
        if (prefs?.assigned === false && (type === 'ASSIGNMENT' || type === 'UNASSIGNMENT')) return false;
        if (prefs?.comments === false && (type === 'COMMENT' || type === 'REPLY')) return false;
        if (prefs?.mentions === false && type === 'MENTION') return false;
        return true;
      }

      if (cat === 'status') {
        if (type !== 'STATUS_CHANGE') return false;
        // Never shows status changes on tasks assigned to someone else
        return isAssigned;
      }

      if (cat === 'checklists') {
        if (type !== 'CHECKLIST_ITEM_CHECKED' && type !== 'CHECKLIST_ITEM_ASSIGNED') return false;
        // Never shows checklists on tasks not assigned to you
        return isAssigned || item.rawItem?.userId === currentUser?.id;
      }

      if (cat === 'audits') {
        if (type !== 'AUDIT_ITEM_CHECKED') return false;
        // Never shows audits on tasks not assigned to you
        return isAssigned;
      }

      if (cat === 'assigned') {
        return type === 'ASSIGNMENT' || type === 'UNASSIGNMENT';
      }

      if (cat === 'comments') {
        if (type !== 'COMMENT' && type !== 'REPLY' && type !== 'MENTION') return false;
        // Comments on tasks assigned to you or where mentioned
        return isAssigned || item.rawItem?.userId === currentUser?.id;
      }

      return false;
    },
    [currentUser?.id, currentUser?.notificationPreferences, isTaskAssignedToMe, viewMode]
  );

  /**
   * Merging Rules:
   * 1. Checklists: Multiple checklist items completed on same task -> "[Name] completed N checklist items in [Task name]"
   * 2. Audits: Audits checked within ~10 minutes on same task -> "[Name] has checked [audit types] auditing on task [Task name]" or "[Name] has checked all auditing on task [Task name]"
   * 3. Repeated events from same actor on same task merged
   */
  const mergeFeedItems = useCallback((items: FeedItem[]): FeedItem[] => {
    if (items.length <= 1) return items;

    const merged: FeedItem[] = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const current = items[i];
      if (usedIds.has(current.id)) continue;

      const currentTime = new Date(current.createdAt).getTime();

      // Case 1: Auditor checks within ~10 min (600,000 ms) on the same task by same actor
      if (current.type === 'AUDIT_ITEM_CHECKED' && current.taskId) {
        const cluster = [current];
        for (let j = i + 1; j < items.length; j++) {
          const candidate = items[j];
          if (
            candidate.type === 'AUDIT_ITEM_CHECKED' &&
            candidate.taskId === current.taskId &&
            candidate.actorId === current.actorId &&
            !usedIds.has(candidate.id)
          ) {
            const candidateTime = new Date(candidate.createdAt).getTime();
            if (Math.abs(currentTime - candidateTime) <= 10 * 60 * 1000) {
              cluster.push(candidate);
              usedIds.add(candidate.id);
            }
          }
        }

        if (cluster.length > 1) {
          usedIds.add(current.id);

          // Extract audit types
          const auditTypes = new Set<string>();
          cluster.forEach((c) => {
            const rawText = (c.rawItem?.details?.itemName || c.title || '').toLowerCase();
            if (rawText.includes('funnel')) auditTypes.add('Funnel');
            else if (rawText.includes('design')) auditTypes.add('Design');
            else if (rawText.includes('ui') || rawText.includes('ux')) auditTypes.add('UI UX');
            else if (rawText.includes('instruction')) auditTypes.add('Instructions');
            else auditTypes.add('Auditing');
          });

          const typeArray = Array.from(auditTypes);
          let mergedTitle = '';
          if (typeArray.length >= 4) {
            mergedTitle = `${current.actorName} checked all auditing on ${current.taskTitle}`;
          } else if (typeArray.length > 1) {
            const last = typeArray.pop();
            mergedTitle = `${current.actorName} checked ${typeArray.join(', ').toLowerCase()} and ${last?.toLowerCase()} auditing on ${current.taskTitle}`;
          } else {
            mergedTitle = `${current.actorName} checked ${typeArray[0]?.toLowerCase() || 'auditing'} auditing on ${current.taskTitle}`;
          }

          const hasUnread = cluster.some((c) => !c.isRead);

          merged.push({
            ...current,
            id: `merged_audit_${cluster.map((c) => c.id).join('_')}`,
            childIds: cluster.map((c) => c.sourceId),
            title: mergedTitle,
            isRead: !hasUnread,
          });
          continue;
        }
      }

      // Case 2: Checklist completions on same task by same actor within ~30 minutes
      if (current.type === 'CHECKLIST_ITEM_CHECKED' && current.taskId) {
        const cluster = [current];
        for (let j = i + 1; j < items.length; j++) {
          const candidate = items[j];
          if (
            candidate.type === 'CHECKLIST_ITEM_CHECKED' &&
            candidate.taskId === current.taskId &&
            candidate.actorId === current.actorId &&
            !usedIds.has(candidate.id)
          ) {
            const candidateTime = new Date(candidate.createdAt).getTime();
            if (Math.abs(currentTime - candidateTime) <= 30 * 60 * 1000) {
              cluster.push(candidate);
              usedIds.add(candidate.id);
            }
          }
        }

        if (cluster.length > 1) {
          usedIds.add(current.id);
          const count = cluster.length;
          const hasUnread = cluster.some((c) => !c.isRead);

          merged.push({
            ...current,
            id: `merged_checklist_${cluster.map((c) => c.id).join('_')}`,
            childIds: cluster.map((c) => c.sourceId),
            title: `${current.actorName} completed ${count} checklist items in ${current.taskTitle}`,
            isRead: !hasUnread,
          });
          continue;
        }
      }

      // Case 3: Repeated identical events from same person on same task within 10 minutes
      if (current.taskId) {
        const cluster = [current];
        for (let j = i + 1; j < items.length; j++) {
          const candidate = items[j];
          if (
            candidate.type === current.type &&
            candidate.taskId === current.taskId &&
            candidate.actorId === current.actorId &&
            !usedIds.has(candidate.id)
          ) {
            const candidateTime = new Date(candidate.createdAt).getTime();
            if (Math.abs(currentTime - candidateTime) <= 10 * 60 * 1000) {
              cluster.push(candidate);
              usedIds.add(candidate.id);
            }
          }
        }

        if (cluster.length > 1) {
          usedIds.add(current.id);
          const hasUnread = cluster.some((c) => !c.isRead);
          merged.push({
            ...current,
            childIds: cluster.map((c) => c.sourceId),
            isRead: !hasUnread,
          });
          continue;
        }
      }

      usedIds.add(current.id);
      merged.push(current);
    }

    return merged;
  }, []);

  // Prepare normalized raw feed items from notifications + audit logs
  const allNormalizedItems = useMemo(() => {
    const rawList =
      viewMode === 'show_all'
        ? auditLogs.map((l) => normalizeItem(l, true)).filter(Boolean)
        : [
            ...notifications.map((n) => normalizeItem(n, false)).filter(Boolean),
            ...myAuditLogs.map((l) => normalizeItem(l, true)).filter(Boolean),
          ];

    const sorted = (rawList as FeedItem[]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return sorted;
  }, [viewMode, auditLogs, notifications, myAuditLogs, normalizeItem]);

  // Tab unread counts
  const tabUnreadCounts = useMemo(() => {
    const counts: Record<Category, number> = {
      all: 0,
      status: 0,
      checklists: 0,
      audits: 0,
      assigned: 0,
      comments: 0,
    };

    allNormalizedItems.forEach((item) => {
      if (!item.isRead) {
        counts.all++;
        if (matchesTabFilter(item, 'status')) counts.status++;
        if (matchesTabFilter(item, 'checklists')) counts.checklists++;
        if (matchesTabFilter(item, 'audits')) counts.audits++;
        if (matchesTabFilter(item, 'assigned')) counts.assigned++;
        if (matchesTabFilter(item, 'comments')) counts.comments++;
      }
    });

    return counts;
  }, [allNormalizedItems, matchesTabFilter]);

  // Filter items for current category tab and apply merging
  const currentTabItems = useMemo(() => {
    const filtered = allNormalizedItems.filter((item) => matchesTabFilter(item, category));
    return mergeFeedItems(filtered);
  }, [allNormalizedItems, category, matchesTabFilter, mergeFeedItems]);

  // Partition into Unread ("New") vs Read items
  const { unreadItems, readItemsGrouped } = useMemo(() => {
    const unread = currentTabItems.filter((item) => !item.isRead);
    const read = currentTabItems.filter((item) => item.isRead);

    const grouped: { [key: string]: FeedItem[] } = {};
    read.forEach((item) => {
      const d = new Date(item.createdAt);
      let g = '';
      if (isToday(d)) {
        g = 'Today';
      } else if (isYesterday(d)) {
        g = 'Yesterday';
      } else {
        g = format(d, 'EEE, MMM d');
      }
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(item);
    });

    return {
      unreadItems: unread,
      readItemsGrouped: grouped,
    };
  }, [currentTabItems]);

  const handlePreviewImage = useCallback((src: string, commentImages?: string[]) => {
    setLightboxImage(src);
    if (commentImages && commentImages.length > 0) {
      setLightboxImages(commentImages);
    } else {
      setLightboxImages([src]);
    }
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightboxImage(null);
  }, []);

  return (
    <div className={`flex flex-col h-full bg-background text-foreground relative ${selectedTask ? 'overflow-hidden' : 'pt-8'}`}>
      <div className={selectedTask ? 'hidden' : 'flex flex-col flex-1 min-h-0'}>
        {/* Header Bar */}
      <div className="px-8 flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-medium tracking-tight">Activity</h1>

          {/* Prominent For Me vs Show All Segmented Toggle */}
          <div className="flex items-center bg-card p-1 rounded-lg border border-border shadow-xs">
            <button
              onClick={() => {
                setViewMode('for_me');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'for_me'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/50 [.theme-light_&]:hover:bg-zinc-200/60'
              }`}
              title="Personal feed: tasks assigned to you or involving you"
            >
              <User className="size-3.5" />
              <span>For Me</span>
            </button>
            <button
              onClick={() => {
                setViewMode('show_all');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'show_all'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/50 [.theme-light_&]:hover:bg-zinc-200/60'
              }`}
              title="Workspace-wide feed: all tasks and team activities"
            >
              <Users className="size-3.5" />
              <span>Show All</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1 bg-card p-1 rounded-md border border-border mr-1 hidden sm:flex">
            <button
              onClick={() => {
                setTimeFilter('all');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
                timeFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/50 [.theme-light_&]:hover:bg-zinc-200/60'
              }`}
            >
              All time
            </button>
            <button
              onClick={() => {
                setTimeFilter('today');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
                timeFilter === 'today'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/50 [.theme-light_&]:hover:bg-zinc-200/60'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => {
                setTimeFilter('last7');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
                timeFilter === 'last7'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/50 [.theme-light_&]:hover:bg-zinc-200/60'
              }`}
            >
              Last 7 days
            </button>
            <button
              onClick={() => {
                setTimeFilter('last30');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
                timeFilter === 'last30'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/50 [.theme-light_&]:hover:bg-zinc-200/60'
              }`}
            >
              Last 30 days
            </button>
          </div>

          {viewMode === 'for_me' && (
            <button
              onClick={handleMarkAllAsRead}
              className="px-3 py-1.5 text-xs font-medium text-foreground bg-card hover:bg-zinc-800/80 [.theme-light_&]:hover:bg-zinc-200/70 border border-border rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="size-3.5" />
              Mark all as read
            </button>
          )}

          <button
            onClick={() => router.push('/settings#notifications')}
            className="px-3 py-1.5 text-xs font-medium text-foreground bg-card hover:bg-zinc-800/80 [.theme-light_&]:hover:bg-zinc-200/70 border border-border rounded-md shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Customize your notification preferences in settings"
          >
            <SlidersHorizontal className="size-3.5 text-muted-foreground" />
            <span className="hidden sm:inline">Customize</span>
          </button>
        </div>
      </div>

      {/* Category Tabs with Unread Badges */}
      <div className="px-8 border-b border-border mb-6 flex items-center gap-8 overflow-x-auto custom-scrollbar">
        {CATEGORIES.map((cat) => {
          const isActive = category === cat.value;
          const unreadCount = tabUnreadCounts[cat.value] || 0;

          return (
            <button
              key={cat.value}
              onClick={() => {
                setCategory(cat.value);
                setPage(1);
              }}
              className={`pb-3 px-1 text-sm font-medium transition-colors relative whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer ${
                isActive ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>{cat.label}</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] font-medium rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 [.theme-light_&]:bg-blue-50 [.theme-light_&]:text-blue-700 [.theme-light_&]:border-blue-200">
                  {unreadCount}
                </span>
              )}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Feed Content */}
      <div
        ref={feedScrollRef}
        onScroll={(e) => {
          if (feedCache) {
            feedCache.scrollY = e.currentTarget.scrollTop;
          }
        }}
        className="flex-1 overflow-y-auto px-8 pr-2 custom-scrollbar space-y-8"
      >
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : currentTabItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
            <MailOpen className="size-10 mb-3 opacity-20" />
            <p>{viewMode === 'show_all' ? 'No activity logs found' : 'You are all caught up!'}</p>
          </div>
        ) : (
          <div className="space-y-6 pb-10">
            {/* UNREAD / "NEW" SECTION */}
            {unreadItems.length > 0 && (
              <div className="mb-6">
                <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm py-2 mb-3">
                  <h3 className="text-sm font-medium text-sky-500 dark:text-sky-400 px-1">
                    New
                  </h3>
                </div>

                <div className="space-y-3">
                  {unreadItems.map((item) => (
                    <ActivityCard
                      key={item.id}
                      id={item.id}
                      type={item.type}
                      actorName={item.actorName}
                      actorAvatar={item.actorAvatar}
                      taskTitle={item.taskTitle}
                      isSubtask={item.isSubtask}
                      subtaskTitle={item.subtaskTitle}
                      title={item.title}
                      content={item.content}
                      isRead={item.isRead}
                      createdAt={item.createdAt}
                      details={item.rawItem?.details}
                      onPreviewImage={handlePreviewImage}
                      onClick={() => {
                        if (item.taskId) {
                          handleOpenTask(item.rawItem, item);
                        }
                      }}
                      onClear={(e) => {
                        e.stopPropagation();
                        handleClear(item.id, item.childIds);
                      }}
                      onMarkAsRead={(e) => {
                        e.stopPropagation();
                        handleMarkAsRead(item.id, item.childIds);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* READ ITEMS GROUPED BY DAY */}
            {Object.entries(readItemsGrouped).map(([groupName, items]) => (
              <div key={groupName} className="mb-6">
                {/* Date Group Heading (Today, Yesterday, Thu, Oct 22) */}
                <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm py-2 mb-3">
                  <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 px-1">
                    {groupName}
                  </h3>
                </div>

                <div className="space-y-3">
                  {items.map((item) => (
                    <ActivityCard
                      key={item.id}
                      id={item.id}
                      type={item.type}
                      actorName={item.actorName}
                      actorAvatar={item.actorAvatar}
                      taskTitle={item.taskTitle}
                      isSubtask={item.isSubtask}
                      subtaskTitle={item.subtaskTitle}
                      title={item.title}
                      content={item.content}
                      isRead={item.isRead}
                      createdAt={item.createdAt}
                      details={item.rawItem?.details}
                      onPreviewImage={handlePreviewImage}
                      onClick={() => {
                        if (item.taskId) {
                          handleOpenTask(item.rawItem, item);
                        }
                      }}
                      onClear={(e) => {
                        e.stopPropagation();
                        handleClear(item.id, item.childIds);
                      }}
                      onMarkAsRead={(e) => {
                        e.stopPropagation();
                        handleMarkAsRead(item.id, item.childIds);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Persistent Bottom Pagination Bar (Matching Image 1) */}
      {total > 0 && (
        <div className="px-8 py-3.5 border-t border-border bg-background/95 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="text-xs text-muted-foreground select-none">
            Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total} activities
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground select-none">Per page</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
                if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
              }}
              className="bg-card border border-border text-foreground rounded px-2.5 py-1 text-xs cursor-pointer focus:outline-none focus:border-indigo-500"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
              }}
              disabled={page <= 1}
              className="text-xs text-muted-foreground hover:text-foreground hover:bg-zinc-800/60 [.theme-light_&]:hover:bg-zinc-200/60 px-2 py-1 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer font-medium"
            >
              Prev
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => {
                if (totalPages <= 7) return true;
                if (p === 1 || p === totalPages) return true;
                if (Math.abs(p - page) <= 1) return true;
                return false;
              })
              .map((p, idx, arr) => {
                const prevPage = arr[idx - 1];
                const isGap = prevPage && p - prevPage > 1;

                return (
                  <Fragment key={p}>
                    {isGap && <span className="text-muted-foreground/60 px-1 text-xs select-none">...</span>}
                    <button
                      onClick={() => {
                        setPage(p);
                        if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
                      }}
                      className={`w-7 h-7 rounded text-xs transition-all flex items-center justify-center cursor-pointer ${
                        page === p
                          ? 'bg-foreground text-background font-bold shadow-xs'
                          : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800/80 [.theme-light_&]:hover:bg-zinc-200/70 font-medium'
                      }`}
                    >
                      {p}
                    </button>
                  </Fragment>
                );
              })}

            <button
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1));
                if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
              }}
              disabled={page >= totalPages}
              className="text-xs text-foreground hover:text-foreground hover:bg-zinc-800/60 [.theme-light_&]:hover:bg-zinc-200/60 px-2 py-1 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer font-medium"
            >
              Next
            </button>
          </div>
        </div>
      )}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          isOpen={true}
          mode="full"
          onClose={() => {
            setSelectedTask(null);
            setTargetCommentInfo(null);
            if (typeof window !== 'undefined') {
              const url = new URL(window.location.href);
              url.searchParams.delete('task');
              url.searchParams.delete('subtask');
              url.searchParams.delete('comment');
              window.history.replaceState(null, '', url.pathname + (url.search || ''));
            }
          }}
          task={selectedTask}
          targetCommentId={targetCommentInfo?.id}
          targetCommentText={targetCommentInfo?.text}
          scrollToComments={Boolean(targetCommentInfo)}
          workspaceRoles={workspaceRoles}
          onUpdateTask={(updatedTask) => {
            setSelectedTask(updatedTask);
          }}
        />
      )}

      {/* Image Lightbox Modal */}
      <ImageLightboxModal
        isOpen={Boolean(lightboxImage)}
        onClose={handleCloseLightbox}
        currentSrc={lightboxImage}
        images={lightboxImages}
        onNavigate={(src) => setLightboxImage(src)}
      />
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ActivityFeedContent />
    </Suspense>
  );
}