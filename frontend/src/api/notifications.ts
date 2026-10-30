import { apiClient } from './client';

export interface TaskNotification {
  id: string;
  userId: string;
  actorId: string | null;
  taskId: string | null;
  type: string;
  title: string;
  content: string | null;
  isRead: boolean;
  isCleared: boolean;
  createdAt: string;
  actor?: {
    id: string;
    name: string;
    avatarUrl: string | null;
    imageUrl?: string | null;
  } | null;
  task?: {
    id: string;
    title: string;
    status: string;
    listId: string;
  } | null;
  commentId?: string | null;
  subtaskId?: string | null;
  details?: any;
}

export interface GetNotificationsParams {
  tab?: 'primary' | 'cleared';
  page?: number;
  limit?: number;
  filter?: 'all' | 'unread' | 'mentions';
}

export interface GetNotificationsResponse {
  notifications: TaskNotification[];
  total: number;
  unreadCount: number;
  hasMore: boolean;
  page?: number;
  limit?: number;
}

export const notificationsApi = {
  getNotifications: async (
    paramsOrTab: 'primary' | 'cleared' | GetNotificationsParams = 'primary'
  ): Promise<GetNotificationsResponse> => {
    let query = '';
    if (typeof paramsOrTab === 'string') {
      query = `tab=${paramsOrTab}`;
    } else {
      const q = new URLSearchParams();
      if (paramsOrTab.tab) q.append('tab', paramsOrTab.tab);
      if (paramsOrTab.page) q.append('page', paramsOrTab.page.toString());
      if (paramsOrTab.limit) q.append('limit', paramsOrTab.limit.toString());
      if (paramsOrTab.filter && paramsOrTab.filter !== 'all') q.append('filter', paramsOrTab.filter);
      query = q.toString();
    }
    return apiClient(`/api/notifications${query ? `?${query}` : ''}`);
  },
  markAsRead: async (id: string): Promise<{ notification: TaskNotification }> => {
    return apiClient(`/api/notifications/${id}/read`, { method: 'PATCH' });
  },
  clearNotification: async (id: string): Promise<{ notification: TaskNotification }> => {
    return apiClient(`/api/notifications/${id}/clear`, { method: 'PATCH' });
  },
  markAllAsRead: async (): Promise<{ success: boolean }> => {
    return apiClient(`/api/notifications/read-all`, { method: 'PATCH' });
  },
  clearAll: async (): Promise<{ success: boolean }> => {
    return apiClient(`/api/notifications/clear-all`, { method: 'PATCH' });
  },
  deleteCleared: async (): Promise<{ success: boolean }> => {
    return apiClient(`/api/notifications/cleared`, { method: 'DELETE' });
  },
};
