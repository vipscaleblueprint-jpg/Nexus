import { prisma } from '../config/prisma';
import { randomUUID } from 'crypto';
import { io } from '../server';
import { getActiveManilaShift } from './auditAutoAssign';

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
