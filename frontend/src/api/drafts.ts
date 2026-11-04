import { apiClient } from './client';

export interface TaskDraft {
  id: string; // `task:${taskId}` or `task:${taskId}:sub:${subtaskId}`
  taskId: string;
  taskTitle: string;
  subtaskId?: string | null;
  subtaskTitle?: string | null;
  comment?: string;
  description?: string;
  type: 'comment' | 'task';
  updatedAt: string;
  userId?: string;
}

export const draftsApi = {
  getDrafts: async (): Promise<{ drafts: TaskDraft[] }> => {
    return apiClient<{ drafts: TaskDraft[] }>('/api/drafts');
  },

  saveDraft: async (draft: Partial<TaskDraft> & { taskId: string }): Promise<{ success: boolean; draft: TaskDraft }> => {
    return apiClient<{ success: boolean; draft: TaskDraft }>('/api/drafts', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
  },

  deleteDraft: async (draftId: string): Promise<{ success: boolean; id: string }> => {
    return apiClient<{ success: boolean; id: string }>(`/api/drafts/${encodeURIComponent(draftId)}`, {
      method: 'DELETE',
    });
  },

  deleteDraftByTask: async (taskId: string, subtaskId?: string | null): Promise<{ success: boolean; count: number }> => {
    const query = subtaskId ? `?subtaskId=${encodeURIComponent(subtaskId)}` : '';
    return apiClient<{ success: boolean; count: number }>(`/api/drafts/task/${encodeURIComponent(taskId)}${query}`, {
      method: 'DELETE',
    });
  },
};

