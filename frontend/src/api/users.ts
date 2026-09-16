import { apiClient } from './client';
import { User } from '@/lib/types';

export const usersApi = {
  async getUsers(): Promise<{ users: User[] }> {
    return apiClient<{ users: User[] }>('/api/users', {
      method: 'GET',
    });
  },

  async getTeams(): Promise<{ teams: any[] }> {
    return apiClient<{ teams: any[] }>('/api/users/teams', {
      method: 'GET',
    });
  },

  async updateUser(id: string, data: Partial<User>): Promise<{ user: User }> {
    return apiClient<{ user: User }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteUser(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/users/${id}`, {
      method: 'DELETE',
    });
  },

  async uploadAvatar(userId: string, file: File): Promise<{ user: User }> {
    const formData = new FormData();
    formData.append('avatar', file);

    return apiClient<{ user: User }>(`/api/users/${userId}/avatar`, {
      method: 'POST',
      body: formData,
    });
  },

  async removeAvatar(userId: string): Promise<{ user: User }> {
    return apiClient<{ user: User }>(`/api/users/${userId}/avatar`, {
      method: 'DELETE',
    });
  },

  async getApiKeys(userId: string): Promise<{ apiKeys: any[] }> {
    return apiClient<{ apiKeys: any[] }>(`/api/users/${userId}/api-keys`, {
      method: 'GET',
    });
  },

  async createApiKey(userId: string, name: string): Promise<{ apiKey: any }> {
    return apiClient<{ apiKey: any }>(`/api/users/${userId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async deleteApiKey(userId: string, keyId: string): Promise<{ success: boolean }> {
    return apiClient<{ success: boolean }>(`/api/users/${userId}/api-keys/${keyId}`, {
      method: 'DELETE',
    });
  },
};
