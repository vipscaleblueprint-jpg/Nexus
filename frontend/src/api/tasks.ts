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

  async updateTask(id: string, data: Partial<Task>): Promise<{ task: Task }> {
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

  async moveTask(id: string, status: string, currentListId?: string): Promise<{ task: Task }> {
    return apiClient<{ task: Task }>(`/api/tasks/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ status, currentListId }),
    });
  },

  async addComment(id: string, content: string, userId: string, listId?: string): Promise<{ comment: any }> {
    return apiClient<{ comment: any }>(`/api/tasks/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, userId, listId }),
    });
  },
};
