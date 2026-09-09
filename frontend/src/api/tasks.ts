import { apiClient } from './client';
import { Task } from '@/lib/types';

export const tasksApi = {
  async getTasks(): Promise<{ tasks: Task[] }> {
    return apiClient<{ tasks: Task[] }>('/api/tasks', {
      method: 'GET',
    });
  },

  async getTask(id: string): Promise<{ task: Task }> {
    return apiClient<{ task: Task }>(`/api/tasks/${id}`, {
      method: 'GET',
    });
  },

  async createTask(data: Partial<Task>): Promise<{ task: Task }> {
    return apiClient<{ task: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateTask(id: string, data: Partial<Task> & { assigneeId?: string | null; assigneeIds?: string[]; currentListId?: string; userId?: string }): Promise<{ task: Task }> {
    return apiClient<{ task: Task }>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteTask(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/tasks/${id}`, {
      method: 'DELETE',
    });
  },

  async moveTask(id: string, status: string, currentListId?: string, userId?: string): Promise<{ task: Task; activity?: any }> {
    return apiClient<{ task: Task; activity?: any }>(`/api/tasks/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ status, currentListId, userId }),
    });
  },

  async addComment(taskId: string, content: string, userId: string, listId?: string, mentionedUserIds?: string[]): Promise<{ comment: any; activity?: any }> {
    return apiClient<{ comment: any; activity?: any }>(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, userId, listId, mentionedUserIds }),
    });
  },

  async getActivities(id: string): Promise<{ activities: any[]; taskCreatedAt?: string; creator?: any }> {
    return apiClient<{ activities: any[]; taskCreatedAt?: string; creator?: any }>(`/api/tasks/${id}/activities`, {
      method: 'GET',
    });
  },
};
