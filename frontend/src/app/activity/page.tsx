'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { notificationsApi, TaskNotification } from '@/api/notifications';
import { Check, MailOpen, Clock, ChevronDown, Users, MessageSquare, Activity, Globe } from 'lucide-react';
import { format, isToday, isYesterday, differenceInDays } from 'date-fns';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { tasksApi } from '@/api/tasks';

type ViewMode = 'for_me' | 'comments' | 'status' | 'assigned' | 'show_all';

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: any; description: string }[] = [
  { value: 'for_me',   label: 'For Me',         icon: Activity,      description: 'All your notifications' },
  { value: 'comments', label: 'Comments',        icon: MessageSquare, description: 'Comment & mention notifications' },
  { value: 'status',   label: 'Status Updates',  icon: Clock,         description: 'Task status changes' },
  { value: 'assigned', label: 'Assigned to Me',  icon: Users,         description: 'Assignment notifications' },
  { value: 'show_all', label: 'Show All',        icon: Globe,         description: 'All workspace activity' },
];

const formatActivityMessage = (log: any) => {
  const { action, entity, entityTitle, details } = log;
  const isSubtask = details?.subtaskTitle || entity?.toLowerCase() === 'subtask';
  const targetTitle = details?.subtaskTitle || entityTitle;
  const targetName = isSubtask ? `subtask "${targetTitle}"` : `task "${targetTitle}"`;
  let message = '';
  switch (action) {
    case 'STATUS_CHANGE':
      message = `changed status ${details?.oldStatus ? `from ${details.oldStatus} ` : ''}to ${details?.newStatus}`;
      break;
    case 'PRIORITY_CHANGE':
      message = `changed priority ${details?.oldPriority ? `from ${details.oldPriority} ` : ''}to ${details?.newPriority}`;
      break;
    case 'ASSIGNMENT':
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
    default:
      message = action ? `performed ${action.replace(/_/g, ' ').toLowerCase()}` : 'performed an action';
  }
  return `${message} on ${targetName}`;
};

export default function ActivityPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('for_me');
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'last7' | 'last30'>('all');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { decrementUnreadNotifications, workspaceRoles } = useAppStore();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [notifRes, auditRes] = await Promise.all([
        notificationsApi.getNotifications('primary'),
        import('@/api/activity').then(m => m.activityApi.getAuditLogs())
      ]);
      setNotifications(notifRes.notifications);
      setAuditLogs(auditRes.logs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTask = async (n: TaskNotification | string) => {
    const taskId = typeof n === 'string' ? n : n.task?.id;
    if (typeof n !== 'string' && !n.isRead) handleMarkAsRead(n.id);
    if (!taskId) return;
    try {
      const res = await tasksApi.getTask(taskId);
      setSelectedTask(res.task);
      const url = new URL(window.location.href);
      url.searchParams.set('task', taskId);
      window.history.pushState({}, '', url.toString());
    } catch (err) {
      console.error('Failed to fetch task:', err);
      if (typeof n !== 'string' && n.task) setSelectedTask(n.task);
    }
  };

  useEffect(() => {
    fetchData();
    const url = new URL(window.location.href);
    const taskId = url.searchParams.get('task');
    if (taskId) handleOpenTask(taskId);
    const onNew = () => fetchData();
    const onClear = () => {
      setSelectedTask(null);
      const u = new URL(window.location.href);
      u.searchParams.delete('task');
      window.history.pushState({}, '', u.toString());
    };
    window.addEventListener('notification_received', onNew);
    window.addEventListener('clear_activity_task', onClear);
    return () => {
      window.removeEventListener('notification_received', onNew);
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
      setNotifications(prev => prev.filter(n => n.id !== id));
      decrementUnreadNotifications();
    } catch (err) { console.error(err); }
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      decrementUnreadNotifications();
    } catch (err) { console.error(err); }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      useAppStore.getState().setUnreadNotifications(0);
    } catch (err) { console.error(err); }
  };

  const handleClearAll = async () => {
    try {
      await notificationsApi.clearAll();
      setNotifications([]);
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

  const isGlobalLogView = viewMode === 'show_all' || viewMode === 'status';

  const filteredNotifications = notifications.filter(n => {
    if (viewMode === 'for_me') return true;
    if (viewMode === 'comments') return n.type === 'MENTION' || n.type === 'COMMENT';
    if (viewMode === 'assigned') return n.type === 'ASSIGNMENT';
    return false;
  });

  const activeItems = isGlobalLogView 
    ? (viewMode === 'status' ? auditLogs.filter(l => l.action === 'STATUS_CHANGE') : auditLogs) 
    : filteredNotifications;

  let filteredByTime = activeItems;
  if (isGlobalLogView) {
    if (timeFilter === 'today') {
      filteredByTime = activeItems.filter(item => isToday(new Date(item.createdAt)));
    } else if (timeFilter === 'last7') {
      filteredByTime = activeItems.filter(item => differenceInDays(new Date(), new Date(item.createdAt)) <= 7);
    } else if (timeFilter === 'last30') {
      filteredByTime = activeItems.filter(item => differenceInDays(new Date(), new Date(item.createdAt)) <= 30);
    }
  }

  const grouped = groupByDate(filteredByTime);
  const currentView = VIEW_OPTIONS.find(v => v.value === viewMode)!;
  const CurrentIcon = currentView.icon;

  return (
    <div className="flex flex-col h-full bg-background text-foreground p-8 relative">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Activity</h1>

        <div className="flex items-center gap-3">
          {isGlobalLogView && (
            <div className="flex items-center gap-1 bg-zinc-800/50 p-1 rounded-md border border-zinc-800 mr-2 hidden sm:flex">
              <button 
                onClick={() => setTimeFilter('all')} 
                className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'all' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                All time
              </button>
              <button 
                onClick={() => setTimeFilter('today')} 
                className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'today' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Today
              </button>
              <button 
                onClick={() => setTimeFilter('last7')} 
                className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'last7' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Last 7 days
              </button>
              <button 
                onClick={() => setTimeFilter('last30')} 
                className={`px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors ${timeFilter === 'last30' ? 'bg-[#5f5ce6] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Last 30 days
              </button>
            </div>
          )}

          {!isGlobalLogView && (
            <>
              <button
                onClick={handleMarkAllAsRead}
                className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md shadow-sm transition-colors flex items-center gap-1.5"
              >
                <MailOpen className="size-3.5" />
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
              <CurrentIcon className="size-3.5" />
              {currentView.label}
              <ChevronDown className={`size-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-56 bg-secondary border border-zinc-700/60 rounded-lg shadow-xl z-50 overflow-hidden">
                {VIEW_OPTIONS.map(option => {
                  const Icon = option.icon;
                  const isActive = viewMode === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => { setViewMode(option.value); setDropdownOpen(false); }}
                      className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800 ${isActive ? 'bg-indigo-500/10' : ''}`}
                    >
                      <Icon className={`size-4 mt-0.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-zinc-400'}`} />
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

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-[#5f5ce6] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : activeItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
            <MailOpen className="size-10 mb-3 opacity-20" />
            <p>{isGlobalLogView ? 'No activity logs found' : "You are all caught up!"}</p>
          </div>
        ) : isGlobalLogView ? (
          <div className="space-y-8 pb-10">
            {Object.entries(grouped).map(([groupName, items]) => (
              <div key={groupName} className="relative">
                <div className="sticky top-0 z-30 bg-background/95 backdrop-blur py-2 mb-4">
                  <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">{groupName}</h3>
                </div>
                <div className="space-y-4">
                  {items.map((log: any, i: number) => {
                    const isAssignment = log.action === 'ASSIGNMENT';
                    const isStatus = log.action === 'STATUS_CHANGE';
                    const isComment = log.action === 'COMMENT_ADDED';
                    const IconToUse = isAssignment ? Users : isStatus ? Clock : isComment ? MessageSquare : Globe;
                    const iconColor = isAssignment ? 'text-blue-400' : isStatus ? 'text-emerald-400' : isComment ? 'text-amber-400' : 'text-zinc-400';
                    const iconBg = isAssignment ? 'bg-blue-500/10' : isStatus ? 'bg-emerald-500/10' : isComment ? 'bg-amber-500/10' : 'bg-zinc-500/10';

                    return (
                      <div
                        key={log.id}
                        onClick={() => {
                          if (log.entity?.toLowerCase() === 'task' || log.entity?.toLowerCase() === 'subtask') {
                            handleOpenTask(log.entityId);
                          }
                        }}
                        className="group flex gap-4 cursor-pointer relative"
                      >
                        {/* Timeline line */}
                        {i !== items.length - 1 && (
                          <div className="absolute left-5 top-12 bottom-[-16px] w-[2px] bg-zinc-800/50" />
                        )}

                        <div className="shrink-0 relative">
                          <div className="relative z-10">
                            {log.user?.avatarUrl ? (
                              <img 
                                src={log.user.avatarUrl} 
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
                              className="size-10 rounded-full bg-[#5f5ce6]/10 text-[#5f5ce6] flex items-center justify-center text-sm font-bold shrink-0 ring-4 ring-background shadow-sm"
                              style={{ display: log.user?.avatarUrl ? 'none' : 'flex' }}
                            >
                              {log.user?.name?.substring(0, 2).toUpperCase() || '?'}
                            </div>
                            
                            <div className={`absolute -bottom-1 -right-1 size-4 rounded-full ${iconBg} ${iconColor} flex items-center justify-center ring-2 ring-background`}>
                              <IconToUse className="size-2.5" />
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 min-w-0 bg-white/[0.02] border border-white/5 rounded-xl p-4 transition-all group-hover:bg-white/[0.04] group-hover:border-white/10 group-hover:-translate-y-0.5 group-hover:shadow-lg">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-semibold text-sm text-zinc-100">{log.user?.name || 'Someone'}</span>
                            <span className="text-sm text-zinc-400">{formatActivityMessage(log)}</span>
                          </div>
                          
                          <div className="flex items-center gap-3 mt-3">
                            <span className="text-[11px] text-zinc-500 font-medium flex items-center gap-1.5">
                              <Clock className="size-3.5" />
                              {format(new Date(log.createdAt), 'h:mm a')}
                            </span>
                            {(log.entity?.toLowerCase() === 'task' || log.entity?.toLowerCase() === 'subtask') && (
                              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-medium text-zinc-300">
                                {log.entity}
                              </span>
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
        ) : (
          <div className="space-y-8 pb-10">
            {Object.entries(grouped).map(([groupName, items]) => (
              <div key={groupName} className="relative">
                <div className="sticky top-0 z-30 bg-background/95 backdrop-blur py-2 mb-4">
                  <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">{groupName}</h3>
                </div>
                <div className="space-y-4">
                  {(items as TaskNotification[]).map((n, i) => {
                    const isAssignment = n.type === 'ASSIGNMENT';
                    const isStatus = n.type === 'STATUS_CHANGE';
                    const isComment = n.type === 'COMMENT' || n.type === 'MENTION';
                    const IconToUse = isAssignment ? Users : isStatus ? Clock : isComment ? MessageSquare : Globe;
                    const iconColor = isAssignment ? 'text-blue-400' : isStatus ? 'text-emerald-400' : isComment ? 'text-amber-400' : 'text-zinc-400';
                    const iconBg = isAssignment ? 'bg-blue-500/10' : isStatus ? 'bg-emerald-500/10' : isComment ? 'bg-amber-500/10' : 'bg-zinc-500/10';

                    return (
                      <div
                        key={n.id}
                        onClick={() => handleOpenTask(n)}
                        className={`group flex gap-4 cursor-pointer relative ${!n.isRead ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}
                      >
                        {/* Timeline line */}
                        {i !== items.length - 1 && (
                          <div className="absolute left-5 top-12 bottom-[-16px] w-[2px] bg-zinc-800/50" />
                        )}

                        <div className="shrink-0 relative">
                          <div className="relative z-10">
                            {n.actor?.imageUrl || n.actor?.avatarUrl ? (
                              <img 
                                src={n.actor.imageUrl || n.actor.avatarUrl || ''} 
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
                              className="size-10 rounded-full bg-[#5f5ce6]/10 text-[#5f5ce6] flex items-center justify-center text-sm font-bold shrink-0 ring-4 ring-background shadow-sm"
                              style={{ display: (n.actor?.imageUrl || n.actor?.avatarUrl) ? 'none' : 'flex' }}
                            >
                              {n.actor?.name?.substring(0, 2).toUpperCase() || '?'}
                            </div>
                            
                            <div className={`absolute -bottom-1 -right-1 size-4 rounded-full ${iconBg} ${iconColor} flex items-center justify-center ring-2 ring-background`}>
                              <IconToUse className="size-2.5" />
                            </div>

                            {/* Unread indicator */}
                            {!n.isRead && (
                              <div className="absolute -top-1 -left-1 size-3 rounded-full bg-[#5f5ce6] ring-2 ring-background" />
                            )}
                          </div>
                        </div>

                        <div className={`flex-1 min-w-0 bg-white/[0.02] border border-white/5 rounded-xl p-4 transition-all group-hover:bg-white/[0.04] group-hover:border-white/10 group-hover:-translate-y-0.5 group-hover:shadow-lg ${!n.isRead ? 'bg-[#5f5ce6]/[0.04] border-[#5f5ce6]/30' : ''}`}>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-semibold text-sm text-zinc-100">{n.actor?.name || 'Someone'}</span>
                            <span className="text-sm text-zinc-400">{n.title.replace(n.actor?.name || 'Someone', '').trim()}</span>
                          </div>
                          
                          {n.content && (
                            <div
                              className="mt-2 text-sm text-zinc-300 bg-black/20 p-3 rounded-md border border-white/5 prose prose-sm prose-invert max-w-full prose-p:my-0 prose-a:text-indigo-400"
                              dangerouslySetInnerHTML={{ __html: n.content }}
                            />
                          )}

                          <div className="flex items-center justify-between gap-4 mt-3">
                            <div className="flex items-center gap-3">
                              <span className="text-[11px] text-zinc-500 font-medium flex items-center gap-1.5">
                                <Clock className="size-3.5" />
                                {format(new Date(n.createdAt), 'h:mm a')}
                              </span>
                              {n.task && (
                                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-medium text-zinc-300">
                                  {n.task.title}
                                </span>
                              )}
                            </div>

                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleClear(n.id); }}
                              className="opacity-0 group-hover:opacity-100 px-3 py-1.5 text-[10px] font-medium text-white bg-[#5f5ce6] hover:bg-[#4b48d6] rounded-md shadow-sm flex items-center gap-1.5 transition-all"
                            >
                              <Check className="size-3" />
                              Clear
                            </button>
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


      <TaskDetailModal
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        task={selectedTask}
        mode="full"
        workspaceRoles={workspaceRoles}
        onUpdateTask={(updatedTask) => setSelectedTask(updatedTask)}
      />
    </div>
  );
}