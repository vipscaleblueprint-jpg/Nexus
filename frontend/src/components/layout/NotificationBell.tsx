/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  Clock,
  MessageSquare,
  AtSign,
  RefreshCw,
  UserPlus,
  ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isToday, isYesterday } from "date-fns";
import { notificationsApi, TaskNotification } from "@/api/notifications";
import { useAppStore } from "@/lib/store";
import { CommentContent } from "@/components/ui/CommentContent";
import { fetchListStatuses } from "@/lib/listStatusCache";

const STATUS_HEX_MAP: Record<string, string> = {
  KYC: '#3A8F55',
  'PIN BOARD': '#1F8A6E',
  PIN_BOARD: '#1F8A6E',
  DAILY: '#2F7BD0',
  WEEKLY: '#2F7BD0',
  MONTHLY: '#2F7BD0',
  PENDING: '#D29A2A',
  'IN PROGRESS': '#D04A7C',
  IN_PROGRESS: '#D04A7C',
  REVISION: '#5B6BD6',
  WAITING: '#D9534F',
  'IN REVIEW': '#D97B3A',
  IN_REVIEW: '#D97B3A',
  REVIEW: '#D97B3A',
  CHECKING: '#A35DB8',
  CRM: '#22A3AE',
  'ON-HOLD': '#8A8F98',
  ON_HOLD: '#8A8F98',
  CLOSED: '#2FA37A',
  TODO: '#475569',
  DONE: '#2FA37A',
  COMPLETE: '#2FA37A',
  COMPLETED: '#2FA37A',
  CANCELLED: '#f43f5e',
};

const COLOR_NAMES_MAP: Record<string, string> = {
  slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
  blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
  pink: '#ec4899', rose: '#f43f5e'
};

function getStatusHexColor(status: string, customColor?: string): string {
  if (customColor) {
    if (customColor.startsWith('#')) return customColor;
    if (COLOR_NAMES_MAP[customColor.toLowerCase()]) return COLOR_NAMES_MAP[customColor.toLowerCase()];
    return customColor;
  }
  if (!status) return '#71717a';

  const clean = status.trim().toUpperCase();
  if (STATUS_HEX_MAP[clean]) return STATUS_HEX_MAP[clean];

  const noUnderscore = clean.replace(/_/g, ' ');
  if (STATUS_HEX_MAP[noUnderscore]) return STATUS_HEX_MAP[noUnderscore];

  const withHyphen = clean.replace(/ /g, '-');
  if (STATUS_HEX_MAP[withHyphen]) return STATUS_HEX_MAP[withHyphen];

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(status.trim())) {
    return status.trim();
  }
  return '#71717a';
}

type TabType = "all" | "unread" | "mentions";

export function NotificationBell() {
  const router = useRouter();
  const unreadCount = useAppStore(state => state.unreadNotifications);
  const setUnreadCount = useAppStore(state => state.setUnreadNotifications);

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [customStatusColors, setCustomStatusColors] = useState<Record<string, string>>({});

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Pre-load custom list status colors for tasks in notification list
  useEffect(() => {
    const listIds = Array.from(new Set(notifications.map(n => n.task?.listId).filter(Boolean))) as string[];
    if (listIds.length === 0) return;

    listIds.forEach(listId => {
      fetchListStatuses(listId).then(statuses => {
        if (Array.isArray(statuses) && statuses.length > 0) {
          setCustomStatusColors(prev => {
            let changed = false;
            const next = { ...prev };
            statuses.forEach((s: any) => {
              const name = (s.name || s.title || s.status || '').toUpperCase();
              if (name && s.color) {
                const key = `${listId}:${name}`;
                if (next[key] !== s.color) {
                  next[key] = s.color;
                  changed = true;
                }
              }
            });
            return changed ? next : prev;
          });
        }
      }).catch(() => {});
    });
  }, [notifications]);

  const loadNotifications = useCallback(async (pageNum = 1, tab = activeTab, markAsReadOnLoad = false) => {
    if (pageNum === 1) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const res = await notificationsApi.getNotifications({
        tab: 'primary',
        page: pageNum,
        limit: 15,
        filter: tab,
      });

      const processed = markAsReadOnLoad
        ? (res.notifications || []).map(n => ({ ...n, isRead: true }))
        : (res.notifications || []);

      if (pageNum === 1) {
        setNotifications(processed);
      } else {
        setNotifications(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const fresh = processed.filter(n => !existingIds.has(n.id));
          return [...prev, ...fresh];
        });
      }

      setHasMore(res.hasMore);
      setPage(pageNum);

      if (markAsReadOnLoad) {
        setUnreadCount(0);
      } else if (typeof res.unreadCount === 'number') {
        setUnreadCount(res.unreadCount);
      }
    } catch (error) {
      console.error("Failed to load notifications", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [activeTab, setUnreadCount]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Mention profile cards render in a portal outside the dropdown; clicks inside them shouldn't close it
      if ((event.target as Element)?.closest?.('[data-radix-popper-content-wrapper]')) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Listen for real-time events to reload
  useEffect(() => {
    const handleActivity = () => {
      if (isOpen) {
        loadNotifications(1, activeTab);
      } else {
        // Lightweight unread count sync without fetching notification bodies
        notificationsApi.getNotifications({ tab: 'primary', limit: 1 }).then(res => {
          if (typeof res.unreadCount === 'number') {
            setUnreadCount(res.unreadCount);
          }
        });
      }
    };

    const handleRead = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      }
    };

    const handleAllRead = () => {
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    };

    const handleCleared = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }
    };

    const handleAllCleared = () => {
      setNotifications([]);
      setUnreadCount(0);
    };

    window.addEventListener("notification_received", handleActivity);
    window.addEventListener("notification_read", handleRead);
    window.addEventListener("notifications_all_read", handleAllRead);
    window.addEventListener("notification_cleared", handleCleared);
    window.addEventListener("notifications_all_cleared", handleAllCleared);

    return () => {
      window.removeEventListener("notification_received", handleActivity);
      window.removeEventListener("notification_read", handleRead);
      window.removeEventListener("notifications_all_read", handleAllRead);
      window.removeEventListener("notification_cleared", handleCleared);
      window.removeEventListener("notifications_all_cleared", handleAllCleared);
    };
  }, [isOpen, activeTab, loadNotifications, setUnreadCount]);

  const loadMore = () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    loadNotifications(page + 1, activeTab);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 60 && hasMore && !isLoading && !isLoadingMore) {
      loadMore();
    }
  };

  const handleTabChange = (newTab: TabType) => {
    if (newTab === activeTab) return;
    setActiveTab(newTab);
    setNotifications([]);
    setPage(1);
    setHasMore(false);
    loadNotifications(1, newTab);
  };

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await notificationsApi.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (error) {
      console.error("Failed to mark as read", error);
    }
  };

  const displayList = notifications;

  const formatNotifTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    if (isToday(d)) {
      return format(d, "h:mm a");
    }
    if (isYesterday(d)) {
      return `Yesterday, ${format(d, "h:mm a")}`;
    }
    return format(d, "MMM d, h:mm a");
  };

  const getNotificationMeta = (n: TaskNotification) => {
    const type = n.type?.toUpperCase() || "";
    const actorName = n.actor?.name || "Someone";
    let actionVerb = "updated";
    let statusBadge: string | null = null;
    let Icon = Bell;
    let badgeBg = "bg-zinc-600";

    if (type === "MENTION") {
      Icon = AtSign;
      badgeBg = "bg-indigo-600";
      actionVerb = "mentioned you in";
    } else if (type === "COMMENT" || type === "REPLY") {
      Icon = MessageSquare;
      badgeBg = "bg-amber-600";
      actionVerb = "commented on";
    } else if (type === "STATUS_CHANGE") {
      Icon = RefreshCw;
      badgeBg = "bg-emerald-600";
      actionVerb = "changed status";
      const match = n.title.match(/(?:status|status of subtask .*?) to (.+)$/i) || n.title.match(/status to (.+)$/i);
      if (match) {
        statusBadge = match[1].replace(/["']/g, '').trim();
      } else if (n.task?.status) {
        statusBadge = n.task.status;
      }
    } else if (type === "ASSIGNMENT") {
      Icon = UserPlus;
      badgeBg = "bg-blue-600";
      actionVerb = "assigned you to";
    } else {
      const raw = n.title.replace(actorName, "").trim();
      if (raw) actionVerb = raw;
    }

    return { Icon, badgeBg, actionVerb, statusBadge, actorName };
  };

  const bellVariants = {
    ringing: {
      rotate: [0, -20, 20, -20, 20, -10, 10, 0],
      transition: {
        duration: 0.8,
        repeat: Infinity,
        repeatDelay: 3,
        ease: "easeInOut" as const
      }
    },
    still: {
      rotate: 0
    }
  };

  const handleToggleOpen = () => {
    const nextOpen = !isOpen;
    if (nextOpen) {
      const hadUnread = unreadCount > 0;
      if (hadUnread) {
        setUnreadCount(0);
        notificationsApi.markAllAsRead()
          .then(() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('notifications_all_read'));
            }
          })
          .catch((err) => console.error("Failed to mark notifications read", err));
      }
      loadNotifications(1, activeTab, hadUnread);
    }
    setIsOpen(nextOpen);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggleOpen}
        className="relative p-2 rounded-full hover:bg-zinc-800/60 transition-colors text-zinc-400 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
        title="Notifications"
      >
        <motion.div
          variants={bellVariants}
          animate={unreadCount > 0 ? "ringing" : "still"}
        >
          <Bell className="w-5 h-5" />
        </motion.div>

        {unreadCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 border-2 border-background flex items-center justify-center text-[9px] font-bold text-white shadow-sm"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.div>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 mt-2 w-88 sm:w-[420px] bg-card border border-zinc-800/80 rounded-xl shadow-2xl z-[200] overflow-hidden origin-top-right flex flex-col max-h-[85vh]"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-zinc-100">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-[10px] font-bold">
                    {unreadCount} new
                  </span>
                )}
              </div>
            </div>

            {/* Segmented Filter Tabs */}
            <div className="flex items-center px-4 border-b border-zinc-800/80 bg-zinc-900/30 gap-1">
              <button
                onClick={() => handleTabChange('all')}
                className={`relative py-2.5 px-3 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'all'
                    ? 'text-zinc-100 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All
                {activeTab === 'all' && (
                  <motion.div
                    layoutId="activeNotificationTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full"
                  />
                )}
              </button>

              <button
                onClick={() => handleTabChange('unread')}
                className={`relative py-2.5 px-3 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'unread'
                    ? 'text-zinc-100 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>Unread</span>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/15 text-indigo-400 text-[10px] font-bold">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
                {activeTab === 'unread' && (
                  <motion.div
                    layoutId="activeNotificationTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full"
                  />
                )}
              </button>

              <button
                onClick={() => handleTabChange('mentions')}
                className={`relative py-2.5 px-3 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                  activeTab === 'mentions'
                    ? 'text-zinc-100 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>Mentions</span>
                {activeTab === 'mentions' && (
                  <motion.div
                    layoutId="activeNotificationTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full"
                  />
                )}
              </button>
            </div>

            {/* List Body with Custom Slim Scrollbar */}
            <div
              onScroll={handleScroll}
              className="overflow-y-auto overflow-x-hidden flex-1 p-2 space-y-1.5 custom-scrollbar max-h-[460px] bg-card"
            >
              {isLoading && notifications.length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-xs flex flex-col items-center gap-2">
                  <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                  Loading notifications...
                </div>
              ) : displayList.length === 0 ? (
                <div className="p-8 text-center flex flex-col items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full bg-zinc-800/60 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-zinc-400" />
                  </div>
                  <p className="text-xs font-medium text-zinc-400">
                    {activeTab === 'unread'
                      ? "No unread notifications"
                      : activeTab === 'mentions'
                      ? "No mentions yet"
                      : "You're all caught up!"}
                  </p>
                </div>
              ) : (
                <>
                  {displayList.map((n) => {
                    const meta = getNotificationMeta(n);

                    return (
                      <div
                        key={n.id}
                        onClick={() => {
                          setIsOpen(false);
                          if (!n.isRead) {
                            handleMarkAsRead(n.id);
                          }
                          if (n.task?.id) {
                            router.push(`/tasks/${n.task.id}`);
                          } else {
                            router.push('/activity');
                          }
                        }}
                        className={`group/notif relative flex items-start gap-3 p-2.5 rounded-lg transition-all cursor-pointer ${
                          !n.isRead
                            ? 'bg-indigo-500/10 hover:bg-indigo-500/15'
                            : 'hover:bg-zinc-800/40'
                        }`}
                      >
                        {/* Avatar with Micro Icon Badge */}
                        <div className="shrink-0 relative mt-0.5">
                          {n.actor?.imageUrl || n.actor?.avatarUrl ? (
                            <img
                              src={n.actor.imageUrl || n.actor.avatarUrl || ''}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover ring-2 ring-card"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.nextElementSibling) {
                                  (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex';
                                }
                              }}
                            />
                          ) : null}
                          <div
                            className="w-8 h-8 rounded-full bg-indigo-500/15 text-indigo-400 flex items-center justify-center text-xs font-bold ring-2 ring-card"
                            style={{ display: (n.actor?.imageUrl || n.actor?.avatarUrl) ? 'none' : 'flex' }}
                          >
                            {meta.actorName.substring(0, 2).toUpperCase()}
                          </div>

                          <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${meta.badgeBg} text-white flex items-center justify-center ring-2 ring-card`}>
                            <meta.Icon className="w-2.5 h-2.5" />
                          </div>
                        </div>

                        {/* Content Column */}
                        <div className="flex-1 min-w-0 pr-1">
                          {/* Row 1: Actor + Action + Timestamp + Unread Dot */}
                          <div className="flex items-center justify-between gap-1.5 leading-snug">
                            <p className="text-xs text-zinc-200 truncate">
                              <span className="font-semibold text-zinc-100">{meta.actorName}</span>
                              <span className="text-zinc-400"> {meta.actionVerb}</span>
                            </p>

                            <div className="relative shrink-0 ml-1.5 flex items-center">
                              <div className={`flex items-center gap-1.5 transition-opacity ${!n.isRead ? 'group-hover:opacity-0' : ''}`}>
                                <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5 text-zinc-500" />
                                  {formatNotifTime(n.createdAt)}
                                </span>
                                {!n.isRead && (
                                  <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-sm" />
                                )}
                              </div>

                              {!n.isRead && (
                                <button
                                  onClick={(e) => handleMarkAsRead(n.id, e)}
                                  className="absolute right-0 opacity-0 group-hover/notif:opacity-100 transition-opacity p-1 rounded-md text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800 bg-secondary border border-zinc-800 shadow-sm cursor-pointer"
                                  title="Mark as read"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Row 2: Target Task + Status Pill */}
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {n.task?.title ? (
                              <span className="text-xs font-medium text-indigo-400 hover:underline truncate max-w-[240px]">
                                {n.task.title}
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-zinc-400">
                                Workspace
                              </span>
                            )}

                            {meta.statusBadge && (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white shadow-xs shrink-0 select-none leading-none"
                                style={{
                                  backgroundColor: getStatusHexColor(
                                    meta.statusBadge,
                                    n.task?.listId
                                      ? customStatusColors[`${n.task.listId}:${meta.statusBadge.toUpperCase()}`]
                                      : undefined
                                  )
                                }}
                              >
                                {meta.statusBadge}
                              </span>
                            )}
                          </div>

                          {/* Row 3: Comment or Mention Snippet Quote Box */}
                          {n.content && (
                            <div className="mt-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800/40 border border-zinc-800/70 text-xs text-zinc-300">
                              <CommentContent
                                content={n.content}
                                className="line-clamp-2 [&_p]:inline text-xs text-zinc-300"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Infinite Scroll Loading Spinner */}
                  {isLoadingMore && (
                    <div className="py-2.5 flex items-center justify-center gap-2 text-xs text-zinc-400">
                      <div className="w-3.5 h-3.5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                      <span>Loading more...</span>
                    </div>
                  )}

                  {/* Optional Load More button fallback */}
                  {!isLoadingMore && hasMore && notifications.length > 0 && (
                    <div className="py-1 text-center">
                      <button
                        onClick={loadMore}
                        className="text-[11px] font-medium text-zinc-400 hover:text-indigo-300 transition-colors py-1 px-3 rounded hover:bg-zinc-800/60 cursor-pointer"
                      >
                        Load more notifications
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-zinc-800/80 bg-zinc-900/50">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push('/activity');
                }}
                className="w-full py-2 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>View all activity</span>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
