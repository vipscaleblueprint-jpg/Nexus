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
};
