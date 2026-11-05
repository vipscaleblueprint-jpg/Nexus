import { apiClient } from './client';

export interface AuditShift {
  id: string;
  shiftKey: string;
  name: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  auditorNames: string[];
  auditorIds: string[];
  memberNames?: string[];
  memberIds?: string[];
  members?: (AuditShiftUser & { isAudit: boolean })[];
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditShiftUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roles: string[];
  systemRole: string;
}

export interface AuditShiftsResponse {
  shifts: AuditShift[];
  users: AuditShiftUser[];
  currentManilaTime: {
    hour: number;
    minute: number;
    formatted: string;
    timezone: string;
  };
  activeShiftKey: string;
}

export const auditShiftsApi = {
  getAuditShifts: async (): Promise<AuditShiftsResponse> => {
    return apiClient<AuditShiftsResponse>('/api/admin/audit-shifts');
  },

  updateAuditShift: async (
    id: string,
    data: Partial<Omit<AuditShift, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<{ success: boolean; shift: AuditShift }> => {
    return apiClient<{ success: boolean; shift: AuditShift }>(`/api/admin/audit-shifts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  createAuditShift: async (
    data: Omit<AuditShift, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<{ success: boolean; shift: AuditShift }> => {
    return apiClient<{ success: boolean; shift: AuditShift }>('/api/admin/audit-shifts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteAuditShift: async (id: string): Promise<{ success: boolean; message: string }> => {
    return apiClient<{ success: boolean; message: string }>(`/api/admin/audit-shifts/${id}`, {
      method: 'DELETE',
    });
  },

  resetAuditShifts: async (): Promise<{ success: boolean; shifts: AuditShift[] }> => {
    return apiClient<{ success: boolean; shifts: AuditShift[] }>('/api/admin/audit-shifts/reset', {
      method: 'POST',
    });
  },

  triggerShiftSweep: async (shift?: string): Promise<{
    success: boolean;
    checkedTasks: number;
    updatedTasks: number;
  }> => {
    return apiClient<{
      success: boolean;
      checkedTasks: number;
      updatedTasks: number;
    }>('/api/admin/audit-shifts/sweep', {
      method: 'POST',
      body: JSON.stringify({ shift }),
    });
  },
};

