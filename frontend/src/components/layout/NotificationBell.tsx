"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Clock, Globe, MessageSquare, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { notificationsApi, TaskNotification } from "@/api/notifications";
import { useAppStore } from "@/lib/store";

export function NotificationBell() {
  const router = useRouter();
  const unreadCount = useAppStore(state => state.unreadNotifications);
  const setUnreadCount = useAppStore(state => state.setUnreadNotifications);
  
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen]);

  // Optionally listen for real-time events to reload
  useEffect(() => {
    const handleActivity = () => {
      if (isOpen) loadNotifications();
    };
    window.addEventListener("notification_received", handleActivity);
    return () => window.removeEventListener("notification_received", handleActivity);
  }, [isOpen]);

  const loadNotifications = async () => {
    setIsLoading(true);
    try {
      const res = await notificationsApi.getNotifications('primary');
      setNotifications(res.notifications);
    } catch (error) {
      console.error("Failed to load notifications", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await notificationsApi.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (error) {
      console.error("Failed to mark as read", error);
    }
  };

  const handleMarkAllAsRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await notificationsApi.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all as read", error);
    }
  };

  const unreadNotificationsList = notifications.filter(n => !n.isRead);
  const readNotificationsList = notifications.filter(n => n.isRead);
  
  // Show all unread, if none, show some read ones up to limit
  let displayList: TaskNotification[] = [];
  const LIMIT = 5;
  
  if (unreadNotificationsList.length > 0) {
    if (unreadNotificationsList.length > LIMIT) {
      displayList = unreadNotificationsList.slice(0, LIMIT);
    } else {
      displayList = [
        ...unreadNotificationsList,
        ...readNotificationsList.slice(0, LIMIT - unreadNotificationsList.length)
      ];
    }
  } else {
    displayList = readNotificationsList.slice(0, LIMIT);
  }

  const hasMore = unreadNotificationsList.length > LIMIT || notifications.length > LIMIT;

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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-600 dark:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
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
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 border-2 border-white dark:border-zinc-950 flex items-center justify-center text-[9px] font-bold text-white shadow-sm"
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
            className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-xl shadow-2xl z-[200] overflow-hidden origin-top-right flex flex-col max-h-[85vh]"
          >
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-medium">
                    {unreadCount} new
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs font-medium text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="overflow-y-auto overflow-x-hidden flex-1 p-2 space-y-1 bg-white dark:bg-zinc-900">
              {isLoading && notifications.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 dark:text-zinc-400 text-sm flex flex-col items-center gap-2">
                  <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                  Loading...
                </div>
              ) : displayList.length === 0 ? (
                <div className="p-8 text-center flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-zinc-400" />
                  </div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">You're all caught up!</p>
                </div>
              ) : (
                displayList.map((n) => {
                  const type = n.type?.toUpperCase();
                  const isAssignment = type === 'ASSIGNMENT';
                  const isStatus = type === 'STATUS_CHANGE';
                  const isComment = type === 'COMMENT' || type === 'MENTION';
                  const IconToUse = isAssignment ? Users : isStatus ? Clock : isComment ? MessageSquare : Globe;
                  
                  // Color distinctions for both light and dark mode
                  const iconColor = isAssignment 
                    ? 'text-blue-600 dark:text-blue-400' 
                    : isStatus ? 'text-emerald-600 dark:text-emerald-400' 
                    : isComment ? 'text-amber-600 dark:text-amber-400' 
                    : 'text-zinc-600 dark:text-zinc-400';
                  
                  const iconBg = isAssignment 
                    ? 'bg-blue-100 dark:bg-blue-500/10' 
                    : isStatus ? 'bg-emerald-100 dark:bg-emerald-500/10' 
                    : isComment ? 'bg-amber-100 dark:bg-amber-500/10' 
                    : 'bg-zinc-100 dark:bg-zinc-500/10';

                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        setIsOpen(false);
                        if (n.task?.id) {
                          router.push(`/tasks/${n.task.id}`);
                        } else {
                          router.push('/activity');
                        }
                      }}
                      className={`group relative flex items-start gap-3 p-3 rounded-lg transition-all cursor-pointer ${
                        !n.isRead 
                          ? 'bg-indigo-50/50 dark:bg-indigo-500/5 hover:bg-indigo-50 dark:hover:bg-indigo-500/10' 
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      {!n.isRead && (
                        <div className="absolute top-1/2 -translate-y-1/2 left-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      )}
                      
                      <div className={`shrink-0 relative ${!n.isRead ? 'ml-2' : 'ml-0'}`}>
                        {n.actor?.imageUrl || n.actor?.avatarUrl ? (
                          <img 
                            src={n.actor.imageUrl || n.actor.avatarUrl || ''} 
                            alt="" 
                            className="w-9 h-9 rounded-full object-cover ring-2 ring-white dark:ring-zinc-900" 
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              if (e.currentTarget.nextElementSibling) {
                                (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex';
                              }
                            }}
                          />
                        ) : null}
                        <div 
                          className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold ring-2 ring-white dark:ring-zinc-900"
                          style={{ display: (n.actor?.imageUrl || n.actor?.avatarUrl) ? 'none' : 'flex' }}
                        >
                          {n.actor?.name?.substring(0, 2).toUpperCase() || '?'}
                        </div>
                        
                        <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${iconBg} ${iconColor} flex items-center justify-center ring-2 ring-white dark:ring-zinc-900`}>
                          <IconToUse className="w-2.5 h-2.5" />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <p className="text-sm text-zinc-900 dark:text-zinc-100 leading-tight">
                            <span className="font-semibold">{n.actor?.name || 'Someone'}</span>
                            <span className="text-zinc-500 dark:text-zinc-400"> {n.title.replace(n.actor?.name || 'Someone', '').trim()}</span>
                          </p>
                        </div>
                        
                        {n.content && (
                          <div
                            className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 line-clamp-2"
                            dangerouslySetInnerHTML={{ __html: n.content }}
                          />
                        )}
                        
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] text-zinc-400 font-medium flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(n.createdAt), 'MMM d, h:mm a')}
                          </span>
                          {n.task && (
                            <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 truncate max-w-[120px]">
                              • {n.task.title}
                            </span>
                          )}
                        </div>
                      </div>

                      {!n.isRead && (
                        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center self-center h-full ml-2">
                          <button
                            onClick={(e) => handleMarkAsRead(n.id, e)}
                            className="p-1.5 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 bg-white dark:bg-zinc-800 shadow-sm border border-zinc-200 dark:border-zinc-700 transition-colors"
                            title="Mark as read"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              
              {hasMore && (
                <div className="py-2 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                  <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                  <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                </div>
              )}
            </div>

            <div className="p-2 border-t border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/50">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push('/activity');
                }}
                className="w-full py-2 px-4 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors shadow-sm"
              >
                View All Activity
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
