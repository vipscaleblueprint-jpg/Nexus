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
  } | null;
  task?: {
    id: string;
    title: string;
    status: string;
    listId: string;
  } | null;
}

export const notificationsApi = {
  getNotifications: async (tab: 'primary' | 'cleared' = 'primary'): Promise<{ notifications: TaskNotification[] }> => {
    return apiClient(`/api/notifications?tab=${tab}`);
  },
  markAsRead: async (id: string): Promise<{ notification: TaskNotification }> => {
    return apiClient(`/api/notifications/${id}/read`, { method: 'PATCH' });
  },
  clearNotification: async (id: string): Promise<{ notification: TaskNotification }> => {
    return apiClient(`/api/notifications/${id}/clear`, { method: 'PATCH' });
  },
  deleteCleared: async (): Promise<{ success: boolean }> => {
    return apiClient(`/api/notifications/cleared`, { method: 'DELETE' });
  },
};
