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
  memberIds?: string[];
  memberNames?: string[];
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
  taskDeliverablesDescription?: string | null;
  taskUpdateAndDeliverables?: string | null;
  dailySheetLogId?: string;
  isLive?: boolean;
  startedAt?: string | null;
  dateKey?: string;
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
  /** AI / PM estimate in hours; null means the 30-minute default applies. */
  estimatedHours?: number | null;
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
  externalId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Extracts candidate Nexus / ClickUp task IDs from a pasted URL or raw ID string.
 */
export function extractTaskLinkIdentifiers(query?: string | null): {
  isLink: boolean;
  ids: string[];
} {
  const raw = (query || '').trim();
  if (!raw) return { isLink: false, ids: [] };

  const ids = new Set<string>();
  let isLink = false;

  const isUrlLike =
    /^https?:\/\//i.test(raw) ||
    raw.startsWith('/') ||
    raw.startsWith('?') ||
    /(?:nexus\.vipscaleph\.com|app\.clickup\.com)/i.test(raw);

  if (isUrlLike) {
    isLink = true;
    try {
      const normalizedUrl =
        raw.startsWith('/') || raw.startsWith('?')
          ? new URL(raw, 'https://nexus.vipscaleph.com')
          : /^https?:\/\//i.test(raw)
            ? new URL(raw)
            : new URL(`https://${raw}`);

      const taskParam = normalizedUrl.searchParams.get('task');
      const subtaskParam = normalizedUrl.searchParams.get('subtask');
      if (taskParam) ids.add(taskParam.trim().toLowerCase());
      if (subtaskParam) ids.add(subtaskParam.trim().toLowerCase());

      const nexusTaskMatch = normalizedUrl.pathname.match(/\/tasks\/([a-zA-Z0-9_-]+)/i);
      if (nexusTaskMatch?.[1]) ids.add(nexusTaskMatch[1].trim().toLowerCase());

      // ClickUp URLs: https://app.clickup.com/t/<taskId> or /t/<teamId>/<customTaskId>
      const clickupSegments = normalizedUrl.pathname.match(/\/t\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/i);
      if (clickupSegments?.[1]) ids.add(clickupSegments[1].trim().toLowerCase());
      if (clickupSegments?.[2]) ids.add(clickupSegments[2].trim().toLowerCase());
    } catch {
      // Fall back to regex extraction for partial/malformed URLs
      const paramMatches = raw.matchAll(/[?&](?:task|subtask)=([a-zA-Z0-9_-]+)/gi);
      for (const m of paramMatches) {
        if (m[1]) ids.add(m[1].trim().toLowerCase());
      }
      const pathMatch = raw.match(/\/(?:tasks|t)\/([a-zA-Z0-9_-]+)/i);
      if (pathMatch?.[1]) ids.add(pathMatch[1].trim().toLowerCase());
    }
  } else if (/^[a-zA-Z0-9_-]{6,}$/.test(raw)) {
    // Also support pasting a raw Nexus/ClickUp task ID directly
    ids.add(raw.toLowerCase());
  }

  return { isLink, ids: Array.from(ids) };
}

/**
 * Returns true if a task (or its subtask/parent/external ClickUp ID) matches a pasted task link or ID.
 */
export function matchesTaskLinkOrId(
  task: Partial<TaskMapItem> | null | undefined,
  query?: string | null
): boolean {
  if (!task || !query) return false;
  const { isLink, ids } = extractTaskLinkIdentifiers(query);
  if (ids.length === 0) return false;

  const taskCandidates = [
    task.id,
    task.subtaskId,
    task.parentTaskId,
    task.externalId,
  ]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());

  if (taskCandidates.some((c) => ids.includes(c))) {
    return true;
  }

  // If it's a raw ID (not a URL), allow prefix/substring matching on IDs of length >= 6
  if (!isLink && ids.length === 1 && ids[0].length >= 6) {
    return taskCandidates.some((c) => c.includes(ids[0]));
  }

  return false;
}

/** Header user-visibility filter: ALL users, LIVE (live-working clocked in), ACTIVE (on-shift with latest spreadsheet row in current shift window). */
export type TrackFilter = 'ALL' | 'LIVE' | 'ACTIVE';

/**
 * True when a progress/daily-log row is dated for the target date (Manila, defaults to today).
 * Accepts YYYY-MM-DD, ISO strings, or M/D/YYYY sheet dates; falls back to `updatedAt` when the row has no date.
 */
export function isProgressLoggedToday(
  prog?: { date?: string | null; updatedAt?: string | null } | null,
  nowOrTargetDate: Date | string = new Date()
): boolean {
  if (!prog) return false;
  const targetDateKey = getManilaDateKey(nowOrTargetDate);
  if (!targetDateKey) return false;

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
  return !!key && key === targetDateKey;
}

/**
 * Returns Manila (Asia/Manila, UTC+8) calendar date key and hour/minute components for `now`.
 */
export function getManilaTimeParts(now: Date = new Date()): {
  dateKey: string;
  hour: number;
  minute: number;
  totalMinutes: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  let hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  if (hour === 24) hour = 0;

  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

/**
 * Shifts a `YYYY-MM-DD` date key by `deltaDays` (e.g. -1 for yesterday, +1 for tomorrow).
 */
export function shiftDateKeyByDays(dateKey: string, deltaDays: number): string {
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/**
 * Computes the current shift window [startMs, endMs] in Manila time, properly handling
 * overnight/night shifts (where endHour < startHour, e.g. 5 PM - 2 AM or 8 PM - 5 AM).
 */
export function getShiftWindowBounds(
  shift: Pick<TaskMapShift, 'startHour' | 'startMinute' | 'endHour' | 'endMinute'>,
  now: Date = new Date()
): { isWithinShift: boolean; startMs: number; endMs: number } {
  const { dateKey, totalMinutes } = getManilaTimeParts(now);
  const startMin = shift.startMinute || 0;
  const endMin = shift.endMinute || 0;
  const startTotal = shift.startHour * 60 + startMin;
  const endTotal = shift.endHour * 60 + endMin;

  let isWithinShift = false;
  let startDateKey = dateKey;
  let endDateKey = dateKey;

  if (startTotal <= endTotal) {
    isWithinShift = totalMinutes >= startTotal && totalMinutes < endTotal;
  } else {
    // Overnight / night shift crossing midnight
    isWithinShift = totalMinutes >= startTotal || totalMinutes < endTotal;
    if (totalMinutes < endTotal) {
      startDateKey = shiftDateKeyByDays(dateKey, -1);
      endDateKey = dateKey;
    } else {
      startDateKey = dateKey;
      endDateKey = shiftDateKeyByDays(dateKey, 1);
    }
  }

  const startIso = `${startDateKey}T${String(shift.startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00+08:00`;
  const endIso = `${endDateKey}T${String(shift.endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00+08:00`;
  return {
    isWithinShift,
    startMs: new Date(startIso).getTime(),
    endMs: new Date(endIso).getTime(),
  };
}

/**
 * Returns the configured active shifts that include `user` (by `memberIds` or `memberNames`).
 */
export function getUserConfiguredShifts(
  user?: { id?: string | null; name?: string | null } | null,
  shifts: TaskMapShift[] = []
): TaskMapShift[] {
  if (!user || !Array.isArray(shifts) || shifts.length === 0) return [];
  const uid = user.id || '';
  const nameLower = (user.name || '').trim().toLowerCase();
  const firstName = nameLower.split(/\s+/)[0] || '';

  return shifts.filter((s) => {
    if (s.isActive === false) return false;
    const ids = Array.isArray(s.memberIds) ? s.memberIds : [];
    if (uid && ids.includes(uid)) return true;
    const names = Array.isArray(s.memberNames)
      ? s.memberNames.map((n) => (n || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (!nameLower || names.length === 0) return false;
    return names.some(
      (n) =>
        n === nameLower ||
        nameLower.includes(n) ||
        n.includes(nameLower) ||
        (firstName.length >= 2 && n.split(/\s+/)[0] === firstName)
    );
  });
}

function parseClockTimeMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const m = String(timeStr)
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let hrs = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = (m[3] || '').toLowerCase();
  if (ampm === 'pm' && hrs < 12) hrs += 12;
  if (ampm === 'am' && hrs === 12) hrs = 0;
  if (hrs < 0 || hrs > 23 || mins < 0 || mins > 59) return null;
  return hrs * 60 + mins;
}

function resolveSheetRowDateKey(
  prog?: {
    date?: string | null;
    dateKey?: string | null;
    dateDisplay?: string | null;
    updatedAt?: string | null;
    submittedAt?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
  } | null
): string | null {
  if (!prog) return null;
  if (prog.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(prog.dateKey.trim())) {
    return prog.dateKey.trim();
  }
  const raw = (prog.date || prog.dateDisplay || '').trim();
  if (raw) {
    const sheet = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (sheet) return `${sheet[3]}-${sheet[1].padStart(2, '0')}-${sheet[2].padStart(2, '0')}`;
    const ymd = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    const hasTime = /\d{1,2}:\d{2}/.test(raw);
    const parsed = hasTime ? new Date(raw) : new Date(`${raw} 12:00:00`);
    const key = !isNaN(parsed.getTime()) ? getManilaDateKey(parsed) : getManilaDateKey(raw);
    if (key) return key;
  }
  for (const fallback of [prog.endedAt, prog.startedAt, prog.submittedAt, prog.updatedAt]) {
    if (fallback) {
      const key = getManilaDateKey(fallback);
      if (key) return key;
    }
  }
  return null;
}

/**
 * Resolves the latest timestamp (ms) represented by a spreadsheet progress row.
 * Uses timeOut/endedAt if present, else timeIn/startedAt, else submittedAt/updatedAt.
 */
export function getProgressRowTimestampMs(
  prog?: {
    date?: string | null;
    dateKey?: string | null;
    dateDisplay?: string | null;
    timeIn?: string | null;
    timeOut?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    updatedAt?: string | null;
    submittedAt?: string | null;
  } | null
): number | null {
  if (!prog) return null;
  const dateKey = resolveSheetRowDateKey(prog);
  const inMins = parseClockTimeMinutes(prog.timeIn);
  const outMins = parseClockTimeMinutes(prog.timeOut);

  if (dateKey && outMins !== null) {
    const effectiveOutDateKey =
      inMins !== null && outMins < inMins ? shiftDateKeyByDays(dateKey, 1) : dateKey;
    const h = Math.floor(outMins / 60);
    const m = outMins % 60;
    const ms = new Date(
      `${effectiveOutDateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`
    ).getTime();
    if (!isNaN(ms)) return ms;
  }
  if (prog.endedAt) {
    const ms = new Date(prog.endedAt).getTime();
    if (!isNaN(ms)) return ms;
  }
  if (dateKey && inMins !== null) {
    const h = Math.floor(inMins / 60);
    const m = inMins % 60;
    const ms = new Date(
      `${dateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`
    ).getTime();
    if (!isNaN(ms)) return ms;
  }
  for (const fallback of [prog.startedAt, prog.submittedAt, prog.updatedAt]) {
    if (fallback) {
      const ms = new Date(fallback).getTime();
      if (!isNaN(ms)) return ms;
    }
  }
  return null;
}

/**
 * Shift-aware check for the Task Map ACTIVE filter.
 * Determines whether a spreadsheet progress row belongs to the user's current shift window
 * (properly supporting overnight/night shifts that cross midnight) rather than naively comparing
 * against today's calendar date.
 */
export function isProgressActiveForShift(
  prog?: {
    date?: string | null;
    dateKey?: string | null;
    dateDisplay?: string | null;
    timeIn?: string | null;
    timeOut?: string | null;
    isMissingTime?: boolean;
    isLive?: boolean;
    startedAt?: string | null;
    endedAt?: string | null;
    updatedAt?: string | null;
    submittedAt?: string | null;
  } | null,
  options?: {
    user?: { id?: string | null; name?: string | null } | null;
    shifts?: TaskMapShift[];
    activeShift?: string | null;
    now?: Date;
    targetDate?: Date | string | null;
    isHistory?: boolean;
    preShiftGraceMinutes?: number;
    postShiftGraceMinutes?: number;
  }
): boolean {
  if (!prog) return false;
  const hasRowActivity = Boolean(
    (prog.timeIn && String(prog.timeIn).trim()) ||
    (prog.timeOut && String(prog.timeOut).trim()) ||
    prog.isMissingTime ||
    prog.startedAt ||
    prog.endedAt
  );
  if (!hasRowActivity) return false;

  const now = options?.now ?? new Date();
  const todayKey = getManilaDateKey(now);
  const targetKey = options?.targetDate ? getManilaDateKey(options.targetDate) : todayKey;
  if (options?.isHistory || (targetKey && todayKey && targetKey !== todayKey)) {
    return isProgressLoggedToday(prog, options?.targetDate ?? now);
  }

  const rowTs = getProgressRowTimestampMs(prog);
  if (rowTs === null) return false;

  const nowMs = now.getTime();
  const preGraceMs = (options?.preShiftGraceMinutes ?? 120) * 60 * 1000;
  const postGraceMs = (options?.postShiftGraceMinutes ?? 120) * 60 * 1000;

  // Resolve the most recent wall-clock submission timestamp as fallback when a sheet row's Date column wasn't updated after midnight
  const submittedMs = (() => {
    for (const ts of [prog.submittedAt, prog.updatedAt, prog.endedAt, prog.startedAt]) {
      if (ts) {
        const ms = new Date(ts).getTime();
        if (!isNaN(ms)) return ms;
      }
    }
    return null;
  })();

  // 1. Actively clocked-in live row (no timeOut) within max shift duration always counts as active
  const isLiveNow = Boolean(
    prog.timeIn &&
    String(prog.timeIn).trim() &&
    !(prog.timeOut && String(prog.timeOut).trim()) &&
    !prog.isMissingTime &&
    prog.isLive !== false &&
    (
      (nowMs - rowTs <= 14 * 60 * 60 * 1000 && rowTs <= nowMs + 15 * 60 * 1000) ||
      (submittedMs !== null && nowMs - submittedMs <= 14 * 60 * 60 * 1000 && submittedMs <= nowMs + 15 * 60 * 1000)
    )
  );
  if (isLiveNow) return true;

  // 2. Any spreadsheet row logged today (Manila calendar date) counts as ACTIVE,
  // even if the MA started early, worked overtime, or logged outside their configured shift hours
  const rowDateKey = resolveSheetRowDateKey(prog);
  if (todayKey && rowDateKey === todayKey) return true;
  if (todayKey && submittedMs !== null && getManilaDateKey(new Date(submittedMs)) === todayKey) return true;

  // 3. Overnight / previous-day rows: allow if within the user's configured shift window or active shift window
  const shifts = Array.isArray(options?.shifts) ? options.shifts : [];
  const userShifts = getUserConfiguredShifts(options?.user, shifts);

  if (userShifts.length > 0) {
    const inUserShift = userShifts.some((s) => {
      const bounds = getShiftWindowBounds(s, now);
      const isOnShiftNow = nowMs >= bounds.startMs - preGraceMs && nowMs <= bounds.endMs + postGraceMs;
      if (!isOnShiftNow) return false;
      return rowTs >= bounds.startMs - preGraceMs && rowTs <= bounds.endMs + postGraceMs;
    });
    if (inUserShift) return true;
  }

  // Fallback when user has no explicit shift assignment or worked cross-shift overnight: check active shift windows
  const activeShiftTokens = (options?.activeShift || '')
    .toUpperCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const activeShifts = shifts.filter((s) => {
    if (s.isActive === false) return false;
    const bounds = getShiftWindowBounds(s, now);
    if (nowMs >= bounds.startMs - preGraceMs && nowMs <= bounds.endMs + postGraceMs) return true;
    return activeShiftTokens.includes((s.shiftKey || '').toUpperCase().trim());
  });

  if (activeShifts.length > 0) {
    const inActiveShift = activeShifts.some((s) => {
      const bounds = getShiftWindowBounds(s, now);
      return rowTs >= bounds.startMs - preGraceMs && rowTs <= bounds.endMs + postGraceMs;
    });
    if (inActiveShift) return true;
  }

  // Final fallback for recent overnight activity: rolling 12-hour window
  return (
    (rowTs >= nowMs - 12 * 60 * 60 * 1000 && rowTs <= nowMs + 60 * 60 * 1000) ||
    (submittedMs !== null && submittedMs >= nowMs - 12 * 60 * 60 * 1000 && submittedMs <= nowMs + 60 * 60 * 1000)
  );
}

/**
 * Determines whether a user should appear in the Task Map ACTIVE filter based on their shift time
 * and whether they have a latest spreadsheet row within their active shift window.
 */
export function isUserActiveInShift(params: {
  user?: { id?: string | null; name?: string | null } | null;
  shifts?: TaskMapShift[];
  activeShift?: string | null;
  allItems?: TaskMapItem[];
  activeSession?: any;
  dailySheetLogs?: DailySheetLogItem[];
  latestSheetRows?: DailySheetLogItem[];
  now?: Date;
  targetDate?: Date | string | null;
  isHistory?: boolean;
}): boolean {
  const userName = (params.user?.name || '').trim();
  if (!userName) return false;

  const userLower = userName.toLowerCase();
  const userFirst = userLower.split(/\s+/)[0] || '';
  const matchesMa = (maName?: string | null, userId?: string | null): boolean => {
    if (params.user?.id && userId && params.user.id === userId) return true;
    if (!maName) return false;
    const pLower = maName.trim().toLowerCase();
    const pFirst = pLower.split(/\s+/)[0] || '';
    return (
      pLower === userLower ||
      (userFirst.length >= 2 && pFirst === userFirst) ||
      userLower.includes(pLower) ||
      pLower.includes(userLower)
    );
  };

  const checkOpts = {
    user: params.user,
    shifts: params.shifts,
    activeShift: params.activeShift,
    now: params.now,
    targetDate: params.targetDate,
    isHistory: params.isHistory,
  };

  // 1. Check latest spreadsheet rows (includes overnight/night-shift rows from previous calendar day)
  if (Array.isArray(params.latestSheetRows)) {
    const matchedLatest = params.latestSheetRows.some(
      (row) => matchesMa(row.maName, row.userId) && isProgressActiveForShift(row, checkOpts)
    );
    if (matchedLatest) return true;
  }

  // 2. Check today's DailySheetLog rows
  if (Array.isArray(params.dailySheetLogs)) {
    const matchedLog = params.dailySheetLogs.some(
      (row) => matchesMa(row.maName, row.userId) && isProgressActiveForShift(row, checkOpts)
    );
    if (matchedLog) return true;
  }

  // 3. Check active session (Redis / live socket session)
  if (params.activeSession && isProgressActiveForShift(params.activeSession, checkOpts)) {
    return true;
  }

  // 4. Check task-level spreadsheet progress entries
  if (Array.isArray(params.allItems)) {
    return params.allItems.some(
      (t) =>
        matchesMa(t.progress?.maName) &&
        isProgressActiveForShift(t.progress, checkOpts)
    );
  }

  return false;
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

export function isHandoverSubStatusKey(norm: string): boolean {
  return norm === 'HANDOVER' || norm === 'HAND_OVER' || norm === 'HANDOVEROUT' || norm === 'HANDOVERIN';
}

export function isTaskHandedOver(task?: TaskMapItem | null): boolean {
  if (!task) return false;
  if (task.taskMap?.handedOver) return true;
  // If actively PM-assigned to a user (queued/working with a 'Hand-over' tag), it stays in their column
  if (getPmAssignedUserId(task)) return false;
  const statuses = task.taskMap?.statuses || [];
  return statuses.some((s) => {
    const norm = s.trim().toUpperCase().replace(/[\s_-]+/g, '');
    return isHandoverSubStatusKey(norm) || norm === 'AVAILABLETASK';
  });
}

export function isTaskMissingTime(task?: TaskMapItem | null): boolean {
  if (!task?.progress?.isMissingTime) return false;
  if (isTaskHandedOver(task)) return false;
  return true;
}

export function getEffectiveTaskMapHandlerId(task?: TaskMapItem | null): string | null {
  if (!task) return null;
  if (isTaskHandedOver(task)) return null;
  const pmAssignedId = getPmAssignedUserId(task);
  if (pmAssignedId) return pmAssignedId;
  return null;
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
  if (!progress) return false;
  const hasTimeIn = Boolean(progress.timeIn && String(progress.timeIn).trim());
  const hasTimeOut = Boolean(progress.timeOut && String(progress.timeOut).trim());
  if (!hasTimeIn || hasTimeOut || progress.isMissingTime) return false;
  if (progress.isLive === false) return false;
  return true;
}

/**
 * When a task is actively live working (clocked in with no timeOut), transitions any
 * non-closed, non-recurring task status into 'IN PROGRESS'. Recurring/cadence tasks
 * (Daily, Weekly, Monthly, Recurring) strictly preserve their cadence status.
 */
export function applyLiveWorkingTaskStatus(task: TaskMapItem): TaskMapItem {
  const normStatus = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const isMainStatusClosed = ['CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED'].includes(normStatus);
  const isLive = isLiveWorkingProgress(task.progress);

  if (isTaskHandedOver(task) && (!isLive || isMainStatusClosed)) {
    if (task.progress?.isMissingTime) {
      return {
        ...task,
        progress: {
          ...task.progress,
          isMissingTime: false,
        },
      };
    }
    return task;
  }
  if (!isLive) return task;
  if (isCadenceTaskMapItem(task)) return task;
  if (isMainStatusClosed) return task;

  const existingStatuses = Array.isArray(task.taskMap?.statuses) ? [...task.taskMap.statuses] : [];
  const cleanedStatuses = existingStatuses.filter((st) => {
    const norm = st.trim().toUpperCase().replace(/[\s_-]+/g, '');
    return (
      norm !== 'HANDOVER' &&
      norm !== 'AVAILABLETASK' &&
      norm !== 'PAUSED' &&
      norm !== 'ONHOLD' &&
      norm !== 'CLOSED' &&
      norm !== 'DONE' &&
      norm !== 'COMPLETE' &&
      norm !== 'COMPLETED' &&
      norm !== 'RESOLVED'
    );
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
  targetUser: { id: string; name?: string; email?: string; avatarUrl?: string | null; roles?: string[]; teamId?: string | null; team?: any } | null,
  mode: 'IN_PROGRESS' | 'QUEUE' = 'QUEUE',
  assigneeRoleRestrictions?: string[],
  preserveHandover?: boolean
): TaskMapItem {
  const existingReviews = parseTaskPmReviewsList(task);
  const filteredReviews = existingReviews.filter((r: any) => {
    if (r?.type !== 'PM_ASSIGNMENT') return true;
    return task.isSubtask ? r?.subtaskId !== task.subtaskId : Boolean(r?.subtaskId);
  });

  const isCadence = isCadenceTaskMapItem(task);
  const existingStatuses = Array.isArray(task.taskMap?.statuses) ? [...task.taskMap.statuses] : [];

  if (!targetUser) {
    // Unassign / return to Available Tasks pool (preserve status & mark Available Task or Hand-over to match backend)
    const hadHandover =
      Boolean(preserveHandover) ||
      Boolean(task.taskMap?.handedOver) ||
      existingStatuses.some((st) => isHandoverSubStatusKey(st.trim().toUpperCase().replace(/[\s_-]+/g, '')));
    const poolStatuses = hadHandover ? ['Hand-over'] : ['Available Task'];
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
          isMissingTime: false,
        }
        : null,
      taskMap: {
        ...(task.taskMap || {
          taskId: task.id,
          statuses: poolStatuses,
          shift: 'DAY',
          stepOrder: 0,
          dontRollover: false,
        }),
        handedOver: hadHandover,
        statuses: poolStatuses,
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

  const hasPausedStatus = existingStatuses.some(
    (st) => st.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'PAUSED'
  );
  const hasHandoverOutStatus = existingStatuses.some(
    (st) => st.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'HANDOVEROUT'
  );
  const hadHandover =
    Boolean(task.taskMap?.handedOver) ||
    existingStatuses.some((st) => isHandoverSubStatusKey(st.trim().toUpperCase().replace(/[\s_-]+/g, '')));
  const previousOwnerId = getEffectiveTaskMapHandlerId(task) || task.assigneeId || null;
  const isCrossUserTransfer = Boolean(previousOwnerId && previousOwnerId !== targetUser.id);
  const keepHandoverOutInQueue =
    mode === 'QUEUE' &&
    !isCrossUserTransfer &&
    !preserveHandover &&
    hasHandoverOutStatus;
  const shouldSetHandover =
    mode === 'QUEUE' &&
    !hasPausedStatus &&
    !keepHandoverOutInQueue &&
    (hadHandover || isCrossUserTransfer || Boolean(preserveHandover));

  let cleanedStatuses = existingStatuses.filter((st) => {
    const norm = st.trim().toUpperCase().replace(/[\s_-]+/g, '');
    if (isHandoverSubStatusKey(norm) || norm === 'AVAILABLETASK' || norm === 'REVISION' || norm === 'REVISIONS') return false;
    if (mode === 'QUEUE' && norm === 'INPROGRESS') return false;
    return true;
  });

  if (keepHandoverOutInQueue) {
    cleanedStatuses = ['Hand-over Out'];
  } else if (shouldSetHandover) {
    cleanedStatuses = ['Hand-over In'];
  } else if (mode === 'IN_PROGRESS' && !cleanedStatuses.some((s) => s.trim().toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS')) {
    cleanedStatuses.push('In progress');
  } else if (mode === 'QUEUE' && cleanedStatuses.length === 0) {
    cleanedStatuses = ['Available Task'];
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
          timeIn: formatManilaTime(new Date()),
          timeOut: null,
          isMissingTime: false,
          isUpwork: Boolean(task.progress?.isUpwork),
          client: task.progress?.client || task.list?.name || 'General',
          timeTracker: task.progress?.timeTracker || 'No Need to Track',
          maName: targetUser.name || 'Team Member',
          status: 'In Progress',
          date: formatManilaDateLong(new Date()),
          taskDeliverables: task.title,
          taskUpdateAndDeliverables: '',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : task.progress
        ? {
          ...task.progress,
          timeIn: null,
        }
        : null;

  let nextRoleRestrictions = Array.isArray(assigneeRoleRestrictions)
    ? assigneeRoleRestrictions
    : task.assigneeRoleRestrictions ? [...task.assigneeRoleRestrictions] : [];

  if (targetUser && !Array.isArray(assigneeRoleRestrictions)) {
    const specifiedRole = (targetUser as any)?.specifiedRole || targetUser.roles?.[0] || targetUser.team?.name;
    if (specifiedRole && !nextRoleRestrictions.some((r) => r.toLowerCase().trim() === specifiedRole.toLowerCase().trim())) {
      nextRoleRestrictions = [...nextRoleRestrictions, specifiedRole];
    }
  }

  return {
    ...task,
    assigneeRoleRestrictions: nextRoleRestrictions,
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
  availablePoolIds?: string[];
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
  dailySheetLogs?: DailySheetLogItem[];
  latestSheetRows?: DailySheetLogItem[];
}

export interface DailySheetLogItem {
  id: string;
  dateKey: string;
  dateDisplay?: string | null;
  maName: string;
  maKey: string;
  userId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
  sheetRow?: number | null;
  spreadsheetId?: string | null;
  client?: string | null;
  taskName?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  isMissingTime: boolean;
  isUpwork: boolean;
  timeTracker?: string | null;
  status?: string | null;
  taskDeliverables?: string | null;
  taskUpdateAndDeliverables?: string | null;
  taskLink?: string | null;
  source: string;
  isLive: boolean;
  startedAt?: string | null;
  endedAt?: string | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ===========================================================================
// Client-Side Request Cache & In-Flight Deduplication for taskMapApi
// ===========================================================================

interface TaskMapApiCacheEntry<T = any> {
  data: T;
  expiresAt: number;
  updatedAt: number;
}

const TASK_MAP_API_CACHE_MAX_ENTRIES = 100;
const TASK_MAP_CACHE_TTL = {
  DATA: 15_000,
  ADMIN_TASKS: 30_000,
  OPTIONS: 5 * 60_000,
  SHIFTS: 5 * 60_000,
  HISTORY_DATES: 2 * 60_000,
  LAUNCH_DATA: 30_000,
  LAUNCH_CANDIDATES: 30_000,
  DAILY_OTP: 60_000,
  CLIENT_LOCK: 30_000,
  TIMELINE: 15_000,
  UPWORK_CLIENTS: 5 * 60_000,
  UPWORK_ACTIVE: 10_000,
  TASK_DESCRIPTION: 60_000,
  CRM_FOLLOW_UPS: 20_000,
  DAILY_SHEET_LOGS: 10_000,
  DAILY_SCHEDULE_CONFIG: 5 * 60_000,
  USER_SHEET_ACTIVITY: 15_000,
} as const;

const taskMapApiCache = new Map<string, TaskMapApiCacheEntry>();
const taskMapApiInflight = new Map<string, Promise<any>>();

function getCacheEntry<T>(key: string): T | undefined {
  const entry = taskMapApiCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    taskMapApiCache.delete(key);
    return undefined;
  }
  // Refresh LRU order
  taskMapApiCache.delete(key);
  taskMapApiCache.set(key, entry);
  return entry.data as T;
}

function setCacheEntry<T>(key: string, data: T, ttlMs: number): void {
  if (ttlMs <= 0) return;
  const now = Date.now();
  if (taskMapApiCache.has(key)) {
    taskMapApiCache.delete(key);
  }
  taskMapApiCache.set(key, {
    data,
    updatedAt: now,
    expiresAt: now + ttlMs,
  });
  while (taskMapApiCache.size > TASK_MAP_API_CACHE_MAX_ENTRIES) {
    const oldestKey = taskMapApiCache.keys().next().value;
    if (!oldestKey) break;
    taskMapApiCache.delete(oldestKey);
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

function raceWithAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

function cachedRequest<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: { force?: boolean; signal?: AbortSignal }
): Promise<T> {
  if (options?.signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  if (!options?.force) {
    const cached = getCacheEntry<T>(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const existingInflight = taskMapApiInflight.get(key) as Promise<T> | undefined;
    if (existingInflight) {
      return raceWithAbortSignal(existingInflight, options?.signal);
    }
  }

  const requestPromise = fetcher()
    .then((result) => {
      setCacheEntry(key, result, ttlMs);
      return result;
    })
    .finally(() => {
      if (taskMapApiInflight.get(key) === requestPromise) {
        taskMapApiInflight.delete(key);
      }
    });

  taskMapApiInflight.set(key, requestPromise);
  return raceWithAbortSignal(requestPromise, options?.signal);
}

/**
 * Invalidates cached entries in taskMapApi matching the given prefix(es).
 * Omit `prefixes` to clear all in-memory taskMapApi cache entries.
 */
export function invalidateTaskMapCache(prefixes?: string | string[]): void {
  if (!prefixes) {
    taskMapApiCache.clear();
    return;
  }
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  for (const key of Array.from(taskMapApiCache.keys())) {
    if (list.some((prefix) => key.startsWith(prefix))) {
      taskMapApiCache.delete(key);
    }
  }
}

/**
 * Clears all taskMapApi in-memory caches, in-flight trackers, and Task Map sessionStorage SWR entries.
 */
export function clearTaskMapApiCache(): void {
  taskMapApiCache.clear();
  taskMapApiInflight.clear();
  if (typeof window !== 'undefined') {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('nexus_taskmap_swr_v1:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => sessionStorage.removeItem(k));
    } catch {
      // Ignore storage access errors
    }
  }
}

export const taskMapApi = {
  invalidateCache: invalidateTaskMapCache,
  clearCache: clearTaskMapApiCache,

  getData: async (params?: { shift?: string; date?: string; search?: string; client?: string; signal?: AbortSignal; timeoutMs?: number; force?: boolean }): Promise<TaskMapDataResponse> => {
    const shiftKey = (params?.shift || 'DEFAULT').trim().toUpperCase();
    const dateKey = (params?.date || 'TODAY').trim();
    const clientKey = (params?.client || '').trim().toLowerCase();
    const cacheKey = `data:${shiftKey}::${dateKey}::${clientKey}`;

    return cachedRequest<TaskMapDataResponse>(
      cacheKey,
      TASK_MAP_CACHE_TTL.DATA,
      async () => {
        const q = new URLSearchParams();
        if (params?.shift) q.set('shift', params.shift);
        if (params?.date) q.set('date', params.date);
        if (params?.client) q.set('client', params.client);
        // Request compact wire payload (deduplicates availablePool via availablePoolIds)
        q.set('compact', '1');
        const queryString = q.toString() ? `?${q.toString()}` : '';
        const res = await apiClient<TaskMapDataResponse>(`/api/task-map/data${queryString}`, {
          timeoutMs: params?.timeoutMs ?? 25000,
        });
        // Transparently hydrate availablePool from availablePoolIds + tasks so all consumers see the exact same shape
        if (res && !Array.isArray(res.availablePool) && Array.isArray(res.availablePoolIds)) {
          const byId = new Map<string, TaskMapItem>();
          for (const t of res.tasks || []) {
            byId.set(t.id, t);
          }
          res.availablePool = res.availablePoolIds
            .map((id) => byId.get(id))
            .filter((t): t is TaskMapItem => Boolean(t));
        }
        return res;
      },
      { force: params?.force, signal: params?.signal }
    );
  },

  searchAdminTasks: async (query?: string, limit?: number, options?: { force?: boolean }): Promise<TaskMapItem[]> => {
    const cleanQuery = (query || '').trim().toLowerCase();
    const cacheKey = `admin-tasks:${cleanQuery}::${limit ?? ''}`;
    try {
      return await cachedRequest<TaskMapItem[]>(
        cacheKey,
        TASK_MAP_CACHE_TTL.ADMIN_TASKS,
        async () => {
          const q = new URLSearchParams();
          if (query) q.set('q', query);
          if (limit) q.set('limit', String(limit));
          const qs = q.toString() ? `?${q.toString()}` : '';
          const res = await apiClient<{ success: boolean; tasks: TaskMapItem[] }>(`/api/task-map/admin-tasks${qs}`);
          return res.tasks || [];
        },
        { force: options?.force }
      );
    } catch (err) {
      console.warn('Failed to search admin tasks:', err);
      return [];
    }
  },

  getOptions: async (options?: { force?: boolean }): Promise<{ success: boolean; options: TaskMapOption[] }> => {
    return cachedRequest(
      'options',
      TASK_MAP_CACHE_TTL.OPTIONS,
      () => apiClient<{ success: boolean; options: TaskMapOption[] }>('/api/task-map/options'),
      { force: options?.force }
    );
  },

  upsertOption: async (data: Partial<TaskMapOption>): Promise<{ success: boolean; option: TaskMapOption }> => {
    const res = await apiClient<{ success: boolean; option: TaskMapOption }>('/api/task-map/options', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    invalidateTaskMapCache(['options', 'data:']);
    return res;
  },

  deleteOption: async (id: string, force = false): Promise<{ success: boolean; inUseCount?: number }> => {
    const res = await apiClient<{ success: boolean; inUseCount?: number }>(`/api/task-map/options/${id}?force=${force}`, {
      method: 'DELETE',
    });
    invalidateTaskMapCache(['options', 'data:']);
    return res;
  },

  getShifts: async (options?: { force?: boolean }): Promise<{ success: boolean; shifts: TaskMapShift[]; activeShiftKey: string }> => {
    return cachedRequest(
      'shifts',
      TASK_MAP_CACHE_TTL.SHIFTS,
      () => apiClient<{ success: boolean; shifts: TaskMapShift[]; activeShiftKey: string }>('/api/task-map/shifts'),
      { force: options?.force }
    );
  },

  updateShifts: async (shifts: Partial<TaskMapShift>[]): Promise<{ success: boolean; shifts: TaskMapShift[] }> => {
    const res = await apiClient<{ success: boolean; shifts: TaskMapShift[] }>('/api/task-map/shifts', {
      method: 'PUT',
      body: JSON.stringify({ shifts }),
    });
    invalidateTaskMapCache(['shifts', 'data:']);
    return res;
  },

  updateTaskStatuses: async (
    taskId: string,
    statuses: string[],
    extra?: {
      taskDeliverablesDescription?: string | null;
      taskUpdateAndDeliverables?: string | null;
      timeOut?: string | null;
      timeIn?: string | null;
      sheetRow?: number | null;
      skipN8nSync?: boolean;
    }
  ): Promise<{
    success: boolean;
    taskMap: TaskMapRecord;
    upworkStartedAt?: string | null;
    upworkSession?: UpworkSession | null;
    activeUpworkSessions?: UpworkSession[];
    originalMaId?: string | null;
    assigneeId?: string | null;
    assignee?: any;
  }> => {
    markTaskSavingToDb(taskId, true);
    try {
      const res = await apiClient<{
        success: boolean;
        taskMap: TaskMapRecord;
        upworkStartedAt?: string | null;
        upworkSession?: UpworkSession | null;
        activeUpworkSessions?: UpworkSession[];
        originalMaId?: string | null;
        assigneeId?: string | null;
        assignee?: any;
      }>(`/api/task-map/tasks/${taskId}/statuses`, {
        method: 'PATCH',
        body: JSON.stringify({ statuses, ...(extra || {}) }),
      });
      invalidateTaskMapCache([
        'data:',
        'admin-tasks:',
        'launch-data:',
        `timeline:${taskId}`,
        'task-desc:',
        'upwork-active',
        'crm-follow-ups',
        'daily-sheet-logs:',
      ]);
      return res;
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  claimTask: async (taskId: string): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord }> => {
    markTaskSavingToDb(taskId, true);
    try {
      const res = await apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/claim`, {
        method: 'PATCH',
      });
      invalidateTaskMapCache(['data:', 'admin-tasks:', 'launch-data:', `timeline:${taskId}`]);
      return res;
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  assignTask: async (
    taskId: string,
    assigneeId: string | null,
    mode: 'IN_PROGRESS' | 'QUEUE' = 'QUEUE',
    options?: { assigneeRoleRestrictions?: string[]; role?: string; otp?: string; preserveHandover?: boolean }
  ): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord; progress?: any; maSession?: any }> => {
    markTaskSavingToDb(taskId, true);
    try {
      const res = await apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord; progress?: any; maSession?: any }>(`/api/task-map/tasks/${taskId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId, mode, ...options }),
      });
      invalidateTaskMapCache([
        'data:',
        'admin-tasks:',
        'launch-data:',
        `timeline:${taskId}`,
        'task-desc:',
        'upwork-active',
        'daily-sheet-logs:',
        'user-sheet-activity:',
      ]);
      return res;
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  transferTask: async (
    taskId: string,
    targetUserId: string,
    options?: { assigneeRoleRestrictions?: string[]; role?: string; otp?: string }
  ): Promise<{ success: boolean; task: any; taskMap: TaskMapRecord }> => {
    markTaskSavingToDb(taskId, true);
    try {
      const res = await apiClient<{ success: boolean; task: any; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ targetUserId, ...options }),
      });
      invalidateTaskMapCache(['data:', 'admin-tasks:', 'launch-data:', `timeline:${taskId}`]);
      return res;
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  resetColumnTasks: async (
    columnId: string,
    type: 'BOARD' | 'AUDIT' = 'BOARD'
  ): Promise<{ success: boolean; count: number; resetTaskIds: string[]; message?: string }> => {
    const res = await apiClient<{ success: boolean; count: number; resetTaskIds: string[]; message?: string }>(
      `/api/task-map/columns/${columnId}/reset`,
      {
        method: 'POST',
        body: JSON.stringify({ type }),
      }
    );
    invalidateTaskMapCache(['data:', 'admin-tasks:', 'upwork-active']);
    return res;
  },

  pmReview: async (taskId: string, data: { action: 'APPROVE' | 'REQUEST_REVISION'; pmTag?: string; comment?: string }): Promise<{ success: boolean; taskMap: TaskMapRecord }> => {
    const res = await apiClient<{ success: boolean; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/pm-review`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    invalidateTaskMapCache(['data:', `timeline:${taskId}`]);
    return res;
  },

  runRollover: async (data?: {
    taskId?: string;
    shift?: string;
    isDaily?: boolean;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ success: boolean; rolledCount?: number; nextShift?: string; taskMap?: TaskMapRecord; retainedDate?: string; newDate?: string }> => {
    const res = await apiClient<{ success: boolean; rolledCount?: number; nextShift?: string; taskMap?: TaskMapRecord; retainedDate?: string; newDate?: string }>('/api/task-map/rollover', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
    invalidateTaskMapCache(['data:', 'history-dates']);
    return res;
  },

  runDailyRollover: async (data?: {
    fromDate?: string;
    toDate?: string;
    retainCurrent?: boolean;
  }): Promise<DailyRolloverResult> => {
    const res = await apiClient<DailyRolloverResult>('/api/task-map/daily-rollover', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
    invalidateTaskMapCache(['data:', 'history-dates']);
    return res;
  },

  getHistoryDates: async (options?: { force?: boolean }): Promise<{ success: boolean; dates: string[]; currentDate: string; latestDate?: string }> => {
    return cachedRequest(
      'history-dates',
      TASK_MAP_CACHE_TTL.HISTORY_DATES,
      () => apiClient<{ success: boolean; dates: string[]; currentDate: string; latestDate?: string }>('/api/task-map/history-dates'),
      { force: options?.force }
    );
  },

  updateTaskMeta: async (taskId: string, meta: { dontRollover?: boolean; handedOver?: boolean; stepOrder?: number; shift?: string }): Promise<{ success: boolean; taskMap: TaskMapRecord }> => {
    const res = await apiClient<{ success: boolean; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/meta`, {
      method: 'PATCH',
      body: JSON.stringify(meta),
    });
    invalidateTaskMapCache(['data:', `timeline:${taskId}`, 'task-desc:']);
    return res;
  },

  getLaunchData: async (params?: { start?: string; end?: string; signal?: AbortSignal; force?: boolean }): Promise<LaunchMapDataResponse> => {
    const cacheKey = `launch-data:${params?.start || ''}::${params?.end || ''}`;
    return cachedRequest<LaunchMapDataResponse>(
      cacheKey,
      TASK_MAP_CACHE_TTL.LAUNCH_DATA,
      () => {
        const q = new URLSearchParams();
        if (params?.start) q.set('start', params.start);
        if (params?.end) q.set('end', params.end);
        const qs = q.toString() ? `?${q.toString()}` : '';
        return apiClient<LaunchMapDataResponse>(`/api/task-map/launch${qs}`);
      },
      { force: params?.force, signal: params?.signal }
    );
  },

  getLaunchCandidates: async (params?: { q?: string; limit?: number; includeClosed?: boolean; signal?: AbortSignal; force?: boolean }): Promise<{
    success: boolean;
    candidates: LaunchMapLightItem[];
  }> => {
    const cacheKey = `launch-candidates:${(params?.q || '').trim().toLowerCase()}::${params?.limit ?? ''}::${Boolean(params?.includeClosed)}`;
    return cachedRequest(
      cacheKey,
      TASK_MAP_CACHE_TTL.LAUNCH_CANDIDATES,
      () => {
        const q = new URLSearchParams();
        if (params?.q) q.set('q', params.q);
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.includeClosed) q.set('includeClosed', 'true');
        const qs = q.toString() ? `?${q.toString()}` : '';
        return apiClient<{ success: boolean; candidates: LaunchMapLightItem[] }>(`/api/task-map/launch/candidates${qs}`);
      },
      { force: params?.force, signal: params?.signal }
    );
  },

  getMyDailyOtp: async (options?: { force?: boolean }): Promise<{
    isPm: boolean;
    otp: string | null;
    date?: string;
    recentAuthorizations?: Array<{
      clientName: string;
      maName: string;
      sheet?: string | null;
      source?: string;
      timestamp: string;
    }>;
  }> => {
    return cachedRequest(
      'daily-otp',
      TASK_MAP_CACHE_TTL.DAILY_OTP,
      () => apiClient('/api/task-map/my-daily-otp'),
      { force: options?.force }
    );
  },

  verifyClientOtp: async (data: { client: string; otp: string }): Promise<{ success: boolean; pmName?: string; error?: string }> => {
    const res = await apiClient<{ success: boolean; pmName?: string; error?: string }>('/api/task-map/verify-client-otp', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    invalidateTaskMapCache(['daily-otp', `client-lock:${(data.client || '').trim().toLowerCase()}`]);
    return res;
  },

  getClientLockStatus: async (client: string, options?: { force?: boolean }): Promise<{ clientName: string; isLocked: boolean; isOvertime: boolean; hoursLogged?: number; weeklyLimit?: number }> => {
    const cacheKey = `client-lock:${(client || '').trim().toLowerCase()}`;
    return cachedRequest(
      cacheKey,
      TASK_MAP_CACHE_TTL.CLIENT_LOCK,
      () => apiClient(`/api/task-map/client-lock-status?client=${encodeURIComponent(client)}`),
      { force: options?.force }
    );
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
      const res = await apiClient<{
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
      invalidateTaskMapCache(['launch-data:', 'launch-candidates:', 'data:']);
      return res;
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  getTimeline: async (taskId: string, options?: { force?: boolean }): Promise<{ success: boolean; logs: any[]; taskMap: TaskMapRecord }> => {
    return cachedRequest(
      `timeline:${taskId}`,
      TASK_MAP_CACHE_TTL.TIMELINE,
      () => apiClient<{ success: boolean; logs: any[]; taskMap: TaskMapRecord }>(`/api/task-map/tasks/${taskId}/timeline`),
      { force: options?.force }
    );
  },

  getUpworkClients: async (options?: { force?: boolean }): Promise<{ success: boolean; clients: string[]; projectClients?: string[] }> => {
    return cachedRequest(
      'upwork-clients',
      TASK_MAP_CACHE_TTL.UPWORK_CLIENTS,
      () => apiClient<{ success: boolean; clients: string[]; projectClients?: string[] }>('/api/task-map/upwork-clients'),
      { force: options?.force }
    );
  },

  toggleUpworkClient: async (data: {
    clientName: string;
    isUpwork?: boolean;
    isProjectBased?: boolean;
    action?: 'add' | 'remove' | 'toggle';
    clients?: string[];
    projectClients?: string[];
  }): Promise<{ success: boolean; clients: string[]; projectClients?: string[] }> => {
    const res = await apiClient<{ success: boolean; clients: string[]; projectClients?: string[] }>('/api/task-map/upwork-clients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    invalidateTaskMapCache(['upwork-clients', 'data:']);
    return res;
  },

  getUpworkActiveSessions: async (options?: { force?: boolean }): Promise<{ success: boolean; activeUpworkSessions: UpworkSession[] }> => {
    return cachedRequest(
      'upwork-active',
      TASK_MAP_CACHE_TTL.UPWORK_ACTIVE,
      () => apiClient<{ success: boolean; activeUpworkSessions: UpworkSession[] }>('/api/task-map/upwork-active'),
      { force: options?.force }
    );
  },

  getTaskDescription: async (params: {
    taskId?: string | null;
    title?: string | null;
    client?: string | null;
    force?: boolean;
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
    const cacheKey = `task-desc:${params.taskId || ''}::${(params.title || '').trim().toLowerCase()}::${(params.client || '').trim().toLowerCase()}`;
    return cachedRequest(
      cacheKey,
      TASK_MAP_CACHE_TTL.TASK_DESCRIPTION,
      () => {
        const q = new URLSearchParams();
        if (params.taskId) q.set('taskId', params.taskId);
        if (params.title) q.set('title', params.title);
        if (params.client) q.set('client', params.client);
        const qs = q.toString() ? `?${q.toString()}` : '';
        return apiClient(`/api/task-map/task-description${qs}`);
      },
      { force: params.force }
    );
  },

  getPendingCrmFollowUps: async (options?: { force?: boolean }): Promise<{
    success: boolean;
    items: PendingCrmFollowUpItem[];
  }> => {
    return cachedRequest(
      'crm-follow-ups',
      TASK_MAP_CACHE_TTL.CRM_FOLLOW_UPS,
      () => apiClient('/api/task-map/crm/follow-ups'),
      { force: options?.force }
    );
  },

  acknowledgeCrmFollowUps: async (
    taskIds: string[]
  ): Promise<{
    success: boolean;
    count?: number;
    error?: string;
  }> => {
    const res = await apiClient<{
      success: boolean;
      count?: number;
      error?: string;
    }>('/api/task-map/crm/follow-ups/acknowledge', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    });
    invalidateTaskMapCache(['crm-follow-ups']);
    return res;
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
      const res = await apiClient<{
        success: boolean;
        task?: any;
        comment?: any;
        error?: string;
        uncheckedAudits?: string[];
        openSubtasks?: string[];
      }>(`/api/task-map/crm/follow-ups/${taskId}/respond`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invalidateTaskMapCache(['crm-follow-ups', 'data:', `timeline:${taskId}`]);
      return res;
    } finally {
      markTaskSavingToDb(taskId, false);
    }
  },

  /**
   * Syncs task progress and time-tracking directly to the user's MA Daily Schedule spreadsheet
   * (reference: MA Daily Schedule spreadsheet & appscript.js).
   * - On Drag/Select to In Progress (START): records Time In = now, Time Out = blank, status = "In Progress".
   * - On Transition to Handover or To Review (STOP): records Time Out = now, validates and splits any midnight crossings (11:59 PM -> 12:00 AM),
   *   and attaches Task Deliverables Description (Col K) & Task Update and Deliverables (Col L).
   */
  syncScheduleToSpreadsheet: async (
    params: SyncScheduleToSpreadsheetParams
  ): Promise<{
    success: boolean;
    rows: SpreadsheetScheduleRow[];
    log?: DailySheetLogItem | null;
    isSplitAcrossMidnight: boolean;
    message?: string;
  }> => {
    let rows: SpreadsheetScheduleRow[];
    if (params.explicitRow) {
      rows = [params.explicitRow];
    } else {
      const start = params.startedAt ? new Date(params.startedAt) : new Date();
      const end = params.stoppedAt ? new Date(params.stoppedAt) : params.mode === 'STOP' ? new Date() : null;

      const normalizedDeliverables = normalizeTaskDeliverablesInput(params.taskDeliverablesDescription);
      rows = splitMidnightScheduleRows({
        start,
        end,
        client: params.clientName,
        task: params.taskTitle,
        taskLink: params.taskLink,
        status: params.status,
        timeTracker: params.timeTracker || (params.isUpwork ? 'Upwork' : 'No Need to Track'),
        taskDeliverablesDescription: normalizedDeliverables || params.taskTitle,
        taskUpdateAndDeliverables: params.taskUpdateAndDeliverables || '',
      });
    }

    const isSplitAcrossMidnight = rows.length > 1;

    const res = await apiClient<{
      success: boolean;
      rows: SpreadsheetScheduleRow[];
      log?: DailySheetLogItem | null;
      isSplitAcrossMidnight: boolean;
      message?: string;
    }>('/api/task-map/sheets/sync-row', {
      method: 'POST',
      body: JSON.stringify({
        taskId: params.taskId || null,
        subtaskId: params.subtaskId || null,
        mode: params.mode,
        sheetRow: params.sheetRow,
        source: params.source,
        rows,
        isSplitAcrossMidnight,
      }),
    });
    invalidateTaskMapCache(['data:', 'daily-sheet-logs:', 'upwork-active', 'user-sheet-activity:']);
    return res;
  },

  getDailySheetLogs: async (params?: { date?: string; maName?: string; search?: string; force?: boolean }): Promise<{
    success: boolean;
    date: string;
    logs: DailySheetLogItem[];
  }> => {
    const cacheKey = `daily-sheet-logs:${params?.date || 'TODAY'}::${(params?.maName || '').trim().toLowerCase()}::${(params?.search || '').trim().toLowerCase()}`;
    return cachedRequest(
      cacheKey,
      TASK_MAP_CACHE_TTL.DAILY_SHEET_LOGS,
      () => {
        const q = new URLSearchParams();
        if (params?.date) q.set('date', params.date);
        if (params?.maName) q.set('maName', params.maName);
        if (params?.search) q.set('search', params.search);
        const qs = q.toString() ? `?${q.toString()}` : '';
        return apiClient(`/api/task-map/sheets/logs${qs}`);
      },
      { force: params?.force }
    );
  },

  createDailySheetLog: async (payload: {
    date?: string;
    maName?: string;
    taskId?: string | null;
    subtaskId?: string | null;
    sheetRow?: number | null;
    client?: string | null;
    taskName?: string | null;
    timeIn?: string | null;
    timeOut?: string | null;
    isMissingTime?: boolean;
    isUpwork?: boolean;
    timeTracker?: string | null;
    status?: string | null;
    taskDeliverables?: string | null;
    taskUpdateAndDeliverables?: string | null;
    taskLink?: string | null;
  }): Promise<{ success: boolean; log: DailySheetLogItem }> => {
    const res = await apiClient<{ success: boolean; log: DailySheetLogItem }>('/api/task-map/sheets/logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    invalidateTaskMapCache(['data:', 'daily-sheet-logs:', 'user-sheet-activity:']);
    return res;
  },

  getDailyScheduleConfig: async (userId?: string, options?: { force?: boolean }): Promise<{
    success: boolean;
    userId: string;
    userName: string | null;
    dailySheetUrl: string | null;
    spreadsheetId: string | null;
  }> => {
    const cacheKey = `daily-schedule-config:${userId || 'SELF'}`;
    return cachedRequest(
      cacheKey,
      TASK_MAP_CACHE_TTL.DAILY_SCHEDULE_CONFIG,
      () => {
        const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
        return apiClient(`/api/task-map/sheets/user-config${q}`);
      },
      { force: options?.force }
    );
  },

  checkSuperviseSession: async (payload: {
    maName: string;
    dateKey?: string;
    timeIn: string;
    taskId?: string | null;
    taskTitle?: string | null;
    client?: string | null;
    note?: string | null;
  }): Promise<{ success: boolean; check: SuperviseCheckItem }> => {
    const res = await apiClient<{ success: boolean; check: SuperviseCheckItem }>('/api/task-map/supervise/check', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    invalidateTaskMapCache(['data:']);
    return res;
  },

  uncheckSuperviseSession: async (sessionKey: string): Promise<{ success: boolean; sessionKey: string }> => {
    const res = await apiClient<{ success: boolean; sessionKey: string }>('/api/task-map/supervise/uncheck', {
      method: 'POST',
      body: JSON.stringify({ sessionKey }),
    });
    invalidateTaskMapCache(['data:']);
    return res;
  },

  checkUserSheetActivity: async (userId: string, options?: { force?: boolean }): Promise<UserSheetActivityStatus> => {
    return cachedRequest(
      `user-sheet-activity:${userId}`,
      TASK_MAP_CACHE_TTL.USER_SHEET_ACTIVITY,
      () => apiClient<UserSheetActivityStatus>(`/api/task-map/users/${encodeURIComponent(userId)}/sheet-activity`),
      { force: options?.force }
    );
  },
};

export interface SheetActivityLogRow {
  rowNumber: number | null;
  date: string | null;
  timeIn: string | null;
  timeOut: string | null;
  client: string | null;
  task: string | null;
  status: string | null;
}

export interface UserSheetActivityStatus {
  success: boolean;
  userId: string;
  userName: string;
  isInactive: boolean;
  thresholdHours: number;
  elapsedMinutes: number | null;
  elapsedLabel: string | null;
  lastActivityAt: string | null;
  lastRow: SheetActivityLogRow | null;
  recentRows: SheetActivityLogRow[];
  source: 'GOOGLE_SHEET' | 'DAILY_SHEET_LOG' | 'NONE';
  reason: string;
}

export interface SuperviseCheckItem {
  id: string;
  sessionKey: string;
  maKey: string;
  maName: string;
  dateKey: string;
  timeIn: string;
  taskId?: string | null;
  taskTitle?: string | null;
  client?: string | null;
  note?: string | null;
  checkedById?: string | null;
  checkedByName?: string | null;
  checkedAt: string;
  reappearAt: string;
}

// ===========================================================================
// MA Daily Schedule Spreadsheet Column Map & Time Tracking Types
// Reference: MA Daily Schedule spreadsheet & appscript.js
// ===========================================================================

export interface SpreadsheetScheduleRow {
  rowNumber?: number;
  date: string; // Col A (1): e.g. "Tuesday, September 1, 2026"
  timeIn: string; // Col B (2): e.g. "8:40 AM"
  timeOut: string; // Col C (3): e.g. "12:00 PM" or ""
  durationNum?: number | string; // Col E (5): e.g. 3.33 or formula
  durationHours?: string; // Col F (6): e.g. "3hrs 20min"
  client: string; // Col G (7): Client Name
  timeTracker: string; // Col H (8): "Upwork" | "No Need to Track" | "Clockify"
  task: string; // Col I (9): Task Title
  dc?: boolean | string; // Col J (10): false
  taskDeliverablesDescription?: string | number; // Col K (11): High-level deliverable scope/title (plain number or text)
  taskUpdateAndDeliverables?: string; // Col L (12): Detailed update & outcome
  taskLink?: string; // Col M (13): Nexus or ClickUp link
  taskStatus?: string; // Col N (14): "In Progress" | "In Review" | "Handover" | "Closed" (managed by Sheet automation)
  wasDeliverablesSubmitted?: string; // Col O (15): "None" | "Yes" (managed by Sheet automation)
  isRecorded?: string; // Col P (16): "No" | "Yes" (managed by Sheet automation)
  doubleCheckedBy?: string; // Col Q (17)
  automation?: string; // Col R (18)
  notes?: string; // Col S (19)
}

/**
 * Normalizes a Task Deliverables Description input, accepting plain numbers (including 0) or text.
 */
export function normalizeTaskDeliverablesInput(value?: string | number | null): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export interface SyncScheduleToSpreadsheetParams {
  taskId?: string | null;
  subtaskId?: string | null;
  taskTitle: string;
  clientName: string;
  taskLink?: string;
  status: string; // "In Progress" | "Handover" | "To Review" | "In Review"
  mode: 'START' | 'STOP' | 'UPDATE';
  startedAt?: Date | string | null;
  stoppedAt?: Date | string | null;
  taskDeliverablesDescription?: string | number | null;
  taskUpdateAndDeliverables?: string | null;
  timeTracker?: string | null;
  isUpwork?: boolean;
  sheetRow?: number | null;
  source?: string;
  explicitRow?: SpreadsheetScheduleRow;
}

/** Formats a Date object into Manila 12-hour time format: "h:mm A" (e.g. "8:40 AM", "11:59 PM", "12:00 AM") */
export function formatManilaTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** Formats a Date object into the standard MA Daily Schedule date header: "dddd, MMMM d, yyyy" */
export function formatManilaDateLong(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Converts a Manila date string (e.g. "Wednesday, November 25, 2026" or "2026-11-25")
 * and 12-hour time string (e.g. "8:30 AM") into an ISO timestamp string.
 */
export function parseManilaTimeToIso(
  dateStr?: string | null,
  timeStr?: string | null
): string | null {
  if (!timeStr) return null;
  const timeMatch = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!timeMatch) return null;
  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const ampm = timeMatch[3].toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  let dateKey: string;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    dateKey = dateStr.trim();
  } else if (dateStr) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      dateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(parsed);
    } else {
      dateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    }
  } else {
    dateKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  const dt = new Date(
    `${dateKey}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+08:00`
  );
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Calculates duration between two time strings on the same day.
 * Returns { durationNum: number, durationHours: string }
 */
export function calculateScheduleDuration(
  timeInStr: string,
  timeOutStr: string
): { durationNum: number; durationHours: string } {
  if (!timeInStr || !timeOutStr) {
    return { durationNum: 0, durationHours: '0min' };
  }
  const parseMinutes = (t: string): number => {
    const match = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return 0;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  };
  const inMin = parseMinutes(timeInStr);
  const outMin = parseMinutes(timeOutStr);
  let diffMin = outMin - inMin;
  if (diffMin < 0) {
    diffMin += 24 * 60;
  }
  const hours = diffMin / 60;
  const hPart = Math.floor(hours);
  const mPart = Math.round(diffMin % 60);
  const durationHours = hPart > 0 ? `${hPart}hr${hPart > 1 ? 's' : ''} ${mPart}min` : `${mPart}min`;
  return {
    durationNum: parseFloat(hours.toFixed(2)),
    durationHours,
  };
}

/**
 * Handles midnight crossovers (e.g. 11:59 PM to 12:00 AM / 12:29 AM next day).
 * In Google Sheets, a row cannot have a Time Out on a different date without breaking daily schedule
 * calculations. When a session crosses midnight (12:00 AM), this cleanly splits the session into
 * separate rows per calendar day.
 */
export function splitMidnightScheduleRows(
  session: {
    start: Date;
    end?: Date | null;
    client: string;
    task: string;
    taskLink?: string;
    status: string;
    timeTracker?: string;
    taskDeliverablesDescription?: string | number | null;
    taskUpdateAndDeliverables?: string;
  }
): SpreadsheetScheduleRow[] {
  const { start, end } = session;
  const normalizedDeliverables =
    normalizeTaskDeliverablesInput(session.taskDeliverablesDescription) || session.task;
  if (!end) {
    // Ongoing task (still in progress): single row for start date with blank Time Out
    return [
      {
        date: formatManilaDateLong(start),
        timeIn: formatManilaTime(start),
        timeOut: '',
        durationNum: 0,
        durationHours: '0min',
        client: session.client,
        timeTracker: session.timeTracker || 'No Need to Track',
        task: session.task,
        dc: 'FALSE',
        taskDeliverablesDescription: normalizedDeliverables,
        taskUpdateAndDeliverables: session.taskUpdateAndDeliverables || '',
      },
    ];
  }

  // Get calendar keys for start and end in Manila timezone
  const startKey = getManilaDateKey(start);
  const endKey = getManilaDateKey(end);

  // Case 1: Same day (normal shift)
  if (startKey === endKey) {
    const timeIn = formatManilaTime(start);
    const timeOut = formatManilaTime(end);
    const { durationNum, durationHours } = calculateScheduleDuration(timeIn, timeOut);
    return [
      {
        date: formatManilaDateLong(start),
        timeIn,
        timeOut,
        durationNum,
        durationHours,
        client: session.client,
        timeTracker: session.timeTracker || 'No Need to Track',
        task: session.task,
        dc: 'FALSE',
        taskDeliverablesDescription: normalizedDeliverables,
        taskUpdateAndDeliverables: session.taskUpdateAndDeliverables || '',
      },
    ];
  }

  // Case 2: Crosses midnight (e.g. 11:59 PM to 12:29 AM next day)
  // Split into Row 1 (Day 1 until 12:00 AM) and Row 2 (Day 2 starting at 12:00 AM)
  const rows: SpreadsheetScheduleRow[] = [];

  // Row 1: Day 1 (from start time to 12:00 AM midnight)
  const timeIn1 = formatManilaTime(start);
  const timeOut1 = '12:00 AM';
  const duration1 = calculateScheduleDuration(timeIn1, '12:00 AM');
  rows.push({
    date: formatManilaDateLong(start),
    timeIn: timeIn1,
    timeOut: timeOut1,
    durationNum: duration1.durationNum,
    durationHours: duration1.durationHours,
    client: session.client,
    timeTracker: session.timeTracker || 'No Need to Track',
    task: session.task,
    dc: 'FALSE',
    taskDeliverablesDescription: normalizedDeliverables,
    taskUpdateAndDeliverables: `${session.taskUpdateAndDeliverables || ''} (Part 1 - Until Midnight)`.trim(),
  });

  // Row 2: Day 2 (from 12:00 AM midnight to end time)
  const timeIn2 = '12:00 AM';
  const timeOut2 = formatManilaTime(end);
  const duration2 = calculateScheduleDuration('12:00 AM', timeOut2);
  rows.push({
    date: formatManilaDateLong(end),
    timeIn: timeIn2,
    timeOut: timeOut2,
    durationNum: duration2.durationNum,
    durationHours: duration2.durationHours,
    client: session.client,
    timeTracker: session.timeTracker || 'No Need to Track',
    task: session.task,
    dc: 'FALSE',
    taskDeliverablesDescription: normalizedDeliverables,
    taskUpdateAndDeliverables: session.taskUpdateAndDeliverables || '',
  });

  return rows;
}

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
  'Production Auditor': 'Prod Aud',
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
    for (const r of ['UI UX Auditor', 'Design Auditor', 'Production Auditor', 'Instruction Auditor', 'Funnel Auditor']) {
      roleNameMap.set(r.toLowerCase(), r);
    }
  }

  const formatLabel = (roleName: string) => {
    const clean = roleName.trim();
    if (/^ui\s*\/?\s*ux\s*(auditor|audit)?$/i.test(clean)) return 'UI/UX';
    if (/^design\s*(auditor|audit)$/i.test(clean)) return 'Design';
    if (/^prod(?:uction)?\s*(auditor|audit)$/i.test(clean)) return 'Production';
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
    if (l.includes('prod')) return 1;
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
    folderName.includes('admin') ||
    HIDDEN_DEFAULT_FOLDER_KEYWORDS.some((kw) => folderName.includes(kw)) ||
    listName === 'admin' ||
    ADMIN_LIST_NAMES.has(listName) ||
    listName.includes('vip scale') ||
    listName.includes('xfnite') ||
    listName.includes('xfinite') ||
    listName.includes('snaply') ||
    listName.includes('harmony') ||
    listName.includes('jenesia')
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
 * (logged on targetDate/today, recently active without timeOut, or present on a historical snapshot).
 */
export function hasSpreadsheetTaskInput(
  task?: TaskMapItem | null,
  options?: { isHistory?: boolean; now?: Date; targetDate?: Date | string | null }
): boolean {
  const prog = task?.progress;
  if (!prog?.maName) return false;
  if (!prog.timeIn && !prog.timeOut && !prog.isMissingTime) return false;
  if (options?.isHistory) return true;
  const targetDate = options?.targetDate ?? options?.now ?? new Date();
  const now = options?.now ?? new Date();
  const targetKey = getManilaDateKey(targetDate);
  const todayKey = getManilaDateKey(now);
  const isViewingToday = !targetKey || targetKey === todayKey;

  // Recent active live work only applies when viewing today
  const isRecentActive = Boolean(
    isViewingToday &&
    prog.timeIn &&
    !prog.timeOut &&
    (!prog.updatedAt || now.getTime() - new Date(prog.updatedAt).getTime() <= 14 * 60 * 60 * 1000)
  );
  return isProgressLoggedToday(prog, targetDate) || isRecentActive;
}

export function isDeveloperUser(user: any, workspaceTeams: any[] = []): boolean {
  if (!user) return false;
  const userRoles = [
    ...((user.roles || []) as string[]),
    typeof user.role === 'string' ? user.role : '',
    typeof user.title === 'string' ? user.title : '',
    typeof user.department === 'string' ? user.department : '',
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (userRoles.length === 0) return false;

  const devRoles = extractDeveloperRoles(workspaceTeams, []);
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const devRoleNorms = devRoles
    .filter((r) => r.key !== 'ALL')
    .map((r) => normalize(r.fullRole));

  return userRoles.some((ur) => {
    const normUr = normalize(ur);
    if (!normUr) return false;
    if (
      normUr === 'dev' ||
      normUr === 'devpm' ||
      normUr.startsWith('dev') ||
      normUr.includes('developer') ||
      normUr.includes('engineer') ||
      normUr.includes('programmer')
    ) {
      return true;
    }
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
  const cleanTimeIn = params?.timeIn && String(params.timeIn).trim() ? String(params.timeIn).trim() : null;
  const cleanTimeOut = params?.timeOut && String(params.timeOut).trim() ? String(params.timeOut).trim() : null;
  const assumedDay = params?.day || getManilaDateKey(new Date()) || new Date().toISOString().split('T')[0];
  const assumedStatus = params?.status || (cleanTimeOut ? 'Done' : 'In progress');
  const rawEffectiveStatus = params?.taskStatus || assumedStatus;
  const rawNorm = rawEffectiveStatus.trim().toUpperCase().replace(/[\s_-]+/g, '');
  const isCadenceAssumed = ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].some(
    (c) => rawNorm === c || rawNorm.includes(c)
  );
  const isLiveAssumed = Boolean(cleanTimeIn && !cleanTimeOut);
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
      timeIn: cleanTimeIn,
      timeOut: cleanTimeOut,
      isLive: isLiveAssumed,
      isMissingTime: Boolean(
        !cleanTimeIn &&
        !cleanTimeOut &&
        (Boolean(params?.rowNumber) ||
          assumedClient !== 'No client inputted' ||
          assumedTitle !== 'No task inputted' ||
          Boolean(params?.status))
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
  isProductionAudit,
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
 * for every sub-status that transitions a task's main status. Hand-over is specifically styled
 * as grey to match user preference and spreadsheet workflow.
 */
export const TASK_MAP_STATUS_COLORS = {
  IN_PROGRESS: '#D04A7C',    // -> IN PROGRESS (Pink)
  AVAILABLE_TASK: '#2563eb', // Workflow pool (no main status change)
  HAND_OVER: '#3f3f46',      // Retains IN PROGRESS (Grey)
  PAUSED: '#eab308',         // Retains IN PROGRESS
  ASK_CLIENT: '#06b6d4',     // Retains IN PROGRESS / IN REVIEW
  TO_REVIEW: '#D97B3A',      // -> IN REVIEW (Orange)
  WAITING: '#D9534F',        // -> WAITING (Red)
  SENT: '#D9534F',           // -> WAITING (Red)
  ON_HOLD: '#8A8F98',        // -> ON-HOLD (Gray)
  REVISION: '#5B6BD6',       // -> REVISION (Indigo)
  TO_SEND: '#0284c7',        // -> CRM Needed to Send (Sky-600)
  READY_TO_SEND: '#0284c7',  // -> CRM Needed to Send (Sky-600)
  FOLLOW_UP: '#6366F1',      // -> CRM Needed to Follow Up (Indigo)
  CRM: '#22A3AE',            // Existing historical CRM (Teal)
  CRM_TO_SEND: '#0284c7',    // CRM Needed to Send (Sky-600)
  CRM_FOLLOW_UP: '#6366F1',  // CRM Needed to Follow Up (Indigo)
  CLOSED: '#2FA37A',         // -> CLOSED (Green)
} as const;

/**
 * Normalizes sub-status label strings for consistent matching regardless of casing, hyphens, or spacing.
 */
export function normalizeSubStatusKey(label?: string | null): string {
  return (label || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
}

/**
 * Resolves sub-status pill color and styling for Task Map and cards, ensuring that colors
 * reflect their dropdown option colors, Hand-over stays grey, and styling properly supports
 * both light and dark modes.
 */
export function getTaskMapSubStatusStyle(
  label?: string | null,
  options?: TaskMapOption[]
): {
  color: string;
  textColor: string;
} {
  const norm = normalizeSubStatusKey(label);
  if (!norm) {
    return {
      color: '#3f3f46',
      textColor: '#ffffff',
    };
  }

  // 1. Hand-over / Hand-over Out / Hand-over In is explicitly grey
  if (isHandoverSubStatusKey(norm)) {
    return {
      color: TASK_MAP_STATUS_COLORS.HAND_OVER,
      textColor: '#ffffff',
    };
  }

  // 2. Check if the label matches an existing dropdown option
  if (Array.isArray(options) && options.length > 0) {
    const matched = options.find((opt) => normalizeSubStatusKey(opt.label) === norm);
    if (matched?.color) {
      return {
        color: matched.color,
        textColor: matched.textColor || '#ffffff',
      };
    }
  }

  // 3. Known canonical fallback map
  const canonicalColors: Record<string, { color: string; textColor: string }> = {
    INPROGRESS: { color: TASK_MAP_STATUS_COLORS.IN_PROGRESS, textColor: '#ffffff' },
    AVAILABLETASK: { color: TASK_MAP_STATUS_COLORS.AVAILABLE_TASK, textColor: '#ffffff' },
    HANDOVER: { color: TASK_MAP_STATUS_COLORS.HAND_OVER, textColor: '#ffffff' },
    HANDOVEROUT: { color: TASK_MAP_STATUS_COLORS.HAND_OVER, textColor: '#ffffff' },
    HANDOVERIN: { color: TASK_MAP_STATUS_COLORS.HAND_OVER, textColor: '#ffffff' },
    PAUSED: { color: TASK_MAP_STATUS_COLORS.PAUSED, textColor: '#713f12' },
    ASKCLIENT: { color: TASK_MAP_STATUS_COLORS.ASK_CLIENT, textColor: '#155e75' },
    TOREVIEW: { color: TASK_MAP_STATUS_COLORS.TO_REVIEW, textColor: '#ffffff' },
    WAITING: { color: TASK_MAP_STATUS_COLORS.WAITING, textColor: '#ffffff' },
    SENT: { color: TASK_MAP_STATUS_COLORS.SENT, textColor: '#ffffff' },
    SENTBUTWAITING: { color: TASK_MAP_STATUS_COLORS.SENT, textColor: '#ffffff' },
    ONHOLD: { color: TASK_MAP_STATUS_COLORS.ON_HOLD, textColor: '#ffffff' },
    REVISION: { color: TASK_MAP_STATUS_COLORS.REVISION, textColor: '#ffffff' },
    REVISIONS: { color: TASK_MAP_STATUS_COLORS.REVISION, textColor: '#ffffff' },
    TOSEND: { color: TASK_MAP_STATUS_COLORS.TO_SEND, textColor: '#ffffff' },
    READYTOSEND: { color: TASK_MAP_STATUS_COLORS.READY_TO_SEND, textColor: '#ffffff' },
    FOLLOWUP: { color: TASK_MAP_STATUS_COLORS.FOLLOW_UP, textColor: '#ffffff' },
    CRM: { color: TASK_MAP_STATUS_COLORS.CRM, textColor: '#ffffff' },
    CRMTOSEND: { color: TASK_MAP_STATUS_COLORS.CRM_TO_SEND, textColor: '#ffffff' },
    CRMNEEDEDTOSEND: { color: TASK_MAP_STATUS_COLORS.CRM_TO_SEND, textColor: '#ffffff' },
    CRMFOLLOWUP: { color: TASK_MAP_STATUS_COLORS.CRM_FOLLOW_UP, textColor: '#ffffff' },
    CRMNEEDEDTOFOLLOWUP: { color: TASK_MAP_STATUS_COLORS.CRM_FOLLOW_UP, textColor: '#ffffff' },
    CLOSED: { color: TASK_MAP_STATUS_COLORS.CLOSED, textColor: '#ffffff' },
    DESIGNAUDIT: { color: '#ec4899', textColor: '#ffffff' },
    UIUXAUDIT: { color: '#06b6d4', textColor: '#ffffff' },
    INSTRUCTIONAUDIT: { color: '#10b981', textColor: '#ffffff' },
    INSACTIONAUDIT: { color: '#10b981', textColor: '#ffffff' },
    FUNNELAUDIT: { color: '#f59e0b', textColor: '#ffffff' },
  };

  if (canonicalColors[norm]) {
    return canonicalColors[norm];
  }

  return {
    color: '#3f3f46',
    textColor: '#ffffff',
  };
}

export type TaskMapBoardScope = 'TASK_MAP' | 'AUDITOR_MAP' | 'CRM_MAP';

export interface SubStatusTransitionGuide {
  key: string;
  label: string;
  boardScope: TaskMapBoardScope;
  isReverting: boolean;
  title: string;
  summary: string;
  destination: string;
  mainStatusChange: string | null;
  sideEffects: string[];
  requiresDeliverablesClockOut: boolean;
  requiresConfirmModal: boolean;
  accentColor: string;
}

/**
 * Single source of truth describing what every sub-status transition does across
 * Task Map, Auditor Map, and CRM Map (destination board/column, main status update,
 * clock-out / spreadsheet sync behavior, and modal requirement).
 */
export const TASK_MAP_SUBSTATUS_GUIDE: Record<string, Omit<SubStatusTransitionGuide, 'boardScope' | 'isReverting'>> = {
  AVAILABLETASK: {
    key: 'AVAILABLETASK',
    label: 'Available Task',
    title: 'Move to Available Tasks Pool',
    summary: 'Unassigns the current member and returns this card to the Available Tasks pool for PM assignment.',
    destination: 'Task Map -> Available Tasks',
    mainStatusChange: null,
    sideEffects: [
      'Clears Task Map column assignment (PM only).',
      'Retains the task’s existing main workflow status.',
      'Clocks out active sheet session if currently live working.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.AVAILABLE_TASK,
  },
  HANDOVER: {
    key: 'HANDOVER',
    label: 'Hand-over',
    title: 'Hand-over & Clock Out',
    summary: 'Clocks out active work with deliverables/notes and hands the task over for reassignment.',
    destination: 'Task Map -> Available Tasks (or Target MA Queue on drag)',
    mainStatusChange: null,
    sideEffects: [
      'Requires Task Deliverables Description & Task Update before clock-out.',
      'Stamps Time Out in DailySheetLog & Google Daily Schedule.',
      'Keeps Hand-over tag when dragged into another MA’s Queue.',
    ],
    requiresDeliverablesClockOut: true,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.HAND_OVER,
  },
  HANDOVEROUT: {
    key: 'HANDOVEROUT',
    label: 'Hand-over Out',
    title: 'Hand-over Out & Clock Out',
    summary: 'Clocks out active work with deliverables/notes and moves the task to Queue tagged as Hand-over Out.',
    destination: 'Task Map -> MA Queue (Hand-over Out)',
    mainStatusChange: 'PENDING (preserves recurring cadence)',
    sideEffects: [
      'Requires Task Deliverables Description & Task Update before clock-out.',
      'Stamps Time Out in DailySheetLog & Google Daily Schedule.',
      'Moves task to Queue tagged as Hand-over Out.',
    ],
    requiresDeliverablesClockOut: true,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.HAND_OVER,
  },
  HANDOVERIN: {
    key: 'HANDOVERIN',
    label: 'Hand-over In',
    title: 'Mark as Hand-over In',
    summary: 'Marks this task in the MA Queue as Hand-over In (received from Available Tasks or another MA).',
    destination: 'Task Map -> MA Queue (Hand-over In)',
    mainStatusChange: null,
    sideEffects: [
      'Keeps the task in the MA Queue tagged as Hand-over In.',
      'Automatically applied when dragged from Available Tasks or another MA.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.HAND_OVER,
  },
  PAUSED: {
    key: 'PAUSED',
    label: 'Paused',
    title: 'Pause & Store in Queue',
    summary: 'Times out the current work session and moves the task into the member’s Queue as Paused.',
    destination: 'Current User Column -> Queue',
    mainStatusChange: 'PENDING (if currently IN PROGRESS)',
    sideEffects: [
      'Opens Time-Out & Update modal to record progress or pause reason.',
      'Stamps Time Out in DailySheetLog & Google Daily Schedule if clocked in.',
      'Keeps the task assigned to the user inside their Queue.',
    ],
    requiresDeliverablesClockOut: true,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.PAUSED,
  },
  ASKCLIENT: {
    key: 'ASKCLIENT',
    label: 'Ask Client',
    title: 'Escalate to CRM (Ask Client)',
    summary: 'Transfers this task out of the current column into the CRM Map pool so CRM can reach out to the client.',
    destination: 'CRM Map -> CRM Pool',
    mainStatusChange: null,
    sideEffects: [
      'Removes task from MA / Auditor column.',
      'Preserves original assigned MA for quick return on Revision.',
      'Clocks out active sheet session if currently live working.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.ASK_CLIENT,
  },
  TOREVIEW: {
    key: 'TOREVIEW',
    label: 'To Review',
    title: 'Submit for Audit Review',
    summary: 'Clocks out work with client-ready deliverables and transfers the task to the Auditor Map.',
    destination: 'Auditor Map -> Review Queue',
    mainStatusChange: 'IN REVIEW',
    sideEffects: [
      'Requires Task Deliverables Description & Task Update on Task Map.',
      'Stamps Time Out in DailySheetLog & Google Daily Schedule.',
      'Moves task to IN REVIEW and removes it from the MA column.',
    ],
    requiresDeliverablesClockOut: true,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.TO_REVIEW,
  },
  WAITING: {
    key: 'WAITING',
    label: 'Waiting',
    title: 'Move to Sent / Waiting',
    summary: 'Marks the task as waiting on client response and transfers it to the CRM Map.',
    destination: 'CRM Map -> Sent / Waiting',
    mainStatusChange: 'WAITING',
    sideEffects: [
      'Changes main status to WAITING and starts CRM follow-up tracking.',
      'Removes task from current MA column.',
      'Clocks out active sheet session if currently live working.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.WAITING,
  },
  ONHOLD: {
    key: 'ONHOLD',
    label: 'On-hold',
    title: 'Put Task On-hold',
    summary: 'Places the task on hold at the bottom of Available Tasks (and cascades to open subtasks).',
    destination: 'Task Map -> Available Tasks (Bottom, excluded from counts)',
    mainStatusChange: 'ON-HOLD',
    sideEffects: [
      'Changes main status to ON-HOLD and unassigns Task Map column.',
      'Cascades On-hold to open subtasks on parent tasks.',
      'Clocks out active sheet session if currently live working.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.ON_HOLD,
  },
  REVISION: {
    key: 'REVISION',
    label: 'Revision',
    title: 'Send Back for Revision',
    summary: 'Marks the task as Revision and returns it to the original assigned MA on Task Map.',
    destination: 'Task Map -> Original MA Column',
    mainStatusChange: 'REVISION',
    sideEffects: [
      'Changes main status to REVISION.',
      'Automatically restores assignment to the original MA.',
      'Resets/flags review flow so the MA can fix and re-submit.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.REVISION,
  },
  READYTOSEND: {
    key: 'READYTOSEND',
    label: 'Ready to Send',
    title: 'Approve & Move to CRM (To Send)',
    summary: 'Verifies all required audits & subtasks are complete, then transfers the task to CRM Map.',
    destination: 'CRM Map -> CRM Needed to Send',
    mainStatusChange: 'CRM',
    sideEffects: [
      'Checks audit checklist and open subtasks gate before moving.',
      'Transfers task from Auditor Map into CRM Map.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.READY_TO_SEND,
  },
  TOSEND: {
    key: 'TOSEND',
    label: 'To send',
    title: 'Mark Ready to Send (CRM)',
    summary: 'Places the task in the CRM To Send queue ready for client outreach.',
    destination: 'CRM Map -> CRM Needed to Send',
    mainStatusChange: 'CRM',
    sideEffects: [
      'Verifies completion gate before entering CRM.',
      'Shows task in the CRM To Send queue.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.TO_SEND,
  },
  SENTBUTWAITING: {
    key: 'SENTBUTWAITING',
    label: 'Sent but Waiting',
    title: 'Mark Sent & Start Follow-up Timer',
    summary: 'Marks outreach as sent to the client and starts the Day 0–7+ CRM follow-up countdown.',
    destination: 'CRM Map -> Sent but Waiting',
    mainStatusChange: 'WAITING',
    sideEffects: [
      'Requires Client Dashboard membership & completed audits/subtasks.',
      'Starts Day 0–7+ follow-up aging and alerts on Day 4+.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.SENT,
  },
  FOLLOWUP: {
    key: 'FOLLOWUP',
    label: 'Follow up',
    title: 'Flag for Client Follow-up',
    summary: 'Marks the task under Follow up so CRM tracks the next client touchpoint.',
    destination: 'CRM Map -> Follow Up',
    mainStatusChange: null,
    sideEffects: [
      'Highlights task as needing a client follow-up.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.FOLLOW_UP,
  },
  CLOSED: {
    key: 'CLOSED',
    label: 'Closed',
    title: 'Close & Archive Task',
    summary: 'Marks the task as Closed after confirming all audits and subtasks are finished.',
    destination: 'Closed Archive (removed from active boards)',
    mainStatusChange: 'CLOSED',
    sideEffects: [
      'Checks audit checklist and open subtasks completion gate.',
      'Clears active Task Map / CRM queues and ends open sessions.',
    ],
    requiresDeliverablesClockOut: false,
    requiresConfirmModal: true,
    accentColor: TASK_MAP_STATUS_COLORS.CLOSED,
  },
};

/**
 * Resolves the user-facing transition guide for any sub-status change across
 * Task Map, Auditor Map, and CRM Map.
 */
export function getSubStatusTransitionGuide(
  label: string,
  boardScope: TaskMapBoardScope,
  context?: { isSelecting?: boolean; isLiveSession?: boolean }
): SubStatusTransitionGuide {
  const norm = normalizeSubStatusKey(label);
  const isSelecting = context?.isSelecting ?? true;
  const isLiveSession = Boolean(context?.isLiveSession);

  if (!isSelecting) {
    const revertTarget =
      boardScope === 'AUDITOR_MAP'
        ? 'Auditor Map -> IN REVIEW'
        : boardScope === 'CRM_MAP'
          ? norm === 'CLOSED'
            ? 'CRM Map -> WAITING'
            : 'CRM Map -> CRM Pool'
          : 'Current Column';
    return {
      key: norm || 'CLEAR',
      label,
      boardScope,
      isReverting: true,
      title: `Revert "${label}" Sub-Status`,
      summary: `Clears "${label}" and returns the task to its previous workflow state.`,
      destination: revertTarget,
      mainStatusChange:
        boardScope === 'AUDITOR_MAP' && (norm === 'READYTOSEND' || norm === 'REVISION' || norm === 'REVISIONS')
          ? 'IN REVIEW'
          : boardScope === 'CRM_MAP' && norm === 'CLOSED'
            ? 'WAITING'
            : boardScope === 'CRM_MAP' && (norm === 'SENTBUTWAITING' || norm === 'SENT' || norm === 'REVISION' || norm === 'REVISIONS')
              ? 'CRM'
              : null,
      sideEffects: [
        `Removes the "${label}" sub-status badge.`,
        isLiveSession
          ? 'Task is currently live — Time-Out & Update modal will clock out the active session.'
          : 'Restores the task’s prior queue/workflow placement.',
      ],
      requiresDeliverablesClockOut: isLiveSession,
      requiresConfirmModal: boardScope !== 'AUDITOR_MAP',
      accentColor: getTaskMapSubStatusStyle(label).color,
    };
  }

  // Board-specific overrides for Auditor Map & CRM Map where Hand-over / To Review differ from Task Map
  if (boardScope === 'AUDITOR_MAP' && (norm === 'HANDOVER' || norm === 'TOREVIEW')) {
    return {
      key: norm,
      label,
      boardScope,
      isReverting: false,
      title: 'Return to Auditor Review Queue',
      summary: 'Unassigns the current auditor and places the task back in the general IN REVIEW queue.',
      destination: 'Auditor Map -> Review Queue',
      mainStatusChange: 'IN REVIEW',
      sideEffects: [
        'Clears the assigned auditor so another auditor can claim it.',
        'Keeps main status at IN REVIEW.',
        'Stamps Time Out if an active audit timer is running.',
      ],
      requiresDeliverablesClockOut: false,
      requiresConfirmModal: false,
      accentColor: getTaskMapSubStatusStyle(label).color,
    };
  }

  if (boardScope === 'CRM_MAP' && norm === 'HANDOVER') {
    return {
      key: norm,
      label,
      boardScope,
      isReverting: false,
      title: 'Return to CRM Pool',
      summary: 'Unassigns the current CRM member and places the task back in the shared CRM Pool as To send.',
      destination: 'CRM Map -> CRM Pool (To send)',
      mainStatusChange: 'CRM',
      sideEffects: [
        'Clears current CRM assignee so another CRM member can pick it up.',
        'Sets sub-status to To send.',
      ],
      requiresDeliverablesClockOut: false,
      requiresConfirmModal: true,
      accentColor: TASK_MAP_STATUS_COLORS.HAND_OVER,
    };
  }

  if (boardScope === 'CRM_MAP' && norm === 'TOREVIEW') {
    return {
      key: norm,
      label,
      boardScope,
      isReverting: false,
      title: 'Return to Auditor Map',
      summary: 'Sends the task back from CRM Map to the Auditor Map review queue for re-auditing.',
      destination: 'Auditor Map -> Review Queue',
      mainStatusChange: 'IN REVIEW',
      sideEffects: [
        'Clears CRM assignee and sets main status to IN REVIEW.',
        'Moves task back to Auditor Map.',
      ],
      requiresDeliverablesClockOut: false,
      requiresConfirmModal: true,
      accentColor: TASK_MAP_STATUS_COLORS.TO_REVIEW,
    };
  }

  const preset =
    TASK_MAP_SUBSTATUS_GUIDE[norm] ||
    (norm === 'REVISIONS' ? TASK_MAP_SUBSTATUS_GUIDE.REVISION : undefined) ||
    (norm === 'SENT' ? TASK_MAP_SUBSTATUS_GUIDE.SENTBUTWAITING : undefined);

  if (preset) {
    return {
      ...preset,
      boardScope,
      isReverting: false,
      requiresDeliverablesClockOut: preset.requiresDeliverablesClockOut || isLiveSession,
      requiresConfirmModal: boardScope === 'AUDITOR_MAP' ? false : preset.requiresConfirmModal,
    };
  }

  return {
    key: norm || label.toUpperCase(),
    label,
    boardScope,
    isReverting: false,
    title: `Apply "${label}" Sub-Status`,
    summary:
      boardScope === 'AUDITOR_MAP'
        ? `Tags this card with "${label}" on the Auditor Map.`
        : boardScope === 'CRM_MAP'
          ? `Tags this card with "${label}" on the CRM Map.`
          : `Updates the task sub-status to "${label}".`,
    destination:
      boardScope === 'AUDITOR_MAP'
        ? 'Auditor Map (Current Column)'
        : boardScope === 'CRM_MAP'
          ? 'CRM Map (Current Column)'
          : isLiveSession
            ? 'Current User Column -> Queue (after Time Out)'
            : 'Current Column',
    mainStatusChange: null,
    sideEffects: isLiveSession
      ? [
          'Task is currently live working — requires Time Out & Update modal.',
          'Moves card into Queue once timed out.',
        ]
      : [`Sets sub-status pill to "${label}".`],
    requiresDeliverablesClockOut: isLiveSession,
    requiresConfirmModal: boardScope !== 'AUDITOR_MAP',
    accentColor: getTaskMapSubStatusStyle(label).color,
  };
}

/** Maps task-map sub-status labels to the main (Prisma ListStatus) status they transition to. */
const SUB_STATUS_DB_ALIAS: Record<string, string> = {
  REVISION: 'REVISION',
  REVISIONS: 'REVISION',
  WAITING: 'WAITING',
  SENT: 'WAITING',
  SENTBUTWAITING: 'WAITING',
  ONHOLD: 'ON-HOLD',
  TOREVIEW: 'IN REVIEW',
  TOSEND: 'CRM Needed to Send',
  READYTOSEND: 'CRM Needed to Send',
  CRMTOSEND: 'CRM Needed to Send',
  CRMNEEDEDTOSEND: 'CRM Needed to Send',
  FOLLOWUP: 'CRM Needed to Follow Up',
  CRMFOLLOWUP: 'CRM Needed to Follow Up',
  CRMNEEDEDTOFOLLOWUP: 'CRM Needed to Follow Up',
  CRM: 'CRM',
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
  SENT: 'WAITING',
  INREVIEW: 'IN REVIEW',
  TOREVIEW: 'IN REVIEW',
  REVIEW: 'IN REVIEW',
  CHECKING: 'CHECKING',
  INCHECKING: 'CHECKING',
  CRM: 'CRM',
  CRMNEEDEDTOSEND: 'CRM Needed to Send',
  CRMTOSEND: 'CRM Needed to Send',
  CRMNEEDEDTOFOLLOWUP: 'CRM Needed to Follow Up',
  CRMFOLLOWUP: 'CRM Needed to Follow Up',
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
 * Ensures there are never empty sub-statuses on Task Map cards:
 * - IN REVIEW / CHECKING -> ['To Review']
 * - REVISION -> ['Revision']
 * - CLOSED / DONE / COMPLETED / RESOLVED / CANCELLED -> ['Closed']
 * - Active/Queued/Unassigned tasks -> ['Available Task']
 */
export function getDefaultTaskMapSubStatuses(
  taskStatus?: string | null,
  _options?: { isAssigned?: boolean }
): string[] {
  const canonical = toCanonicalTaskStatus(taskStatus);
  if (canonical === 'CRM Needed to Send' || canonical === 'CRM') return ['To send'];
  if (canonical === 'CRM Needed to Follow Up') return ['Follow up'];
  if (canonical === 'WAITING') return ['Sent but Waiting'];
  if (canonical === 'ON-HOLD') return ['On-hold'];
  if (canonical === 'REVISION') return ['Revision'];
  if (canonical === 'IN REVIEW' || canonical === 'CHECKING') return ['To Review'];
  if (
    canonical === 'CLOSED' ||
    canonical === 'COMPLETE' ||
    canonical === 'COMPLETED' ||
    canonical === 'RESOLVED' ||
    canonical === 'CANCELLED'
  ) {
    return ['Closed'];
  }
  return ['Available Task'];
}

const STALE_WAITING_SUBSTATUS_KEYS = new Set([
  'AVAILABLETASK',
  'TOSEND',
  'READYTOSEND',
  'WAITING',
  'SENT',
  'SENTBUTWAITING',
  'INPROGRESS',
  'PENDING',
  'HANDOVER',
  'HANDOVEROUT',
  'HANDOVERIN',
  'ONHOLD',
  'TOREVIEW',
  'REVISION',
  'REVISIONS',
]);

const STALE_CRM_SUBSTATUS_KEYS = new Set([
  'AVAILABLETASK',
  'TOSEND',
  'WAITING',
  'SENT',
  'SENTBUTWAITING',
  'INPROGRESS',
  'PENDING',
  'HANDOVER',
  'HANDOVEROUT',
  'HANDOVERIN',
  'ONHOLD',
  'TOREVIEW',
]);

const STALE_REVIEW_SUBSTATUS_KEYS = new Set([
  'AVAILABLETASK',
  'HANDOVER',
  'HANDOVEROUT',
  'HANDOVERIN',
  'PAUSED',
  'INPROGRESS',
  'PENDING',
  'REVISION',
  'REVISIONS',
  'WAITING',
  'SENT',
  'SENTBUTWAITING',
  'TOSEND',
  'FOLLOWUP',
  'ONHOLD',
]);

/**
 * Uniformly resolves/normalizes Task Map sub-statuses for a task's main status,
 * ensuring stale pool/workflow tags (e.g. "Available Task", "Hand-over", "Revision")
 * are converted into the appropriate sub-status ("To Review" for IN REVIEW,
 * "Sent but Waiting" for WAITING, "To send" for CRM Pool, etc.) and never empty.
 */
export function normalizeTaskMapSubStatuses(
  taskStatus?: string | null,
  rawStatuses?: string[] | null,
  options?: { isAssigned?: boolean }
): string[] {
  const clean = (Array.isArray(rawStatuses) ? rawStatuses : []).filter(
    (s) => Boolean(s) && s.toUpperCase().trim() !== 'CRM'
  );
  const canonical = toCanonicalTaskStatus(taskStatus);

  if (canonical === 'CLOSED' || canonical === 'DONE') {
    return ['Closed'];
  }

  if (canonical === 'IN REVIEW' || canonical === 'CHECKING') {
    if (
      clean.length === 0 ||
      clean.every((s) => STALE_REVIEW_SUBSTATUS_KEYS.has(normalizeSubStatusKey(s)))
    ) {
      return ['To Review'];
    }
    return clean.slice(0, 1);
  }

  if (canonical === 'REVISION') {
    if (
      clean.length === 0 ||
      clean.every((s) => STALE_REVIEW_SUBSTATUS_KEYS.has(normalizeSubStatusKey(s)) || normalizeSubStatusKey(s) === 'TOREVIEW')
    ) {
      return ['Revision'];
    }
    return clean.slice(0, 1);
  }

  if (canonical === 'WAITING') {
    if (
      clean.length === 0 ||
      clean.every((s) => STALE_WAITING_SUBSTATUS_KEYS.has(normalizeSubStatusKey(s)))
    ) {
      return ['Sent but Waiting'];
    }
    return clean.slice(0, 1);
  }

  if (canonical === 'CRM' || canonical === 'CRM Needed to Send') {
    if (
      clean.length === 0 ||
      clean.every((s) => STALE_CRM_SUBSTATUS_KEYS.has(normalizeSubStatusKey(s)))
    ) {
      return ['To send'];
    }
    return clean.slice(0, 1);
  }

  if (canonical === 'CRM Needed to Follow Up') {
    if (
      clean.length === 0 ||
      clean.every((s) => STALE_CRM_SUBSTATUS_KEYS.has(normalizeSubStatusKey(s)))
    ) {
      return ['Follow up'];
    }
    return clean.slice(0, 1);
  }

  if (clean.length > 0) {
    const first = clean[0];
    const firstNorm = normalizeSubStatusKey(first);
    if (options?.isAssigned === false && isHandoverSubStatusKey(firstNorm)) {
      return ['Hand-over'];
    }
    if (options?.isAssigned === true && firstNorm === 'HANDOVER') {
      return ['Hand-over In'];
    }
    return [first];
  }

  return getDefaultTaskMapSubStatuses(taskStatus, options);
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
 * Returns true if the Task Map item is in Waiting status (main status or Task Map sub-status).
 */
export function isTaskMapItemWaiting(task?: Partial<TaskMapItem> | null): boolean {
  if (!task) return false;
  const s = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (s === 'WAITING' || s === 'SENT' || s.includes('WAITING')) return true;
  const customStatuses = task.taskMap?.statuses || [];
  return customStatuses.some((cs: string) => {
    const up = (cs || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    return up === 'WAITING' || up === 'SENTBUTWAITING' || up.includes('WAITING');
  });
}

/**
 * Returns true if a task's status or Task Map sub-statuses exclude it from the Available Tasks pool.
 * Available Tasks includes Waiting, In Progress, Revision/Revising, Pending, and On-Hold tasks,
 * while excluding CRM, Review/Checking, and recurring/cadence tasks.
 */
export function isAvailablePoolExcludedTask(
  task?: (Partial<TaskMapItem> & { recurringConfig?: any }) | null,
  overrideSubStatuses?: string[]
): boolean {
  if (!task) return true;
  const s = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const mapStatuses = (overrideSubStatuses ?? task.taskMap?.statuses ?? []).map((x: string) =>
    (x || '').trim().toUpperCase().replace(/[\s_-]+/g, '')
  );

  return (
    s === 'CRM' ||
    s.includes('CRM') ||
    s === 'INREVIEW' ||
    s === 'TOREVIEW' ||
    s === 'REVIEW' ||
    s === 'CHECKING' ||
    s === 'INCHECKING' ||
    s === 'DAILY' ||
    s.includes('DAILY') ||
    s === 'WEEKLY' ||
    s.includes('WEEKLY') ||
    s === 'MONTHLY' ||
    s.includes('MONTHLY') ||
    s === 'RECURRING' ||
    s.includes('RECURRING') ||
    Boolean(task.recurringConfig) ||
    mapStatuses.some(
      (st: string) =>
        [
          'CRM',
          'ASKCLIENT',
          'READYTOSEND',
          'TOSEND',
          'DAILY',
          'WEEKLY',
          'MONTHLY',
          'RECURRING',
          'INREVIEW',
          'TOREVIEW',
          'CHECKING',
          'INCHECKING',
        ].includes(st) ||
        st.includes('CRM') ||
        st.includes('DAILY') ||
        st.includes('WEEKLY') ||
        st.includes('MONTHLY') ||
        st.includes('RECURRING')
    )
  );
}

/**
 * Numeric urgency rank for Task Map priority sorting (lower = higher priority):
 * URGENT (0) > HIGH (1) > NORMAL/MEDIUM (2) > LOW (3) > none/other (4).
 */
export function getTaskPriorityRank(
  task?: (Partial<TaskMapItem> & { tags?: Array<string | { name?: string }> }) | null
): number {
  if (!task) return 4;
  const p = (task.priority || '').trim().toUpperCase();
  const customStatuses = task.taskMap?.statuses || [];
  const tags = task.tags || [];
  const isUrgent =
    p === 'URGENT' ||
    customStatuses.some((cs) => (cs || '').toUpperCase().includes('URGENT')) ||
    tags.some((tag) => (typeof tag === 'string' ? tag : tag?.name || '').toUpperCase().includes('URGENT')) ||
    (task.title || '').toUpperCase().includes('[URGENT]');

  if (isUrgent) return 0;
  if (p === 'HIGH') return 1;
  if (p === 'NORMAL' || p === 'MEDIUM') return 2;
  if (p === 'LOW') return 3;
  return 4;
}

/**
 * Numeric status rank for Available Tasks sorting within the same priority (lower = higher):
 * Hand-over (0) > Revision (1) > Available Task / other (2) > Waiting (3) > On-Hold (4).
 */
export function getAvailableTaskStatusRank(task?: Partial<TaskMapItem> | null): number {
  if (!task) return 2;
  if (isTaskMapItemOnHold(task)) return 4;
  if (isTaskMapItemWaiting(task)) return 3;

  const s = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const mapStatuses = (task.taskMap?.statuses || []).map((x: string) =>
    (x || '').trim().toUpperCase().replace(/[\s_-]+/g, '')
  );

  if (
    mapStatuses.some(
      (st) => st === 'HANDOVER' || st === 'HANDOVERIN' || st === 'HANDOVEROUT' || st.includes('HANDOVER')
    )
  ) {
    return 0;
  }

  if (
    s === 'REVISION' ||
    s === 'REVISIONS' ||
    s === 'REVISING' ||
    s.includes('REVIS') ||
    mapStatuses.some(
      (st) => st === 'REVISION' || st === 'REVISIONS' || st === 'REVISING' || st.includes('REVIS')
    )
  ) {
    return 1;
  }

  if (task.taskMap?.handedOver && !mapStatuses.includes('AVAILABLETASK')) {
    return 0;
  }

  return 2;
}

/**
 * Comparator for Available Tasks pool:
 * 1. Bottom tiers: Active tasks (0) > Waiting (1) > On-Hold (2)
 * 2. Priority urgency: URGENT > HIGH > NORMAL/MEDIUM > LOW
 * 3. Sub-status bucket within priority: Hand-over > Revision > Available Task / other
 * 4. Newest createdAt first
 */
export function compareAvailablePoolTasks(a: TaskMapItem, b: TaskMapItem): number {
  const tierA = isTaskMapItemOnHold(a) ? 2 : isTaskMapItemWaiting(a) ? 1 : 0;
  const tierB = isTaskMapItemOnHold(b) ? 2 : isTaskMapItemWaiting(b) ? 1 : 0;
  if (tierA !== tierB) return tierA - tierB;

  const priorityDiff = getTaskPriorityRank(a) - getTaskPriorityRank(b);
  if (priorityDiff !== 0) return priorityDiff;

  const statusDiff = getAvailableTaskStatusRank(a) - getAvailableTaskStatusRank(b);
  if (statusDiff !== 0) return statusDiff;

  const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return dateB - dateA;
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
      target.closest(
        '[data-kanban-card], [data-task-id], [data-column-header], [data-group-drag-handle], [data-in-progress-dropzone], [data-no-drag-scroll], [data-task-column], [data-droppable-column], [data-column-body]'
      ) ||
      target.closest(
        '[role="dialog"], [role="menu"], [data-portal], [draggable="true"], [aria-roledescription="draggable"], .no-board-drag, .no-drag-scroll'
      )
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
      // Only initiate board horizontal drag when horizontal movement is dominant and exceeds threshold
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        isDragging = true;
        prevScrollBehavior = container.style.scrollBehavior;
        container.style.scrollBehavior = 'auto';
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      } else if (Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx)) {
        // Vertical movement (e.g. scrolling or card dragging within a column) - cancel board horizontal drag
        isMouseDown = false;
        return;
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

export interface SearchedTaskLocation {
  taskId: string;
  title: string;
  isSubtask: boolean;
  parentTaskTitle?: string;
  locationText: string;
}

/**
 * Finds where a searched task/subtask currently lives across Task Map, Auditor Map,
 * and CRM Map (and who it is assigned to) when a column's search returns empty.
 */
export function findSearchedTaskLocations(
  query: string | undefined,
  allItems: TaskMapItem[],
  allUsers: Array<{ id: string; name?: string | null }> = [],
  maxResults = 3
): SearchedTaskLocation[] {
  const raw = (query || '').trim();
  if (!raw || !Array.isArray(allItems) || allItems.length === 0) return [];
  const q = raw.toLowerCase();

  const usersById = new Map<string, string>();
  for (const u of allUsers) {
    if (u?.id && u?.name) usersById.set(u.id, u.name);
  }

  const results: SearchedTaskLocation[] = [];
  const seen = new Set<string>();

  for (const t of allItems) {
    if (!t || seen.has(t.id)) continue;
    const isMatch =
      matchesTaskLinkOrId(t, raw) ||
      (t.title || '').toLowerCase().includes(q) ||
      (t.parentTaskTitle || '').toLowerCase().includes(q) ||
      (Array.isArray(t.subtasks) &&
        t.subtasks.some((st: any) => (st?.title || '').toLowerCase().includes(q)));

    if (!isMatch) continue;
    seen.add(t.id);

    const statusNorm = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatusesNorm = (t.taskMap?.statuses || []).map((s) =>
      (s || '').trim().toUpperCase().replace(/[\s_-]+/g, '')
    );

    const handlerId = getEffectiveTaskMapHandlerId(t);
    const liveMaName =
      t.progress?.timeIn && !t.progress?.timeOut && !t.progress?.isMissingTime
        ? t.progress?.maName
        : null;
    const assignedName =
      (handlerId ? usersById.get(handlerId) : null) ||
      liveMaName ||
      t.assignee?.name ||
      t.assignees?.[0]?.name ||
      null;

    const isCrmTag = mapStatusesNorm.some((s) =>
      ['ASKCLIENT', 'READYTOSEND', 'TOSEND', 'SENTBUTWAITING', 'SENT', 'FOLLOWUP'].includes(s)
    );
    const isReview =
      ['INREVIEW', 'TOREVIEW', 'REVIEW', 'CHECKING', 'INCHECKING'].includes(statusNorm) ||
      mapStatusesNorm.some((s) =>
        ['INREVIEW', 'TOREVIEW', 'REVIEW', 'CHECKING', 'INCHECKING'].includes(s)
      );
    const isCrm =
      statusNorm === 'CRM' ||
      statusNorm === 'WAITING' ||
      statusNorm.includes('CRM') ||
      statusNorm.includes('WAITING') ||
      isCrmTag;

    let locationText: string;
    if (t.isClosed || ['CLOSED', 'DONE', 'COMPLETED', 'COMPLETE', 'RESOLVED', 'CANCELLED'].includes(statusNorm)) {
      locationText = assignedName ? `Closed (was assigned to ${assignedName})` : 'Closed';
    } else if (isCrm && !mapStatusesNorm.includes('REVISION') && statusNorm !== 'REVISION') {
      locationText = assignedName
        ? `CRM Map — assigned to ${assignedName}`
        : `CRM Map (${t.status || 'CRM'} / Pool)`;
    } else if (isReview && !isCrmTag && statusNorm !== 'REVISION' && !mapStatusesNorm.includes('REVISION')) {
      locationText =
        handlerId && assignedName
          ? `Auditor Map — assigned to ${assignedName}`
          : 'Auditor Map (To Review queue)';
    } else if (handlerId && assignedName) {
      locationText = `Task Map — assigned to ${assignedName}${liveMaName ? ' (In Progress)' : ' (Queue)'}`;
    } else if (liveMaName) {
      locationText = `Task Map — assigned to ${liveMaName} (In Progress)`;
    } else {
      locationText = `Task Map — Available Tasks${isTaskUnderAdmin(t) ? ' (Admin)' : ''}`;
    }

    results.push({
      taskId: t.id,
      title: t.title,
      isSubtask: Boolean(t.isSubtask),
      parentTaskTitle: t.parentTaskTitle,
      locationText,
    });
    if (results.length >= maxResults) break;
  }

  return results;
}
