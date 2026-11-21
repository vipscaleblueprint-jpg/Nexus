/**
 * Pure decision rules for Task Map auto-queueing (no DB, no network) so they can be unit tested.
 *
 * Code decides who CAN take a task (eligible MA, on shift, under the queue cap);
 * the AI picker (ollamaPicker.ts) only chooses who SHOULD among those candidates.
 */
import { resolveEffectiveTaskMapOwnerId } from '../../utils/taskMapPermissions';

export interface QueueUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  systemRole?: string | null;
  isActive?: boolean;
  starRating?: number | null;
}

export interface ShiftWindow {
  shiftKey: string;
  startHour: number;
  startMinute?: number | null;
  endHour: number;
  endMinute?: number | null;
  memberIds?: string[] | null;
  memberNames?: string[] | null;
  isActive?: boolean;
}

/** The subset of a Task Map board item (getTaskMapData payload) these rules read. */
export interface BoardItem {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | Date | null;
  createdAt?: string | Date | null;
  description?: string | null;
  isSubtask?: boolean;
  subtaskId?: string | null;
  parentTaskId?: string | null;
  parentTaskTitle?: string | null;
  listId?: string | null;
  list?: { id?: string; name?: string | null } | null;
  assigneeId?: string | null;
  assignees?: Array<{ id: string; name?: string | null }> | null;
  isAdminTask?: boolean;
  isClosed?: boolean;
  recurringConfig?: unknown;
  progress?: { timeIn?: string | null; timeOut?: string | null } | null;
  taskMap?: {
    statuses?: string[] | null;
    pmReviews?: any;
    handedOver?: boolean | null;
  } | null;
}

export interface MaLoad {
  /** Open MA work in their column (queued + in progress). */
  active: number;
  /** Open MA work not yet started: what the queue cap applies to. */
  queued: number;
}

const norm = (s?: string | null) => (s || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
const lowerRoles = (u: QueueUser) => (u.roles || []).map((r) => (r || '').trim().toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------------------
// Who can take tasks
// ---------------------------------------------------------------------------

const MA_ROLE = (r: string) => r === 'ma' || r.includes('marketing associate') || /\bdev/.test(r);
const PM_OR_LEAD_ROLE = (r: string) =>
  /project\s*manager|\bpm\b|team\s*lead|\bsenior\b/.test(r);

/**
 * Everyone doing production work is an MA; Auditor/CRM/Funnel etc. are extra duties on top.
 * PMs/leads/admins (who do the assigning) and system accounts never receive auto-queued work.
 */
export function isAutoQueueEligibleUser(user: QueueUser): boolean {
  if (user.isActive === false) return false;
  if ((user.email || '').toLowerCase().endsWith('@system.local')) return false;
  if ((user.systemRole || '').toUpperCase() === 'ADMIN') return false;
  const roles = lowerRoles(user);
  if (roles.some(PM_OR_LEAD_ROLE)) return false;
  return roles.some(MA_ROLE);
}

function isWithinWindow(s: ShiftWindow, minuteOfDay: number): boolean {
  const start = s.startHour * 60 + (s.startMinute || 0);
  const end = s.endHour * 60 + (s.endMinute || 0);
  if (start <= end) return minuteOfDay >= start && minuteOfDay < end;
  return minuteOfDay >= start || minuteOfDay < end; // overnight, e.g. 17:00-01:00
}

/** Same membership match as maInactivityService: member id, or member name (exact or contained). */
function isShiftMember(user: QueueUser, s: ShiftWindow): boolean {
  if ((s.memberIds || []).some((id) => (id || '').trim() === user.id)) return true;
  const name = (user.name || user.email || '').trim().toLowerCase();
  if (!name) return false;
  return (s.memberNames || [])
    .map((n) => (n || '').trim().toLowerCase())
    .some((n) => n && (n === name || name.includes(n)));
}

/** True when the user is a member of a shift that is running at minuteOfDay (Manila time). */
export function isUserOnShiftNow(user: QueueUser, shifts: ShiftWindow[], minuteOfDay: number): boolean {
  return shifts.some((s) => s.isActive !== false && isShiftMember(user, s) && isWithinWindow(s, minuteOfDay));
}

// ---------------------------------------------------------------------------
// Task classification
// ---------------------------------------------------------------------------

const NOT_MA_WORK_EXACT = new Set([
  'CLOSED', 'DONE', 'COMPLETE', 'COMPLETED',
  'INREVIEW', 'TOREVIEW', 'REVIEW', 'CHECKING', 'INCHECKING',
  'CRM', 'WAITING', 'SENT',
  'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING',
  'KYC', 'PINBOARD',
]);

function isOnHold(item: BoardItem): boolean {
  if (norm(item.status).includes('HOLD')) return true;
  return (item.taskMap?.statuses || []).some((s) => norm(s).includes('HOLD'));
}

/** Open production work an MA does (not review/CRM/cadence/on-hold/closed/internal admin). */
export function isMaWorkItem(item: BoardItem): boolean {
  if (item.isClosed || item.isAdminTask || item.recurringConfig) return false;
  const s = norm(item.status);
  if (NOT_MA_WORK_EXACT.has(s) || s.includes('WAITING') || s.includes('CRM')) return false;
  return !isOnHold(item);
}

function isStarted(item: BoardItem): boolean {
  if (norm(item.status) === 'INPROGRESS') return true;
  return Boolean(item.progress?.timeIn && !item.progress?.timeOut);
}

export function getBoardItemOwnerId(item: BoardItem): string | null {
  return resolveEffectiveTaskMapOwnerId({
    pmReviews: item.taskMap?.pmReviews,
    handedOver: Boolean(item.taskMap?.handedOver),
    statuses: item.taskMap?.statuses || [],
    assigneeId: item.assigneeId,
    assignees: item.assignees,
    subtaskId: item.isSubtask ? item.subtaskId : null,
  });
}

export function computeMaLoads(items: BoardItem[], userIds: string[]): Map<string, MaLoad> {
  const loads = new Map<string, MaLoad>(userIds.map((id) => [id, { active: 0, queued: 0 }]));
  for (const it of items) {
    if (!isMaWorkItem(it)) continue;
    const owner = getBoardItemOwnerId(it);
    const load = owner ? loads.get(owner) : undefined;
    if (!load) continue;
    load.active++;
    if (!isStarted(it)) load.queued++;
  }
  return loads;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1 };
const time = (d?: string | Date | null) => (d ? new Date(d).getTime() : NaN);

/**
 * Available-pool tasks in the order they should be queued: urgent, high, earliest due date,
 * then oldest first (so nothing starves). On-hold, internal admin and closed tasks are skipped.
 */
export function orderPoolForQueue(pool: BoardItem[]): BoardItem[] {
  return pool
    .filter(isMaWorkItem)
    .slice()
    .sort((a, b) => {
      const pa = PRIORITY_RANK[norm(a.priority)] ?? 2;
      const pb = PRIORITY_RANK[norm(b.priority)] ?? 2;
      if (pa !== pb) return pa - pb;
      const da = time(a.dueDate);
      const db = time(b.dueDate);
      if (!isNaN(da) || !isNaN(db)) {
        if (isNaN(da)) return 1;
        if (isNaN(db)) return -1;
        if (da !== db) return da - db;
      }
      return (time(a.createdAt) || 0) - (time(b.createdAt) || 0);
    });
}

export interface Candidate {
  user: QueueUser;
  load: MaLoad;
}

/** Rules fallback (and the order candidates are shown to the AI): fewest active, fewest queued, then name. */
export function rankCandidatesByLoad<C extends Candidate>(candidates: C[]): C[] {
  return candidates
    .slice()
    .sort(
      (a, b) =>
        a.load.active - b.load.active ||
        a.load.queued - b.load.queued ||
        (a.user.name || '').localeCompare(b.user.name || '')
    );
}
