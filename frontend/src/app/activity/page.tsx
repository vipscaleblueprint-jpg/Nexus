'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { notificationsApi, TaskNotification } from '@/api/notifications';
import { Check, MailOpen, Trash2, Clock, Inbox, Mail } from 'lucide-react';
import { format, isToday, isYesterday, differenceInDays } from 'date-fns';
import Link from 'next/link';

export default function ActivityPage() {
  const [tab, setTab] = useState<'primary' | 'cleared'>('primary');
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const { decrementUnreadNotifications } = useAppStore();

  const fetchNotifications = async (currentTab: 'primary' | 'cleared') => {
    setLoading(true);
    try {
      const res = await notificationsApi.getNotifications(currentTab);
      setNotifications(res.notifications);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications(tab);

    const handleNewNotification = () => {
      fetchNotifications(tab);
    };

    window.addEventListener('notification_received', handleNewNotification);
    return () => window.removeEventListener('notification_received', handleNewNotification);
  }, [tab]);

  const handleClear = async (id: string) => {
    try {
      await notificationsApi.clearNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      decrementUnreadNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      decrementUnreadNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearAll = async () => {
    try {
      await notificationsApi.deleteCleared();
      if (tab === 'cleared') {
        setNotifications([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const groupNotificationsByDate = (notifs: TaskNotification[]) => {
    const groups: { [key: string]: TaskNotification[] } = {};
    
    notifs.forEach(n => {
      const d = new Date(n.createdAt);
      let groupName = '';
      if (isToday(d)) groupName = 'Today';
      else if (isYesterday(d)) groupName = 'Yesterday';
      else if (differenceInDays(new Date(), d) <= 7) groupName = 'Last 7 days';
      else groupName = format(d, 'MMMM'); // e.g., "August"

      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(n);
    });

    return groups;
  };

  const grouped = groupNotificationsByDate(notifications);

  return (
    <div className="flex flex-col h-full bg-[#131316] text-[#e4e4e7] p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <div className="flex items-center gap-2">
          {tab === 'cleared' && (
            <button 
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-md transition-colors"
            >
              <Trash2 className="size-3.5" />
              Empty Cleared
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-white/5 mb-6">
        <button
          onClick={() => setTab('primary')}
          className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'primary' ? 'border-[#5f5ce6] text-[#5f5ce6]' : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Inbox className="size-4" />
          Primary
        </button>
        <button
          onClick={() => setTab('cleared')}
          className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'cleared' ? 'border-[#5f5ce6] text-[#5f5ce6]' : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Check className="size-4" />
          Cleared
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-[#5f5ce6] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
            <MailOpen className="size-10 mb-3 opacity-20" />
            <p>You're all caught up!</p>
          </div>
        ) : (
          Object.entries(grouped).map(([groupName, items]) => (
            <div key={groupName}>
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">{groupName}</h3>
              <div className="bg-[#1c1c1f] rounded-lg border border-white/5 overflow-hidden">
                {items.map((n, i) => (
                  <div 
                    key={n.id} 
                    className={`group flex items-start gap-4 p-4 transition-colors hover:bg-white/[0.02] ${
                      i !== items.length - 1 ? 'border-b border-white/5' : ''
                    } ${!n.isRead ? 'bg-[#5f5ce6]/5' : ''}`}
                    onClick={() => { if (!n.isRead) handleMarkAsRead(n.id); }}
                  >
                    <div className="shrink-0 pt-0.5">
                      <div className="size-2 rounded-full mt-1.5" style={{ backgroundColor: !n.isRead ? '#5f5ce6' : 'transparent' }} />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <div className="flex items-center gap-2 overflow-hidden">
                          {n.actor?.avatarUrl ? (
                            <img src={n.actor.avatarUrl} alt="" className="size-5 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="size-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[9px] font-bold shrink-0">
                              {n.actor?.name?.substring(0, 2).toUpperCase() || '?'}
                            </div>
                          )}
                          <span className="font-medium text-sm text-zinc-200 shrink-0">{n.actor?.name || 'Someone'}</span>
                          <span className="text-sm text-zinc-400 truncate">{n.title.replace(n.actor?.name || 'Someone', '')}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-zinc-500 flex items-center gap-1">
                            <Clock className="size-3" />
                            {format(new Date(n.createdAt), 'MMM d, h:mm a')}
                          </span>
                        </div>
                      </div>

                      {n.content && (
                        <div className="mt-2 text-sm text-zinc-300 bg-white/5 p-3 rounded-md border border-white/5">
                          {n.content}
                        </div>
                      )}

                      {n.task && (
                        <div className="mt-3 flex items-center gap-2">
                          <Link href={`/lists/${n.task.listId}?task=${n.task.id}`} className="text-xs font-medium text-[#5f5ce6] hover:underline flex items-center gap-1">
                            {n.task.title}
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {tab === 'primary' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleClear(n.id); }}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-[#5f5ce6] hover:bg-[#4b48d6] rounded-md shadow-sm flex items-center gap-1.5"
                        >
                          <Check className="size-3.5" />
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
