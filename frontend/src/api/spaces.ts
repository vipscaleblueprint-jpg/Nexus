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

  async updateSpace(id: string, data: { name?: string }): Promise<{ space: Space }> {
    return apiClient<{ space: Space }>(`/api/spaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async duplicateSpace(id: string): Promise<{ space: Space }> {
    return apiClient<{ space: Space }>(`/api/spaces/${id}/duplicate`, {
      method: 'POST',
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

  async updateFolder(id: string, data: { name?: string }): Promise<{ folder: Folder }> {
    return apiClient<{ folder: Folder }>(`/api/spaces/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async duplicateFolder(id: string): Promise<{ folder: Folder }> {
    return apiClient<{ folder: Folder }>(`/api/spaces/folders/${id}/duplicate`, {
      method: 'POST',
    });
  },

  async createDoc(data: { title: string; spaceId?: string; folderId?: string }): Promise<{ doc: Doc }> {
    return apiClient<{ doc: Doc }>('/api/spaces/docs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getDoc(id: string): Promise<{ doc: any }> {
    return apiClient<{ doc: any }>(`/api/spaces/docs/${id}`, {
      method: 'GET',
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

  async duplicateDoc(id: string): Promise<{ doc: Doc }> {
    return apiClient<{ doc: Doc }>(`/api/spaces/docs/${id}/duplicate`, {
      method: 'POST',
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

  async duplicatePage(id: string): Promise<{ page: Page }> {
    return apiClient<{ page: Page }>(`/api/spaces/pages/${id}/duplicate`, {
      method: 'POST',
    });
  },

  async createList(data: { name: string; spaceId?: string; folderId?: string }): Promise<{ list: any }> {
    return apiClient<{ list: any }>('/api/lists', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getList(id: string): Promise<{ list: any }> {
    return apiClient<{ list: any }>(`/api/lists/${id}`, {
      method: 'GET',
    });
  },

  async updateList(id: string, data: { name?: string }): Promise<{ list: any }> {
    return apiClient<{ list: any }>(`/api/lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async duplicateList(id: string): Promise<{ list: any }> {
    return apiClient<{ list: any }>(`/api/lists/${id}/duplicate`, {
      method: 'POST',
    });
  },

  async deleteList(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/lists/${id}`, {
      method: 'DELETE',
    });
  },
};
