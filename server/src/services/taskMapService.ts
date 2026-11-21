import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { randomUUID } from 'crypto';
import { getActiveManilaShift } from './auditAutoAssign';
import { redis, isRedisReady, invalidateCache, getMaActiveSessionsMap, clearMaActiveSessions } from './redisService';

function getIo() {
  try {
    return require('../server').io;
  } catch {
    return null;
  }
}

export function toTaskMapShiftKey(key: string): string {
  const norm = (key || '').trim().toUpperCase();
  if (norm === 'AM' || norm === 'DAY' || norm === 'MORNING') return 'DAY';
  if (norm === 'PM_AFTERNOON' || norm === 'NOON' || norm === 'AFTERNOON') return 'NOON';
  if (norm === 'PM_NIGHT' || norm === 'NIGHT') return 'NIGHT';
  return norm || 'DAY';
}

export function fromTaskMapShiftKey(key: string): string {
  const norm = (key || '').trim().toUpperCase();
  if (norm === 'DAY' || norm === 'AM' || norm === 'MORNING') return 'AM';
  if (norm === 'NOON' || norm === 'PM_AFTERNOON' || norm === 'AFTERNOON') return 'PM_AFTERNOON';
  if (norm === 'NIGHT' || norm === 'PM_NIGHT') return 'PM_NIGHT';
  return norm || 'AM';
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
 * Tasks under Admin, Dormant Clients, Startups, or Human Resource folders (or known Admin lists)
 * are hidden from Available Tasks by default unless explicitly toggled or inputted via spreadsheet.
 */
export function isHiddenAdminOrInternalTask(
  list?: { name?: string | null; folder?: { name?: string | null } | null } | null
): boolean {
  const folderName = (list?.folder?.name || '').trim().toLowerCase();
  const listName = (list?.name || '').trim().toLowerCase();
  return (
    folderName === 'admin' ||
    HIDDEN_DEFAULT_FOLDER_KEYWORDS.some((kw) => folderName.includes(kw)) ||
    listName === 'admin' ||
    ADMIN_LIST_NAMES.has(listName)
  );
}

export interface TaskMapOption {
  id: string;
  label: string;
  color: string;
  textColor: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskMapRecordData {
  id: string;
  taskId: string;
  subtaskId: string | null;
  statuses: string[];
  shift: string;
  shiftDate: Date;
  rolloverCount: number;
  originShift: string | null;
  originDate: Date | null;
  dontRollover: boolean;
  handedOver: boolean;
  stepOrder: number;
  pmReviews: any;
  waitingReviewSince: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Status Options
// ---------------------------------------------------------------------------
export async function getStatusOptions(): Promise<TaskMapOption[]> {
  const rows = await prisma.$queryRawUnsafe<TaskMapOption[]>(
    `SELECT "id", "label", "color", "textColor", "order", "createdAt", "updatedAt"
     FROM "TaskMapStatusOption"
     ORDER BY "order" ASC`
  );
  return rows;
}

export async function upsertStatusOption(data: {
  id?: string;
  label: string;
  color: string;
  textColor?: string | null;
  order?: number;
}): Promise<TaskMapOption> {
  const id = data.id || randomUUID();
  const order = data.order !== undefined ? data.order : 0;
  const textColor = data.textColor || null;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "TaskMapStatusOption" ("id", "label", "color", "textColor", "order", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT ("label") DO UPDATE
     SET "color" = EXCLUDED."color",
         "textColor" = EXCLUDED."textColor",
         "order" = EXCLUDED."order",
         "updatedAt" = NOW()`,
    id,
    data.label.trim(),
    data.color.trim(),
    textColor,
    order
  );

  const [row] = await prisma.$queryRawUnsafe<TaskMapOption[]>(
    `SELECT * FROM "TaskMapStatusOption" WHERE "label" = $1 LIMIT 1`,
    data.label.trim()
  );
  return row;
}

export async function deleteStatusOption(id: string, force = false): Promise<{ success: boolean; inUseCount?: number }> {
  // Check if option exists
  const [option] = await prisma.$queryRawUnsafe<TaskMapOption[]>(
    `SELECT * FROM "TaskMapStatusOption" WHERE "id" = $1 LIMIT 1`,
    id
  );
  if (!option) return { success: false };

  // Check how many tasks use this option
  const [{ count }] = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*)::bigint AS count FROM "TaskMapRecord" WHERE $1 = ANY("statuses")`,
    option.label
  );
  const inUseCount = Number(count);

  if (inUseCount > 0 && !force) {
    return { success: false, inUseCount };
  }

  // Remove the status from tasks if forced
  if (inUseCount > 0 && force) {
    await prisma.$executeRawUnsafe(
      `UPDATE "TaskMapRecord"
       SET "statuses" = array_remove("statuses", $1),
           "updatedAt" = NOW()
       WHERE $1 = ANY("statuses")`,
      option.label
    );
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM "TaskMapStatusOption" WHERE "id" = $1`,
    id
  );

  return { success: true };
}

// ---------------------------------------------------------------------------
// Shift Configs
// ---------------------------------------------------------------------------
export async function getShiftConfigs(): Promise<TaskMapShift[]> {
  try {
    const auditShifts = await (prisma as any).auditShiftConfig.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });

    if (auditShifts && auditShifts.length > 0) {
      return auditShifts.map((s: any) => ({
        id: s.id,
        shiftKey: toTaskMapShiftKey(s.shiftKey),
        name: s.name,
        startHour: s.startHour,
        startMinute: s.startMinute || 0,
        endHour: s.endHour,
        endMinute: s.endMinute || 0,
        timezone: 'Asia/Manila',
        order: s.order,
        isActive: s.isActive,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
    }
  } catch (err) {
    // fallback to TaskMapShiftConfig
  }

  return prisma.$queryRawUnsafe<TaskMapShift[]>(
    `SELECT * FROM "TaskMapShiftConfig" WHERE "isActive" = true ORDER BY "order" ASC`
  );
}

export async function updateShiftConfig(shiftKey: string, data: Partial<TaskMapShift>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`"name" = $${idx++}`); values.push(data.name); }
  if (data.startHour !== undefined) { fields.push(`"startHour" = $${idx++}`); values.push(data.startHour); }
  if (data.startMinute !== undefined) { fields.push(`"startMinute" = $${idx++}`); values.push(data.startMinute); }
  if (data.endHour !== undefined) { fields.push(`"endHour" = $${idx++}`); values.push(data.endHour); }
  if (data.endMinute !== undefined) { fields.push(`"endMinute" = $${idx++}`); values.push(data.endMinute); }
  if (data.timezone !== undefined) { fields.push(`"timezone" = $${idx++}`); values.push(data.timezone); }
  if (data.order !== undefined) { fields.push(`"order" = $${idx++}`); values.push(data.order); }
  if (data.isActive !== undefined) { fields.push(`"isActive" = $${idx++}`); values.push(data.isActive); }

  if (fields.length === 0) return;
  fields.push(`"updatedAt" = NOW()`);
  values.push(shiftKey);

  await prisma.$executeRawUnsafe(
    `UPDATE "TaskMapShiftConfig" SET ${fields.join(', ')} WHERE "shiftKey" = $${idx}`,
    ...values
  );

  // Keep AuditShiftConfig in sync if present
  try {
    const auditKey = fromTaskMapShiftKey(shiftKey);
    await (prisma as any).auditShiftConfig.updateMany({
      where: { shiftKey: auditKey },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.startHour !== undefined && { startHour: data.startHour }),
        ...(data.startMinute !== undefined && { startMinute: data.startMinute }),
        ...(data.endHour !== undefined && { endHour: data.endHour }),
        ...(data.endMinute !== undefined && { endMinute: data.endMinute }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
    await invalidateCache('cache:audit_shifts');
  } catch {
    // best-effort synchronization
  }
}

export async function getCurrentActiveShift(): Promise<string> {
  const shifts = await getShiftConfigs();
  if (shifts.length === 0) return 'DAY';

  const tz = shifts[0].timezone || 'Asia/Manila';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const currentTotalMinutes = hour * 60 + minute;

  const matchingKeys: string[] = [];
  for (const shift of shifts) {
    if (shift.isActive === false) continue;
    const startMins = shift.startHour * 60 + (shift.startMinute || 0);
    const endMins = shift.endHour * 60 + (shift.endMinute || 0);

    const isActiveNow =
      startMins <= endMins
        ? currentTotalMinutes >= startMins && currentTotalMinutes < endMins
        : currentTotalMinutes >= startMins || currentTotalMinutes < endMins;

    if (isActiveNow) {
      matchingKeys.push(shift.shiftKey);
    }
  }

  if (matchingKeys.length > 0) {
    return matchingKeys.join(',');
  }

  try {
    const activeAuditShift = await getActiveManilaShift();
    if (activeAuditShift && activeAuditShift !== 'OFF_SHIFT') {
      return toTaskMapShiftKey(activeAuditShift);
    }
  } catch {
    // Fall back to ALL when off-shift
  }

  return 'ALL';
}

// ---------------------------------------------------------------------------
// Task Map Records
// ---------------------------------------------------------------------------
export async function getTaskMapRecord(taskId: string): Promise<TaskMapRecordData | null> {
  const [row] = await prisma.$queryRawUnsafe<TaskMapRecordData[]>(
    `SELECT * FROM "TaskMapRecord" WHERE "taskId" = $1 LIMIT 1`,
    taskId
  );
  return row || null;
}

export async function getOrCreateTaskMapRecord(
  taskId: string,
  defaults?: Partial<TaskMapRecordData>
): Promise<TaskMapRecordData> {
  const existing = await getTaskMapRecord(taskId);
  if (existing) return existing;

  const id = randomUUID();
  const shift = defaults?.shift || 'DAY';
  const shiftDate = defaults?.shiftDate || new Date();
  const statuses = defaults?.statuses || [];
  const rolloverCount = defaults?.rolloverCount || 0;
  const dontRollover = defaults?.dontRollover || false;
  const handedOver = defaults?.handedOver || false;
  const stepOrder = defaults?.stepOrder || 0;
  const pmReviews = defaults?.pmReviews ? JSON.stringify(defaults.pmReviews) : null;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "TaskMapRecord"
     ("id", "taskId", "statuses", "shift", "shiftDate", "rolloverCount", "dontRollover", "handedOver", "stepOrder", "pmReviews", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
     ON CONFLICT ("taskId") DO NOTHING`,
    id,
    taskId,
    statuses,
    shift,
    shiftDate,
    rolloverCount,
    dontRollover,
    handedOver,
    stepOrder,
    pmReviews
  );

  return (await getTaskMapRecord(taskId))!;
}

export async function updateTaskMapRecord(
  taskId: string,
  data: Partial<TaskMapRecordData>
): Promise<TaskMapRecordData> {
  await getOrCreateTaskMapRecord(taskId);

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.statuses !== undefined) { fields.push(`"statuses" = $${idx++}`); values.push(data.statuses); }
  if (data.shift !== undefined) { fields.push(`"shift" = $${idx++}`); values.push(data.shift); }
  if (data.shiftDate !== undefined) { fields.push(`"shiftDate" = $${idx++}`); values.push(data.shiftDate); }
  if (data.rolloverCount !== undefined) { fields.push(`"rolloverCount" = $${idx++}`); values.push(data.rolloverCount); }
  if (data.originShift !== undefined) { fields.push(`"originShift" = $${idx++}`); values.push(data.originShift); }
  if (data.originDate !== undefined) { fields.push(`"originDate" = $${idx++}`); values.push(data.originDate); }
  if (data.dontRollover !== undefined) { fields.push(`"dontRollover" = $${idx++}`); values.push(data.dontRollover); }
  if (data.handedOver !== undefined) { fields.push(`"handedOver" = $${idx++}`); values.push(data.handedOver); }
  if (data.stepOrder !== undefined) { fields.push(`"stepOrder" = $${idx++}`); values.push(data.stepOrder); }
  if (data.pmReviews !== undefined) {
    fields.push(`"pmReviews" = $${idx++}::jsonb`);
    values.push(typeof data.pmReviews === 'string' ? data.pmReviews : JSON.stringify(data.pmReviews));
  }
  if (data.waitingReviewSince !== undefined) { fields.push(`"waitingReviewSince" = $${idx++}`); values.push(data.waitingReviewSince); }

  if (fields.length > 0) {
    fields.push(`"updatedAt" = NOW()`);
    values.push(taskId);

    await prisma.$executeRawUnsafe(
      `UPDATE "TaskMapRecord" SET ${fields.join(', ')} WHERE "taskId" = $${idx}`,
      ...values
    );
  }

  return (await getTaskMapRecord(taskId))!;
}

// Shift progression helper
export function getNextShift(currentShift: string): { nextShift: string; nextDay: boolean } {
  switch (currentShift.toUpperCase()) {
    case 'DAY':
      return { nextShift: 'NOON', nextDay: false };
    case 'NOON':
      return { nextShift: 'NIGHT', nextDay: false };
    case 'NIGHT':
    default:
      return { nextShift: 'DAY', nextDay: true };
  }
}

/**
 * Resolves the target shiftDate for a shift transition without jumping to tomorrow
 * when the NIGHT -> DAY rollover runs after midnight (e.g. 1:00 AM Manila).
 */
export function resolveNextShiftDate(currentShiftDate: Date, nextDay: boolean, now = new Date()): Date {
  if (!nextDay) return currentShiftDate;
  try {
    const manilaHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        hour12: false,
      }).format(now)
    );
    const targetDateStr =
      manilaHour < 12
        ? getManilaDateStr(now)
        : getManilaDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    return new Date(`${targetDateStr}T08:00:00+08:00`);
  } catch {
    return new Date(`${getManilaDateStr(now)}T08:00:00+08:00`);
  }
}

// ---------------------------------------------------------------------------
// Upwork Client Management & Project-Based Support
// ---------------------------------------------------------------------------

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

export async function getUpworkClients(): Promise<string[]> {
  if (isRedisReady()) {
    try {
      const members = await redis.smembers('task_map:upwork_clients');
      if (members && members.length > 0) {
        return members.sort((a, b) => a.localeCompare(b));
      }
    } catch { }
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string }>>(
      `SELECT "label" FROM "TaskMapStatusOption" WHERE "label" LIKE 'UPWORK_CLIENT:%' ORDER BY "label" ASC`
    );
    const clients = rows.map((r) => r.label.replace('UPWORK_CLIENT:', '').trim()).filter(Boolean);
    if (isRedisReady() && clients.length > 0) {
      await redis.sadd('task_map:upwork_clients', ...clients).catch(() => { });
    }
    return clients;
  } catch {
    return [];
  }
}

export async function getUpworkProjectClients(): Promise<string[]> {
  if (isRedisReady()) {
    try {
      const members = await redis.smembers('task_map:upwork_project_clients');
      if (members && members.length > 0) {
        return members.sort((a, b) => a.localeCompare(b));
      }
    } catch { }
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string }>>(
      `SELECT "label" FROM "TaskMapStatusOption" WHERE "label" LIKE 'UPWORK_PROJECT_CLIENT:%' ORDER BY "label" ASC`
    );
    const clients = rows.map((r) => r.label.replace('UPWORK_PROJECT_CLIENT:', '').trim()).filter(Boolean);

    // Also auto-include any configured Upwork client whose name indicates project-based
    const baseClients = await getUpworkClients();
    for (const bc of baseClients) {
      if (isProjectBasedUpwork(bc) && !clients.some((c) => c.toLowerCase() === bc.toLowerCase())) {
        clients.push(bc);
      }
    }

    if (isRedisReady() && clients.length > 0) {
      await redis.sadd('task_map:upwork_project_clients', ...clients).catch(() => { });
    }
    return clients.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function addUpworkClient(clientName: string): Promise<string[]> {
  const clean = (clientName || '').trim();
  if (!clean) return getUpworkClients();
  const label = `UPWORK_CLIENT:${clean}`;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskMapStatusOption" ("id", "label", "color", "order", "createdAt", "updatedAt")
       VALUES ($1, $2, '#ffffff', 0, NOW(), NOW())
       ON CONFLICT ("label") DO NOTHING`,
      randomUUID(),
      label
    );
  } catch { }
  if (isRedisReady()) {
    await redis.sadd('task_map:upwork_clients', clean).catch(() => { });
  }
  return getUpworkClients();
}

export async function addUpworkProjectClient(clientName: string): Promise<string[]> {
  const clean = (clientName || '').trim();
  if (!clean) return getUpworkProjectClients();
  const label = `UPWORK_PROJECT_CLIENT:${clean}`;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TaskMapStatusOption" ("id", "label", "color", "order", "createdAt", "updatedAt")
       VALUES ($1, $2, '#ffffff', 0, NOW(), NOW())
       ON CONFLICT ("label") DO NOTHING`,
      randomUUID(),
      label
    );
  } catch { }
  if (isRedisReady()) {
    await redis.sadd('task_map:upwork_project_clients', clean).catch(() => { });
  }
  return getUpworkProjectClients();
}

export async function removeUpworkClient(clientName: string): Promise<string[]> {
  const clean = (clientName || '').trim();
  if (!clean) return getUpworkClients();
  const label = `UPWORK_CLIENT:${clean}`;
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "TaskMapStatusOption" WHERE "label" = $1`,
      label
    );
  } catch { }
  if (isRedisReady()) {
    await redis.srem('task_map:upwork_clients', clean).catch(() => { });
  }
  // Also clean up from project clients if present
  await removeUpworkProjectClient(clean);
  return getUpworkClients();
}

export async function removeUpworkProjectClient(clientName: string): Promise<string[]> {
  const clean = (clientName || '').trim();
  if (!clean) return getUpworkProjectClients();
  const label = `UPWORK_PROJECT_CLIENT:${clean}`;
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "TaskMapStatusOption" WHERE "label" = $1`,
      label
    );
  } catch { }
  if (isRedisReady()) {
    await redis.srem('task_map:upwork_project_clients', clean).catch(() => { });
  }
  return getUpworkProjectClients();
}

export async function setUpworkClients(clients: string[]): Promise<string[]> {
  const cleanList = Array.from(new Set(clients.map((c) => c.trim()).filter(Boolean)));
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "TaskMapStatusOption" WHERE "label" LIKE 'UPWORK_CLIENT:%'`
    );
    for (const c of cleanList) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskMapStatusOption" ("id", "label", "color", "order", "createdAt", "updatedAt")
         VALUES ($1, $2, '#ffffff', 0, NOW(), NOW())
         ON CONFLICT ("label") DO NOTHING`,
        randomUUID(),
        `UPWORK_CLIENT:${c}`
      );
    }
  } catch { }

  if (isRedisReady()) {
    try {
      await redis.del('task_map:upwork_clients');
      if (cleanList.length > 0) {
        await redis.sadd('task_map:upwork_clients', ...cleanList);
      }
    } catch { }
  }
  return cleanList;
}

export async function setUpworkProjectClients(clients: string[]): Promise<string[]> {
  const cleanList = Array.from(new Set(clients.map((c) => c.trim()).filter(Boolean)));
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "TaskMapStatusOption" WHERE "label" LIKE 'UPWORK_PROJECT_CLIENT:%'`
    );
    for (const c of cleanList) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskMapStatusOption" ("id", "label", "color", "order", "createdAt", "updatedAt")
         VALUES ($1, $2, '#ffffff', 0, NOW(), NOW())
         ON CONFLICT ("label") DO NOTHING`,
        randomUUID(),
        `UPWORK_PROJECT_CLIENT:${c}`
      );
    }
  } catch { }

  if (isRedisReady()) {
    try {
      await redis.del('task_map:upwork_project_clients');
      if (cleanList.length > 0) {
        await redis.sadd('task_map:upwork_project_clients', ...cleanList);
      }
    } catch { }
  }
  return cleanList;
}

// ---------------------------------------------------------------------------
// Daily Rollover & Historical Snapshots
// ---------------------------------------------------------------------------

export const isClosedStatus = (status?: string | null) => {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return s === 'CLOSED' || s === 'DONE' || s === 'COMPLETE' || s === 'COMPLETED' || s === 'RESOLVED' || s === 'CANCELLED';
};

export function getManilaDateStr(date?: Date | string | null): string {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().split('T')[0];
  }
}

/**
 * Returns operational date in Asia/Manila where each new day begins at 12:00 AM (midnight).
 */
export function getTaskMapOperationalDateStr(date?: Date | string | null): string {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : new Date();
  if (isNaN(d.getTime())) return getManilaDateStr();
  return getManilaDateStr(d);
}

/**
 * Converts a Manila schedule date (e.g. "2026-11-11") and time (e.g. "8:05 AM") into a canonical UTC ISO string.
 * This guarantees that live elapsed timers (such as Upwork tracking in Header and TaskMap) count from the
 * actual entered clock-in time rather than the moment the webhook hit the server.
 */
export function parseManilaTimeToIso(dateInput?: string | null, timeInput?: string | null): string {
  if (!timeInput || typeof timeInput !== 'string') return new Date().toISOString();

  const cleanTime = timeInput.trim();
  const ampmMatch = cleanTime.match(/(\d{1,2}):(\d{1,2})(?::\d{2})?\s*(am|pm)/i);
  const hourAmPmMatch = !ampmMatch ? cleanTime.match(/^(\d{1,2})\s*(am|pm)$/i) : null;

  if (!ampmMatch && !hourAmPmMatch) return new Date().toISOString();

  let hours = parseInt(ampmMatch ? ampmMatch[1] : hourAmPmMatch![1], 10);
  const mins = ampmMatch ? parseInt(ampmMatch[2], 10) : 0;
  const ampm = (ampmMatch ? ampmMatch[3] : hourAmPmMatch![2]).toUpperCase();

  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  let datePart = '';
  if (dateInput && typeof dateInput === 'string' && dateInput.trim()) {
    const s = dateInput.trim();
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      datePart = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    } else {
      const parsed = new Date(s);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        datePart = `${y}-${m}-${d}`;
      }
    }
  }

  if (!datePart) {
    datePart = getTaskMapOperationalDateStr();
  }

  const isoWithTz = `${datePart}T${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00+08:00`;
  const d = new Date(isoWithTz);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export async function getEffectiveUserId(userId?: string | null): Promise<string> {
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (user) return user.id;
  }
  const admin = await prisma.user.findFirst({
    where: { systemRole: 'ADMIN' },
    select: { id: true },
  });
  if (admin) return admin.id;

  const anyUser = await prisma.user.findFirst({ select: { id: true } });
  return anyUser?.id || '';
}

export async function captureTaskMapDailySnapshot(
  snapshotDate: string,
  snapshotPayload: any,
  actorId = 'system'
): Promise<any> {
  const cleanDate = (snapshotDate || getManilaDateStr()).trim().split('T')[0];
  const validUserId = await getEffectiveUserId(actorId);

  const existing = await prisma.auditLog.findFirst({
    where: {
      action: 'TASK_MAP_DAILY_SNAPSHOT',
      entity: 'TASK_MAP',
      entityId: cleanDate,
    },
    orderBy: { createdAt: 'desc' },
  });

  const payloadWithMeta = {
    ...snapshotPayload,
    snapshotDate: cleanDate,
    capturedAt: new Date().toISOString(),
    capturedBy: actorId,
  };

  if (existing) {
    await prisma.auditLog.update({
      where: { id: existing.id },
      data: {
        userId: validUserId || existing.userId,
        details: payloadWithMeta,
        createdAt: new Date(),
      },
    });
    return payloadWithMeta;
  }

  await prisma.auditLog.create({
    data: {
      action: 'TASK_MAP_DAILY_SNAPSHOT',
      entity: 'TASK_MAP',
      entityId: cleanDate,
      userId: validUserId,
      details: payloadWithMeta,
    },
  });

  return payloadWithMeta;
}

export async function getTaskMapDailySnapshot(snapshotDate: string): Promise<any | null> {
  const cleanDate = (snapshotDate || '').trim().split('T')[0];
  if (!cleanDate) return null;

  const log = await prisma.auditLog.findFirst({
    where: {
      action: 'TASK_MAP_DAILY_SNAPSHOT',
      entity: 'TASK_MAP',
      entityId: cleanDate,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!log || !log.details) return null;
  return typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
}

export async function getAvailableHistoryDates(): Promise<string[]> {
  const [snapshotLogs, rolloverLogs, latestRecords] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        action: 'TASK_MAP_DAILY_SNAPSHOT',
        entity: 'TASK_MAP',
      },
      select: { entityId: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: {
        action: 'TASK_MAP_DAILY_ROLLOVER',
        entity: 'TASK_MAP',
      },
      select: { entityId: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.$queryRawUnsafe<Array<{ shiftDate: Date }>>(
      `SELECT "shiftDate" FROM "TaskMapRecord" ORDER BY "shiftDate" DESC LIMIT 1`
    ).catch(() => []),
  ]);

  const set = new Set<string>();

  snapshotLogs.forEach((l) => {
    if (l.entityId) set.add(l.entityId.trim().split('T')[0]);
  });

  rolloverLogs.forEach((l) => {
    if (l.entityId && l.entityId.includes('->')) {
      const parts = l.entityId.split('->');
      const target = parts[1]?.trim().split('T')[0];
      const source = parts[0]?.trim().split('T')[0];
      if (target) set.add(target);
      if (source) set.add(source);
    }
  });

  if (latestRecords && latestRecords[0]?.shiftDate) {
    const shiftDateStr = getManilaDateStr(latestRecords[0].shiftDate);
    if (shiftDateStr) set.add(shiftDateStr);
  }

  // Always include today in Manila time and never expose future dates from stale shiftDate/rollover entries
  const todayManila = getManilaDateStr();
  set.add(todayManila);

  // Also include the reference mock dates Nov 1-5, 2026 for seamless UI journal browsing
  ['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01'].forEach((d) => set.add(d));

  return Array.from(set)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayManila)
    .sort((a, b) => b.localeCompare(a));
}

const normalizeRolloverStatus = (status?: string | null) =>
  (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');

const NON_TASK_MAP_SECTION_STATUSES = new Set([
  'CLOSED',
  'DONE',
  'COMPLETE',
  'COMPLETED',
  'RESOLVED',
  'CANCELLED',
  'CRM',
  'WAITING',
  'INREVIEW',
  'TOREVIEW',
  'REVIEW',
  'CHECKING',
  'INCHECKING',
  'KYC',
  'PINBOARD',
]);

const isNonTaskMapSectionStatus = (status?: string | null) =>
  NON_TASK_MAP_SECTION_STATUSES.has(normalizeRolloverStatus(status));

const parsePmReviewsSafe = (raw: any): any[] => {
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export async function executeTaskMapDailyRollover(params?: {
  fromDate?: string;
  toDate?: string;
  actorId?: string;
  snapshotPayload?: any;
}): Promise<{
  success: boolean;
  rolledCount: number;
  retainedDate: string;
  newDate: string;
  retainedTasksCount: number;
}> {
  // If fromDate is not passed, use yesterday relative to 12:00 AM midnight Manila new day
  const fromDate = (params?.fromDate || getManilaDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000))).trim().split('T')[0];

  // Default toDate is today in Manila
  let toDate = (params?.toDate || getManilaDateStr()).trim().split('T')[0];
  if (!toDate || toDate === fromDate) {
    const fromD = new Date(`${fromDate}T00:00:00Z`);
    const nextD = new Date(fromD.getTime() + 24 * 60 * 60 * 1000);
    toDate = nextD.toISOString().split('T')[0];
  }

  // Fetch current tasks, records, users, and configs before mutating anything
  const [
    currentTasks,
    taskMapRecs,
    rawOptions,
    shifts,
    allUsers,
    activeShift,
    upworkClients,
    upworkProjectClients,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { status: { notIn: ['KYC', 'PIN BOARD', 'PINBOARD'] } },
      include: {
        list: { select: { id: true, name: true, folder: { select: { id: true, name: true } } } },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
        subtasks: {
          include: {
            User: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
            assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    prisma.taskMapRecord.findMany(),
    getStatusOptions(),
    getShiftConfigs(),
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        roles: true,
        team: { select: { id: true, name: true } },
        systemRole: true,
      },
      orderBy: { name: 'asc' },
    }),
    getCurrentActiveShift(),
    getUpworkClients(),
    getUpworkProjectClients(),
  ]);

  const recMap = new Map(taskMapRecs.map((r) => [r.taskId, r]));

  // 1. Snapshot preservation for the previous date (with full users/options/sessions so history renders user columns)
  let retainedTasksCount = 0;
  let snapshotData = params?.snapshotPayload;
  if (!snapshotData) {
    const options = rawOptions.filter((opt) => {
      const up = opt.label.toUpperCase().trim();
      return (
        up !== 'UPWORK ACTIVE' &&
        !up.startsWith('UPWORK |') &&
        !up.startsWith('UPWORK|') &&
        !up.startsWith('UPWORK_CLIENT:') &&
        !up.startsWith('UPWORK_PROJECT_CLIENT:')
      );
    });

    const shiftUsers = allUsers.map((u) => ({
      ...u,
      isAudit: (u.roles || []).some((r: string) => /audit/i.test(r)),
    }));

    const pmUsers = allUsers.filter((u) => {
      if (u.systemRole === 'ADMIN') return true;
      const rolesStr = (u.roles || []).join(' ').toLowerCase();
      if (rolesStr.includes('pm') || rolesStr.includes('project manager') || rolesStr.includes('team lead') || rolesStr.includes('senior pm') || rolesStr.includes('senior project manager')) {
        return true;
      }
      const nameUp = (u.name || '').toUpperCase();
      return nameUp.includes('CHE') || nameUp.includes('PAU') || nameUp.includes('HAN');
    });

    const maActiveSessions = await getMaActiveSessionsMap();

    const mappedTasks: any[] = [];
    for (const t of currentTasks as any[]) {
      const rec = recMap.get(t.id);
      const reviewsList = parsePmReviewsSafe(rec?.pmReviews);
      const progress = reviewsList.find((r: any) => r?.type === 'SHEET_PROGRESS') || null;
      const upworkSession = reviewsList.find((r: any) => r?.type === 'UPWORK_SESSION' && r?.active) || null;
      const isAdminTask = isHiddenAdminOrInternalTask(t.list);
      const parentClosed = isClosedStatus(t.status);

      mappedTasks.push({
        ...t,
        isClosed: parentClosed,
        isAdminTask,
        progress,
        upworkSession,
        upworkStartedAt: upworkSession?.startedAt || null,
        taskMap: rec
          ? {
              id: rec.id,
              taskId: rec.taskId,
              statuses: rec.statuses,
              shift: rec.shift,
              shiftDate: rec.shiftDate,
              handedOver: rec.handedOver,
              pmReviews: rec.pmReviews,
              rolloverCount: rec.rolloverCount,
            }
          : {
              id: '',
              taskId: t.id,
              statuses: ['Available Task'],
              shift: activeShift || 'ALL',
              shiftDate: new Date(),
              handedOver: false,
              pmReviews: null,
              rolloverCount: 0,
            },
      });
    }

    const isSnapshotPoolItem = (t: any) => {
      if (t.isClosed || isClosedStatus(t.status)) return false;
      const s = normalizeRolloverStatus(t.status);
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) => normalizeRolloverStatus(x));
      if (
        s === 'WAITING' || s.includes('WAITING') ||
        s === 'CRM' || s.includes('CRM') ||
        s === 'INREVIEW' || s === 'TOREVIEW' || s === 'REVIEW' ||
        s === 'CHECKING' || s === 'INCHECKING' ||
        s === 'DAILY' || s.includes('DAILY') ||
        s === 'WEEKLY' || s.includes('WEEKLY') ||
        s === 'MONTHLY' || s.includes('MONTHLY') ||
        s === 'RECURRING' || s.includes('RECURRING') ||
        Boolean(t.recurringConfig) ||
        mapStatuses.some((st: string) =>
          ['WAITING', 'CRM', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING', 'INREVIEW', 'TOREVIEW', 'CHECKING', 'INCHECKING'].includes(st)
        )
      ) {
        return false;
      }
      const revs = parsePmReviewsSafe(t.taskMap?.pmReviews);
      const isLive = Boolean(t.progress?.maName && !t.progress?.timeOut && t.progress?.timeIn);
      const hasPmAssign = revs.some((r: any) => r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId && r?.assignedTo);
      if (isLive || hasPmAssign) return false;
      const handedOver = Boolean(t.taskMap?.handedOver) || mapStatuses.includes('HANDOVER');
      if (t.assigneeId && !handedOver) return false;
      return true;
    };

    const allClientsMap = new Map<string, { id: string; name: string }>();
    for (const t of mappedTasks) {
      if (!t.isAdminTask && t.list?.id && t.list?.name) {
        allClientsMap.set(t.list.id, { id: t.list.id, name: t.list.name });
      }
    }

    snapshotData = {
      tasks: mappedTasks.filter((t) => !t.isClosed),
      availablePool: mappedTasks.filter(isSnapshotPoolItem),
      allClients: Array.from(allClientsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      options,
      shifts,
      activeShift: activeShift || 'ALL',
      allUsers,
      shiftUsers,
      pmUsers,
      upworkClients,
      upworkProjectClients,
      maActiveSessions,
      activeUpworkSessions: [],
      snapshotDate: fromDate,
    };
  }

  await captureTaskMapDailySnapshot(fromDate, snapshotData, params?.actorId || 'system');
  retainedTasksCount = snapshotData.tasks?.length || 0;

  // 2. Clear held/unlinked last-inputted sheet sessions in Redis & memory at 12:00 AM rollover
  await clearMaActiveSessions().catch(() => {});

  // 3. 12:00 AM Daily Rollover for tasks in the Task Map section:
  //    - Tasks actively being progressed by a user (IN PROGRESS or live sheet timeIn without timeOut, and NOT Paused) STAY with that user.
  //    - All other assigned/queued Task Map tasks hand over to Available Tasks (statuses = ['Hand-over'], handedOver = true, assigneeId = null), with ZERO main status changes.
  //    - Already-unassigned tasks in Available Tasks keep their existing sub-statuses untouched.
  const toDateObj = new Date(`${toDate}T08:00:00+08:00`);
  let rolledCount = 0;

  for (const t of currentTasks as any[]) {
    if (isNonTaskMapSectionStatus(t.status)) continue;

    const rec = recMap.get(t.id);
    const reviewsList = parsePmReviewsSafe(rec?.pmReviews);
    const hasPmAssignment = reviewsList.some(
      (r: any) => r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId && r?.assignedTo
    );
    const hasAssignedUser = Boolean(
      t.assigneeId || (Array.isArray(t.assignees) && t.assignees.length > 0) || hasPmAssignment
    );

    const isPaused = (rec?.statuses || []).some((s: string) => normalizeRolloverStatus(s) === 'PAUSED');
    const hasLiveSheetProgress = reviewsList.some(
      (r: any) => r?.type === 'SHEET_PROGRESS' && Boolean(r?.timeIn) && !r?.timeOut && !r?.isMissingTime
    );
    const isActivelyProgressed = hasAssignedUser && !isPaused && hasLiveSheetProgress;

    if (hasAssignedUser && !isActivelyProgressed) {
      // Hand over to Available Tasks without changing Task.status
      await prisma.task.update({
        where: { id: t.id },
        data: {
          assigneeId: null,
          assignees: { set: [] },
        },
      });

      const nowIso = new Date().toISOString();
      let reviewsModified = false;
      const cleanedReviews = reviewsList
        .filter((r: any) => !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId))
        .map((r: any) => {
          if (r?.type === 'UPWORK_SESSION' && r.active) {
            reviewsModified = true;
            return { ...r, active: false, stoppedAt: r.stoppedAt || nowIso };
          }
          return r;
        });

      if (cleanedReviews.length !== reviewsList.length) {
        reviewsModified = true;
      }

      if (isRedisReady()) {
        await redis.hdel('task_map:upwork_active', t.id).catch(() => {});
      }

      await updateTaskMapRecord(t.id, {
        statuses: ['Hand-over'],
        handedOver: true,
        shiftDate: toDateObj,
        rolloverCount: (rec?.rolloverCount || 0) + 1,
        originShift: rec?.originShift || rec?.shift || activeShift || 'DAY',
        originDate: rec?.originDate || rec?.shiftDate || toDateObj,
        ...(reviewsModified ? { pmReviews: cleanedReviews } : {}),
      });

      rolledCount++;
    } else if (rec) {
      // Keep active progressed tasks with their user and keep unassigned pool tasks' existing sub-statuses
      await updateTaskMapRecord(t.id, {
        shiftDate: toDateObj,
        rolloverCount: (rec.rolloverCount || 0) + 1,
        originShift: rec.originShift || rec.shift,
        originDate: rec.originDate || rec.shiftDate,
      });
    }
  }

  // 4. Apply the same 12:00 AM handover rule to subtasks in the Task Map section
  try {
    const openSubtasks = await prisma.subtask.findMany({
      where: { completed: false },
      select: {
        id: true,
        taskId: true,
        status: true,
        assigneeId: true,
        assignees: { select: { id: true } },
        task: { select: { status: true } },
      },
    });

    const latestRecs = await prisma.taskMapRecord.findMany({
      where: { pmReviews: { not: null as any } },
      select: { taskId: true, pmReviews: true },
    });
    const latestReviewsByTask = new Map<string, any[]>(
      latestRecs.map((r) => [r.taskId, parsePmReviewsSafe(r.pmReviews)])
    );
    const modifiedTaskIds = new Set<string>();

    for (const st of openSubtasks) {
      if (isNonTaskMapSectionStatus(st.task?.status) || isNonTaskMapSectionStatus(st.status)) {
        continue;
      }

      const taskRevs = latestReviewsByTask.get(st.taskId) || [];
      const hasSubPmAssignment = taskRevs.some(
        (r: any) => r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === st.id && r?.assignedTo
      );
      const hasSubAssignee = Boolean(
        st.assigneeId || (Array.isArray(st.assignees) && st.assignees.length > 0) || hasSubPmAssignment
      );

      if (!hasSubAssignee) continue;

      const subState = taskRevs.find((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === st.id);
      const isSubPaused = Array.isArray(subState?.statuses) &&
        subState.statuses.some((s: string) => normalizeRolloverStatus(s) === 'PAUSED');
      const isSubActivelyProgressed = false;

      if (!isSubActivelyProgressed) {
        if (st.assigneeId || (st.assignees && st.assignees.length > 0)) {
          await prisma.subtask.update({
            where: { id: st.id },
            data: { assigneeId: null, assignees: { set: [] } },
          });
        }

        const nextRevs = taskRevs.filter(
          (r: any) => !(r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === st.id)
        );
        const subIdx = nextRevs.findIndex(
          (r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === st.id
        );
        const nextSubState = {
          type: 'SUBTASK_STATE',
          subtaskId: st.id,
          statuses: ['Hand-over'],
          handedOver: true,
          updatedAt: new Date().toISOString(),
        };
        if (subIdx !== -1) {
          nextRevs[subIdx] = nextSubState;
        } else {
          nextRevs.push(nextSubState);
        }
        latestReviewsByTask.set(st.taskId, nextRevs);
        modifiedTaskIds.add(st.taskId);
        rolledCount++;
      }
    }

    for (const parentTaskId of modifiedTaskIds) {
      const updatedRevs = latestReviewsByTask.get(parentTaskId) || [];
      await prisma.$executeRawUnsafe(
        `UPDATE "TaskMapRecord" SET "pmReviews" = $1::jsonb, "updatedAt" = NOW() WHERE "taskId" = $2`,
        JSON.stringify(updatedRevs),
        parentTaskId
      );
    }
  } catch (err: any) {
    logger.warn({ err }, 'Failed to process subtask rollover during 12:00 AM daily rollover');
  }

  // Log daily rollover in AuditLog
  const validRolloverUserId = await getEffectiveUserId(params?.actorId);
  await prisma.auditLog.create({
    data: {
      action: 'TASK_MAP_DAILY_ROLLOVER',
      entity: 'TASK_MAP',
      entityId: `${fromDate}->${toDate}`,
      userId: validRolloverUserId,
      details: {
        fromDate,
        toDate,
        rolledCount,
        retainedTasksCount,
        note: '12:00 AM daily rollover: previous date preserved in snapshot; non-progressed Task Map tasks handed over to Available tasks while active IN PROGRESS tasks stay with their user',
        timestamp: new Date().toISOString(),
      },
    },
  });

  await invalidateCache('task:*', 'tasks:all', 'task_map:*');

  getIo()?.emit('task_map:updated');
  getIo()?.emit('task_map:daily_rollover', { fromDate, toDate, rolledCount, retainedTasksCount });

  return {
    success: true,
    rolledCount,
    retainedDate: fromDate,
    newDate: toDate,
    retainedTasksCount,
  };
}

/**
 * Resolves the single active handler (`assigneeId`) as the most recently assigned user,
 * preserving the current handler if still present during removals.
 */
export function resolveLatestAssigneeId(params: {
  nextIds: string[];
  previousIds?: string[];
  currentAssigneeId?: string | null;
  explicitAssigneeId?: string | null;
}): string | null {
  const { nextIds, previousIds = [], currentAssigneeId = null, explicitAssigneeId } = params;
  if (explicitAssigneeId !== undefined) {
    if (!explicitAssigneeId) return null;
    if (nextIds.length === 0 || nextIds.includes(explicitAssigneeId)) {
      return explicitAssigneeId;
    }
  }
  if (nextIds.length === 0) return null;
  const prevSet = new Set(previousIds);
  const newlyAdded = nextIds.filter((id) => !prevSet.has(id));
  if (newlyAdded.length > 0) {
    return newlyAdded[newlyAdded.length - 1];
  }
  if (currentAssigneeId && nextIds.includes(currentAssigneeId)) {
    return currentAssigneeId;
  }
  return nextIds[nextIds.length - 1];
}

/**
 * Clears Task Map handover state and invalidates Task Map caches when a user is assigned directly.
 */
export function isOnHoldStatus(status?: string | null): boolean {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return s === 'ONHOLD';
}

/**
 * Cascades On-Hold state from a Parent Task down to all of its non-closed child subtasks
 * (never affects already-closed subtasks, and never bubbles up from a subtask).
 */
export async function cascadeParentOnHoldToSubtasks(params: {
  parentTaskId: string;
  listId?: string | null;
  actorId?: string | null;
  actorName?: string;
}): Promise<number> {
  const { parentTaskId, listId, actorId, actorName } = params;
  if (!parentTaskId) return 0;

  const openSubtasks = await prisma.subtask.findMany({
    where: {
      taskId: parentTaskId,
      completed: false,
    },
    select: {
      id: true,
      title: true,
      status: true,
      completed: true,
      task: {
        select: {
          listId: true,
          list: {
            select: {
              statuses: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const nonClosed = openSubtasks.filter((st) => !st.completed && !isClosedStatus(st.status));
  if (nonClosed.length === 0) return 0;

  const listStatuses = nonClosed[0]?.task?.list?.statuses || [];
  const matchingOnHold = listStatuses.find((s) => isOnHoldStatus(s.name));
  const canonicalOnHoldStatus = matchingOnHold?.name || 'ON-HOLD';
  const resolvedListId = listId || nonClosed[0]?.task?.listId || null;

  let actorUser: { id: string; name: string; avatarUrl: string | null } | null = null;
  if (actorId) {
    actorUser = await prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, name: true, avatarUrl: true },
    });
  }
  const effectiveActorName = actorUser?.name || actorName || 'System';
  const effectiveUserId = actorUser?.id || (await getEffectiveUserId(actorId));

  const parentRecord = await getOrCreateTaskMapRecord(parentTaskId);
  const reviewsList = parsePmReviewsSafe(parentRecord.pmReviews);
  const io = getIo();
  const nowIso = new Date().toISOString();

  let updatedStatusCount = 0;
  let reviewsChanged = false;
  const changedSubtaskStates: Array<{ subtaskId: string; statuses: string[]; handedOver: boolean }> = [];

  for (const st of nonClosed) {
    if (!isOnHoldStatus(st.status)) {
      const updatedSub = await prisma.subtask.update({
        where: { id: st.id },
        data: { status: canonicalOnHoldStatus },
        include: {
          User: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
          assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        },
      });
      updatedStatusCount++;

      let logCreatedAt = new Date();
      let logId = `onhold-cascade-${st.id}-${Date.now()}`;
      if (effectiveUserId) {
        const log = await prisma.auditLog.create({
          data: {
            action: 'STATUS_CHANGE',
            entity: 'TASK',
            entityId: parentTaskId,
            userId: effectiveUserId,
            details: {
              oldStatus: st.status || 'PENDING',
              newStatus: updatedSub.status,
              subtaskId: st.id,
              subtaskTitle: st.title,
              source: 'parent_on_hold_cascade',
            },
          },
        }).catch(() => null);
        if (log) {
          logId = log.id;
          logCreatedAt = log.createdAt;
        }
      }

      io?.emit('subtask_updated', { taskId: parentTaskId, subtask: updatedSub });
      io?.emit('task_activity', {
        listId: resolvedListId,
        taskId: parentTaskId,
        activity: {
          id: logId,
          type: 'status_change',
          author: effectiveActorName,
          oldStatus: st.status || 'PENDING',
          newStatus: updatedSub.status,
          subtaskId: st.id,
          subtaskTitle: st.title,
          date: logCreatedAt,
          user: actorUser,
        },
      });
    }

    const subIdx = reviewsList.findIndex(
      (r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === st.id
    );
    const prevEntry = subIdx !== -1 ? reviewsList[subIdx] : null;
    const prevStatuses: string[] = Array.isArray(prevEntry?.statuses) ? prevEntry.statuses : [];
    const alreadySubOnHold = prevStatuses.length === 1 && isOnHoldStatus(prevStatuses[0]);

    if (!alreadySubOnHold) {
      const nextEntry = {
        type: 'SUBTASK_STATE',
        subtaskId: st.id,
        statuses: ['On-hold'],
        handedOver: Boolean(prevEntry?.handedOver),
        updatedAt: nowIso,
      };
      if (subIdx !== -1) reviewsList[subIdx] = nextEntry;
      else reviewsList.push(nextEntry);
      reviewsChanged = true;
      changedSubtaskStates.push({
        subtaskId: st.id,
        statuses: nextEntry.statuses,
        handedOver: nextEntry.handedOver,
      });
    }
  }

  let updatedParentRecord = parentRecord;
  if (reviewsChanged) {
    updatedParentRecord = await updateTaskMapRecord(parentTaskId, { pmReviews: reviewsList });
  }

  if (updatedStatusCount > 0 || reviewsChanged) {
    await invalidateCache(
      `task:${parentTaskId}`,
      'tasks:all',
      'dashboard:all',
      'lists:all',
      'task_map:all'
    ).catch(() => {});

    for (const stState of changedSubtaskStates) {
      io?.emit('task_map:updated', {
        taskId: `subtask:${stState.subtaskId}`,
        subtaskId: stState.subtaskId,
        parentTaskId,
        statuses: stState.statuses,
        handedOver: stState.handedOver,
        taskMap: {
          ...updatedParentRecord,
          taskId: `subtask:${stState.subtaskId}`,
          subtaskId: stState.subtaskId,
          statuses: stState.statuses,
          handedOver: stState.handedOver,
        },
      });
    }
  }

  return updatedStatusCount;
}

export async function syncTaskMapOnDirectAssign(
  taskId: string,
  subtaskId?: string | null,
  assigneeId?: string | null
): Promise<void> {
  try {
    const rec = await getOrCreateTaskMapRecord(taskId);
    const cleanStatuses = (arr: string[] = []) =>
      arr.filter((s) => {
        const norm = s.trim().toUpperCase().replace(/[\s_-]+/g, '');
        return norm !== 'HANDOVER' && norm !== 'AVAILABLETASK';
      });

    let reviews: any[] = [];
    if (typeof rec.pmReviews === 'string') {
      try { reviews = JSON.parse(rec.pmReviews); } catch { reviews = []; }
    } else if (Array.isArray(rec.pmReviews)) {
      reviews = [...rec.pmReviews];
    }

    if (!assigneeId) {
      // Unassigned directly: clear any stale PM_ASSIGNMENT for this task/subtask so it leaves the column
      const filteredReviews = reviews.filter((r: any) =>
        subtaskId
          ? !(r?.type === 'PM_ASSIGNMENT' && r?.subtaskId === subtaskId)
          : !(r?.type === 'PM_ASSIGNMENT' && !r?.subtaskId)
      );

      if (subtaskId) {
        const idx = filteredReviews.findIndex((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === subtaskId);
        const existing = idx !== -1 && Array.isArray(filteredReviews[idx].statuses) ? filteredReviews[idx].statuses : [];
        const nextEntry = {
          type: 'SUBTASK_STATE',
          subtaskId,
          statuses: existing,
          handedOver: true,
          updatedAt: new Date().toISOString(),
        };
        if (idx !== -1) filteredReviews[idx] = nextEntry;
        else filteredReviews.push(nextEntry);
        await updateTaskMapRecord(taskId, { pmReviews: filteredReviews });
      } else {
        await updateTaskMapRecord(taskId, {
          handedOver: true,
          ...(filteredReviews.length !== reviews.length ? { pmReviews: filteredReviews } : {}),
        });
      }

      await invalidateCache('task_map:all', 'task_map:*').catch(() => {});
      getIo()?.emit('task_map:updated', {
        taskId: subtaskId ? `subtask:${subtaskId}` : taskId,
        ...(subtaskId ? { subtaskId, parentTaskId: taskId } : {}),
        assigneeId: null,
        assignee: null,
        handedOver: true,
      });
      return;
    }

    if (subtaskId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, name: true, roles: true },
      });
      const parentTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      const parentStatusNorm = (parentTask?.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const isReviewOrCrm = ['TOREVIEW', 'INREVIEW', 'REVIEW', 'CHECKING', 'INCHECKING', 'CRM', 'WAITING', 'SENT', 'CLOSED', 'DONE'].includes(parentStatusNorm);
      const userRoles = (targetUser?.roles || []).map((r) => r.toLowerCase());
      const isPureReviewer =
        userRoles.some((r) => r.includes('audit') || r.includes('crm') || r.includes('funnel')) &&
        !userRoles.some((r) => r === 'ma' || r.includes('marketing associate') || r.includes('dev') || r.includes('pm'));

      if (targetUser && !isReviewOrCrm && !isPureReviewer) {
        reviews = reviews.filter((r: any) => !(r?.type === 'ORIGINAL_MA' && r?.subtaskId === subtaskId));
        reviews.push({
          type: 'ORIGINAL_MA',
          subtaskId,
          userId: targetUser.id,
          userName: targetUser.name,
          updatedAt: new Date().toISOString(),
        });
      }

      const idx = reviews.findIndex((r: any) => r?.type === 'SUBTASK_STATE' && r?.subtaskId === subtaskId);
      const existing = idx !== -1 && Array.isArray(reviews[idx].statuses) ? reviews[idx].statuses : [];
      const nextEntry = {
        type: 'SUBTASK_STATE',
        subtaskId,
        statuses: cleanStatuses(existing),
        handedOver: false,
        updatedAt: new Date().toISOString(),
      };
      if (idx !== -1) reviews[idx] = nextEntry;
      else reviews.push(nextEntry);

      await updateTaskMapRecord(taskId, { pmReviews: reviews });
    } else {
      const targetUser = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, name: true, roles: true },
      });
      const taskInfo = await prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      const statusNorm = (taskInfo?.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const isReviewOrCrm = ['TOREVIEW', 'INREVIEW', 'REVIEW', 'CHECKING', 'INCHECKING', 'CRM', 'WAITING', 'SENT', 'CLOSED', 'DONE'].includes(statusNorm);
      const userRoles = (targetUser?.roles || []).map((r) => r.toLowerCase());
      const isPureReviewer =
        userRoles.some((r) => r.includes('audit') || r.includes('crm') || r.includes('funnel')) &&
        !userRoles.some((r) => r === 'ma' || r.includes('marketing associate') || r.includes('dev') || r.includes('pm'));

      let updatedReviews = reviews;
      let shouldUpdateReviews = false;
      if (targetUser && !isReviewOrCrm && !isPureReviewer) {
        updatedReviews = reviews.filter((r: any) => !(r?.type === 'ORIGINAL_MA' && !r?.subtaskId));
        updatedReviews.push({
          type: 'ORIGINAL_MA',
          userId: targetUser.id,
          userName: targetUser.name,
          updatedAt: new Date().toISOString(),
        });
        shouldUpdateReviews = true;
      }

      const nextStatuses = cleanStatuses(rec.statuses || []);
      await updateTaskMapRecord(taskId, {
        statuses: nextStatuses,
        handedOver: false,
        ...(shouldUpdateReviews ? { pmReviews: updatedReviews } : {}),
      });
    }

    await invalidateCache('task_map:all', 'task_map:*').catch(() => {});
    getIo()?.emit('task_map:updated', {
      taskId: subtaskId ? `subtask:${subtaskId}` : taskId,
      ...(subtaskId ? { subtaskId, parentTaskId: taskId } : {}),
      assigneeId,
      handedOver: false,
    });
  } catch (err) {
    logger.warn({ err, taskId, subtaskId }, 'syncTaskMapOnDirectAssign failed');
  }
}
