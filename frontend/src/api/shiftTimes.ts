import { apiClient } from './client';

export interface ShiftTimeEntry {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  roles: string[];
  systemRole: 'ADMIN' | 'MEMBER';
  employmentType: string;
  isSpecialEditor?: boolean;
  schedule: string;
  source?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface ShiftTimesResponse {
  shiftTimes: ShiftTimeEntry[];
  canEdit: boolean;
}

export const shiftTimesApi = {
  async getShiftTimes(): Promise<ShiftTimesResponse> {
    return apiClient<ShiftTimesResponse>('/api/shift-times', {
      method: 'GET',
    });
  },

  async updateShiftTime(userId: string, schedule: string): Promise<{ success: boolean; shiftTime: ShiftTimeEntry }> {
    return apiClient(`/api/shift-times/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ schedule }),
    });
  },

  async importFromSheet(): Promise<{
    success: boolean;
    totalSheetRows: number;
    syncedCount: number;
    unmatchedCount: number;
  }> {
    return apiClient('/api/shift-times/import-sheet', {
      method: 'POST',
    });
  },
};
