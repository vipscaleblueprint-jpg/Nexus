'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Inbox as InboxIcon,
  ChevronDown,
  SlidersHorizontal,
  Flag,
  CheckCircle2,
  X,
  Loader2,
  CornerDownRight,
} from 'lucide-react';
import { notificationsApi, TaskNotification } from '@/api/notifications';
import { activityApi } from '@/api/activity';
import { useAppStore } from '@/lib/store';
import { format, isToday, subDays } from 'date-fns';
import { toast } from '@/lib/toast';

export function ClickUpMobileInboxView() {
  const router = useRouter();
  const {
    unreadNotifications,
    setUnreadNotifications,
    decrementUnreadNotifications,
    setActiveMobileTask,
  } = useAppStore();

  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'primary' | 'all'>('primary');

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      if (filterMode === 'all') {
        const [notifRes, auditRes] = await Promise.all([
          notificationsApi.getNotifications({ tab: 'primary', limit: 50 }).catch(() => ({ notifications: [], unreadCount: 0 })),
          activityApi.getAuditLogs({ limit: 50 }).catch(() => ({ logs: [] })),
        ]);

        const auditItems: TaskNotification[] = (auditRes.logs || []).map((l: any) => ({
          id: String(l.id || `audit_${Math.random()}`),
          userId: l.userId || '',
          actorId: l.actorId || l.user?.id || null,
          taskId: l.taskId || (l.entity === 'TASK' ? l.entityId : null),
          subtaskId: l.entity === 'SUBTASK' ? l.entityId : null,
          type: l.action || 'ACTIVITY',
          title: l.entityTitle ? `${l.action || 'Activity'}: ${l.entityTitle}` : (l.action || 'Workspace Activity'),
          content: l.details?.text || l.details?.subtaskTitle || l.action || 'Activity update',
          isRead: true,
          isCleared: false,
          createdAt: l.createdAt || new Date().toISOString(),
          actor: l.user || null,
          task: l.task || (l.entityTitle ? { id: l.taskId || l.entityId || '', title: l.entityTitle, status: 'OPEN', listId: '' } : null),
        }));

        const merged = [...(notifRes.notifications || []), ...auditItems];
        merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setNotifications(merged);
        if (typeof notifRes.unreadCount === 'number') {
          setUnreadNotifications(notifRes.unreadCount);
        }
      } else {
        const res = await notificationsApi.getNotifications({
          tab: 'primary',
          limit: 50,
        });
        setNotifications(res.notifications || []);
        if (typeof res.unreadCount === 'number') {
          setUnreadNotifications(res.unreadCount);
        }
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [filterMode, setUnreadNotifications]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Filtered by search
  const filteredNotifications = useMemo(() => {
    if (!searchQuery.trim()) return notifications;
    const q = searchQuery.toLowerCase();
    return notifications.filter((n) =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q) ||
      (n.task?.title || '').toLowerCase().includes(q)
    );
  }, [notifications, searchQuery]);

  // Group into Today and Last 7 days
  const grouped = useMemo(() => {
    const sevenDaysAgo = subDays(new Date(), 7);
    const todayList: TaskNotification[] = [];
    const last7DaysList: TaskNotification[] = [];
    const olderList: TaskNotification[] = [];

    filteredNotifications.forEach((n) => {
      const d = new Date(n.createdAt);
      if (isNaN(d.getTime())) {
        todayList.push(n);
      } else if (isToday(d)) {
        todayList.push(n);
      } else if (d >= sevenDaysAgo) {
        last7DaysList.push(n);
      } else {
        olderList.push(n);
      }
    });

    return { todayList, last7DaysList, olderList };
  }, [filteredNotifications]);

  const handleItemClick = async (notif: TaskNotification) => {
    if (!notif.isRead) {
      try {
        await notificationsApi.markAsRead(notif.id);
        setNotifications((prev) =>
          prev.map((item) =>
            item.id === notif.id ? { ...item, isRead: true } : item
          )
        );
        decrementUnreadNotifications();
      } catch {}
    }

    // Proper redirection to task or subtask
    if (notif.taskId) {
      if (notif.subtaskId) {
        router.push(`/tasks/${notif.taskId}?subtask=${notif.subtaskId}`);
      } else {
        router.push(`/tasks/${notif.taskId}`);
      }
    }
  };

  return (
    <div className="w-full min-h-full bg-background text-foreground flex flex-col pb-28 select-none">
      {/* ── 1. HEADER (Clean Inbox title, NO AA avatar, NO plus) ── */}
      <div className="px-5 pt-4 pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
          Inbox
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
            placeholder="Search notifications..."
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

      {/* ── 3. FILTER HEADER ROW ─────────────────────────────── */}
      <div className="px-5 py-2 flex items-center justify-between border-b border-border pb-3">
        <button
          onClick={() => setFilterMode(filterMode === 'primary' ? 'all' : 'primary')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-secondary border border-border text-xs font-semibold text-foreground cursor-pointer hover:bg-hover-subtle transition-colors"
        >
          <InboxIcon className="size-3.5 text-muted-foreground" />
          <span>
            {filterMode === 'primary' ? 'For Me' : 'All Activity'}{' '}
            {filterMode === 'primary' && unreadNotifications > 0 ? `(${unreadNotifications})` : ''}
          </span>
          <span className={`size-2 rounded-full ${filterMode === 'primary' ? 'bg-pink-500' : 'bg-indigo-500'}`} />
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>

        <button className="p-2 text-muted-foreground hover:text-foreground">
          <SlidersHorizontal className="size-4" />
        </button>
      </div>

      {/* ── 4. NOTIFICATIONS FEED ────────────────────────────── */}
      <div className="px-5 py-3 space-y-4">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="size-6 animate-spin text-indigo-400" />
            <span className="text-xs">Loading notifications...</span>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground space-y-2">
            <InboxIcon className="size-10 mx-auto opacity-30 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Your inbox is clear</p>
            <p className="text-xs text-muted-foreground">Notifications will appear here as tasks update.</p>
          </div>
        ) : (
          <>
            {/* Section: Today */}
            {grouped.todayList.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-muted-foreground mb-2">Today</h3>
                <div className="space-y-1">
                  {grouped.todayList.map((notif) => (
                    <InboxItemRow
                      key={notif.id}
                      item={notif}
                      onClick={() => handleItemClick(notif)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Section: Last 7 days */}
            {grouped.last7DaysList.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-muted-foreground mb-2 mt-4">Last 7 days</h3>
                <div className="space-y-1">
                  {grouped.last7DaysList.map((notif) => (
                    <InboxItemRow
                      key={notif.id}
                      item={notif}
                      onClick={() => handleItemClick(notif)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Section: Older */}
            {grouped.olderList.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-muted-foreground mb-2 mt-4">Older</h3>
                <div className="space-y-1">
                  {grouped.olderList.map((notif) => (
                    <InboxItemRow
                      key={notif.id}
                      item={notif}
                      onClick={() => handleItemClick(notif)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InboxItemRow({
  item,
  onClick,
}: {
  item: TaskNotification;
  onClick: () => void;
}) {
  const isDone =
    item.task?.status === 'DONE' ||
    item.task?.status === 'CLOSED';

  const formattedTime = useMemo(() => {
    try {
      const d = new Date(item.createdAt);
      if (isNaN(d.getTime())) return '';
      return format(d, 'h:mm a');
    } catch {
      return '';
    }
  }, [item.createdAt]);

  const displayTitle = item.task?.title || item.title || 'Task Update';
  const displaySubtitle =
    item.content ||
    `${item.actor?.name || 'VIP Scale'} assigned task to you`;

  return (
    <div
      onClick={onClick}
      className={`py-3 px-2 flex items-start justify-between gap-3 rounded-xl transition-colors cursor-pointer ${
        !item.isRead ? 'bg-secondary/70 border border-border/60' : 'hover:bg-hover-subtle'
      }`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {/* Status ring or done check */}
        <div className="pt-0.5 shrink-0">
          {isDone ? (
            <CheckCircle2 className="size-4 text-emerald-500 fill-emerald-500/20" />
          ) : !item.isRead ? (
            <div className="size-4 rounded-full border-2 border-pink-500 flex items-center justify-center">
              <span className="size-1.5 rounded-full bg-pink-500" />
            </div>
          ) : (
            <div className="size-4 rounded-full border-2 border-zinc-600" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <h4
            className={`text-sm leading-snug line-clamp-1 ${
              !item.isRead ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'
            }`}
          >
            {displayTitle}
          </h4>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground line-clamp-1">
            {item.subtaskId && (
              <span className="inline-flex items-center gap-0.5 text-indigo-400 font-semibold shrink-0">
                <CornerDownRight className="size-3" />
                Subtask
              </span>
            )}
            <span className="truncate">{displaySubtitle}</span>
          </div>
        </div>
      </div>

      {/* Right Column: Priority Flag + Timestamp */}
      <div className="flex flex-col items-end shrink-0 pt-0.5 text-right">
        <Flag className="size-3.5 text-rose-500 fill-rose-500 mb-1" />
        <span className="text-[11px] text-muted-foreground font-sans">
          {formattedTime}
        </span>
      </div>
    </div>
  );
}
