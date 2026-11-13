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
  isSubtask?: boolean;
  subtaskId?: string;
  parentTaskId?: string;
  parentTaskTitle?: string;
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
  checklists?: any[];
  taskMap: TaskMapRecord;
  pmTags: string[];
  isWaitingPmReview: boolean;
  isClosed: boolean;
  isAdminTask?: boolean;
  isAssumptionBlock?: boolean;
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
  clientName?: string;
  timeIn?: string | null;
  date?: string | null;
  startedAt: string;
  stoppedAt?: string | null;
  timeOut?: string | null;
  active?: boolean;
  isManuallyMarkedUpwork?: boolean;
  isProjectBased?: boolean;
}

/**
 * Check if a client name, tracker string, or session indicates project-based (output-based) work
 * which does not require live desktop Upwork tracking screenshots and should not cause conflicts.
 */
export function isProjectBasedUpwork(input?: string | null): boolean {
  if (!input) return false;
  const str = input.toLowerCase();
  return (
    str.includes('project based') ||
    str.includes('project-based') ||
    str.includes('output based') ||
    str.includes('output-based') ||
    str.includes('clockify') ||
    str.includes('no live tracking') ||
    str.includes('no need to track') ||
    str.includes('no tracking') ||
    str.includes('fixed price') ||
    str.includes('fixed-price') ||
    str.includes('fixed contract') ||
    str.includes('lauren')
  );
}

/**
 * Check whether a session is project-based (output-based / no live Upwork tracking)
 */
export function isSessionProjectBased(
  session: UpworkSession | null | undefined,
  projectClients: string[] = []
): boolean {
  if (!session) return false;
  if (session.isProjectBased) return true;
  const combined = `${session.clientName || ''} ${session.pmName || ''} ${session.taskTitle || ''}`;
  if (isProjectBasedUpwork(combined)) return true;
  const clientLower = (session.clientName || '').toLowerCase().trim();
  const pmLower = (session.pmName || '').toLowerCase().trim();
  return projectClients.some((c) => {
    const cl = c.toLowerCase().trim();
    return cl && (cl === clientLower || cl === pmLower || combined.toLowerCase().includes(cl));
  });
}

/**
 * Check if a task has been explicitly assigned or queued to a specific user by a PM on Task Map
 */
export function hasPmAssignmentForUser(task?: TaskMapItem | null, userId?: string | null): boolean {
  if (!task || !userId) return false;
  let reviewsList = task.taskMap?.pmReviews;
  if (typeof reviewsList === 'string') {
    try {
      reviewsList = JSON.parse(reviewsList);
    } catch {
      reviewsList = [];
    }
  }
  if (!Array.isArray(reviewsList)) return false;
  const pmAssign = reviewsList.find((r: any) =>
    r?.type === 'PM_ASSIGNMENT' &&
    r?.assignedTo === userId &&
    (task.isSubtask ? r?.subtaskId === task.subtaskId : !r?.subtaskId)
  );
  return Boolean(pmAssign);
}

export function getPmAssignedUserId(task?: TaskMapItem | null): string | null {
  if (!task) return null;
  let reviewsList = task.taskMap?.pmReviews;
  if (typeof reviewsList === 'string') {
    try {
      reviewsList = JSON.parse(reviewsList);
    } catch {
      reviewsList = [];
    }
  }
  if (!Array.isArray(reviewsList)) return null;
  const pmAssign = reviewsList.find(
    (r: any) =>
      r?.type === 'PM_ASSIGNMENT' &&
      r?.assignedTo &&
      (task.isSubtask ? r?.subtaskId === task.subtaskId : !r?.subtaskId)
  );
  return pmAssign?.assignedTo || null;
}

export function isTaskHandedOver(task?: TaskMapItem | null): boolean {
  if (!task) return false;
  if (task.taskMap?.handedOver) return true;
  const statuses = task.taskMap?.statuses || [];
  return statuses.some((s) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'HANDOVER');
}

export function getEffectiveTaskMapHandlerId(task?: TaskMapItem | null): string | null {
  if (!task) return null;
  const pmAssignedId = getPmAssignedUserId(task);
  if (pmAssignedId) return pmAssignedId;
  if (isTaskHandedOver(task)) return null;
  return task.assigneeId || task.assignee?.id || null;
}

/**
 * Search helper for Task Map header search: matches Marketing Associate (MA) / user name
 */
export function matchesMarketingNameSearch(user: any, searchQuery?: string | null): boolean {
  const clean = (searchQuery || '').trim().toLowerCase();
  if (!clean) return true;
  if (!user) return false;
  const name = (user.name || '').trim().toLowerCase();
  const email = (user.email || '').trim().toLowerCase();
  const tokens = clean.split(/\s+/).filter(Boolean);
  return tokens.every((tok) => name.includes(tok) || email.includes(tok));
}

/**
 * Reactive tracker for tasks currently being saved/posted to the database on Task Map
 */
const savingTaskCounts = new Map<string, number>();
const savingListeners = new Set<(savingIds: Set<string>) => void>();

function notifySavingListeners() {
  const activeIds = new Set<string>();
  savingTaskCounts.forEach((count, id) => {
    if (count > 0) activeIds.add(id);
  });
  savingListeners.forEach((listener) => {
    try {
      listener(activeIds);
    } catch (err) {
      console.error('TaskMap saving listener error:', err);
    }
  });
}

export function markTaskSavingToDb(taskId: string, isSaving: boolean): void {
  if (!taskId) return;
  const current = savingTaskCounts.get(taskId) || 0;
  if (isSaving) {
    savingTaskCounts.set(taskId, current + 1);
  } else if (current <= 1) {
    savingTaskCounts.delete(taskId);
  } else {
    savingTaskCounts.set(taskId, current - 1);
  }
  notifySavingListeners();
}

export function isTaskSavingToDb(taskId?: string | null): boolean {
  if (!taskId) return false;
  return (savingTaskCounts.get(taskId) || 0) > 0;
}

export function getSavingTaskIds(): Set<string> {
  const activeIds = new Set<string>();
  savingTaskCounts.forEach((count, id) => {
    if (count > 0) activeIds.add(id);
  });
  return activeIds;
}

export function subscribeTaskMapSaving(listener: (savingIds: Set<string>) => void): () => void {
  savingListeners.add(listener);
  listener(getSavingTaskIds());
  return () => {
    savingListeners.delete(listener);
  };
}

function parseTaskPmReviewsList(task?: TaskMapItem | null): any[] {
  if (!task) return [];
  let reviewsList: any = task.taskMap?.pmReviews;
  if (typeof reviewsList === 'string') {
    try {
      reviewsList = JSON.parse(reviewsList);
    } catch {
      reviewsList = [];
    }
  }
  return Array.isArray(reviewsList) ? [...reviewsList] : [];
}

function isCadenceTaskMapItem(task: TaskMapItem): boolean {
  const s = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const mapStatuses = (task.taskMap?.statuses || []).map((x) =>
    x.trim().toUpperCase().replace(/[\s_-]+/g, '')
  );
  return (
    s === 'DAILY' ||
    s.includes('DAILY') ||
    s === 'WEEKLY' ||
    s.includes('WEEKLY') ||
    s === 'MONTHLY' ||
    s.includes('MONTHLY') ||
    s === 'RECURRING' ||
    s.includes('RECURRING') ||
    Boolean((task as any).recurringConfig) ||
    mapStatuses.some(
      (st) =>
        ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(st) ||
        st.includes('DAILY') ||
        st.includes('WEEKLY') ||
        st.includes('MONTHLY') ||
        st.includes('RECURRING')
    )
  );
}

/**
 * Optimistically apply a Task Map drag-and-drop assignment or slot change at 0ms on the frontend
 * so the card moves immediately into its target column/slot while posting to the database.
 */
export function applyOptimisticTaskMapAssignment(
  task: TaskMapItem,
  targetUser: { id: string; name?: string; email?: string; avatarUrl?: string | null; roles?: string[] } | null,
  mode: 'IN_PROGRESS' | 'QUEUE' = 'QUEUE'
): TaskMapItem {
  const existingReviews = parseTaskPmReviewsList(task);
  const filteredReviews = existingReviews.filter((r: any) => {
    if (r?.type !== 'PM_ASSIGNMENT') return true;
    return task.isSubtask ? r?.subtaskId !== task.subtaskId : Boolean(r?.subtaskId);
  });

  const isCadence = isCadenceTaskMapItem(task);
  const existingStatuses = Array.isArray(task.taskMap?.statuses) ? [...task.taskMap.statuses] : [];

  if (!targetUser) {
    // Unassign / return to Available Tasks pool
    return {
      ...task,
      assigneeId: null,
      assignee: null,
      assignees: [],
      status: isCadence ? task.status : 'PENDING',
      progress: task.progress
        ? {
            ...task.progress,
            timeIn: null,
            timeOut: task.progress.timeOut || (task.progress.timeIn ? 'HandedOver' : null),
          }
        : null,
      taskMap: {
        ...(task.taskMap || {
          taskId: task.id,
          statuses: ['Hand-over'],
          shift: 'DAY',
          stepOrder: 0,
          dontRollover: false,
        }),
        handedOver: true,
        statuses: ['Hand-over'],
        pmReviews: filteredReviews,
      },
    };
  }

  const nextReviews = [
    ...filteredReviews,
    {
      id: `optimistic-pm-${Date.now()}`,
      type: 'PM_ASSIGNMENT',
      assignedTo: targetUser.id,
      assignedToName: targetUser.name || 'Team Member',
      subtaskId: task.isSubtask ? task.subtaskId : undefined,
      mode,
      createdAt: new Date().toISOString(),
    },
  ];

  const cleanedStatuses = existingStatuses.filter((st) => {
    const norm = st.trim().toUpperCase().replace(/[\s_-]+/g, '');
    if (norm === 'HANDOVER') return false;
    if (mode === 'QUEUE' && norm === 'INPROGRESS') return false;
    return true;
  });

  if (mode === 'IN_PROGRESS' && !cleanedStatuses.some((s) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
    cleanedStatuses.push('In progress');
  }

  const curStatusNorm = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const nextStatus =
    mode === 'IN_PROGRESS'
      ? isCadence
        ? task.status
        : 'IN PROGRESS'
      : isCadence
        ? task.status
        : curStatusNorm === 'INPROGRESS' || curStatusNorm === 'ONHOLD'
          ? 'PENDING'
          : task.status || 'PENDING';

  const nextAssigneeObj = {
    id: targetUser.id,
    name: targetUser.name || 'Team Member',
    email: targetUser.email || '',
    avatarUrl: targetUser.avatarUrl || null,
    roles: targetUser.roles || [],
  };

  const nextAssignees = [
    nextAssigneeObj,
    ...(task.assignees || []).filter((u: any) => u && u.id !== targetUser.id),
  ];

  const nextProgress =
    mode === 'IN_PROGRESS'
      ? {
          ...(task.progress || {}),
          maName: targetUser.name || task.progress?.maName || 'Team Member',
          timeOut: null,
        }
      : task.progress
        ? {
            ...task.progress,
            timeIn: null,
          }
        : null;

  return {
    ...task,
    assigneeId: targetUser.id,
    assignee: nextAssigneeObj,
    assignees: nextAssignees,
    status: nextStatus,
    progress: nextProgress as any,
    taskMap: {
      ...(task.taskMap || {
        taskId: task.id,
        statuses: cleanedStatuses,
        shift: 'DAY',
        stepOrder: 0,
        dontRollover: false,
      }),
      handedOver: false,
      statuses: cleanedStatuses,
      pmReviews: nextReviews,
    },
  };
}

/**
 * Syncs taskMap.pmReviews when a task's assigneeId is updated directly (e.g. Auditing or CRM view)
 */
export function syncTaskPmReviewsWithAssignee(
  task: TaskMapItem,
  nextAssigneeId: string | null | undefined,
  nextAssigneeName?: string
): TaskMapRecord {
  const baseMap: TaskMapRecord = task.taskMap || {
    taskId: task.id,
    statuses: [],
    shift: 'DAY',
    stepOrder: 0,
    dontRollover: false,
    handedOver: false,
    pmReviews: [],
  };
  if (nextAssigneeId === undefined) return baseMap;

  const existingReviews = parseTaskPmReviewsList(task);
  const filteredReviews = existingReviews.filter((r: any) => {
    if (r?.type !== 'PM_ASSIGNMENT') return true;
    return task.isSubtask ? r?.subtaskId !== task.subtaskId : Boolean(r?.subtaskId);
  });

  if (nextAssigneeId === null) {
    return {
      ...baseMap,
      handedOver: true,
      pmReviews: filteredReviews,
    };
  }

  return {
    ...baseMap,
    handedOver: false,
    pmReviews: [
      ...filteredReviews,
      {
        id: `optimistic-pm-${Date.now()}`,
        type: 'PM_ASSIGNMENT',
        assignedTo: nextAssigneeId,
        assignedToName: nextAssigneeName || 'Team Member',
        subtaskId: task.isSubtask ? task.subtaskId : undefined,
        mode: 'QUEUE',
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export function pickLatestPrimaryAssignee<T extends { id: string }>(
  updatedAssignees: T[],
  currentAssigneeId?: string | null,
  toggledUser?: T | null,
  wasRemoved?: boolean
): T | null {
  if (updatedAssignees.length === 0) return null;
  if (!wasRemoved && toggledUser && updatedAssignees.some((u) => u.id === toggledUser.id)) {
    return toggledUser;
  }
  if (currentAssigneeId) {
    const preserved = updatedAssignees.find((u) => u.id === currentAssigneeId);
    if (preserved) return preserved;
  }
  return updatedAssignees[updatedAssignees.length - 1];
}

export interface DailyRolloverResult {
  success: boolean;
  rolledCount: number;
  retainedDate: string;
  newDate: string;
  retainedTasksCount: number;
}

export interface TaskMapDataResponse {
  success: boolean;
  isHistory?: boolean;
  snapshotDate?: string;
  latestDate?: string;
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
  upworkProjectClients?: string[];
  maActiveSessions?: Record<string, any>;
}

export const taskMapApi = {
  getData: async (params?: { shift?: string; date?: string; search?: string; client?: string }): Promise<TaskMapDataResponse> => {
    const q = new URLSearchParams();
    if (params?.shift) q.set('shift', params.shift);
    if (params?.date) q.set('date', params.date);
    if (params?.client) q.set('client', params.client);
    q.set('_t', String(Date.now()));
    const queryString = q.toString() ? `?${q.toString()}` : '';
    return apiClient<TaskMapDataResponse>(`/api/task-map/data${queryString}`);
  },

  getOptions: async (): Promise<{ success: boolean; options: TaskMapOption[] }> => {
    return apiClient<{ success: boolean; options: TaskMapOption[] }>(`/api/task-map/options?_t=${Date.now()}`);
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
    return apiClient<{ success: boolean; shifts: TaskMapShift[]; activeShiftKey: string }>(`/api/task-map/shifts?_t=${Date.now()}`);
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
    markTaskSavingToDb(taskId, true);
    try {
      return await apiClient<{
        success: boolean;
        taskMap: TaskMapRecord;
        upworkStartedAt?: string | null;
        upworkSession?: UpworkSession | null;
        activeUpworkSessions?: UpworkSession[];
      }>(`/api/task-map/tasks/${taskId}/statuses`, {
        method: 'PATCH',
        body: JSON.stringify({ statuses }),
      });
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  claimTask: async (taskId: string): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord }> => {
    markTaskSavingToDb(taskId, true);
    try {
      return await apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/claim`, {
        method: 'PATCH',
      });
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  assignTask: async (
    taskId: string,
    assigneeId: string | null,
    mode: 'IN_PROGRESS' | 'QUEUE' = 'QUEUE'
  ): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord }> => {
    markTaskSavingToDb(taskId, true);
    try {
      return await apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId, mode }),
      });
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  resetColumnTasks: async (
    columnId: string,
    type: 'BOARD' | 'AUDIT' = 'BOARD'
  ): Promise<{ success: boolean; count: number; resetTaskIds: string[]; message?: string }> => {
    return apiClient<{ success: boolean; count: number; resetTaskIds: string[]; message?: string }>(
      `/api/task-map/columns/${columnId}/reset`,
      {
        method: 'POST',
        body: JSON.stringify({ type }),
      }
    );
  },

  pmReview: async (taskId: string, data: { action: 'APPROVE' | 'REQUEST_REVISION'; pmTag?: string; comment?: string }): Promise<{ success: boolean; taskMap: TaskMapRecord }> => {
    return apiClient<{ success: boolean; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/pm-review`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  runRollover: async (data?: {
    taskId?: string;
    shift?: string;
    isDaily?: boolean;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ success: boolean; rolledCount?: number; nextShift?: string; taskMap?: TaskMapRecord; retainedDate?: string; newDate?: string }> => {
    return apiClient('/api/task-map/rollover', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  runDailyRollover: async (data?: {
    fromDate?: string;
    toDate?: string;
    retainCurrent?: boolean;
  }): Promise<DailyRolloverResult> => {
    return apiClient<DailyRolloverResult>('/api/task-map/daily-rollover', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  getHistoryDates: async (): Promise<{ success: boolean; dates: string[]; currentDate: string; latestDate?: string }> => {
    return apiClient<{ success: boolean; dates: string[]; currentDate: string; latestDate?: string }>(`/api/task-map/history-dates?_t=${Date.now()}`);
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

  getUpworkClients: async (): Promise<{ success: boolean; clients: string[]; projectClients?: string[] }> => {
    return apiClient<{ success: boolean; clients: string[]; projectClients?: string[] }>(`/api/task-map/upwork-clients?_t=${Date.now()}`);
  },

  toggleUpworkClient: async (data: {
    clientName: string;
    isUpwork?: boolean;
    isProjectBased?: boolean;
    action?: 'add' | 'remove' | 'toggle';
    clients?: string[];
    projectClients?: string[];
  }): Promise<{ success: boolean; clients: string[]; projectClients?: string[] }> => {
    return apiClient<{ success: boolean; clients: string[]; projectClients?: string[] }>('/api/task-map/upwork-clients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getUpworkActiveSessions: async (): Promise<{ success: boolean; activeUpworkSessions: UpworkSession[] }> => {
    return apiClient<{ success: boolean; activeUpworkSessions: UpworkSession[] }>(`/api/task-map/upwork-active?_t=${Date.now()}`);
  },
};

// ===========================================================================
// User Roles & Short/Recreation Labels Mapping
// ===========================================================================

export interface UserRoleMapping {
  mainRole: string;
  mainRoleShort: string;
  roles: string[];
  secondaryRoles: string[];
}

export const ROLE_SHORT_NAMES: Record<string, string> = {
  'Product': 'Prod',
  'Production': 'Prod',
  'Production Project Manager': 'Prod PM',
  'Dev Project Manager': 'Dev PM',
  'Cyber Security': 'Cyber Sec',
  'Cybersecurity Developer': 'Cyber Sec',
  'ProjectManagers': 'PM',
  'Project Manager': 'PM',
  'AI Director': 'Ai Dir',
  'AI Scene Prompt Director': 'Ai Dir',
  'Funnel Auditor': 'Funnel Aud',
  'Funnel Strategist': 'Funnel Strat',
  'Funnel Builder': 'Funnel Builder',
  'Backend Developer': 'Backend',
  'Back-end Developer': 'Backend',
  'Developer': 'Dev',
  'UI UX Auditor': 'UI UX Aud',
  'Instruction Auditor': 'Instruction Aud',
  'Design Auditor': 'Design Aud',
  'Motion Graphics': 'Motion Graphics',
  '3D Design': '3D Design',
  'Design': 'Design',
  'Dev Ops': 'Dev Ops',
  'CRM': 'CRM',
  'Client Relationship Manager': 'CRM',
  'Lead Generation': 'Lead Gen',
  'Sales': 'Sales',
  'Onboarding Sales': 'Sales',
  'Marketing': 'Marketing',
  'Harmony': 'Harmony',
  'Senior': 'Senior',
  'Super Admin': 'Super Admin',
  'Admin': 'Admin',
  'Member': 'Member',
};

export const USER_ROLE_DEFINITIONS: Record<string, UserRoleMapping> = {};

export interface AuditorRoleOption {
  key: string;
  label: string;
  fullRole: string;
}

export function extractAuditorRoles(workspaceTeams: any[] = [], allUsers: any[] = []): AuditorRoleOption[] {
  const roleNameMap = new Map<string, string>();

  // 1. Discover all teamRoles from teams with "audit" in the name (e.g. "Audit Team")
  for (const team of workspaceTeams || []) {
    if (/audit/i.test(team?.name || '')) {
      for (const tr of team.teamRoles || []) {
        if (tr?.name && typeof tr.name === 'string') {
          const canonical = tr.name.trim();
          roleNameMap.set(canonical.toLowerCase(), canonical);
        }
      }
    }
  }

  // 2. Discover roles from allUsers where role includes "audit" or "auditor"
  for (const u of allUsers || []) {
    for (const r of u?.roles || []) {
      if (typeof r === 'string' && /audit/i.test(r.trim())) {
        const canonical = r.trim();
        if (!roleNameMap.has(canonical.toLowerCase())) {
          roleNameMap.set(canonical.toLowerCase(), canonical);
        }
      }
    }
  }

  // Fallbacks if DB queries haven't loaded yet
  const standardAuditorRoles = ['UI UX Auditor', 'Design Auditor', 'Instruction Auditor', 'Funnel Auditor'];
  for (const r of standardAuditorRoles) {
    if (!roleNameMap.has(r.toLowerCase())) {
      roleNameMap.set(r.toLowerCase(), r);
    }
  }

  const formatLabel = (roleName: string) => {
    const clean = roleName.trim();
    if (/^ui\s*\/?\s*ux\s*(auditor|audit)?$/i.test(clean)) return 'UI/UX';
    if (/^design\s*(auditor|audit)$/i.test(clean)) return 'Design';
    if (/^instruction\s*(auditor|audit)$/i.test(clean)) return 'Instruction';
    if (/^funnel\s*(auditor|audit)$/i.test(clean)) return 'Funnel Audit';
    return clean.replace(/\s+(auditor|audit)$/i, '').trim() || clean;
  };

  const options: AuditorRoleOption[] = [
    { key: 'ALL', label: 'All', fullRole: 'ALL' },
  ];

  const orderWeight = (k: string) => {
    const l = k.toLowerCase();
    if (l.includes('ui') || l.includes('ux')) return 1;
    if (l.includes('design')) return 1;
    if (l.includes('instruction')) return 2;
    if (l.includes('funnel')) return 3;
    return 10;
  };

  const sortedRoles = Array.from(roleNameMap.values()).sort((a, b) => {
    const diff = orderWeight(a) - orderWeight(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  for (const role of sortedRoles) {
    options.push({
      key: role,
      label: formatLabel(role),
      fullRole: role,
    });
  }

  return options;
}

export function getRoleBadgeClass(shortOrFullRole: string): string {
  const r = (shortOrFullRole || '').toLowerCase().trim();
  if (r.includes('design aud')) return 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/70 dark:text-pink-300 dark:border-pink-800/60';
  if (r.includes('design') || r.includes('3d')) return 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/70 dark:text-pink-300 dark:border-pink-800/60';
  if (r.includes('prod pm') || r.includes('production project manager')) return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800/60';
  if (r.includes('prod')) return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800/60';
  if (r.includes('funnel aud')) return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/60';
  if (r.includes('funnel strat')) return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/60';
  if (r.includes('funnel')) return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/60';
  if (r.includes('ui ux') || r.includes('ui/ux') || r.includes('ui/ux aud')) return 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/70 dark:text-cyan-300 dark:border-cyan-800/60';
  if (r.includes('instruction')) return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/60';
  if (r.includes('lead gen') || r.includes('lead generation')) return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/60';
  if (r.includes('dev pm') || r.includes('dev project manager')) return 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/70 dark:text-violet-300 dark:border-violet-800/60';
  if (r.includes('pm') || r.includes('project manager')) return 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/70 dark:text-violet-300 dark:border-violet-800/60';
  if (r.includes('crm') || r.includes('client relationship')) return 'bg-[#22A3AE]/15 text-[#0e7490] border-[#22A3AE]/30 dark:bg-[#22A3AE]/20 dark:text-[#22A3AE] dark:border-[#22A3AE]/40';
  if (r.includes('sales')) return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/60';
  if (r.includes('marketing')) return 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/70 dark:text-fuchsia-300 dark:border-fuchsia-800/60';
  if (r.includes('senior')) return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/70 dark:text-yellow-300 dark:border-yellow-800/60';
  if (r.includes('harmony')) return 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800/60';
  if (r.includes('dev ops') || r.includes('devops')) return 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800/60';
  if (r.includes('backend') || r.includes('back-end')) return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800/60';
  if (r.includes('dev') && !r.includes('dev ops')) return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800/60';
  if (r.includes('ai dir') || r.includes('ai director') || r.includes('ai scene')) return 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-800/60';
  if (r.includes('cyber sec') || r.includes('cybersecurity')) return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800/60';
  if (r.includes('motion')) return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800/60';
  if (r.includes('super admin') || r.includes('admin')) return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800/60';
  return 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700/60';
}

export function getUserRoleDefinition(user: any): UserRoleMapping & { badgeClass: string } {
  const dbRoles: string[] = Array.isArray(user?.roles)
    ? user.roles.filter(Boolean)
    : [];

  const teamName: string = user?.team?.name || '';
  let mainRole = dbRoles[0] || teamName;

  if (!mainRole) {
    mainRole = user?.systemRole === 'ADMIN' ? 'Super Admin' : 'Member';
  }

  const shortRole = ROLE_SHORT_NAMES[mainRole] || mainRole;
  const secondaryRoles = dbRoles.length > 1 ? dbRoles.slice(1) : [];

  return {
    mainRole,
    mainRoleShort: shortRole,
    roles: dbRoles.length ? dbRoles : [mainRole],
    secondaryRoles,
    badgeClass: getRoleBadgeClass(shortRole || mainRole),
  };
}

// ===========================================================================
// User Latest Input / Empty Assumption Block
// ===========================================================================

export interface EmptyUserBlock {
  id: string;
  isAssumptionBlock: boolean;
  day: string;
  timeIn: string | null;
  timeOut: string | null;
  client: string;
  taskTitle: string;
  status: string;
  isUpwork: boolean;
  isMissingTime: boolean;
  maName?: string | null;
  rowNumber?: number;
  updatedAt?: string;
}

export function createEmptyUserBlock(params?: {
  userId?: string;
  userName?: string;
  day?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  client?: string | null;
  taskTitle?: string | null;
  status?: string | null;
  isUpwork?: boolean;
  rowNumber?: number;
}): TaskMapItem {
  const rawClient = (params?.client || '').trim();
  const assumedClient =
    rawClient && rawClient.toLowerCase() !== 'general' ? rawClient : 'No client inputted';
  const rawTitle = (params?.taskTitle || '').trim();
  const assumedTitle =
    rawTitle && rawTitle.toLowerCase() !== 'general task' ? rawTitle : 'No task inputted';
  const assumedDay = params?.day || new Date().toISOString().split('T')[0];
  const assumedStatus = params?.status || (params?.timeOut ? 'Done' : 'In progress');
  const id = `general-slot-${params?.userId || 'user'}`;

  return {
    id,
    title: assumedTitle,
    description: 'Auto-generated assumption block for latest daily schedule input',
    priority: 'NORMAL',
    listId: 'general',
    status: assumedStatus,
    dueDate: null,
    startDate: null,
    position: -1,
    assigneeId: params?.userId || null,
    assigneeRoleRestrictions: [],
    teamAssignAccessRole: null,
    list: { id: 'general', name: assumedClient },
    assignee: params?.userId ? { id: params.userId, name: params.userName || 'Team Member' } : null,
    assignees: params?.userId ? [{ id: params.userId, name: params.userName || 'Team Member' }] : [],
    creator: null,
    subtasks: [],
    taskMap: {
      id: `map-${id}`,
      taskId: id,
      subtaskId: null,
      statuses: [assumedStatus],
      shift: 'DAY',
      shiftDate: assumedDay,
      rolloverCount: 0,
      originShift: null,
      originDate: null,
      dontRollover: true,
      handedOver: false,
      stepOrder: -1,
      pmReviews: null,
      waitingReviewSince: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    pmTags: [],
    isWaitingPmReview: false,
    isClosed: false,
    isAdminTask: false,
    isAssumptionBlock: true,
    progress: {
      type: 'SHEET_PROGRESS',
      timeIn: params?.timeIn || null,
      timeOut: params?.timeOut || null,
      isMissingTime: Boolean(
        params?.rowNumber &&
        !params?.timeIn &&
        (params?.timeOut || (params?.status && params?.status.toLowerCase() !== 'in progress'))
      ),
      isUpwork: Boolean(params?.isUpwork),
      client: assumedClient,
      timeTracker: params?.isUpwork ? 'Upwork' : null,
      maName: params?.userName || null,
      status: assumedStatus,
      date: assumedDay,
      sheetRow: params?.rowNumber,
      updatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Re-export audit hierarchy helpers
export {
  hasUiUxOrDesignAudit,
  areLevel1AuditsComplete,
  isInstructionAuditComplete,
  canPerformAudit,
  isUiUxAudit,
  isDesignAudit,
  isInstructionAudit,
  isFunnelAudit,
} from '@/lib/auditChecklist';
export type { AuditPermissionCheck } from '@/lib/auditChecklist';

// Re-export uniform status tokens and helpers
export {
  ALL_STATUSES,
  STATUS_COLORS,
  isClosedStatus,
  sortStatusesWithClosedAndKycAtEnd,
  CustomCircleDot,
  CustomCircleDotted,
} from '@/lib/taskTokens';

/**
 * Canonical sub-status hex colors aligned with main task STATUS_COLORS in taskTokens.tsx
 * for every sub-status that transitions a task's main status.
 */
export const TASK_MAP_STATUS_COLORS = {
  AVAILABLE_TASK: '#2563eb', // Workflow pool (no main status change)
  HAND_OVER: '#a855f7',      // Retains IN PROGRESS
  PAUSED: '#eab308',         // Retains IN PROGRESS
  ASK_CLIENT: '#06b6d4',     // Retains IN PROGRESS / IN REVIEW
  TO_REVIEW: '#D97B3A',      // -> IN REVIEW (Orange)
  WAITING: '#D9534F',        // -> WAITING (Red)
  SENT: '#D9534F',           // -> WAITING (Red)
  ON_HOLD: '#8A8F98',        // -> ON-HOLD (Gray)
  REVISION: '#5B6BD6',       // -> REVISION (Indigo)
  TO_SEND: '#22A3AE',        // -> CRM (Teal)
  FOLLOW_UP: '#38bdf8',      // Retains CRM (Sky)
  CLOSED: '#2FA37A',         // -> CLOSED (Green)
} as const;

const CANONICAL_STATUS_MAP: Record<string, string> = {
  KYC: 'KYC',
  PINBOARD: 'PIN BOARD',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  PENDING: 'PENDING',
  INPROGRESS: 'IN PROGRESS',
  REVISION: 'REVISION',
  WAITING: 'WAITING',
  INREVIEW: 'IN REVIEW',
  TOREVIEW: 'IN REVIEW',
  REVIEW: 'IN REVIEW',
  CHECKING: 'CHECKING',
  INCHECKING: 'CHECKING',
  CRM: 'CRM',
  CLOSED: 'CLOSED',
  DONE: 'CLOSED',
  ONHOLD: 'ON-HOLD',
};

/**
 * Normalizes any main task status string to canonical uppercase ALL_STATUSES format
 * so case differences (e.g. "Waiting" vs "WAITING") never write inconsistent names
 * or create redundant STATUS_CHANGE audit logs.
 */
export function toCanonicalTaskStatus(status?: string | null): string {
  const raw = (status || '').trim();
  if (!raw) return '';
  const compact = raw.toUpperCase().replace(/[\s_-]+/g, '');
  return CANONICAL_STATUS_MAP[compact] || raw.toUpperCase();
}

/**
 * Returns innate default sub-statuses when a task has no explicit Task Map sub-status.
 * Active Task Map tasks innately default to ['Available Task'], while Auditor queue
 * (IN REVIEW / CHECKING) and closed tasks stay clean unless explicitly tagged.
 */
export function getDefaultTaskMapSubStatuses(taskStatus?: string | null): string[] {
  const canonical = toCanonicalTaskStatus(taskStatus);
  if (canonical === 'CRM') return ['To send'];
  if (canonical === 'WAITING') return ['Waiting'];
  if (canonical === 'ON-HOLD') return ['On-hold'];
  if (
    canonical === 'IN REVIEW' ||
    canonical === 'CHECKING' ||
    canonical === 'CLOSED' ||
    canonical === 'COMPLETE' ||
    canonical === 'COMPLETED' ||
    canonical === 'RESOLVED' ||
    canonical === 'CANCELLED'
  ) {
    return [];
  }
  return ['Available Task'];
}

/**
 * Returns true if the Task Map item is in On-Hold status (main status or Task Map sub-status).
 */
export function isTaskMapItemOnHold(task?: Partial<TaskMapItem> | null): boolean {
  if (!task) return false;
  const s = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (s === 'ONHOLD' || s.includes('HOLD')) return true;
  const customStatuses = task.taskMap?.statuses || [];
  return customStatuses.some((cs: string) => {
    const up = (cs || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    return up === 'ONHOLD' || up.includes('HOLD');
  });
}

/**
 * Counts active Task Map items excluding On-Hold tasks for task number indicators.
 */
export function countNonOnHoldTasks(items?: Array<Partial<TaskMapItem>> | null): number {
  if (!items || items.length === 0) return 0;
  return items.filter((t) => !isTaskMapItemOnHold(t)).length;
}



