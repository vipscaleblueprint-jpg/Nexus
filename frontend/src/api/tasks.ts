import { apiClient } from './client';
import { Task } from '@/lib/types';

export const tasksApi = {
  async getTasks(): Promise<{ tasks: Task[] }> {
    return apiClient<{ tasks: Task[] }>('/api/tasks', {
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

  async moveTask(id: string, status: string): Promise<{ task: Task }> {
    return apiClient<{ task: Task }>(`/api/tasks/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};
