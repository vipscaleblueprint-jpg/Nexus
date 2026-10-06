import { apiClient } from './client';

export const activityApi = {
  getAuditLogs: async () => {
    return apiClient('/api/activity/all');
  },
};
