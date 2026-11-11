import { prisma } from '../config/prisma';
import { randomUUID } from 'crypto';
import { getActiveManilaShift } from './auditAutoAssign';
import { redis, isRedisReady, invalidateCache } from './redisService';

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
  return 'DAY';
}

export function fromTaskMapShiftKey(key: string): string {
  const norm = (key || '').trim().toUpperCase();
  if (norm === 'DAY' || norm === 'AM' || norm === 'MORNING') return 'AM';
  if (norm === 'NOON' || norm === 'PM_AFTERNOON' || norm === 'AFTERNOON') return 'PM_AFTERNOON';
  if (norm === 'NIGHT' || norm === 'PM_NIGHT') return 'PM_NIGHT';
  return 'AM';
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
  try {
    const activeAuditShift = await getActiveManilaShift();
    if (activeAuditShift && activeAuditShift !== 'OFF_SHIFT') {
      return toTaskMapShiftKey(activeAuditShift);
    }
  } catch (err) {
    // Fall back to local calculation
  }

  const shifts = await getShiftConfigs();
  if (shifts.length === 0) return 'DAY';

  const tz = shifts[0].timezone || 'Asia/Manila';
  const now = new Date();
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(now);

  const [hStr, mStr] = timeStr.split(':');
  const currentTotalMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

  for (const shift of shifts) {
    const startMins = shift.startHour * 60 + shift.startMinute;
    const endMins = shift.endHour * 60 + shift.endMinute;

    if (startMins <= endMins) {
      if (currentTotalMinutes >= startMins && currentTotalMinutes < endMins) {
        return shift.shiftKey;
      }
    } else {
      // Overnight shift, e.g. 17:00 to 01:00
      if (currentTotalMinutes >= startMins || currentTotalMinutes < endMins) {
        return shift.shiftKey;
      }
    }
  }

  return shifts[0]?.shiftKey || 'DAY';
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

// ---------------------------------------------------------------------------
// Upwork Client Management
// ---------------------------------------------------------------------------
export async function getUpworkClients(): Promise<string[]> {
  if (isRedisReady()) {
    try {
      const members = await redis.smembers('task_map:upwork_clients');
      if (members && members.length > 0) {
        return members.sort((a, b) => a.localeCompare(b));
      }
    } catch {}
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string }>>(
      `SELECT "label" FROM "TaskMapStatusOption" WHERE "label" LIKE 'UPWORK_CLIENT:%' ORDER BY "label" ASC`
    );
    const clients = rows.map((r) => r.label.replace('UPWORK_CLIENT:', '').trim()).filter(Boolean);
    if (isRedisReady() && clients.length > 0) {
      await redis.sadd('task_map:upwork_clients', ...clients).catch(() => {});
    }
    return clients;
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
  } catch {}
  if (isRedisReady()) {
    await redis.sadd('task_map:upwork_clients', clean).catch(() => {});
  }
  return getUpworkClients();
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
  } catch {}
  if (isRedisReady()) {
    await redis.srem('task_map:upwork_clients', clean).catch(() => {});
  }
  return getUpworkClients();
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
  } catch {}

  if (isRedisReady()) {
    try {
      await redis.del('task_map:upwork_clients');
      if (cleanList.length > 0) {
        await redis.sadd('task_map:upwork_clients', ...cleanList);
      }
    } catch {}
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
 * Returns operational date in Asia/Manila where each new day begins at 6:00 AM (not midnight).
 * Between 12:00 AM and 5:59 AM, operational date belongs to yesterday's shift.
 * At 6:00 AM, it rolls over to today's date.
 */
export function getTaskMapOperationalDateStr(date?: Date | string | null): string {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : new Date();
  if (isNaN(d.getTime())) return getManilaDateStr();

  try {
    const manilaHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        hour12: false,
      }).format(d)
    );

    // If before 6:00 AM Manila, operational date is yesterday
    if (manilaHour < 6) {
      const yesterday = new Date(d.getTime() - 24 * 60 * 60 * 1000);
      return getManilaDateStr(yesterday);
    }
    return getManilaDateStr(d);
  } catch {
    return getManilaDateStr(d);
  }
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

  // Always include today in Manila time
  set.add(getManilaDateStr());

  // Also include the reference mock dates Nov 1-5, 2026 for seamless UI journal browsing
  ['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01'].forEach((d) => set.add(d));

  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

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
  // If fromDate is not passed, use yesterday relative to 6:00 AM new day
  const fromDate = (params?.fromDate || getManilaDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000))).trim().split('T')[0];
  
  // Default toDate is today in Manila
  let toDate = (params?.toDate || getManilaDateStr()).trim().split('T')[0];
  if (!toDate || toDate === fromDate) {
    const fromD = new Date(`${fromDate}T00:00:00Z`);
    const nextD = new Date(fromD.getTime() + 24 * 60 * 60 * 1000);
    toDate = nextD.toISOString().split('T')[0];
  }

  // 1. Snapshot preservation for the previous date (if not provided, build from current TaskMap state)
  let retainedTasksCount = 0;
  let snapshotData = params?.snapshotPayload;
  if (!snapshotData) {
    // Query current tasks & pool to preserve yesterday's exact historical assignment
    const currentTasks = await prisma.task.findMany({
      where: { status: { notIn: ['KYC', 'PIN BOARD', 'PINBOARD'] } },
      include: {
        list: { select: { id: true, name: true, folder: { select: { id: true, name: true } } } },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
        assignees: { select: { id: true, name: true, email: true, avatarUrl: true, roles: true, systemRole: true } },
      },
    });
    const taskMapRecs = await prisma.taskMapRecord.findMany();
    const recMap = new Map(taskMapRecs.map((r) => [r.taskId, r]));
    const mappedTasks = currentTasks.map((t) => {
      const rec = recMap.get(t.id);
      return {
        ...t,
        taskMap: rec ? { id: rec.id, taskId: rec.taskId, statuses: rec.statuses, shift: rec.shift, shiftDate: rec.shiftDate } : null,
      };
    });
    snapshotData = {
      tasks: mappedTasks.filter((t) => Boolean(t.assigneeId)),
      availablePool: mappedTasks.filter((t) => !t.assigneeId),
      snapshotDate: fromDate,
    };
  }

  await captureTaskMapDailySnapshot(fromDate, snapshotData, params?.actorId || 'system');
  retainedTasksCount = snapshotData.tasks?.length || 0;

  // 2. Auto-reset all active workflow tasks to go back to Available tasks on the new 6:00 AM Task Map page
  // Set assigneeId to null and status to 'Pending' for all non-closed/non-CRM tasks
  await prisma.$executeRawUnsafe(
    `UPDATE "Task"
     SET "assigneeId" = NULL,
         "status" = 'Pending',
         "updatedAt" = NOW()
     WHERE UPPER("status") NOT IN ('CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED', 'CRM', 'WAITING')
       AND "assigneeId" IS NOT NULL`
  );

  // Update TaskMapRecord for all active tasks: shiftDate to new date, status to Available Task, reset handedOver
  const toDateObj = new Date(`${toDate}T08:00:00+08:00`);
  const updateResult: any = await prisma.$executeRawUnsafe(
    `UPDATE "TaskMapRecord" tmr
     SET "shiftDate" = $1,
         "statuses" = ARRAY['Available Task']::text[],
         "rolloverCount" = tmr."rolloverCount" + 1,
         "originShift" = COALESCE(tmr."originShift", tmr."shift"),
         "originDate" = COALESCE(tmr."originDate", tmr."shiftDate"),
         "handedOver" = false,
         "updatedAt" = NOW()
     FROM "Task" t
     WHERE tmr."taskId" = t."id"
       AND UPPER(t."status") NOT IN ('CLOSED', 'DONE', 'COMPLETE', 'COMPLETED', 'RESOLVED', 'CANCELLED', 'CRM', 'WAITING')`,
    toDateObj
  );

  const rolledCount = typeof updateResult === 'number' ? updateResult : 0;

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
        note: '6:00 AM daily turnover: previous date snapshotted; active tasks reset to Available tasks',
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
