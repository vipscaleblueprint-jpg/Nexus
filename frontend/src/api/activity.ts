import { apiClient } from './client';

export interface GetAuditLogsParams {
  userId?: string;
  page?: number;
  limit?: number;
  category?: string;
  timeFilter?: string;
}

export interface GetAuditLogsResponse {
  logs: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const activityApi = {
  getAuditLogs: async (paramsOrUserId?: string | GetAuditLogsParams): Promise<GetAuditLogsResponse> => {
    let query = '';
    if (typeof paramsOrUserId === 'string') {
      query = `?userId=${encodeURIComponent(paramsOrUserId)}`;
    } else if (paramsOrUserId) {
      const searchParams = new URLSearchParams();
      if (paramsOrUserId.userId) searchParams.set('userId', paramsOrUserId.userId);
      if (paramsOrUserId.page) searchParams.set('page', paramsOrUserId.page.toString());
      if (paramsOrUserId.limit) searchParams.set('limit', paramsOrUserId.limit.toString());
      if (paramsOrUserId.category && paramsOrUserId.category !== 'all') {
        searchParams.set('category', paramsOrUserId.category);
      }
      if (paramsOrUserId.timeFilter && paramsOrUserId.timeFilter !== 'all') {
        searchParams.set('timeFilter', paramsOrUserId.timeFilter);
      }
      const str = searchParams.toString();
      if (str) query = `?${str}`;
    }
    return apiClient(`/api/activity/all${query}`);
  },
};
