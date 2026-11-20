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

export interface LaunchMeta {
  type: 'LAUNCH_META';
  launchDate: string | null;
  targetPeriod?: string | null;
  isLaunchDate: boolean;
  workstream?: string | null;
  details?: string | null;
  notes?: string | null;
  updatedAt: string;
  updatedById?: string | null;
}

export interface LaunchMapAssignee {
  id: string;
  name: string;
  avatarUrl?: string | null;
  imageUrl?: string | null;
}

export interface LaunchMapLightItem {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  listId: string;
  list: {
    id: string;
    name: string;
    folder?: { name: string } | null;
    statuses?: ListStatusToken[];
  } | null;
  assignee?: LaunchMapAssignee | null;
  assignees?: LaunchMapAssignee[];
  taskMapStatuses?: string[];
  isClosed?: boolean;
  isAdminTask?: boolean;
  launchMeta?: LaunchMeta | null;
  effectiveLaunchDate?: string | null;
  targetPeriod?: string | null;
  isLaunchDate?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LaunchMapDataResponse {
  success: boolean;
  items: LaunchMapLightItem[];
  clients: Array<{ id: string; name: string; count: number }>;
  counts: {
    scheduled: number;
    inReview: number;
    milestones: number;
    tbd?: number;
  };
}

export interface ListStatusToken {
  name: string;
  color?: string | null;
  groupName?: string | null;
  order?: number;
}

export type CrmFollowUpTier =
  | 'TODAY'
  | 'NEXT_DAY'
  | 'THIRD_DAY'
  | 'FIFTH_DAY'
  | 'SEVENTH_PLUS';

export interface CrmFollowUpRule {
  tier: CrmFollowUpTier;
  label: string;
  colorName: 'neutral' | 'yellow' | 'orange' | 'red' | 'violet';
  hex: string;
  breathe: boolean;
  requiresModal: boolean;
}

export interface CrmWaitingMeta {
  waitingSince: string;
  daysPassed: number;
  rule: CrmFollowUpRule;
  lastResponseAt?: string | null;
  lastResponseByName?: string | null;
  lastResponseNote?: string | null;
  lastResponseAction?: string | null;
}

export interface PendingCrmFollowUpItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  listId: string;
  list: { id: string; name: string } | null;
  waitingSince: string;
  daysPassed: number;
  rule: CrmFollowUpRule;
  lastResponseAt: string | null;
  lastResponseByName: string | null;
  lastResponseNote: string | null;
  subStatuses: string[];
}

export type CrmFollowUpResponseAction =
  | 'FOLLOWED_UP'
  | 'REVISIONS'
  | 'MOVE_TO_POOL'
  | 'CLOSED';

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
  list: {
    id: string;
    name: string;
    folder?: { id: string; name: string } | null;
    statuses?: ListStatusToken[];
  };
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
  linkedTaskId?: string | null;
  launchMeta?: LaunchMeta | null;
  effectiveLaunchDate?: string | null;
  isLaunchDate?: boolean;
  upworkStartedAt?: string | null;
  upworkSession?: UpworkSession | null;
  progress?: TaskProgress | null;
  crmWaitingMeta?: CrmWaitingMeta | null;
  createdAt: string;
  updatedAt: string;
}

/** Header user-visibility filter: ALL users, LIVE (live-working clocked in), ACTIVE (logged today). */
export type TrackFilter = 'ALL' | 'LIVE' | 'ACTIVE';

/**
 * True when a progress/daily-log row is dated today (Manila). Accepts YYYY-MM-DD, ISO strings,
 * or M/D/YYYY sheet dates; falls back to `updatedAt` when the row has no date.
 */
export function isProgressLoggedToday(
  prog?: { date?: string | null; updatedAt?: string | null } | null,
  now: Date = new Date()
): boolean {
  if (!prog) return false;
  const today = getManilaDateKey(now);
  let key: string | null = null;
  const raw = (prog.date || '').trim();
  const sheet = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const ymdSlash = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (sheet) {
    key = `${sheet[3]}-${sheet[1].padStart(2, '0')}-${sheet[2].padStart(2, '0')}`;
  } else if (ymdSlash) {
    key = `${ymdSlash[1]}-${ymdSlash[2].padStart(2, '0')}-${ymdSlash[3].padStart(2, '0')}`;
  } else if (raw) {
    // Parse text dates (e.g. "Nov 20, 2026") at noon when no time component is present to avoid midnight timezone shifts
    const hasTime = /\d{1,2}:\d{2}/.test(raw);
    const parsed = hasTime ? new Date(raw) : new Date(`${raw} 12:00:00`);
    key = !isNaN(parsed.getTime()) ? getManilaDateKey(parsed) : getManilaDateKey(raw);
  }
  if (!key && prog.updatedAt) {
    key = getManilaDateKey(prog.updatedAt);
  }
  return !!key && key === today;
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
  if (isTaskHandedOver(task)) return null;
  const pmAssignedId = getPmAssignedUserId(task);
  if (pmAssignedId) return pmAssignedId;
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

export function isCadenceTaskMapItem(
  task: Pick<TaskMapItem, 'status' | 'taskMap'> & { recurringConfig?: any }
): boolean {
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
 * Returns true when a progress entry represents an active live-working session
 * (clocked in with no timeOut and not flagged as missing time).
 */
export function isLiveWorkingProgress(progress?: TaskProgress | null): boolean {
  return Boolean(progress?.timeIn && !progress?.timeOut && !progress?.isMissingTime);
}

/**
 * When a task is actively live working (clocked in with no timeOut), transitions any
 * non-closed, non-recurring task status into 'IN PROGRESS'. Recurring/cadence tasks
 * (Daily, Weekly, Monthly, Recurring) strictly preserve their cadence status.
 */
export function applyLiveWorkingTaskStatus(task: TaskMapItem): TaskMapItem {
  if (!isLiveWorkingProgress(task.progress)) return task;
  if (isCadenceTaskMapItem(task)) return task;

  const normStatus = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normStatus === 'CLOSED' || normStatus === 'DONE') return task;

  const existingStatuses = Array.isArray(task.taskMap?.statuses) ? [...task.taskMap.statuses] : [];
  const cleanedStatuses = existingStatuses.filter((st) => {
    const norm = st.trim().toUpperCase().replace(/[\s_-]+/g, '');
    return norm !== 'HANDOVER' && norm !== 'AVAILABLETASK' && norm !== 'PAUSED' && norm !== 'ONHOLD';
  });
  if (!cleanedStatuses.some((st) => st.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
    cleanedStatuses.push('In progress');
  }

  return {
    ...task,
    status: normStatus === 'INPROGRESS' ? task.status : 'IN PROGRESS',
    taskMap: {
      ...task.taskMap,
      handedOver: false,
      statuses: cleanedStatuses,
    },
  };
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
    // Unassign / return to Available Tasks pool (preserve status & mark Available Task to match backend)
    return {
      ...task,
      assigneeId: null,
      assignee: null,
      assignees: [],
      status: isCadence ? task.status : task.status || 'PENDING',
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
          statuses: ['Available Task'],
          shift: 'DAY',
          stepOrder: 0,
          dontRollover: false,
        }),
        handedOver: true,
        statuses: ['Available Task'],
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
    if (norm === 'HANDOVER' || norm === 'AVAILABLETASK' || norm === 'REVISION' || norm === 'REVISIONS') return false;
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

  const sameWorkerProgress = Boolean(
    task.progress?.maName &&
    targetUser.name &&
    task.progress.maName.trim().toLowerCase() === targetUser.name.trim().toLowerCase()
  );
  const nextProgress =
    mode === 'IN_PROGRESS'
      ? sameWorkerProgress
        ? task.progress
        : null
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
  launchTasks?: TaskMapItem[];
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
  workspaceRoles?: Array<{ id: string; name: string; color?: string | null }>;
  workspaceTeams?: any[];
  activeUpworkSessions?: UpworkSession[];
  upworkClients?: string[];
  upworkProjectClients?: string[];
  maActiveSessions?: Record<string, any>;
}

export const taskMapApi = {
  getData: async (params?: { shift?: string; date?: string; search?: string; client?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<TaskMapDataResponse> => {
    const q = new URLSearchParams();
    if (params?.shift) q.set('shift', params.shift);
    if (params?.date) q.set('date', params.date);
    if (params?.client) q.set('client', params.client);
    q.set('_t', String(Date.now()));
    const queryString = q.toString() ? `?${q.toString()}` : '';
    return apiClient<TaskMapDataResponse>(`/api/task-map/data${queryString}`, {
      signal: params?.signal,
      timeoutMs: params?.timeoutMs ?? 25000,
    });
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

  transferTask: async (
    taskId: string,
    targetUserId: string
  ): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord }> => {
    markTaskSavingToDb(taskId, true);
    try {
      return await apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
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

  getLaunchData: async (params?: { start?: string; end?: string; signal?: AbortSignal }): Promise<LaunchMapDataResponse> => {
    const q = new URLSearchParams();
    if (params?.start) q.set('start', params.start);
    if (params?.end) q.set('end', params.end);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return apiClient<LaunchMapDataResponse>(`/api/task-map/launch${qs}`, {
      ...(params?.signal ? { signal: params.signal } : {}),
    });
  },

  getLaunchCandidates: async (params?: { q?: string; limit?: number; includeClosed?: boolean; signal?: AbortSignal }): Promise<{
    success: boolean;
    candidates: LaunchMapLightItem[];
  }> => {
    const q = new URLSearchParams();
    if (params?.q) q.set('q', params.q);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.includeClosed) q.set('includeClosed', 'true');
    const qs = q.toString() ? `?${q.toString()}` : '';
    return apiClient<{ success: boolean; candidates: LaunchMapLightItem[] }>(`/api/task-map/launch/candidates${qs}`, {
      ...(params?.signal ? { signal: params.signal } : {}),
    });
  },

  updateLaunchMeta: async (
    taskId: string,
    payload: {
      launchDate?: string | null;
      targetPeriod?: string | null;
      isLaunchDate?: boolean;
      workstream?: string | null;
      details?: string | null;
      notes?: string | null;
      syncDueDate?: boolean;
    }
  ): Promise<{
    success: boolean;
    launchMeta: LaunchMeta;
    effectiveLaunchDate: string | null;
    targetPeriod?: string | null;
    dueDate: string | null;
    alertSent?: boolean;
  }> => {
    markTaskSavingToDb(taskId, true);
    try {
      return await apiClient<{
        success: boolean;
        launchMeta: LaunchMeta;
        effectiveLaunchDate: string | null;
        targetPeriod?: string | null;
        dueDate: string | null;
        alertSent?: boolean;
      }>(`/api/task-map/tasks/${taskId}/launch`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } finally {
      markTaskSavingToDb(taskId, false);
    }
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

  getTaskDescription: async (params: {
    taskId?: string | null;
    title?: string | null;
    client?: string | null;
  }): Promise<{
    success: boolean;
    taskId: string | null;
    listId: string | null;
    listName?: string | null;
    status: string | null;
    priority: string | null;
    subStatuses?: string[];
    description: string | null;
  }> => {
    const q = new URLSearchParams();
    if (params.taskId) q.set('taskId', params.taskId);
    if (params.title) q.set('title', params.title);
    if (params.client) q.set('client', params.client);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return apiClient(`/api/task-map/task-description${qs}`);
  },

  getPendingCrmFollowUps: async (): Promise<{
    success: boolean;
    items: PendingCrmFollowUpItem[];
  }> => {
    return apiClient(`/api/task-map/crm/follow-ups?_t=${Date.now()}`);
  },

  acknowledgeCrmFollowUps: async (
    taskIds: string[]
  ): Promise<{
    success: boolean;
    count?: number;
    error?: string;
  }> => {
    return apiClient('/api/task-map/crm/follow-ups/acknowledge', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    });
  },

  respondCrmFollowUp: async (
    taskId: string,
    payload: { note: string; action: CrmFollowUpResponseAction; parentCommentId?: string | null }
  ): Promise<{
    success: boolean;
    task?: any;
    comment?: any;
    error?: string;
    uncheckedAudits?: string[];
    openSubtasks?: string[];
  }> => {
    markTaskSavingToDb(taskId, true);
    try {
      return await apiClient(`/api/task-map/crm/follow-ups/${taskId}/respond`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } finally {
      markTaskSavingToDb(taskId, false);
    }
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

export function extractAuditorRoles(
  workspaceTeams: any[] = [],
  allUsers: any[] = [],
  workspaceRoles: any[] = []
): AuditorRoleOption[] {
  const roleNameMap = new Map<string, string>();

  // 1. Discover all teamRoles from DB teams with "audit" in the name (e.g. "Audit Team") or audit role names
  for (const team of workspaceTeams || []) {
    const isAuditTeam = /audit/i.test(team?.name || '');
    for (const tr of team.teamRoles || []) {
      if (tr?.name && typeof tr.name === 'string') {
        const canonical = tr.name.trim();
        if (isAuditTeam || /audit/i.test(canonical)) {
          roleNameMap.set(canonical.toLowerCase(), canonical);
        }
      }
    }
  }

  // 2. Discover DB WorkspaceRoles with "audit"
  for (const wr of workspaceRoles || []) {
    if (wr?.name && typeof wr.name === 'string' && /audit/i.test(wr.name.trim())) {
      const canonical = wr.name.trim();
      if (!roleNameMap.has(canonical.toLowerCase())) {
        roleNameMap.set(canonical.toLowerCase(), canonical);
      }
    }
  }

  // 3. Discover roles from allUsers where role includes "audit" or "auditor"
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

  // Initial pre-fetch fallback only before DB teams/roles/users arrive
  if (
    roleNameMap.size === 0 &&
    workspaceTeams.length === 0 &&
    allUsers.length === 0 &&
    (workspaceRoles || []).length === 0
  ) {
    for (const r of ['UI UX Auditor', 'Design Auditor', 'Instruction Auditor', 'Funnel Auditor']) {
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

export function extractDeveloperRoles(
  workspaceTeams: any[] = [],
  allUsers: any[] = [],
  workspaceRoles: any[] = []
): AuditorRoleOption[] {
  const roleNameMap = new Map<string, string>();

  // 1. Discover all teamRoles from DB teams with "dev" or "develop" in the name (e.g. "Dev Team", "Dev Management Team")
  for (const team of workspaceTeams || []) {
    const isDevTeam = /\bdev\b|develop/i.test(team?.name || '');
    for (const tr of team.teamRoles || []) {
      if (tr?.name && typeof tr.name === 'string') {
        const canonical = tr.name.trim();
        if (isDevTeam || /\bdev\b|develop|back-?end|front-?end|full-?stack|dev\s*ops/i.test(canonical)) {
          roleNameMap.set(canonical.toLowerCase(), canonical);
        }
      }
    }
  }

  // 2. Discover DB WorkspaceRoles with dev-related keywords
  for (const wr of workspaceRoles || []) {
    if (
      wr?.name &&
      typeof wr.name === 'string' &&
      /\bdev\b|develop|back-?end|front-?end|full-?stack|dev\s*ops/i.test(wr.name.trim())
    ) {
      const canonical = wr.name.trim();
      if (!roleNameMap.has(canonical.toLowerCase())) {
        roleNameMap.set(canonical.toLowerCase(), canonical);
      }
    }
  }

  // 3. Discover roles from allUsers where role includes dev-related keywords
  for (const u of allUsers || []) {
    for (const r of u?.roles || []) {
      if (
        typeof r === 'string' &&
        /\bdev\b|develop|back-?end|front-?end|full-?stack|dev\s*ops/i.test(r.trim())
      ) {
        const canonical = r.trim();
        if (!roleNameMap.has(canonical.toLowerCase())) {
          roleNameMap.set(canonical.toLowerCase(), canonical);
        }
      }
    }
  }

  // Initial pre-fetch fallback only before DB teams/roles/users arrive
  if (
    roleNameMap.size === 0 &&
    workspaceTeams.length === 0 &&
    allUsers.length === 0 &&
    (workspaceRoles || []).length === 0
  ) {
    for (const r of ['Back-end Developer', 'Dev Ops', 'Developer', 'Harmony', 'Dev Project Manager']) {
      roleNameMap.set(r.toLowerCase(), r);
    }
  }

  const options: AuditorRoleOption[] = [
    { key: 'ALL', label: 'All', fullRole: 'ALL' },
  ];

  const sortedRoles = Array.from(roleNameMap.values()).sort((a, b) => a.localeCompare(b));

  for (const role of sortedRoles) {
    options.push({
      key: role,
      label: formatRoleShortLabel(role),
      fullRole: role,
    });
  }

  return options;
}

export const ADMIN_LIST_NAMES = new Set([
  'admin | jenesia red',
  'harmony',
  'jenesia red',
  'jenesia red | personal',
  'snaply',
  'vip scale',
  'xfnite',
]);

const HIDDEN_DEFAULT_FOLDER_KEYWORDS = [
  'admin',
  'dormant',
  'startups',
  'human resource',
];

/**
 * Returns true if a task belongs to Admin, Dormant Clients, Startups, or Human Resource
 * folders (or known Admin lists), which are hidden from Available Tasks by default.
 */
export function isTaskUnderAdmin(task?: Pick<TaskMapItem, 'isAdminTask' | 'list'> | null): boolean {
  if (!task) return false;
  if (task.isAdminTask) return true;
  const folderName = (task.list?.folder?.name || '').trim().toLowerCase();
  const listName = (task.list?.name || '').trim().toLowerCase();
  return (
    folderName === 'admin' ||
    HIDDEN_DEFAULT_FOLDER_KEYWORDS.some((kw) => folderName.includes(kw)) ||
    listName === 'admin' ||
    ADMIN_LIST_NAMES.has(listName)
  );
}

/**
 * Returns true if a task belongs to a dormant client (folder name contains "dormant"
 * or list name matches dormant patterns).
 */
export function isDormantClientTask(task?: Pick<TaskMapItem, 'list'> | null): boolean {
  if (!task) return false;
  const folderName = (task.list?.folder?.name || '').trim().toLowerCase();
  if (folderName.includes('dormant')) return true;
  const listName = (task.list?.name || '').trim().toLowerCase();
  if (listName.includes('dormant')) return true;
  return false;
}

/**
 * Returns true if a task belongs to an active client within the "Client Dashboard"
 * folder/space (and is strictly not dormant, admin, startups, or human resource).
 */
export function isTaskInClientDashboard(
  task?: Pick<TaskMapItem, 'isAdminTask' | 'list'> | null,
  clientDashboardLists?: Array<{ id: string; name: string }>
): boolean {
  if (!task) return false;
  if (task.isAdminTask) return false;

  const folderName = (task.list?.folder?.name || '').trim().toLowerCase();
  const listName = (task.list?.name || '').trim().toLowerCase();

  // 1. Explicit exclusion: dormant clients
  if (folderName.includes('dormant') || listName.includes('dormant')) {
    return false;
  }

  // 2. Explicit exclusion: admin lists or other internal folders (startups, HR, admin)
  if (
    folderName === 'admin' ||
    folderName.includes('admin') ||
    folderName.includes('startup') ||
    folderName.includes('human resource') ||
    listName === 'admin' ||
    ADMIN_LIST_NAMES.has(listName)
  ) {
    return false;
  }

  // 3. Positive check: folder is directly "Client Dashboard"
  if (folderName.includes('client dashboard')) {
    return true;
  }

  // 4. Verification against known Client Dashboard lists (from database/tree)
  if (clientDashboardLists && clientDashboardLists.length > 0) {
    const listId = task.list?.id;
    return clientDashboardLists.some(
      (c) =>
        (listId && c.id === listId) ||
        (listName && c.name.trim().toLowerCase() === listName)
    );
  }

  return false;
}

/**
 * Returns true when a task has spreadsheet input recorded for an MA
 * (logged today, recently active without timeOut, or present on a historical snapshot).
 */
export function hasSpreadsheetTaskInput(
  task?: TaskMapItem | null,
  options?: { isHistory?: boolean; now?: Date }
): boolean {
  const prog = task?.progress;
  if (!prog?.maName) return false;
  if (!prog.timeIn && !prog.timeOut && !prog.isMissingTime) return false;
  if (options?.isHistory) return true;
  const now = options?.now ?? new Date();
  const isRecentActive = Boolean(
    prog.timeIn &&
    !prog.timeOut &&
    (!prog.updatedAt || now.getTime() - new Date(prog.updatedAt).getTime() <= 14 * 60 * 60 * 1000)
  );
  return isProgressLoggedToday(prog, now) || isRecentActive;
}

export function isDeveloperUser(user: any, workspaceTeams: any[] = []): boolean {
  if (!user) return false;
  const userRoles = (user.roles || []) as string[];
  if (userRoles.length === 0) return false;

  const devRoles = extractDeveloperRoles(workspaceTeams, []);
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const devRoleNorms = devRoles
    .filter((r) => r.key !== 'ALL')
    .map((r) => normalize(r.fullRole));

  return userRoles.some((ur) => {
    if (typeof ur !== 'string') return false;
    const normUr = normalize(ur);
    if (!normUr) return false;
    return devRoleNorms.some((dr) => dr === normUr || normUr.includes(dr) || dr.includes(normUr));
  });
}

const DYNAMIC_ROLE_BADGE_PALETTE = [
  'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/70 dark:text-pink-300 dark:border-pink-800/60',
  'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800/60',
  'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/60',
  'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/70 dark:text-cyan-300 dark:border-cyan-800/60',
  'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/60',
  'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/70 dark:text-violet-300 dark:border-violet-800/60',
  'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/70 dark:text-fuchsia-300 dark:border-fuchsia-800/60',
  'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800/60',
  'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800/60',
  'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-800/60',
  'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800/60',
  'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800/60',
];

export function formatRoleShortLabel(roleName: string): string {
  const clean = (roleName || '').trim();
  if (!clean) return '';
  if (ROLE_SHORT_NAMES[clean]) return ROLE_SHORT_NAMES[clean];
  const ciMatch = Object.entries(ROLE_SHORT_NAMES).find(
    ([k]) => k.toLowerCase() === clean.toLowerCase()
  );
  if (ciMatch) return ciMatch[1];

  return clean
    .replace(/\bproject\s+manager\b/gi, 'PM')
    .replace(/\bproduction\b/gi, 'Prod')
    .replace(/\bdeveloper\b/gi, 'Dev')
    .replace(/\bauditor\b/gi, 'Aud')
    .replace(/\bstrategist\b/gi, 'Strat')
    .replace(/\bgeneration\b/gi, 'Gen')
    .trim();
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
  if (!r || r === 'member') return 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700/60';

  let hash = 0;
  for (let i = 0; i < r.length; i++) {
    hash = (hash * 31 + r.charCodeAt(i)) >>> 0;
  }
  return DYNAMIC_ROLE_BADGE_PALETTE[hash % DYNAMIC_ROLE_BADGE_PALETTE.length];
}

export function getUserRoleDefinition(
  user: any,
  workspaceTeams: any[] = [],
  workspaceRoles: any[] = []
): UserRoleMapping & { badgeClass: string; teamName?: string | null; teamRoles?: string[] } {
  // Build canonical DB role names from WorkspaceRole and TeamRole records
  const canonicalRoleNames = new Map<string, string>();
  for (const wr of workspaceRoles || []) {
    if (wr?.name && typeof wr.name === 'string') {
      canonicalRoleNames.set(wr.name.trim().toLowerCase(), wr.name.trim());
    }
  }
  for (const team of workspaceTeams || []) {
    for (const tr of team?.teamRoles || []) {
      if (tr?.name && typeof tr.name === 'string') {
        const key = tr.name.trim().toLowerCase();
        if (!canonicalRoleNames.has(key)) canonicalRoleNames.set(key, tr.name.trim());
      }
    }
  }

  const matchedTeam =
    (user?.teamId && (workspaceTeams || []).find((t: any) => t?.id === user.teamId)) ||
    (user?.team?.id && (workspaceTeams || []).find((t: any) => t?.id === user.team.id)) ||
    user?.team ||
    null;

  const teamName: string = matchedTeam?.name || user?.team?.name || '';
  const dbTeamRoles: string[] = Array.isArray(matchedTeam?.teamRoles)
    ? matchedTeam.teamRoles.map((tr: any) => tr?.name).filter(Boolean)
    : [];

  for (const trName of dbTeamRoles) {
    const key = trName.trim().toLowerCase();
    if (!canonicalRoleNames.has(key)) canonicalRoleNames.set(key, trName.trim());
  }

  // Merge explicit DB user.roles (preserving roles[0] as Main Role) with DB canonical casing,
  // falling back to DB teamRoles if user.roles is empty
  const rawUserRoles: string[] = Array.isArray(user?.roles)
    ? user.roles.filter((r: any) => typeof r === 'string' && r.trim())
    : [];

  const mergedRoles: string[] = [];
  const seenRoles = new Set<string>();
  const pushRole = (raw: string) => {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    if (!lower || seenRoles.has(lower)) return;
    seenRoles.add(lower);
    mergedRoles.push(canonicalRoleNames.get(lower) || trimmed);
  };

  rawUserRoles.forEach(pushRole);
  if (mergedRoles.length === 0) {
    dbTeamRoles.forEach(pushRole);
  }

  let mainRole = mergedRoles[0] || teamName;
  if (!mainRole) {
    mainRole = user?.systemRole === 'ADMIN' ? 'Super Admin' : 'Member';
  }

  const resolvedRoles = mergedRoles.length > 0 ? mergedRoles : [mainRole];
  const shortRole = formatRoleShortLabel(mainRole) || mainRole;
  const secondaryRoles = resolvedRoles.length > 1 ? resolvedRoles.slice(1) : [];

  return {
    mainRole,
    mainRoleShort: shortRole,
    roles: resolvedRoles,
    secondaryRoles,
    badgeClass: getRoleBadgeClass(mainRole),
    teamName: teamName || null,
    teamRoles: dbTeamRoles,
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
  taskStatus?: string | null;
  priority?: string | null;
  subStatuses?: string[] | null;
  taskId?: string | null;
  listId?: string | null;
  listStatuses?: ListStatusToken[];
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
  const rawEffectiveStatus = params?.taskStatus || assumedStatus;
  const rawNorm = rawEffectiveStatus.trim().toUpperCase().replace(/[\s_-]+/g, '');
  const isCadenceAssumed = ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].some(
    (c) => rawNorm === c || rawNorm.includes(c)
  );
  const isLiveAssumed = Boolean(params?.timeIn && !params?.timeOut);
  const effectiveStatus =
    isLiveAssumed && !isCadenceAssumed && rawNorm !== 'CLOSED' && rawNorm !== 'DONE'
      ? 'IN PROGRESS'
      : rawEffectiveStatus;
  const effectiveListId =
    params?.listId && params.listId !== 'general' ? params.listId : 'general';
  const effectiveSubStatuses = Array.isArray(params?.subStatuses)
    ? params.subStatuses
    : getDefaultTaskMapSubStatuses(effectiveStatus);
  const id = `general-slot-${params?.userId || 'user'}`;

  return {
    id,
    title: assumedTitle,
    description: null,
    priority: params?.priority || 'NORMAL',
    listId: effectiveListId,
    status: effectiveStatus,
    dueDate: null,
    startDate: null,
    position: -1,
    assigneeId: params?.userId || null,
    assigneeRoleRestrictions: [],
    teamAssignAccessRole: null,
    list: {
      id: effectiveListId,
      name: assumedClient,
      ...(Array.isArray(params?.listStatuses) ? { statuses: params.listStatuses } : {}),
    },
    assignee: params?.userId ? { id: params.userId, name: params.userName || 'Team Member' } : null,
    assignees: params?.userId ? [{ id: params.userId, name: params.userName || 'Team Member' }] : [],
    creator: null,
    subtasks: [],
    taskMap: {
      id: `map-${id}`,
      taskId: params?.taskId || id,
      subtaskId: null,
      statuses: effectiveSubStatuses,
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
    linkedTaskId: params?.taskId || null,
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
  getCompletedAuditActorIds,
  getTaskAuditStatus,
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

/** Maps task-map sub-status labels to the main (Prisma ListStatus) status they transition to. */
const SUB_STATUS_DB_ALIAS: Record<string, string> = {
  REVISION: 'REVISION',
  REVISIONS: 'REVISION',
  WAITING: 'WAITING',
  SENT: 'WAITING',
  SENTBUTWAITING: 'WAITING',
  ONHOLD: 'ON-HOLD',
  TOREVIEW: 'IN REVIEW',
  TOSEND: 'CRM',
  READYTOSEND: 'CRM',
  CLOSED: 'CLOSED',
};

/**
 * Resolve a sub-status dropdown color from the DB list statuses (Prisma ListStatus.color)
 * so CRM / Audit / Task Map dropdowns match the main status color. Falls back to the given hex.
 */
export function resolveDbStatusColor(
  label: string,
  fallback: string,
  listStatuses?: Array<ListStatusToken | { name?: string; color?: string | null }> | null
): string {
  const norm = (label || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const target = SUB_STATUS_DB_ALIAS[norm];
  if (!target || !Array.isArray(listStatuses)) return fallback;
  const targetNorm = target.replace(/[\s_-]+/g, '');
  const hit = listStatuses.find(
    (s: any) => ((s?.name || '') as string).trim().toUpperCase().replace(/[\s_-]+/g, '') === targetNorm
  );
  const color = hit?.color?.trim();
  return color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : fallback;
}
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
 * Unassigned active Task Map pool tasks default to ['Available Task'], while assigned column tasks,
 * Auditor queue (IN REVIEW / CHECKING), and closed tasks stay clean unless explicitly tagged.
 */
export function getDefaultTaskMapSubStatuses(
  taskStatus?: string | null,
  options?: { isAssigned?: boolean }
): string[] {
  const canonical = toCanonicalTaskStatus(taskStatus);
  if (canonical === 'CRM') return ['To send'];
  if (canonical === 'WAITING') return ['Sent but Waiting'];
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
  if (options?.isAssigned) {
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

/**
 * Returns true if the task status is strictly an IN REVIEW status.
 */
export function isLaunchReviewStatus(status?: string | null): boolean {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return (
    s === 'INREVIEW' ||
    s === 'TOREVIEW' ||
    s === 'REVIEW' ||
    s === 'UNDERREVIEW' ||
    s === 'FORREVIEW'
  );
}

/**
 * Extracts a canonical YYYY-MM-DD key normalized to Asia/Manila (UTC+8)
 * without off-by-one UTC midnight shifts.
 */
export function getManilaDateKey(input?: Date | string | null): string | null {
  if (!input) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  try {
    const d = typeof input === 'string' ? new Date(input) : input;
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return null;
  }
}

export function getTaskEffectiveLaunchDate(
  task?: {
    launchMeta?: LaunchMeta | null;
    effectiveLaunchDate?: string | null;
    dueDate?: string | null;
  } | null
): string | null {
  if (!task) return null;
  const metaDate = task.launchMeta?.launchDate;
  if (metaDate && /^\d{4}-\d{2}-\d{2}/.test(metaDate)) return metaDate.slice(0, 10);
  if (task.launchMeta?.targetPeriod) return null;
  if (task.effectiveLaunchDate && /^\d{4}-\d{2}-\d{2}/.test(task.effectiveLaunchDate)) {
    return task.effectiveLaunchDate.slice(0, 10);
  }
  return getManilaDateKey(task.dueDate);
}

export function getTaskLaunchTargetPeriod(
  task?: {
    launchMeta?: LaunchMeta | null;
    targetPeriod?: string | null;
  } | null
): string | null {
  if (!task) return null;
  const tp = task.launchMeta?.targetPeriod || task.targetPeriod;
  return tp && tp.trim() ? tp.trim() : null;
}

export function mergeTaskAssignees(
  task?: {
    assignee?: LaunchMapAssignee | null;
    assignees?: LaunchMapAssignee[] | null;
  } | null
): LaunchMapAssignee[] {
  if (!task) return [];
  const map = new Map<string, LaunchMapAssignee>();
  for (const a of task.assignees || []) {
    if (a?.id) map.set(a.id, a);
  }
  if (task.assignee?.id && !map.has(task.assignee.id)) {
    map.set(task.assignee.id, task.assignee);
  }
  return Array.from(map.values());
}

interface ClientTreeList {
  id?: string;
  name?: string;
}

interface ClientTreeFolder {
  name?: string;
  lists?: ClientTreeList[];
  subfolders?: ClientTreeFolder[];
}

interface ClientTreeSpace {
  name?: string;
  lists?: ClientTreeList[];
  folders?: ClientTreeFolder[];
}

interface ClientListEntry {
  folderName?: string;
  spaceName?: string;
  list?: ClientTreeList;
}

/**
 * Collects all client lists residing under any "Client Dashboard" space/folder in the sidebar tree.
 */
export function collectClientDashboardLists(
  spaces: ClientTreeSpace[] = [],
  allLists: ClientListEntry[] = []
): Array<{ id: string; name: string }> {
  const clientMap = new Map<string, { id: string; name: string }>();

  const walkFolders = (folders: ClientTreeFolder[], inClientTree = false) => {
    for (const f of folders || []) {
      const isClient = inClientTree || (f.name || '').trim().toLowerCase().includes('client dashboard');
      if (isClient) {
        (f.lists || []).forEach((l) => {
          if (l?.id && l?.name && !clientMap.has(l.id)) {
            clientMap.set(l.id, { id: l.id, name: l.name });
          }
        });
      }
      if (f.subfolders) walkFolders(f.subfolders, isClient);
    }
  };

  for (const s of spaces || []) {
    const isClientSpace = (s.name || '').trim().toLowerCase().includes('client dashboard');
    if (isClientSpace) {
      (s.lists || []).forEach((l) => {
        if (l?.id && l?.name && !clientMap.has(l.id)) {
          clientMap.set(l.id, { id: l.id, name: l.name });
        }
      });
    }
    walkFolders(s.folders || [], isClientSpace);
  }

  for (const item of allLists || []) {
    const folderName = (item.folderName || '').toLowerCase();
    const spaceName = (item.spaceName || '').toLowerCase();
    if (folderName.includes('client dashboard') || spaceName.includes('client dashboard')) {
      const l = item.list;
      if (l?.id && l?.name && !clientMap.has(l.id)) {
        clientMap.set(l.id, { id: l.id, name: l.name });
      }
    }
  }

  return Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getCrmFollowUpRule(daysPassed: number): CrmFollowUpRule {
  if (daysPassed >= 7) {
    return {
      tier: 'SEVENTH_PLUS',
      label: '7th Day+',
      colorName: 'violet',
      hex: '#8b5cf6',
      breathe: true,
      requiresModal: true,
    };
  }
  if (daysPassed >= 5) {
    return {
      tier: 'FIFTH_DAY',
      label: '5th Day',
      colorName: 'red',
      hex: '#ef4444',
      breathe: true,
      requiresModal: true,
    };
  }
  if (daysPassed >= 3) {
    return {
      tier: 'THIRD_DAY',
      label: '3rd Day',
      colorName: 'orange',
      hex: '#f97316',
      breathe: true,
      requiresModal: daysPassed >= 4,
    };
  }
  if (daysPassed >= 1) {
    return {
      tier: 'NEXT_DAY',
      label: 'Next Day',
      colorName: 'yellow',
      hex: '#eab308',
      breathe: true,
      requiresModal: false,
    };
  }
  return {
    tier: 'TODAY',
    label: 'Today',
    colorName: 'neutral',
    hex: '#71717a',
    breathe: false,
    requiresModal: false,
  };
}

export function getManilaCalendarDaysPassed(
  sinceInput?: Date | string | null,
  now: Date = new Date()
): number {
  if (!sinceInput) return 0;
  const sinceStr = getManilaDateKey(sinceInput);
  const todayStr = getManilaDateKey(now);
  if (!sinceStr || !todayStr) return 0;
  const [sy, sm, sd] = sinceStr.split('-').map(Number);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  if (!sy || !sm || !sd || !ty || !tm || !td) return 0;
  const sinceUtc = Date.UTC(sy, sm - 1, sd);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.floor((todayUtc - sinceUtc) / 86_400_000));
}

export function getTaskCrmWaitingInfo(task: TaskMapItem, now: Date = new Date()): CrmWaitingMeta {
  const revs = parseTaskPmReviewsList(task);
  const meta = revs.find((r: any) => r && r.type === 'CRM_WAITING_META');

  if (task.crmWaitingMeta?.waitingSince) {
    const effectiveSince =
      task.crmWaitingMeta.lastResponseAt ||
      meta?.lastResponseAt ||
      task.crmWaitingMeta.waitingSince;
    const daysPassed = getManilaCalendarDaysPassed(effectiveSince, now);
    return {
      ...task.crmWaitingMeta,
      daysPassed,
      rule: getCrmFollowUpRule(daysPassed),
    };
  }

  const waitingSince =
    meta?.waitingSince ||
    task.taskMap?.updatedAt ||
    task.updatedAt ||
    task.createdAt ||
    new Date().toISOString();
  const effectiveSince = meta?.lastResponseAt || waitingSince;
  const daysPassed = getManilaCalendarDaysPassed(effectiveSince, now);

  return {
    waitingSince,
    daysPassed,
    rule: getCrmFollowUpRule(daysPassed),
    lastResponseAt: meta?.lastResponseAt || null,
    lastResponseByName: meta?.lastResponseByName || null,
    lastResponseNote: meta?.lastResponseNote || null,
    lastResponseAction: meta?.lastResponseAction || null,
  };
}




export function attachDragToScroll(container: HTMLElement): () => void {
  let isMouseDown = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let rafId: number | null = null;
  let pendingScrollLeft: number | null = null;
  let prevScrollBehavior = '';

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;

    const rect = container.getBoundingClientRect();
    const isHorizontalScrollbarClick =
      e.clientY >= rect.top + container.clientTop + container.clientHeight - 4;
    const isVerticalScrollbarClick =
      e.clientX >= rect.left + container.clientLeft + container.clientWidth - 4;
    if (isHorizontalScrollbarClick || isVerticalScrollbarClick) {
      return;
    }

    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (
      target.closest('button, input, textarea, select, option, label, a') ||
      target.closest('[data-kanban-card], [data-task-id], [data-column-header], [data-group-drag-handle], [data-in-progress-dropzone], [data-no-drag-scroll]') ||
      target.closest('[role="dialog"], [role="menu"], [data-portal], [draggable="true"], [aria-roledescription="draggable"], .no-board-drag, .no-drag-scroll')
    ) {
      return;
    }

    isMouseDown = true;
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
    startScrollLeft = container.scrollLeft;
  };

  const flushScroll = () => {
    rafId = null;
    if (pendingScrollLeft !== null) {
      container.scrollLeft = pendingScrollLeft;
      pendingScrollLeft = null;
    }
  };

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (!isMouseDown) return;

    if ((moveEvent.buttons & 1) === 0 && (moveEvent.buttons & 4) === 0) {
      onMouseUp();
      return;
    }

    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;

    if (!isDragging) {
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        isDragging = true;
        prevScrollBehavior = container.style.scrollBehavior;
        container.style.scrollBehavior = 'auto';
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      } else {
        return;
      }
    }

    moveEvent.preventDefault();
    pendingScrollLeft = startScrollLeft - dx;
    if (rafId === null) {
      rafId = window.requestAnimationFrame(flushScroll);
    }
  };

  const onMouseUp = () => {
    if (!isMouseDown) return;
    isMouseDown = false;

    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (pendingScrollLeft !== null) {
      container.scrollLeft = pendingScrollLeft;
      pendingScrollLeft = null;
    }

    if (isDragging) {
      isDragging = false;
      container.style.scrollBehavior = prevScrollBehavior;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const captureClick = (clickEvent: MouseEvent) => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
        window.removeEventListener('click', captureClick, true);
      };
      window.addEventListener('click', captureClick, true);
    }
  };

  container.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove, { passive: false });
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onMouseUp);

  return () => {
    container.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('blur', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
}
