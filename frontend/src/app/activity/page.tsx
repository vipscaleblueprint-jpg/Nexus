'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { notificationsApi, TaskNotification } from '@/api/notifications';
import { useRouter } from 'next/navigation';
import { Check, CheckSquare, ShieldCheck, MailOpen, Clock, ChevronDown, ChevronLeft, ChevronRight, Users, MessageSquare, Activity, Globe } from 'lucide-react';
import { format, isToday, isYesterday, differenceInDays } from 'date-fns';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { ImageLightboxModal } from '@/components/modals/ImageLightboxModal';
import { tasksApi } from '@/api/tasks';
import { CommentContent } from '@/components/ui/CommentContent';
import { extractImagesFromContent } from '@/lib/commentImages';

type ViewMode = 'for_me' | 'show_all';
type Category = 'all' | 'status' | 'checklists' | 'audits' | 'assigned' | 'comments';

const VIEW_OPTIONS: { value: ViewMode; label: string; description: string }[] = [
  { value: 'for_me',   label: 'For Me',   description: 'All your notifications' },
  { value: 'show_all', label: 'Show All', description: 'All workspace activity' },
];

const CATEGORIES: { value: Category; label: string; icon: any }[] = [
  { value: 'all', label: 'All', icon: Activity },
  { value: 'status', label: 'Status Updates', icon: Clock },
  { value: 'checklists', label: 'Checklists', icon: CheckSquare },
  { value: 'audits', label: 'Auditor', icon: ShieldCheck },
  { value: 'assigned', label: 'Assigned to Me', icon: Users },
  { value: 'comments', label: 'Comments', icon: MessageSquare },
];

const formatActivityMessage = (log: any) => {
  const { action, entity, entityTitle, details } = log;
  const isSubtask = details?.subtaskTitle || entity?.toLowerCase() === 'subtask';
  const targetTitle = details?.subtaskTitle || entityTitle;
  const targetName = isSubtask ? `subtask "${targetTitle}"` : `task "${targetTitle}"`;
  let message = '';
  switch (action?.toUpperCase()) {
    case 'STATUS_CHANGE':
      message = `changed status ${details?.oldStatus ? `from ${details.oldStatus} ` : ''}to ${details?.newStatus}`;
      break;
    case 'AUDIT_ITEM_CHECKED': {
      const lower = (details?.itemName || '').toLowerCase();
      if (lower.includes('funnel')) {
        message = 'has checked funnel auditing';
      } else if (lower.includes('design')) {
        message = 'has checked design auditing';
      } else if (lower.includes('ui') && lower.includes('ux')) {
        message = 'has checked UI/UX auditing';
      } else if (lower.includes('instructions')) {
        message = 'has checked instructions auditing';
      } else {
        message = `has checked ${details?.itemName || 'auditing'}`;
      }
      break;
    }
    case 'CHECKLIST_ITEM_CHECKED':
      message = `has checked ${details?.itemName || 'checklist'}`;
      break;
    case 'PRIORITY_CHANGE':
      message = `changed priority ${details?.oldPriority ? `from ${details.oldPriority} ` : ''}to ${details?.newPriority}`;
      break;
    case 'TITLE_CHANGE':
      return `renamed ${isSubtask ? 'subtask' : 'task'} "${details?.oldTitle || ''}" to "${details?.newTitle || targetTitle}"`;
    case 'ASSIGNMENT':
      if (Array.isArray(details?.added) || Array.isArray(details?.removed)) {
        const added: string[] = details.added || [];
        const removed: string[] = details.removed || [];
        if (removed.length > 1 && added.length === 0 && details.assigneeName === 'Unassigned') {
          return `removed all assignees from ${targetName}`;
        }
        const parts: string[] = [];
        if (added.length > 0) parts.push(`assigned ${added.join(', ')}`);
        if (removed.length > 0) parts.push(`${parts.length ? 'and removed' : 'removed'} ${removed.join(', ')}`);
        if (parts.length > 0) {
          message = parts.join(' ');
          break;
        }
      }
      if (details?.assigneeName === 'Unassigned') {
        return `removed all assignees from ${targetName}`;
      }
      message = `updated assignment to ${details?.assigneeName || 'someone'}`;
      break;
    case 'TASK_CREATED': message = 'created this task'; break;
    case 'SUBTASK_CREATED': message = 'created a subtask'; break;
    case 'ASSIGNEE_ADDED': message = 'added an assignee'; break;
    case 'ASSIGNEE_REMOVED': message = 'removed an assignee'; break;
    case 'COMMENT_ADDED': message = 'added a comment'; break;
    case 'COMMENT': message = 'added a comment'; break;
    case 'REPLY': message = 'replied to a comment'; break;
    default:
      message = action ? `performed ${action.replace(/_/g, ' ').toLowerCase()}` : 'performed an action';
  }
  return `${message} on ${targetName}`;
};

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

const parseLogAction = (log: any) => {
  const { action, entity, entityTitle, details } = log;
  const isSubtask = details?.subtaskTitle || entity?.toLowerCase() === 'subtask';
  const targetTitle = details?.subtaskTitle || entityTitle || '';
  const prefix = isSubtask ? 'on subtask' : 'on task';
  let verb = 'performed an action on task';

  switch (action?.toUpperCase()) {
    case 'STATUS_CHANGE':
      verb = `changed status ${details?.oldStatus ? `from ${details.oldStatus} ` : ''}to ${details?.newStatus || ''} ${prefix}`;
      break;
    case 'AUDIT_ITEM_CHECKED': {
      const lower = (details?.itemName || '').toLowerCase();
      if (lower.includes('funnel')) verb = `has checked funnel auditing ${prefix}`;
      else if (lower.includes('design')) verb = `has checked design auditing ${prefix}`;
      else if (lower.includes('ui') && lower.includes('ux')) verb = `has checked UI/UX auditing ${prefix}`;
      else if (lower.includes('instructions')) verb = `has checked instructions auditing ${prefix}`;
      else verb = `has checked ${details?.itemName || 'auditing'} ${prefix}`;
      break;
    }
    case 'CHECKLIST_ITEM_CHECKED':
      verb = `has checked ${details?.itemName || 'checklist'} ${prefix}`;
      break;
    case 'PRIORITY_CHANGE':
      verb = `changed priority ${details?.oldPriority ? `from ${details.oldPriority} ` : ''}to ${details?.newPriority} ${prefix}`;
      break;
    case 'TITLE_CHANGE':
      verb = `renamed ${isSubtask ? 'subtask' : 'task'} "${details?.oldTitle || ''}" to`;
      break;
    case 'ASSIGNMENT':
      if (Array.isArray(details?.added) || Array.isArray(details?.removed)) {
        const added: string[] = details.added || [];
        const removed: string[] = details.removed || [];
        if (removed.length > 1 && added.length === 0 && details.assigneeName === 'Unassigned') {
          verb = `removed all assignees from ${isSubtask ? 'subtask' : 'task'}`;
          break;
        }
        const parts: string[] = [];
        if (added.length > 0) parts.push(`assigned ${added.join(', ')}`);
        if (removed.length > 0) parts.push(`${parts.length ? 'and removed' : 'removed'} ${removed.join(', ')}`);
        if (parts.length > 0) {
          verb = `${parts.join(' ')} ${prefix}`;
          break;
        }
      }
      if (details?.assigneeName === 'Unassigned') {
        verb = `removed all assignees from ${isSubtask ? 'subtask' : 'task'}`;
      } else {
        verb = `updated assignment to ${details?.assigneeName || 'someone'} ${prefix}`;
      }
      break;
    case 'TASK_CREATED':
      verb = 'created this task';
      break;
    case 'SUBTASK_CREATED':
      verb = 'created a subtask on';
      break;
    case 'ASSIGNEE_ADDED':
      verb = `added an assignee ${prefix}`;
      break;
    case 'ASSIGNEE_REMOVED':
      verb = `removed an assignee ${prefix}`;
      break;
    case 'COMMENT_ADDED':
    case 'COMMENT':
      verb = `added a comment on task`;
      break;
    case 'REPLY':
      verb = `replied to a comment on task`;
      break;
    default:
      verb = action ? `${action.replace(/_/g, ' ').toLowerCase()} ${prefix}` : `updated ${prefix}`;
  }

  return { verb, targetTitle, isSubtask };
};

const parseNotifAction = (n: TaskNotification) => {
  const type = n.type?.toUpperCase();
  const actorName = n.actor?.name || 'Someone';
  let verb = 'updated';
  let targetTitle = n.task?.title || '';

  if (type === 'COMMENT' || type === 'REPLY') {
    verb = 'added a comment on task';
  } else if (type === 'MENTION') {
    verb = 'mentioned you in a comment on task';
  } else if (type === 'STATUS_CHANGE') {
    const match = n.title?.match(/status to (.+)$/i);
    verb = match ? `changed status to ${match[1]} on task` : 'changed status on task';
  } else if (type === 'ASSIGNMENT') {
    verb = 'assigned you to task';
  } else if (type === 'AUDIT_ITEM_CHECKED') {
    verb = 'checked audit item on task';
  } else if (type === 'CHECKLIST_ITEM_CHECKED') {
    verb = 'checked checklist item on task';
  } else {
    const cleaned = n.title?.replace(actorName, '').trim();
    if (cleaned) verb = cleaned;
  }

  return { actorName, verb, targetTitle };
};

const parseItemDisplay = (item: any, isAuditLog: boolean) => {
  if (isAuditLog || item.isAudit) {
    const actorName = item.user?.name || item.actor?.name || 'Someone';
    const actorAvatar = item.user?.avatarUrl || item.actor?.avatarUrl || null;
    const { verb, targetTitle } = parseLogAction(item);
    const targetTaskId = item.entityId || item.taskId || item.task?.id;
    const content = item.details?.text || item.content || '';
    const isUnread = !item.isRead && !item.isAudit;
    const action = (item.action || item.type)?.toUpperCase();
    const isComment = action === 'COMMENT' || action === 'REPLY' || action === 'COMMENT_ADDED';
    const isStatus = action === 'STATUS_CHANGE' || action === 'TITLE_CHANGE';
    const isChecklist = action === 'CHECKLIST_ITEM_CHECKED';
    const isAudit = action === 'AUDIT_ITEM_CHECKED';
    const isAssignment = action === 'ASSIGNMENT';

    const IconToUse = isAssignment ? Users : isStatus ? Clock : isComment ? MessageSquare : isAudit ? ShieldCheck : isChecklist ? CheckSquare : Globe;
    const iconBg = isAssignment ? 'bg-blue-600' : isStatus ? 'bg-emerald-600' : isComment ? 'bg-amber-600' : isAudit ? 'bg-purple-600' : isChecklist ? 'bg-violet-600' : 'bg-zinc-600';

    return {
      id: item.id,
      actorName,
      actorAvatar,
      verb,
      targetTitle,
      targetTaskId,
      content,
      isUnread,
      createdAt: item.createdAt,
      IconToUse,
      iconBg,
      rawItem: item,
    };
  } else {
    const { actorName, verb, targetTitle } = parseNotifAction(item);
    const actorAvatar = item.actor?.imageUrl || item.actor?.avatarUrl || null;
    const targetTaskId = item.task?.id || item.taskId || item.entityId;
    const content = item.content || item.details?.text || '';
    const isUnread = !item.isRead;
    const type = item.type?.toUpperCase();

    const isComment = type === 'COMMENT' || type === 'REPLY' || type === 'MENTION';
    const isStatus = type === 'STATUS_CHANGE';
    const isChecklist = type === 'CHECKLIST_ITEM_CHECKED';
    const isAudit = type === 'AUDIT_ITEM_CHECKED';
    const isAssignment = type === 'ASSIGNMENT';

    const IconToUse = isAssignment ? Users : isStatus ? Clock : isComment ? MessageSquare : isAudit ? ShieldCheck : isChecklist ? CheckSquare : Globe;
    const iconBg = isAssignment ? 'bg-blue-600' : isStatus ? 'bg-emerald-600' : isComment ? 'bg-amber-600' : isAudit ? 'bg-purple-600' : isChecklist ? 'bg-violet-600' : 'bg-zinc-600';

    return {
      id: item.id,
      actorName,
      actorAvatar,
      verb,
      targetTitle,
      targetTaskId,
      content,
      isUnread,
      createdAt: item.createdAt,
      IconToUse,
      iconBg,
      rawItem: item,
    };
  }
};

interface ActivityFeedCache {
  notifications: TaskNotification[];
  auditLogs: any[];
  myAuditLogs: any[];
  timestamp: number;
  scrollY: number;
}

let feedCache: ActivityFeedCache | null = null;
const FEED_CACHE_TTL_MS = 60_000;

export default function ActivityPage() {
  const router = useRouter();
  const { decrementUnreadNotifications, workspaceRoles, currentUser, tasksIndex, tasks } = useAppStore();
  const isPrivileged = currentUser?.systemRole === 'ADMIN' || currentUser?.roles?.some((r: string) => /project\s*manager|^pm$|\bsenior\b/i.test(r?.trim()));
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const user = useAppStore.getState().currentUser;
    const isPrivilegedUser = user?.systemRole === 'ADMIN' || user?.roles?.some((r: string) => /project\s*manager|^pm$|\bsenior\b/i.test(r?.trim()));
    return isPrivilegedUser ? 'show_all' : 'for_me';
  });
  const hasInitializedViewMode = useRef(false);

  useEffect(() => {
    if (currentUser && !hasInitializedViewMode.current) {
      if (isPrivileged) {
        setViewMode('show_all');
      }
      hasInitializedViewMode.current = true;
    }
  }, [currentUser, isPrivileged]);

  const [category, setCategory] = useState<Category>('all');
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'last7' | 'last30'>('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const initialCacheValid = !!feedCache && (Date.now() - feedCache.timestamp < FEED_CACHE_TTL_MS);
  const [notifications, setNotifications] = useState<TaskNotification[]>(() => initialCacheValid ? feedCache!.notifications : []);
  const [auditLogs, setAuditLogs] = useState<any[]>(() => initialCacheValid ? feedCache!.auditLogs : []);
  const [myAuditLogs, setMyAuditLogs] = useState<any[]>(() => initialCacheValid ? feedCache!.myAuditLogs : []);
  const [loading, setLoading] = useState<boolean>(() => !initialCacheValid);
  const [selectedTask, setSelectedTask] = useState<any>(null);
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

  // silent = live refresh from a socket event or background update: keep the current list on screen
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
            filter: category === 'comments' ? 'mentions' : 'all',
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

  const handleOpenTask = async (n: any) => {
    // Resolve the task ID from multiple possible shapes:
    //   - TaskNotification: n.task.id
    //   - Audit-merged item: n.entityId or n.taskId (set by backend)
    //   - Plain string (URL param)
    const taskId = typeof n === 'string'
      ? n
      : (n.task?.id || (n as any).taskId || (n as any).entityId);
    if (typeof n !== 'string' && !n.isRead && n.id && !(n as any).isAudit) {
      handleMarkAsRead(n.id);
    }
    if (!taskId) return;

    // Preserve scroll position before opening task
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

    const taskObj = (typeof n === 'object' && n.task?.id === taskId) ? n.task : (tasksIndex[taskId] || tasks.find((t: any) => t.id === taskId));
    if (taskObj) {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('task', taskId);
        window.history.replaceState(null, '', url.pathname + url.search);
      }
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
          window.history.replaceState(null, '', url.pathname + url.search);
        }
        setSelectedTask(res.task);
        return;
      }
    } catch (err) {
      console.warn('Failed to load task for modal:', err);
    }
    router.push(`/tasks/${taskId}?from=/activity`);
  };

  // Sync selectedTask to URL searchParams
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (selectedTask) {
        if (url.searchParams.get('task') !== selectedTask.id) {
          url.searchParams.set('task', selectedTask.id);
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      } else if (url.searchParams.has('task')) {
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
    const url = new URL(window.location.href);
    const taskId = url.searchParams.get('task');
    if (taskId) handleOpenTask(taskId);
    // Live updates: status/name changes, comments and notifications arrive as socket events.
    // Debounced so a burst (e.g. room + global emits, or a doubled integration request) refetches once.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onNew = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => fetchData(true), 400);
    };
    const onClear = () => {
      setSelectedTask(null);
      const u = new URL(window.location.href);
      u.searchParams.delete('task');
      window.history.pushState({}, '', u.toString());
    };
    window.addEventListener('notification_received', onNew);
    window.addEventListener('task_activity', onNew);
    window.addEventListener('task:comment_added', onNew);
    window.addEventListener('clear_activity_task', onClear);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('notification_received', onNew);
      window.removeEventListener('task_activity', onNew);
      window.removeEventListener('task:comment_added', onNew);
      window.removeEventListener('clear_activity_task', onClear);
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

  const handleClear = async (id: string) => {
    try {
      await notificationsApi.clearNotification(id);
      setNotifications(prev => {
        const next = prev.filter(n => n.id !== id);
        if (feedCache) feedCache.notifications = next;
        return next;
      });
      decrementUnreadNotifications();
    } catch (err) { console.error(err); }
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications(prev => {
        const next = prev.map(n => n.id === id ? { ...n, isRead: true } : n);
        if (feedCache) feedCache.notifications = next;
        return next;
      });
      decrementUnreadNotifications();
    } catch (err) { console.error(err); }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications(prev => {
        const next = prev.map(n => ({ ...n, isRead: true }));
        if (feedCache) feedCache.notifications = next;
        return next;
      });
      useAppStore.getState().setUnreadNotifications(0);
    } catch (err) { console.error(err); }
  };

  const handleClearAll = async () => {
    try {
      await notificationsApi.clearAll();
      setNotifications([]);
      if (feedCache) feedCache.notifications = [];
      useAppStore.getState().setUnreadNotifications(0);
    } catch (err) { console.error(err); }
  };

  const groupByDate = (items: any[]) => {
    const groups: { [key: string]: any[] } = {};
    items.forEach(item => {
      const d = new Date(item.createdAt);
      let g = '';
      if (isToday(d)) g = 'Today';
      else if (isYesterday(d)) g = 'Yesterday';
      else if (differenceInDays(new Date(), d) <= 7) g = 'Last 7 days';
      else g = format(d, 'MMMM');
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    });
    return groups;
  };

  const isGlobalLogView = viewMode === 'show_all';

  const matchesCategoryNotif = (n: any, cat: Category) => {
    if (cat === 'all') return true;
    const type = n.type?.toUpperCase();
    if (cat === 'status') return type === 'STATUS_CHANGE' || type === 'TITLE_CHANGE';
    if (cat === 'checklists') return type === 'CHECKLIST_ITEM_CHECKED' || type?.includes('CHECKLIST');
    if (cat === 'audits') return type === 'AUDIT_ITEM_CHECKED' || type?.includes('AUDIT');
    if (cat === 'assigned') return type === 'ASSIGNMENT';
    if (cat === 'comments') return type === 'MENTION' || type === 'COMMENT';
    return false;
  };

  const matchesCategoryLog = (log: any, cat: Category) => {
    if (cat === 'all') return true;
    const action = log.action?.toUpperCase();
    if (cat === 'status') return action === 'STATUS_CHANGE' || action === 'TITLE_CHANGE';
    if (cat === 'checklists') return action === 'CHECKLIST_ITEM_CHECKED' || action?.includes('CHECKLIST');
    if (cat === 'audits') return action === 'AUDIT_ITEM_CHECKED' || action?.includes('AUDIT');
    if (cat === 'assigned') return action === 'ASSIGNMENT';
    if (cat === 'comments') return action === 'COMMENT' || action === 'REPLY' || action === 'COMMENT_ADDED';
    return false;
  };

  const filteredNotifications = notifications.filter(n => matchesCategoryNotif(n, category));
  const filteredLogs = auditLogs.filter(l => matchesCategoryLog(l, category));

  const filteredMyLogs = myAuditLogs.filter(l => matchesCategoryLog(l, category));

  const mergedForMe = [
    ...filteredNotifications,
    ...filteredMyLogs.map(log => {
      const type = (log.action === 'COMMENT_ADDED' || log.action === 'REPLY') ? 'COMMENT' : log.action;
      // taskId comes from backend enrichment (log.taskId) or falls back to entityId
      const resolvedTaskId = log.taskId || log.entityId;
      return {
        id: 'audit_' + log.id,
        type: type,
        actor: log.user,
        title: `${log.user?.name || 'Someone'} ${formatActivityMessage(log)}`,
        content: log.details?.text || '',
        createdAt: log.createdAt,
        isRead: true,
        task: { id: resolvedTaskId, title: log.details?.subtaskTitle || log.entityTitle || 'task' },
        taskId: resolvedTaskId,
        entityId: log.entityId,
        isAudit: true
      };
    })
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const activeItems = isGlobalLogView 
    ? auditLogs 
    : mergedForMe;

  const grouped = groupByDate(activeItems);

  const allFeedImages = useMemo(() => {
    const urls: string[] = [];
    activeItems.forEach((item: any) => {
      const text = item.details?.text || item.content;
      if (text) {
        const imgs = extractImagesFromContent(text);
        imgs.forEach((u) => {
          if (!urls.includes(u)) urls.push(u);
        });
      }
    });
    return urls;
  }, [activeItems]);

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
    <div className="flex flex-col h-full bg-background text-foreground relative pt-8">
      <div className="px-8 flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Activity</h1>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-zinc-800/50 p-1 rounded-md border border-zinc-800 mr-2 hidden sm:flex">
            <button 
              onClick={() => { setTimeFilter('all'); setPage(1); }} 
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'all' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              All time
            </button>
            <button 
              onClick={() => { setTimeFilter('today'); setPage(1); }} 
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'today' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Today
            </button>
            <button 
              onClick={() => { setTimeFilter('last7'); setPage(1); }} 
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'last7' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Last 7 days
            </button>
            <button 
              onClick={() => { setTimeFilter('last30'); setPage(1); }} 
              className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'last30' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Last 30 days
            </button>
          </div>

          {!isGlobalLogView && (
            <>
              <button
                onClick={handleMarkAllAsRead}
                className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Check className="size-3.5" />
                Mark all as read
              </button>
              <button
                onClick={handleClearAll}
                className="px-3 py-1.5 text-xs font-medium text-white bg-[#5f5ce6] hover:bg-[#4b48d6] rounded-md shadow-sm flex items-center gap-1.5 transition-colors"
              >
                <Check className="size-3.5" />
                Clear all
              </button>
            </>
          )}

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(prev => !prev)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-md transition-colors"
            >
              {viewMode === 'for_me' ? 'For Me' : 'Show All'}
              <ChevronDown className={`size-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-secondary border border-zinc-700/60 rounded-lg shadow-xl z-50 overflow-hidden">
                {VIEW_OPTIONS.map(option => {
                  const isActive = viewMode === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => { setViewMode(option.value); setPage(1); setDropdownOpen(false); }}
                      className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800 ${isActive ? 'bg-indigo-500/10' : ''}`}
                    >
                      <div className="flex-1">
                        <p className={`text-xs font-medium ${isActive ? 'text-indigo-300' : 'text-zinc-200'}`}>{option.label}</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">{option.description}</p>
                      </div>
                      {isActive && <Check className="size-3.5 text-indigo-400 mt-0.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category Tabs Matching Photo 2 */}
      <div className="px-8 border-b border-zinc-800/80 mb-6 flex items-center gap-8 overflow-x-auto custom-scrollbar">
        {CATEGORIES.map((cat) => {
          const isActive = category === cat.value;
          return (
            <button
              key={cat.value}
              onClick={() => { setCategory(cat.value); setPage(1); }}
              className={`pb-3 px-1 text-sm font-semibold transition-colors relative whitespace-nowrap shrink-0 ${
                isActive ? 'text-indigo-400' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>{cat.label}</span>
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

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
        ) : activeItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
            <MailOpen className="size-10 mb-3 opacity-20" />
            <p>{isGlobalLogView ? 'No activity logs found' : "You are all caught up!"}</p>
          </div>
        ) : (
          <div className="space-y-8 pb-10">
            {Object.entries(grouped).map(([groupName, items]) => (
              <div key={groupName} className="relative">
                {/* Date Group Heading (e.g. TODAY) */}
                <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm py-2 mb-4">
                  <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest px-1">
                    {groupName}
                  </h3>
                </div>

                <div className="space-y-4">
                  {items.map((rawItem: any, i: number) => {
                    const item = parseItemDisplay(rawItem, isGlobalLogView);
                    const initials = getInitials(item.actorName);
                    const avatarBg = getAvatarBg(item.actorName);

                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (item.targetTaskId) {
                            handleOpenTask(rawItem);
                          }
                        }}
                        className="group/card flex gap-4 cursor-pointer relative"
                      >
                        {/* Timeline Connector Line */}
                        {i !== items.length - 1 && (
                          <div className="absolute left-5 top-12 bottom-[-16px] w-[2px] bg-zinc-800" />
                        )}

                        {/* Avatar with Micro Icon Badge */}
                        <div className="shrink-0 relative">
                          <div className="relative z-10">
                            {item.actorAvatar ? (
                              <img
                                src={item.actorAvatar}
                                alt=""
                                className="size-10 rounded-full object-cover shrink-0 ring-4 ring-background shadow-sm"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  if (e.currentTarget.nextElementSibling) {
                                    (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex';
                                  }
                                }}
                              />
                            ) : null}
                            <div
                              className={`size-10 rounded-full ${avatarBg} text-white flex items-center justify-center text-sm font-bold shrink-0 ring-4 ring-background shadow-sm`}
                              style={{ display: item.actorAvatar ? 'none' : 'flex' }}
                            >
                              {initials}
                            </div>

                            <div className={`absolute -bottom-1 -right-1 size-4 rounded-full ${item.iconBg} text-white flex items-center justify-center ring-2 ring-background`}>
                              <item.IconToUse className="size-2.5" />
                            </div>
                          </div>
                        </div>

                        {/* Card Content Matching Photo 2 */}
                        <div className={`flex-1 min-w-0 bg-[#18181c] border border-zinc-800/80 rounded-2xl p-5 shadow-sm transition-all hover:border-zinc-700/80 hover:bg-[#1b1b20] ${item.isUnread ? 'border-zinc-800 ring-1 ring-indigo-500/10' : ''}`}>
                          {/* Header: Actor + Verb + Task Title + Unread Dot */}
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="flex items-center gap-1.5 flex-wrap text-sm leading-tight">
                              <span className="font-semibold text-zinc-100">{item.actorName}</span>
                              <span className="text-zinc-400">{item.verb}</span>
                              {item.targetTitle && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (item.targetTaskId) handleOpenTask(rawItem);
                                  }}
                                  className="font-medium text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer"
                                >
                                  {item.targetTitle}
                                </span>
                              )}
                            </div>

                            {item.isUnread && (
                              <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-sm shrink-0" />
                            )}
                          </div>

                          {/* Quote Body with clean vertical left border */}
                          {item.content && (
                            <div className="my-2.5 pl-3.5 border-l-2 border-zinc-700/60 text-sm text-zinc-300">
                              <CommentContent
                                content={item.content}
                                className="text-sm text-zinc-300 max-w-full prose prose-sm prose-invert prose-p:my-1 prose-a:text-blue-400 prose-a:underline [&_a]:text-blue-400 [&_a]:underline"
                                onPreviewImage={handlePreviewImage}
                              />
                            </div>
                          )}

                          {/* Footer: Timestamp & optional hover clear */}
                          <div className="flex items-center justify-between gap-4 mt-3">
                            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                              <Clock className="size-3.5 text-zinc-500" />
                              <span>{format(new Date(item.createdAt), 'MMM d, h:mm a')}</span>
                            </div>

                            {item.isUnread && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleClear(item.id);
                                }}
                                className="opacity-0 group-hover/card:opacity-100 px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800 rounded-md transition-all flex items-center gap-1"
                                title="Clear notification"
                              >
                                <Check className="size-3" />
                                <span>Clear</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Persistent Bottom Pagination Bar */}
      {total > 0 && (
        <div className="px-8 py-3.5 border-t border-zinc-800/80 bg-background/95 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span>
              Showing <span className="font-semibold text-zinc-200">{Math.min((page - 1) * limit + 1, total)}</span>–<span className="font-semibold text-zinc-200">{Math.min(page * limit, total)}</span> of <span className="font-semibold text-zinc-200">{total}</span> activities
            </span>

            <div className="flex items-center gap-1.5 ml-2 border-l border-zinc-800 pl-3">
              <span className="text-[11px] text-zinc-500">Per page:</span>
              {[25, 50, 100].map((size) => (
                <button
                  key={size}
                  onClick={() => {
                    setLimit(size);
                    setPage(1);
                    if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
                  }}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                    limit === size
                      ? 'bg-zinc-800 text-indigo-400 font-semibold border border-zinc-700'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 1 || loading}
                onClick={() => {
                  setPage(p => Math.max(1, p - 1));
                  if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
                }}
                className="h-8 px-2.5 flex items-center gap-1 rounded-lg text-xs font-medium text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer border border-zinc-800/80"
              >
                <ChevronLeft className="size-3.5" />
                <span>Prev</span>
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = i + 1;
                  if (totalPages > 5) {
                    if (page > 3) pageNum = page - 2 + i;
                    if (page > totalPages - 2) pageNum = totalPages - 4 + i;
                  }
                  if (pageNum < 1 || pageNum > totalPages) return null;
                  return (
                    <button
                      key={pageNum}
                      disabled={loading}
                      onClick={() => {
                        setPage(pageNum);
                        if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
                      }}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        page === pageNum
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                disabled={page >= totalPages || loading}
                onClick={() => {
                  setPage(p => Math.min(totalPages, p + 1));
                  if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
                }}
                className="h-8 px-2.5 flex items-center gap-1 rounded-lg text-xs font-medium text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer border border-zinc-800/80"
              >
                <span>Next</span>
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}


      <TaskDetailModal
        isOpen={!!selectedTask}
        onClose={() => {
          setSelectedTask(null);
          if (typeof window !== 'undefined') {
            const u = new URL(window.location.href);
            u.searchParams.delete('task');
            u.searchParams.delete('subtask');
            window.history.replaceState({}, '', u.pathname + (u.search || ''));
          }
          if (feedCache?.scrollY && feedScrollRef.current) {
            const targetY = feedCache.scrollY;
            requestAnimationFrame(() => {
              if (feedScrollRef.current) {
                feedScrollRef.current.scrollTop = targetY;
              }
            });
          }
        }}
        task={selectedTask}
        mode="full"
        workspaceRoles={workspaceRoles}
        onUpdateTask={(updatedTask) => setSelectedTask(updatedTask)}
      />

      <ImageLightboxModal
        isOpen={!!lightboxImage}
        onClose={handleCloseLightbox}
        currentSrc={lightboxImage}
        images={lightboxImages}
        onNavigate={(newSrc) => setLightboxImage(newSrc)}
      />
    </div>
  );
}