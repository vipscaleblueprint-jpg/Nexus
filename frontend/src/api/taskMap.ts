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
  startedAt: string;
  stoppedAt?: string | null;
  timeOut?: string | null;
  active?: boolean;
  isManuallyMarkedUpwork?: boolean;
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
  maActiveSessions?: Record<string, any>;
}

export const taskMapApi = {
  getData: async (params?: { shift?: string; date?: string; search?: string; client?: string }): Promise<TaskMapDataResponse> => {
    const q = new URLSearchParams();
    if (params?.shift) q.set('shift', params.shift);
    if (params?.date) q.set('date', params.date);
    if (params?.search) q.set('search', params.search);
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

  getUpworkClients: async (): Promise<{ success: boolean; clients: string[] }> => {
    return apiClient<{ success: boolean; clients: string[] }>(`/api/task-map/upwork-clients?_t=${Date.now()}`);
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
  const standardAuditorRoles = ['UI UX Auditor', 'Design Auditor', 'Funnel Auditor', 'Instruction Auditor'];
  for (const r of standardAuditorRoles) {
    if (!roleNameMap.has(r.toLowerCase())) {
      roleNameMap.set(r.toLowerCase(), r);
    }
  }

  const formatLabel = (roleName: string) => {
    const clean = roleName.trim();
    if (/^ui\s*\/?\s*ux\s*(auditor|audit)?$/i.test(clean)) return 'UI/UX';
    if (/^funnel\s*(auditor|audit)$/i.test(clean)) return 'Funnel Audit';
    if (/^design\s*(auditor|audit)$/i.test(clean)) return 'Design';
    if (/^instruction\s*(auditor|audit)$/i.test(clean)) return 'Instruction';
    return clean.replace(/\s+(auditor|audit)$/i, '').trim() || clean;
  };

  const options: AuditorRoleOption[] = [
    { key: 'ALL', label: 'All', fullRole: 'ALL' },
  ];

  const orderWeight = (k: string) => {
    const l = k.toLowerCase();
    if (l.includes('ui') || l.includes('ux')) return 1;
    if (l.includes('design')) return 2;
    if (l.includes('funnel')) return 3;
    if (l.includes('instruction')) return 4;
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
  if (r.includes('design aud')) return 'bg-pink-950/70 text-pink-300 border-pink-800/60';
  if (r.includes('design') || r.includes('3d')) return 'bg-pink-950/70 text-pink-300 border-pink-800/60';
  if (r.includes('prod pm') || r.includes('production project manager')) return 'bg-orange-950/70 text-orange-300 border-orange-800/60';
  if (r.includes('prod')) return 'bg-orange-950/70 text-orange-300 border-orange-800/60';
  if (r.includes('funnel aud')) return 'bg-amber-950/70 text-amber-300 border-amber-800/60';
  if (r.includes('funnel strat')) return 'bg-amber-950/70 text-amber-300 border-amber-800/60';
  if (r.includes('funnel')) return 'bg-amber-950/70 text-amber-300 border-amber-800/60';
  if (r.includes('ui ux') || r.includes('ui/ux') || r.includes('ui/ux aud')) return 'bg-cyan-950/70 text-cyan-300 border-cyan-800/60';
  if (r.includes('instruction')) return 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60';
  if (r.includes('lead gen') || r.includes('lead generation')) return 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60';
  if (r.includes('dev pm') || r.includes('dev project manager')) return 'bg-violet-950/70 text-violet-300 border-violet-800/60';
  if (r.includes('pm') || r.includes('project manager')) return 'bg-violet-950/70 text-violet-300 border-violet-800/60';
  if (r.includes('crm') || r.includes('client relationship')) return 'bg-[#22A3AE]/20 text-[#22A3AE] border-[#22A3AE]/40';
  if (r.includes('sales')) return 'bg-amber-950/70 text-amber-300 border-amber-800/60';
  if (r.includes('marketing')) return 'bg-fuchsia-950/70 text-fuchsia-300 border-fuchsia-800/60';
  if (r.includes('senior')) return 'bg-yellow-950/70 text-yellow-300 border-yellow-800/60';
  if (r.includes('harmony')) return 'bg-indigo-950/70 text-indigo-300 border-indigo-800/60';
  if (r.includes('dev ops') || r.includes('devops')) return 'bg-indigo-950/70 text-indigo-300 border-indigo-800/60';
  if (r.includes('backend') || r.includes('back-end')) return 'bg-blue-950/70 text-blue-300 border-blue-800/60';
  if (r.includes('dev') && !r.includes('dev ops')) return 'bg-sky-950/70 text-sky-300 border-sky-800/60';
  if (r.includes('ai dir') || r.includes('ai director') || r.includes('ai scene')) return 'bg-teal-950/70 text-teal-300 border-teal-800/60';
  if (r.includes('cyber sec') || r.includes('cybersecurity')) return 'bg-red-950/70 text-red-300 border-red-800/60';
  if (r.includes('motion')) return 'bg-purple-950/70 text-purple-300 border-purple-800/60';
  if (r.includes('super admin') || r.includes('admin')) return 'bg-rose-950/70 text-rose-300 border-rose-800/60';
  return 'bg-zinc-800 text-zinc-300 border-zinc-700/60';
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
