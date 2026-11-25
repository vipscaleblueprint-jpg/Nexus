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
  teamId?: string | null;
}

export interface ShiftWindow {
  shiftKey: string;
  order?: number | null;
  startHour: number;
  startMinute?: number | null;
  endHour: number;
  endMinute?: number | null;
  memberIds?: string[] | null;
  memberNames?: string[] | null;
  isActive?: boolean;
}

export type ShiftGroup = 'morning' | 'noon' | 'night';

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
  subtaskCount?: number | null;
  subtasks?: Array<{ title?: string | null }> | null;
  listId?: string | null;
  list?: { id?: string; name?: string | null } | null;
  assigneeId?: string | null;
  assignees?: Array<{ id: string; name?: string | null }> | null;
  isAdminTask?: boolean;
  isClosed?: boolean;
  recurringConfig?: unknown;
  /** Hands-on hours (Galaxy estimate / PM edit / ClickUp time estimate); null when unknown. */
  estimatedHours?: number | null;
  /** Role(s) the task needs, e.g. Galaxy's picked role. Any one of them qualifies. */
  assigneeRoleRestrictions?: string[] | null;
  /**
   * Set by the auto-queue when it loads the board (resolveTaskRoles): the task's own roles, else its
   * parent task's, else roles guessed from the title. Source 'none' = no role could be worked out,
   * so the auto-queue leaves the task for a PM. Undefined = not resolved; the task's own roles apply.
   */
  effectiveRoles?: string[];
  effectiveRolesSource?: 'task' | 'parent' | 'title' | 'none';
  teamId?: string | null;
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
  /** Estimated hours of the open MA work (unknown estimates count as the default). */
  hours: number;
}

const norm = (s?: string | null) => (s || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
const lowerRoles = (u: QueueUser) => (u.roles || []).map((r) => (r || '').trim().toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------------------
// Who can take tasks
// ---------------------------------------------------------------------------

/**
 * Every active worker can receive auto-queued work, whatever their roles (PMs, seniors and admins
 * included): being on a shift decides who works today, and canUserTakeTask matches each task's
 * roles. Only inactive and system accounts are left out.
 */
export function isAutoQueueEligibleUser(user: QueueUser): boolean {
  if (user.isActive === false) return false;
  if ((user.email || '').toLowerCase().endsWith('@system.local')) return false;
  return true;
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

const SHIFT_GROUPS: readonly ShiftGroup[] = ['morning', 'noon', 'night'];

const shiftStartMinutes = (s: ShiftWindow) => s.startHour * 60 + (s.startMinute || 0);

function shiftCoverage(user: QueueUser, shifts: ShiftWindow[]): boolean[] {
  const covered = new Array<boolean>(48 * 60).fill(false); // two days, for shifts past midnight
  for (const s of shifts) {
    if (s.isActive === false || !isShiftMember(user, s)) continue;
    const start = shiftStartMinutes(s);
    let end = s.endHour * 60 + (s.endMinute || 0);
    if (end <= start) end += 24 * 60;
    for (let m = start; m < end; m++) covered[m] = true;
  }
  return covered;
}

/**
 * Hours the user is scheduled today: the union of the shifts they belong to, so overlapping
 * shifts (e.g. 12:00-18:30 and 17:00-01:00) aren't counted twice. 0 = not scheduled.
 * Shifts are the same every day (Nexus has no days off yet).
 */
export function scheduledShiftHours(user: QueueUser, shifts: ShiftWindow[]): number {
  return shiftCoverage(user, shifts).filter(Boolean).length / 60;
}

/** Minutes of the user's shift union at or after `minuteOfDay`, in hours. */
export function remainingShiftHours(user: QueueUser, shifts: ShiftWindow[], minuteOfDay: number): number {
  const covered = shiftCoverage(user, shifts);
  const start = Math.max(0, Math.floor(minuteOfDay));
  let mins = 0;
  for (let m = start; m < covered.length; m++) {
    if (covered[m]) mins++;
  }
  return mins / 60;
}

/**
 * Shift group = rank of active shifts sorted by `order` (ties by start time):
 * 0 = morning, 1 = noon, 2 = night. User's group = lowest rank they're a member of.
 */
export function shiftGroupOf(user: QueueUser, shifts: ShiftWindow[]): ShiftGroup | null {
  const active = shifts
    .filter((s) => s.isActive !== false)
    .slice()
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        shiftStartMinutes(a) - shiftStartMinutes(b)
    );
  for (let i = 0; i < Math.min(active.length, SHIFT_GROUPS.length); i++) {
    if (isShiftMember(user, active[i])) return SHIFT_GROUPS[i];
  }
  return null;
}

/** Eligible MAs whose starting shift belongs to `group`. */
export function usersInGroup(users: QueueUser[], shifts: ShiftWindow[], group: ShiftGroup): QueueUser[] {
  return users.filter((u) => isAutoQueueEligibleUser(u) && shiftGroupOf(u, shifts) === group);
}

// ---------------------------------------------------------------------------
// Role match
// ---------------------------------------------------------------------------

const roleKey = (r: string) => (r || '').trim().toLowerCase();

/**
 * Whether the user has a role the task asks for (e.g. Galaxy's picked "TECH" or "Designer"),
 * or is in the task's team (team roles). A task with no role or team can go to any MA.
 */
export function canUserTakeTask(user: QueueUser, item: BoardItem): boolean {
  if (item.effectiveRolesSource === 'none' && !item.teamId) return false; // no role known: a PM tags it
  const required = (item.effectiveRoles ?? item.assigneeRoleRestrictions ?? []).map(roleKey).filter(Boolean);
  if (required.length === 0 && !item.teamId) return true;
  if (item.teamId && user.teamId === item.teamId) return true;
  const userRoles = new Set(lowerRoles(user).map(roleKey));
  return required.some((r) => userRoles.has(r));
}

// ---------------------------------------------------------------------------
// Working out a task's role when it has none
// ---------------------------------------------------------------------------

/**
 * Title keywords -> the role(s) that do that work. Only used when neither the task nor its parent
 * task has a role. Any one matched role qualifies, like a tagged task with several roles.
 */
const ROLE_KEYWORDS: Array<{ roles: string[]; pattern: RegExp }> = [
  { roles: ['Motion Graphics'], pattern: /\b(videos?|reels?|animations?|motion|video edit\w*|youtube|screen recording)\b/i },
  { roles: ['Design'], pattern: /\b(design\w*|graphics?|logos?|banners?|thumbnails?|carousels?|flyers?|mock-?ups?|figma|canva|branding|posts?|feeds?|stories|story|infographics?|presentation deck|ui\/ux)\b/i },
  { roles: ['Marketing'], pattern: /\b(emails?|newsletters?|copywriting|copy|captions?|content calendar|marketing calendar|campaigns?|blogs?|announcements?|sms)\b/i },
  { roles: ['Funnel Builder'], pattern: /\b(funnels?|landing pages?|sales pages?|opt-?ins?|checkout|order bump|upsells?|downsells?|thank you page|kajabi|clickfunnels|websites?|web ?pages?)\b/i },
  { roles: ['Developer'], pattern: /\b(automations?|zapier|n8n|api|integrations?|webhooks?|smart contracts?|scripts?|code|bugs?|database|nft)\b/i },
  { roles: ['Lead Generation'], pattern: /\b(leads?|lead gen\w*|outreach|prospect\w*|manychat|follow[- ]?ups?)\b/i },
];

export function guessRolesFromTitle(title: string | null | undefined): string[] {
  const text = (title || '').replace(/^[-\s]+/, '');
  return ROLE_KEYWORDS.filter((k) => k.pattern.test(text)).flatMap((k) => k.roles);
}

/**
 * Sets effectiveRoles on a task: its own roles, else (subtasks) the parent task's roles, else roles
 * guessed from the title, else none (the auto-queue then leaves it in Available tasks for a PM).
 */
export function resolveTaskRoles(item: BoardItem, parentRoles?: string[] | null): BoardItem {
  const own = (item.assigneeRoleRestrictions || []).filter(Boolean);
  if (own.length) return { ...item, effectiveRoles: own, effectiveRolesSource: 'task' };
  const parent = (parentRoles || []).filter(Boolean);
  if (item.isSubtask && parent.length) return { ...item, effectiveRoles: parent, effectiveRolesSource: 'parent' };
  const guessed = guessRolesFromTitle(item.title);
  if (guessed.length) return { ...item, effectiveRoles: guessed, effectiveRolesSource: 'title' };
  return { ...item, effectiveRoles: [], effectiveRolesSource: 'none' };
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

/** Parent tasks (any non-`--audit` subtask, open or completed) are never queued or counted; their subtasks are. */
export function isParentTask(item: BoardItem): boolean {
  if (item.isSubtask) return false;
  if (typeof item.subtaskCount === 'number') return item.subtaskCount > 0;
  return (item.subtasks || []).some((st) => !(st?.title || '').toLowerCase().includes('--audit'));
}

/** Open production work an MA does (not parent tasks, review/CRM/cadence/on-hold/closed/internal admin). */
export function isMaWorkItem(item: BoardItem): boolean {
  if (isParentTask(item)) return false;
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

/** The MA the auto-queue put this item with, if its current Task Map assignment is the auto-queue's. */
export function autoQueuedTo(item: BoardItem, botId: string): string | null {
  const reviews = Array.isArray(item.taskMap?.pmReviews) ? item.taskMap!.pmReviews : [];
  const entry = reviews.find(
    (r: any) =>
      r?.type === 'PM_ASSIGNMENT' &&
      r?.assignedTo &&
      (item.isSubtask ? r?.subtaskId === item.subtaskId : !r?.subtaskId)
  );
  return entry && entry.assignedBy === botId && getBoardItemOwnerId(item) === entry.assignedTo ? entry.assignedTo : null;
}

export function computeMaLoads(items: BoardItem[], userIds: string[], defaultHours = DEFAULT_ESTIMATED_HOURS): Map<string, MaLoad> {
  const loads = new Map<string, MaLoad>(userIds.map((id) => [id, { active: 0, queued: 0, hours: 0 }]));
  for (const it of items) {
    if (!isMaWorkItem(it)) continue;
    const owner = getBoardItemOwnerId(it);
    const load = owner ? loads.get(owner) : undefined;
    if (!load) continue;
    load.active++;
    load.hours += itemHours(it, defaultHours);
    if (!isStarted(it)) load.queued++;
  }
  return loads;
}

/** Hours a task counts for when balancing: its estimate, or the default when it has none. */
export const DEFAULT_ESTIMATED_HOURS = 0.5;
export function itemHours(item: BoardItem, defaultHours = DEFAULT_ESTIMATED_HOURS): number {
  const h = Number(item.estimatedHours);
  return Number.isFinite(h) && h > 0 ? h : defaultHours;
}

export { isStarted as isBoardItemStarted };

/** Fresh-DB check before handover/return: owner unchanged and not started (`IN PROGRESS`). */
export function isStillMovable(
  fresh: { ownerId: string | null | undefined; status?: string | null },
  expectedOwnerId: string
): boolean {
  return Boolean(fresh.ownerId) && fresh.ownerId === expectedOwnerId && norm(fresh.status) !== 'INPROGRESS';
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
    // Already started (e.g. handed over mid-work): queueing would reset it to Pending, so PMs place these
    .filter((t) => !isStarted(t))
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
