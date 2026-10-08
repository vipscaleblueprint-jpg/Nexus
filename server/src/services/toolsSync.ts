import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { createLogger, errMsg } from '../config/logger';
import { redis, invalidateCache } from './redisService';

/**
 * Two-way sync between Nexus users and VIPScale (tools) `assistant` rows.
 *
 * The tools are the source of truth; edits flow both ways automatically:
 * - tools → Nexus: a Supabase trigger posts every changed assistant row to
 *   /api/webhooks/assistant-changed (applyAssistantChange). VIPScale's own
 *   Role Management also forwards its edits directly.
 * - Nexus → tools: edits made in the Nexus UI call pushUserToTools.
 * - reconcileWithTools runs every 10 minutes as a safety net.
 *
 * A push that fails is remembered in a Redis set so the reconcile can re-send
 * it before pulling from the tools; otherwise the pull would overwrite a Nexus
 * edit the tools never received.
 */

const log = createLogger('tools-sync');

type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'INTERN' | 'CONTRACTOR';
type SystemRole = 'ADMIN' | 'MEMBER';

// VIPScale's assistant.employment_type has one more value ("regular") than Nexus's
// EmploymentType enum, so it needs an explicit mapping rather than a direct cast.
const EMPLOYMENT_FROM_TOOLS: Record<string, EmploymentType> = {
  'full-time': 'FULL_TIME',
  'part-time': 'PART_TIME',
  'intern': 'INTERN',
  'regular': 'CONTRACTOR',
};

const EMPLOYMENT_TO_TOOLS: Record<EmploymentType, string> = {
  FULL_TIME: 'full-time',
  PART_TIME: 'part-time',
  INTERN: 'intern',
  CONTRACTOR: 'regular',
};

/** Assistant columns that map onto Nexus user fields. */
export const SYNCED_ASSISTANT_FIELDS = [
  'name',
  'star',
  'daily_schedule_sheet',
  'is_active',
  'employment_type',
  'roles',
  'system_role',
  'credits',
] as const;
type SyncedAssistantField = (typeof SYNCED_ASSISTANT_FIELDS)[number];

export interface ToolsAssistant {
  email: string;
  name?: string | null;
  star?: number | string | null;
  daily_schedule_sheet?: string | null;
  is_active?: boolean | null;
  employment_type?: string | null;
  roles?: unknown;
  system_role?: string | null;
  credits?: number | string | null;
}

interface NexusUserSnapshot {
  email: string;
  name: string;
  dailySheetUrl: string | null;
  starRating: number;
  employmentType: EmploymentType;
  isActive: boolean;
  systemRole: SystemRole;
  roles: string[];
}

const PENDING_KEY = 'tools-sync:pending';
// Fallback when Redis is unreachable, so a failed push is still retried by this process.
const pendingInMemory = new Set<string>();

export function isToolsSyncEnabled(): boolean {
  return process.env.ROLE_SYNC_ENABLED !== 'false';
}

function toolsBaseUrl(): string {
  const isDev = process.env.NODE_ENV === 'development';
  return (process.env.TOOLS_VIP_URL || (isDev ? 'http://localhost:3001' : 'https://tools.vipscaleph.com')).replace(/\/+$/, '');
}

function toolsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.VIPSCALE_API_KEY || '',
  };
}

// Service accounts (VIP Scale, VIPSCALE API) have no assistant row and must never sync.
function isSystemEmail(email: string): boolean {
  return email.toLowerCase().endsWith('@system.local');
}

function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => (typeof r === 'string' ? r : (r as { name?: unknown })?.name))
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
}

function toBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    return BigInt(Math.trunc(Number(value)));
  } catch {
    return null;
  }
}

function sameRoles(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

// ---------------------------------------------------------------------------
// Pending pushes (Nexus edits the tools haven't received yet)
// ---------------------------------------------------------------------------

async function markPending(email: string) {
  pendingInMemory.add(email);
  try {
    await redis.sadd(PENDING_KEY, email);
  } catch (err) {
    log.warn({ err }, `Could not record pending push in Redis: ${errMsg(err)}`);
  }
}

async function clearPending(email: string) {
  pendingInMemory.delete(email);
  try {
    await redis.srem(PENDING_KEY, email);
  } catch {
    // in-memory copy already cleared
  }
}

async function getPendingEmails(): Promise<string[]> {
  const emails = new Set(pendingInMemory);
  try {
    for (const e of await redis.smembers(PENDING_KEY)) emails.add(e);
  } catch {
    // Redis down: in-memory set only
  }
  return [...emails];
}

// ---------------------------------------------------------------------------
// Nexus → tools
// ---------------------------------------------------------------------------

function snapshotToPayload(user: NexusUserSnapshot) {
  return {
    email: user.email.toLowerCase(),
    name: user.name,
    daily_schedule_sheet: user.dailySheetUrl,
    star: user.starRating,
    employment_type: EMPLOYMENT_TO_TOOLS[user.employmentType] ?? null,
    is_active: user.isActive,
    system_role: user.systemRole,
    roles: user.roles,
  };
}

async function postToTools(body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${toolsBaseUrl()}/api/assistants/sync`, {
      method: 'POST',
      headers: toolsHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log.warn(`Tools sync rejected (${res.status}): ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err }, `Tools sync request failed: ${errMsg(err)}`);
    return false;
  }
}

/**
 * Send a Nexus user's current state to the tools. Never throws; a failed push
 * is queued for the next reconcile.
 */
export async function pushUserToTools(email: string): Promise<boolean> {
  if (!isToolsSyncEnabled() || isSystemEmail(email)) return false;
  const normalized = email.toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    select: {
      email: true,
      name: true,
      dailySheetUrl: true,
      starRating: true,
      employmentType: true,
      isActive: true,
      systemRole: true,
      roles: true,
    },
  });

  // A user deleted in Nexus is deactivated in the tools (rows there feed time
  // tracking and history, so they are never removed).
  const body = user
    ? { user: snapshotToPayload(user as NexusUserSnapshot) }
    : { deleted: true, email: normalized };

  const ok = await postToTools(body);
  if (ok) await clearPending(normalized);
  else await markPending(normalized);
  return ok;
}

/** Fire-and-forget wrapper for request handlers. */
export function queueUserPush(email: string | null | undefined) {
  if (!email) return;
  void pushUserToTools(email).catch((err) => log.error({ err }, `pushUserToTools crashed: ${errMsg(err)}`));
}

/** Re-send every push that failed earlier. Returns the emails still pending. */
export async function flushPendingPushes(): Promise<Set<string>> {
  const stillPending = new Set<string>();
  for (const email of await getPendingEmails()) {
    const ok = await pushUserToTools(email);
    if (!ok) stillPending.add(email);
  }
  return stillPending;
}

// ---------------------------------------------------------------------------
// tools → Nexus
// ---------------------------------------------------------------------------

/** Build the Nexus update for the given assistant fields, keeping only real changes. */
function diffAssistantAgainstUser(
  assistant: ToolsAssistant,
  fields: readonly SyncedAssistantField[],
  user: NexusUserSnapshot & { credits: bigint | null },
): Prisma.UserUpdateInput {
  const data: Prisma.UserUpdateInput = {};

  for (const field of fields) {
    switch (field) {
      case 'name': {
        const name = assistant.name?.trim();
        if (name && name !== user.name) data.name = name;
        break;
      }
      case 'star': {
        if (assistant.star == null) break;
        const star = Math.round(Number(assistant.star));
        if (Number.isFinite(star) && star !== user.starRating) data.starRating = star;
        break;
      }
      case 'daily_schedule_sheet': {
        const sheet = assistant.daily_schedule_sheet ?? null;
        if (sheet !== user.dailySheetUrl) data.dailySheetUrl = sheet;
        break;
      }
      case 'is_active': {
        if (assistant.is_active == null) break;
        if (assistant.is_active !== user.isActive) data.isActive = assistant.is_active;
        break;
      }
      case 'employment_type': {
        const mapped = assistant.employment_type ? EMPLOYMENT_FROM_TOOLS[assistant.employment_type] : undefined;
        if (mapped && mapped !== user.employmentType) data.employmentType = mapped;
        break;
      }
      case 'roles': {
        if (assistant.roles === undefined) break;
        const roles = normalizeRoles(assistant.roles);
        if (!sameRoles(roles, user.roles)) data.roles = roles;
        break;
      }
      case 'system_role': {
        const role = assistant.system_role === 'ADMIN' || assistant.system_role === 'MEMBER' ? assistant.system_role : undefined;
        if (role && role !== user.systemRole) data.systemRole = role;
        break;
      }
      case 'credits': {
        if (assistant.credits === undefined) break;
        const credits = toBigIntOrNull(assistant.credits);
        if (credits !== user.credits) data.credits = credits;
        break;
      }
    }
  }

  return data;
}

export type ApplyResult = 'created' | 'updated' | 'unchanged' | 'skipped';

/**
 * Apply an assistant row to its Nexus user (matched by email). Only `fields`
 * are considered, so a trigger reporting one changed column can't overwrite
 * unrelated Nexus fields. Does not push back to the tools, which is what keeps
 * the two-way sync from looping.
 */
export async function applyAssistantToNexus(
  assistant: ToolsAssistant,
  fields: readonly SyncedAssistantField[] = SYNCED_ASSISTANT_FIELDS,
  previousEmail?: string | null,
): Promise<ApplyResult> {
  if (!isToolsSyncEnabled()) return 'skipped';
  const email = assistant.email?.trim().toLowerCase();
  if (!email || isSystemEmail(email)) return 'skipped';

  const lookupEmail = previousEmail?.trim().toLowerCase() || email;
  const user = await prisma.user.findFirst({
    where: { email: { equals: lookupEmail, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      name: true,
      dailySheetUrl: true,
      starRating: true,
      employmentType: true,
      isActive: true,
      systemRole: true,
      roles: true,
      credits: true,
    },
  });

  if (!user) {
    // Inactive rows are people deleted from Nexus; recreating them would undo the delete.
    if (assistant.is_active === false) return 'skipped';

    // New assistant: create the Nexus account so they can be assigned work.
    const password = await bcrypt.hash(Math.random().toString(36), 10);
    await prisma.user.create({
      data: {
        email,
        password,
        name: assistant.name?.trim() || email,
        dailySheetUrl: assistant.daily_schedule_sheet ?? null,
        starRating: assistant.star != null ? Math.round(Number(assistant.star)) || 1 : 1,
        employmentType: (assistant.employment_type && EMPLOYMENT_FROM_TOOLS[assistant.employment_type]) || 'FULL_TIME',
        isActive: assistant.is_active ?? true,
        systemRole: assistant.system_role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
        roles: normalizeRoles(assistant.roles),
        credits: toBigIntOrNull(assistant.credits),
      },
    });
    await invalidateCache('users:all', 'teams:all', 'dashboard:all');
    return 'created';
  }

  const data = diffAssistantAgainstUser(assistant, fields, user as NexusUserSnapshot & { credits: bigint | null });
  if (user.email.toLowerCase() !== email) data.email = email;
  if (Object.keys(data).length === 0) return 'unchanged';

  await prisma.user.update({ where: { id: user.id }, data });
  await invalidateCache('users:all', 'teams:all', 'dashboard:all');
  log.info({ email, fields: Object.keys(data) }, 'Applied tools change to Nexus user');
  return 'updated';
}

/**
 * Full two-way reconcile: re-send failed Nexus pushes first, then pull every
 * assistant from the tools. Users whose Nexus edit still can't be delivered are
 * skipped so the pull doesn't overwrite it.
 */
export async function reconcileWithTools() {
  const summary = { created: [] as string[], updated: [] as string[], skippedPending: [] as string[], total: 0 };
  if (!isToolsSyncEnabled()) return summary;

  const stillPending = await flushPendingPushes();

  const res = await fetch(`${toolsBaseUrl()}/api/assistants`, { headers: toolsHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch assistants from tools: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.success || !Array.isArray(data.assistants)) {
    throw new Error('Invalid response format from tools assistants API');
  }

  for (const assistant of data.assistants as ToolsAssistant[]) {
    const email = assistant.email?.trim().toLowerCase();
    if (!email) continue;
    summary.total += 1;
    if (stillPending.has(email)) {
      summary.skippedPending.push(email);
      continue;
    }
    try {
      const result = await applyAssistantToNexus(assistant);
      if (result === 'created') summary.created.push(email);
      if (result === 'updated') summary.updated.push(email);
    } catch (err) {
      log.error({ err, email }, `Reconcile failed for assistant: ${errMsg(err)}`);
    }
  }

  if (summary.created.length || summary.updated.length || summary.skippedPending.length) {
    log.info(summary, 'Tools reconcile applied changes');
  }
  return summary;
}
