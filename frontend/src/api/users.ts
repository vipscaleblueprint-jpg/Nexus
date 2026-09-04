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
};
