import { apiClient } from './client';

export const activityApi = {
  getAuditLogs: async (userId?: string) => {
    return apiClient(`/api/activity/all${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);
  },
};
