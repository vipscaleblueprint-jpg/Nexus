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

  async getComments(id: string, subtaskId?: string): Promise<{ comments: any[] }> {
    const url = subtaskId ? `/api/tasks/${id}/comments?subtaskId=${subtaskId}` : `/api/tasks/${id}/comments`;
    return apiClient<{ comments: any[] }>(url, {
      method: 'GET',
    });
  },

  async addComment(taskId: string, content: string, userId: string, listId?: string, mentionedUserIds?: string[], parentCommentId?: string, subtaskId?: string): Promise<{ comment: any; activity?: any }> {
    return apiClient<{ comment: any; activity?: any }>(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, userId, listId, mentionedUserIds, parentCommentId, subtaskId }),
    });
  },

  async toggleCommentReaction(taskId: string, commentId: string, emoji: string, userId: string): Promise<{ reactions: any[]; toggled: string }> {
    return apiClient<{ reactions: any[]; toggled: string }>(`/api/tasks/${taskId}/comments/${commentId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji, userId }),
    });
  },

  async getActivities(id: string): Promise<{ activities: any[]; taskCreatedAt?: string; creator?: any }> {
    return apiClient<{ activities: any[]; taskCreatedAt?: string; creator?: any }>(`/api/tasks/${id}/activities`, {
      method: 'GET',
    });
  },

  async getLiveBlocksData(type: string, assigneeName?: string, reportDate?: string, listId?: string): Promise<{ blocks: Record<string, Task[]> }> {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (assigneeName) params.append('assigneeName', assigneeName);
    if (reportDate) params.append('reportDate', reportDate);
    if (listId) params.append('listId', listId);
    return apiClient<{ blocks: Record<string, Task[]> }>(`/api/tasks/live-blocks?${params.toString()}`, {
      method: 'GET',
    });
  },

  async createSubtask(taskId: string, data: Partial<any>): Promise<{ subtask: any }> {
    return apiClient<{ subtask: any }>(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateSubtask(taskId: string, subtaskId: string, data: Partial<any>): Promise<{ subtask: any }> {
    return apiClient<{ subtask: any }>(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteSubtask(taskId: string, subtaskId: string): Promise<{ success: boolean }> {
    return apiClient<{ success: boolean }>(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'DELETE',
    });
  },
};
