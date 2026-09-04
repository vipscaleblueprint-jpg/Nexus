import { apiClient, API_BASE_URL } from './client';
import { User } from '@/lib/types';

export interface LoginParams {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthResponse {
  user: User;
  rememberMe?: boolean;
}

export interface UpdateProfileParams {
  name?: string;
  avatarUrl?: string;
  dailySheetUrl?: string;
}

export const authApi = {
  getGoogleAuthUrl(): string {
    return `${API_BASE_URL}/api/auth/google`;
  },

  async login(credentials: LoginParams): Promise<AuthResponse> {
    return apiClient<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  async logout(): Promise<{ message: string }> {
    return apiClient<{ message: string }>('/api/auth/logout', {
      method: 'POST',
    });
  },

  async getMe(): Promise<{ user: User }> {
    return apiClient<{ user: User }>('/api/auth/me', {
      method: 'GET',
    });
  },

  async updateProfile(data: UpdateProfileParams): Promise<{ user: User }> {
    return apiClient<{ user: User }>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async changePassword(data: { currentPassword?: string; newPassword: string }): Promise<{ message: string }> {
    return apiClient<{ message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async forgotPassword(data: { email: string }): Promise<{ message: string }> {
    return apiClient<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async resetPassword(data: { email: string; otp: string; newPassword: string }): Promise<{ message: string }> {
    return apiClient<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
