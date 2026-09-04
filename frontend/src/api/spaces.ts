import { apiClient } from './client';
import { Space, Folder, Doc, Page } from '@/lib/types';

export const spacesApi = {
  async getSpaces(): Promise<{ spaces: Space[] }> {
    return apiClient<{ spaces: Space[] }>('/api/spaces', {
      method: 'GET',
    });
  },

  async createSpace(data: { name: string; icon?: string; color?: string; ownerId: string }): Promise<{ space: Space }> {
    return apiClient<{ space: Space }>('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteSpace(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/spaces/${id}`, {
      method: 'DELETE',
    });
  },

  async createFolder(data: { name: string; spaceId?: string; parentFolderId?: string }): Promise<{ folder: Folder }> {
    return apiClient<{ folder: Folder }>('/api/spaces/folders', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteFolder(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/spaces/folders/${id}`, {
      method: 'DELETE',
    });
  },

  async createDoc(data: { title: string; spaceId?: string; folderId?: string }): Promise<{ doc: Doc }> {
    return apiClient<{ doc: Doc }>('/api/spaces/docs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateDoc(id: string, data: { title?: string; docDate?: string }): Promise<{ doc: Doc }> {
    return apiClient<{ doc: Doc }>(`/api/spaces/docs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteDoc(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/spaces/docs/${id}`, {
      method: 'DELETE',
    });
  },

  async createPage(data: { title?: string; content?: string; docId: string; parentPageId?: string }): Promise<{ page: Page }> {
    return apiClient<{ page: Page }>('/api/spaces/pages', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updatePage(id: string, data: { title?: string; content?: string }): Promise<{ page: Page }> {
    return apiClient<{ page: Page }>(`/api/spaces/pages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deletePage(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/spaces/pages/${id}`, {
      method: 'DELETE',
    });
  },

  async createList(data: { name: string; spaceId?: string; folderId?: string }): Promise<{ list: any }> {
    return apiClient<{ list: any }>('/api/lists', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
