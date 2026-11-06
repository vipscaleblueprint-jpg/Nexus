import { apiClient } from './client';
import { tasksApi } from './tasks';

export interface TaskMapOption {
  id: string;
  label: string;
  color: string;
  textColor: string | null;
  order: number;
}

export interface TaskMapShift {
  id: string;
  shiftKey: string;
  name: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  timezone: string;
  order: number;
  isActive: boolean;
}

export interface TaskMapRecord {
  id: string;
  taskId: string;
  subtaskId: string | null;
  statuses: string[];
  shift: string;
  shiftDate: string;
  rolloverCount: number;
  originShift: string | null;
  originDate: string | null;
  dontRollover: boolean;
  handedOver: boolean;
  stepOrder: number;
  pmReviews: any;
  waitingReviewSince: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskProgress {
  type?: string;
  timeIn: string | null;
  timeOut: string | null;
  isMissingTime: boolean;
  isUpwork: boolean;
  client: string | null;
  timeTracker: string | null;
  maName: string | null;
  status: string | null;
  date: string | null;
  sheetRow?: number;
  taskDeliverables?: string | null;
  taskUpdateAndDeliverables?: string | null;
  updatedAt?: string;
}

export interface TaskMapItem {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  listId: string;
  status: string;
  dueDate: string | null;
  startDate: string | null;
  position: number | null;
  assigneeId: string | null;
  assigneeRoleRestrictions: string[];
  teamAssignAccessRole: string | null;
  list: { id: string; name: string; folder?: { id: string; name: string } | null };
  assignee: any;
  assignees: any[];
  creator: any;
  subtasks: any[];
  taskMap: TaskMapRecord;
  pmTags: string[];
  isWaitingPmReview: boolean;
  isClosed: boolean;
  isAdminTask?: boolean;
  upworkStartedAt?: string | null;
  upworkSession?: UpworkSession | null;
  progress?: TaskProgress | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roles: string[];
  systemRole: string;
  isAudit: boolean;
}

export interface UpworkSession {
  taskId: string;
  taskTitle: string;
  userId: string;
  userName: string;
  pmName: string;
  startedAt: string;
}

export interface TaskMapDataResponse {
  success: boolean;
  tasks: TaskMapItem[];
  availablePool: TaskMapItem[];
  allClients?: Array<{ id: string; name: string }>;
  options: TaskMapOption[];
  shifts: TaskMapShift[];
  statusCounts: Record<string, number>;
  overdueCount: number;
  unassignedCount: number;
  activeShift: string;
  currentShift: string;
  currentDate: string;
  pmUsers: any[];
  allUsers?: any[];
  shiftUsers?: ShiftUser[];
  activeUpworkSessions?: UpworkSession[];
  upworkClients?: string[];
}

export const taskMapApi = {
  getData: async (params?: { shift?: string; date?: string; search?: string; client?: string }): Promise<TaskMapDataResponse> => {
    const q = new URLSearchParams();
    if (params?.shift) q.set('shift', params.shift);
    if (params?.date) q.set('date', params.date);
    if (params?.search) q.set('search', params.search);
    if (params?.client) q.set('client', params.client);
    const queryString = q.toString() ? `?${q.toString()}` : '';
    return apiClient<TaskMapDataResponse>(`/api/task-map/data${queryString}`);
  },

  getOptions: async (): Promise<{ success: boolean; options: TaskMapOption[] }> => {
    return apiClient<{ success: boolean; options: TaskMapOption[] }>('/api/task-map/options');
  },

  upsertOption: async (data: Partial<TaskMapOption>): Promise<{ success: boolean; option: TaskMapOption }> => {
    return apiClient<{ success: boolean; option: TaskMapOption }>('/api/task-map/options', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteOption: async (id: string, force = false): Promise<{ success: boolean; inUseCount?: number }> => {
    return apiClient<{ success: boolean; inUseCount?: number }>(`/api/task-map/options/${id}?force=${force}`, {
      method: 'DELETE',
    });
  },

  getShifts: async (): Promise<{ success: boolean; shifts: TaskMapShift[]; activeShiftKey: string }> => {
    return apiClient<{ success: boolean; shifts: TaskMapShift[]; activeShiftKey: string }>('/api/task-map/shifts');
  },

  updateShifts: async (shifts: Partial<TaskMapShift>[]): Promise<{ success: boolean; shifts: TaskMapShift[] }> => {
    return apiClient<{ success: boolean; shifts: TaskMapShift[] }>('/api/task-map/shifts', {
      method: 'PUT',
      body: JSON.stringify({ shifts }),
    });
  },

  updateTaskStatuses: async (
    taskId: string,
    statuses: string[]
  ): Promise<{
    success: boolean;
    taskMap: TaskMapRecord;
    upworkStartedAt?: string | null;
    upworkSession?: UpworkSession | null;
    activeUpworkSessions?: UpworkSession[];
  }> => {
    return apiClient<{
      success: boolean;
      taskMap: TaskMapRecord;
      upworkStartedAt?: string | null;
      upworkSession?: UpworkSession | null;
      activeUpworkSessions?: UpworkSession[];
    }>(`/api/task-map/tasks/${taskId}/statuses`, {
      method: 'PATCH',
      body: JSON.stringify({ statuses }),
    });
  },

  claimTask: async (taskId: string): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord }> => {
    return apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/claim`, {
      method: 'PATCH',
    });
  },

  assignTask: async (taskId: string, assigneeId: string | null): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord }> => {
    return apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assigneeId }),
    });
  },

  pmReview: async (taskId: string, data: { action: 'APPROVE' | 'REQUEST_REVISION'; pmTag?: string; comment?: string }): Promise<{ success: boolean; taskMap: TaskMapRecord }> => {
    return apiClient<{ success: boolean; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/pm-review`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  runRollover: async (data?: { taskId?: string; shift?: string }): Promise<{ success: boolean; rolledCount?: number; nextShift?: string; taskMap?: TaskMapRecord }> => {
    return apiClient<{ success: boolean; rolledCount?: number; nextShift?: string; taskMap?: TaskMapRecord }>('/api/task-map/rollover', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  updateTaskMeta: async (taskId: string, meta: { dontRollover?: boolean; handedOver?: boolean; stepOrder?: number; shift?: string }): Promise<{ success: boolean; taskMap: TaskMapRecord }> => {
    return apiClient<{ success: boolean; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/meta`, {
      method: 'PATCH',
      body: JSON.stringify(meta),
    });
  },

  getTimeline: async (taskId: string): Promise<{ success: boolean; logs: any[]; taskMap: TaskMapRecord }> => {
    return apiClient<{ success: boolean; logs: any[]; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/timeline`);
  },

  getUpworkClients: async (): Promise<{ success: boolean; clients: string[] }> => {
    return apiClient<{ success: boolean; clients: string[] }>('/api/task-map/upwork-clients');
  },

  toggleUpworkClient: async (data: {
    clientName: string;
    isUpwork?: boolean;
    action?: 'add' | 'remove' | 'toggle';
    clients?: string[];
  }): Promise<{ success: boolean; clients: string[] }> => {
    return apiClient<{ success: boolean; clients: string[] }>('/api/task-map/upwork-clients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getUpworkActiveSessions: async (): Promise<{ success: boolean; activeUpworkSessions: UpworkSession[] }> => {
    return apiClient<{ success: boolean; activeUpworkSessions: UpworkSession[] }>('/api/task-map/upwork-active');
  },
};
