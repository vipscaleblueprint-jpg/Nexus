/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Clock,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { notificationsApi, TaskNotification } from "@/api/notifications";
import { useAppStore } from "@/lib/store";
import { fetchListStatuses } from "@/lib/listStatusCache";
import { ActivityCard } from "@/components/ui/ActivityCard";

type TabType = "all" | "mentions" | "unread";

export function NotificationBell() {
  const router = useRouter();
  const unreadCount = useAppStore((state) => state.unreadNotifications);
  const setUnreadCount = useAppStore((state) => state.setUnreadNotifications);

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
    const listIds = Array.from(
      new Set(notifications.map((n) => n.task?.listId).filter(Boolean))
    ) as string[];
    if (listIds.length === 0) return;

    listIds.forEach((listId) => {
      fetchListStatuses(listId)
        .then((statuses) => {
          if (Array.isArray(statuses) && statuses.length > 0) {
            setCustomStatusColors((prev) => {
              let changed = false;
              const next = { ...prev };
              statuses.forEach((s: any) => {
                const name = (s.name || s.title || s.status || "").toUpperCase();
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
        })
        .catch(() => {});
    });
  }, [notifications]);

  const loadNotifications = useCallback(
    async (pageNum = 1, tab = activeTab) => {
      if (pageNum === 1) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const res = await notificationsApi.getNotifications({
          tab: "primary",
          page: pageNum,
          limit: 15,
          filter: tab,
        });

        const freshItems = res.notifications || [];

        if (pageNum === 1) {
          setNotifications(freshItems);
        } else {
          setNotifications((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const fresh = freshItems.filter((n) => !existingIds.has(n.id));
            return [...prev, ...fresh];
          });
        }

        setHasMore(res.hasMore);
        setPage(pageNum);

        if (typeof res.unreadCount === "number") {
          setUnreadCount(res.unreadCount);
        }
      } catch (error) {
        console.error("Failed to load notifications", error);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [activeTab, setUnreadCount]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if ((event.target as Element)?.closest?.("[data-radix-popper-content-wrapper]")) return;
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
        notificationsApi.getNotifications({ tab: "primary", limit: 1 }).then((res) => {
          if (typeof res.unreadCount === "number") {
            setUnreadCount(res.unreadCount);
          }
        });
      }
    };

    const handleRead = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
        );
      }
    };

    const handleAllRead = () => {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    };

    const handleCleared = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
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

  // Maintaining the scroll down load of the cowbell
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

  const handleMarkAsRead = async (id: string, childIds?: string[], e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const idsToMark = childIds && childIds.length > 0 ? childIds : [id];
    try {
      for (const targetId of idsToMark) {
        await notificationsApi.markAsRead(targetId);
      }
      setNotifications((prev) =>
        prev.map((n) => (idsToMark.includes(n.id) ? { ...n, isRead: true } : n))
      );
      setUnreadCount(Math.max(0, unreadCount - idsToMark.length));
    } catch (error) {
      console.error("Failed to mark as read", error);
    }
  };

  // Cluster identical audit and checklist items like Image 4
  const displayList = useMemo(() => {
    const usedIds = new Set<string>();
    const merged: (TaskNotification & { childIds?: string[] })[] = [];

    for (let i = 0; i < notifications.length; i++) {
      const current = notifications[i];
      if (usedIds.has(current.id)) continue;
      const currentTime = new Date(current.createdAt).getTime();
      const currentType = (current.type || "").toUpperCase();

      // Cluster audit items on same task by same actor within 10 min
      if (currentType === "AUDIT_ITEM_CHECKED" && current.taskId) {
        const cluster = [current];
        for (let j = i + 1; j < notifications.length; j++) {
          const candidate = notifications[j];
          if (
            (candidate.type || "").toUpperCase() === "AUDIT_ITEM_CHECKED" &&
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
          const auditTypes = new Set<string>();
          cluster.forEach((c) => {
            const rawText = (c.title || "").toLowerCase();
            if (rawText.includes("funnel")) auditTypes.add("funnel");
            else if (rawText.includes("design")) auditTypes.add("design");
            else if (rawText.includes("ui") || rawText.includes("ux")) auditTypes.add("UI UX");
            else if (rawText.includes("instruction")) auditTypes.add("instructions");
            else auditTypes.add("auditing");
          });

          const typeArray = Array.from(auditTypes);
          let mergedTitle = "";
          if (typeArray.length >= 4) {
            mergedTitle = `${current.actor?.name || "Someone"} checked all auditing on ${current.task?.title || "task"}`;
          } else if (typeArray.length > 1) {
            const last = typeArray.pop();
            mergedTitle = `${current.actor?.name || "Someone"} checked ${typeArray.join(", ")} and ${last} auditing on ${current.task?.title || "task"}`;
          } else {
            mergedTitle = `${current.actor?.name || "Someone"} checked ${typeArray[0] || "auditing"} auditing on ${current.task?.title || "task"}`;
          }

          const hasUnread = cluster.some((c) => !c.isRead);
          merged.push({
            ...current,
            id: `merged_${cluster.map((c) => c.id).join("_")}`,
            childIds: cluster.map((c) => c.id),
            title: mergedTitle,
            isRead: !hasUnread,
          });
          continue;
        }
      }

      // Cluster checklist items on same task by same actor within 30 min
      if (currentType === "CHECKLIST_ITEM_CHECKED" && current.taskId) {
        const cluster = [current];
        for (let j = i + 1; j < notifications.length; j++) {
          const candidate = notifications[j];
          if (
            (candidate.type || "").toUpperCase() === "CHECKLIST_ITEM_CHECKED" &&
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
            id: `merged_${cluster.map((c) => c.id).join("_")}`,
            childIds: cluster.map((c) => c.id),
            title: `${current.actor?.name || "Someone"} completed ${count} checklist items in ${current.task?.title || "task"}`,
            isRead: !hasUnread,
          });
          continue;
        }
      }

      usedIds.add(current.id);
      merged.push(current);
    }

    return merged;
  }, [notifications]);

  const bellVariants = {
    ringing: {
      rotate: [0, -20, 20, -20, 20, -10, 10, 0],
      transition: {
        duration: 0.8,
        repeat: Infinity,
        repeatDelay: 3,
        ease: "easeInOut" as const,
      },
    },
    still: {
      rotate: 0,
    },
  };

  const handleToggleOpen = () => {
    const nextOpen = !isOpen;
    if (nextOpen) {
      loadNotifications(1, activeTab);
    }
    setIsOpen(nextOpen);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggleOpen}
        className="relative p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-800/80 [.theme-light_&]:hover:bg-zinc-200/70 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
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
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 border-2 border-background flex items-center justify-center text-[9px] font-semibold text-white shadow-sm"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
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
            className="absolute right-0 mt-2 w-88 sm:w-[420px] bg-card border border-border rounded-xl shadow-2xl z-[200] overflow-hidden origin-top-right flex flex-col max-h-[85vh]"
          >
            {/* Header: Notifications on left, All, @ Mentions & Unread on right */}
            <div className="px-4 py-3.5 border-b border-border flex items-center justify-between bg-card">
              <h3 className="font-semibold text-base text-foreground tracking-tight">Notifications</h3>

              <div className="flex items-center gap-4">
                <button
                  onClick={() => handleTabChange("all")}
                  className={`relative pb-1 text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === "all" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All
                  {activeTab === "all" && (
                    <motion.div
                      layoutId="activeBellTab"
                      className="absolute -bottom-1 left-0 right-0 h-[2px] bg-foreground rounded-full"
                    />
                  )}
                </button>

                <button
                  onClick={() => handleTabChange("mentions")}
                  className={`relative pb-1 text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === "mentions" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  @ Mentions
                  {activeTab === "mentions" && (
                    <motion.div
                      layoutId="activeBellTab"
                      className="absolute -bottom-1 left-0 right-0 h-[2px] bg-foreground rounded-full"
                    />
                  )}
                </button>

                <button
                  onClick={() => handleTabChange("unread")}
                  className={`relative pb-1 text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === "unread" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Unread
                  {activeTab === "unread" && (
                    <motion.div
                      layoutId="activeBellTab"
                      className="absolute -bottom-1 left-0 right-0 h-[2px] bg-foreground rounded-full"
                    />
                  )}
                </button>
              </div>
            </div>

            {/* List Body with Slim Scrollbar & Infinite Scroll */}
            <div
              onScroll={handleScroll}
              className="overflow-y-auto overflow-x-hidden flex-1 p-2.5 space-y-2.5 custom-scrollbar max-h-[500px] bg-[#101013] [.theme-light_&]:bg-[#f8f8fa]"
            >
              {isLoading && notifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-xs flex flex-col items-center gap-2">
                  <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
                  Loading notifications...
                </div>
              ) : displayList.length === 0 ? (
                <div className="p-8 text-center flex flex-col items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full bg-zinc-800/60 [.theme-light_&]:bg-zinc-200/60 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {activeTab === "unread"
                      ? "No unread notifications"
                      : activeTab === "mentions"
                      ? "No @mentions yet"
                      : "You're all caught up!"}
                  </p>
                </div>
              ) : (
                <>
                  {displayList.map((n) => {
                    const actorName = n.actor?.name || "Someone";
                    const isSubtask = n.title.toLowerCase().includes("subtask");

                    return (
                      <ActivityCard
                        key={n.id}
                        id={n.id}
                        type={n.type}
                        actorName={actorName}
                        actorAvatar={n.actor?.imageUrl || n.actor?.avatarUrl}
                        taskTitle={n.task?.title || "task"}
                        isSubtask={isSubtask}
                        title={n.title}
                        content={n.content}
                        isRead={n.isRead}
                        createdAt={n.createdAt}
                        compact={true}
                        customStatusColor={
                          n.task?.listId && n.task?.status
                            ? customStatusColors[`${n.task.listId}:${n.task.status.toUpperCase()}`]
                            : undefined
                        }
                        onClick={() => {
                          setIsOpen(false);
                          if (!n.isRead) {
                            handleMarkAsRead(n.id, n.childIds);
                          }
                          if (n.task?.id) {
                            router.push(`/activity?task=${n.task.id}`);
                          } else {
                            router.push("/activity");
                          }
                        }}
                      />
                    );
                  })}

                  {/* Infinite Scroll Spinner */}
                  {isLoadingMore && (
                    <div className="py-2.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <div className="w-3.5 h-3.5 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin" />
                      <span>Loading more...</span>
                    </div>
                  )}

                  {/* Manual fallback load more */}
                  {!isLoadingMore && hasMore && notifications.length > 0 && (
                    <div className="py-1 text-center">
                      <button
                        onClick={loadMore}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1 px-3 rounded hover:bg-zinc-800/60 [.theme-light_&]:hover:bg-zinc-200/60 cursor-pointer"
                      >
                        Load more notifications
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* View all activity footer link */}
            <div className="p-2 border-t border-border bg-card">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push("/activity");
                }}
                className="w-full py-1.5 px-3 rounded-lg bg-secondary hover:bg-zinc-800/80 [.theme-light_&]:hover:bg-zinc-200/70 border border-border text-xs font-medium text-secondary-foreground hover:text-foreground transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>View all activity</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
