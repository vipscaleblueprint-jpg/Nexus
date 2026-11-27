import { prisma } from '../config/prisma';
import { createLogger, errMsg } from '../config/logger';
import { invalidateCache } from './redisService';

const log = createLogger('shift-time-sync');
const db = prisma as any;

/**
 * Users granted Shift Times edit access in addition to ADMINs.
 * Special mention: gwyndelacruz.2903@gmail.com (Pau2x).
 */
export const SHIFT_TIME_EDITOR_EMAILS = new Set<string>([
  'gwyndelacruz.2903@gmail.com',
]);

export const DEFAULT_SHIFT_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/13MVe-HrNyxK_OX6jovK_d1x0mEYqd2ufBs17HW5wN50/gviz/tq?tqx=out:csv&gid=1341277542';

export function isShiftTimeSpecialEditor(email?: string | null): boolean {
  if (!email) return false;
  return SHIFT_TIME_EDITOR_EMAILS.has(email.trim().toLowerCase());
}

export function canEditShiftTimes(user?: { systemRole?: string | null; email?: string | null } | null): boolean {
  if (!user) return false;
  if (user.systemRole === 'ADMIN') return true;
  return isShiftTimeSpecialEditor(user.email);
}

/**
 * Normalizes a shift schedule string while preserving the exact canonical format
 * from Column X of the sheet, e.g. "M-F 9AM to 4PM", "T-S 5PM to 2AM", "T-F 8AM to 5PM".
 */
export function normalizeScheduleFormat(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  // Match canonical "<DAYS> <START> to <END>" (case-insensitive) and normalize casing
  const match = cleaned.match(
    /^([A-Za-z]+(?:-[A-Za-z]+)?)\s+(\d{1,2}(?::\d{2})?\s*[AaPp][Mm])\s+(?:to|-|–)\s+(\d{1,2}(?::\d{2})?\s*[AaPp][Mm])$/i
  );
  if (match) {
    const days = match[1].toUpperCase();
    const start = match[2].replace(/\s+/g, '').toUpperCase();
    const end = match[3].replace(/\s+/g, '').toUpperCase();
    return `${days} ${start} to ${end}`;
  }

  return cleaned;
}

function toolsBaseUrl(): string {
  const isDev = process.env.NODE_ENV === 'development';
  return (
    process.env.TOOLS_VIP_URL ||
    (isDev ? 'http://localhost:3001' : 'https://tools.vipscaleph.com')
  ).replace(/\/+$/, '');
}

function toolsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.VIPSCALE_API_KEY || '',
  };
}

export interface ShiftTimeWebhookPayload {
  userId: string;
  email: string;
  name: string;
  schedule: string;
  source: string;
  updatedBy?: string | null;
  updatedAt: string;
}

/**
 * Pushes a shift time change from Nexus to VIPScale Tools webhook.
 * Never throws so callers remain responsive even if VIPScale is temporarily unreachable.
 */
export async function pushShiftTimeToTools(
  payload: ShiftTimeWebhookPayload | ShiftTimeWebhookPayload[]
): Promise<boolean> {
  const body = Array.isArray(payload) ? { updates: payload, source: 'NEXUS' } : payload;
  try {
    const res = await fetch(`${toolsBaseUrl()}/api/webhooks/shift-times`, {
      method: 'POST',
      headers: toolsHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.warn(
        `VIPScale shift-times webhook rejected (${res.status}): ${await res.text().catch(() => '')}`
      );
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err }, `VIPScale shift-times webhook request failed: ${errMsg(err)}`);
    return false;
  }
}

/**
 * Optional outbound webhook for n8n / Google Sheets (Column X) sync when configured.
 */
export async function pushShiftTimeToSheetWebhook(
  payload: ShiftTimeWebhookPayload | ShiftTimeWebhookPayload[]
): Promise<boolean> {
  const webhookUrl = process.env.SHIFT_TIMES_SHEET_WEBHOOK_URL?.trim();
  if (!webhookUrl) return false;

  const body = Array.isArray(payload) ? { updates: payload } : payload;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.VIPSCALE_API_KEY ? { 'x-api-key': process.env.VIPSCALE_API_KEY } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.warn(`Sheet webhook rejected (${res.status}): ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err }, `Sheet webhook request failed: ${errMsg(err)}`);
    return false;
  }
}

export function queueShiftTimeWebhooks(
  payload: ShiftTimeWebhookPayload | ShiftTimeWebhookPayload[],
  options?: { skipTools?: boolean; skipSheet?: boolean }
) {
  if (!options?.skipTools) {
    void pushShiftTimeToTools(payload).catch((err) =>
      log.error({ err }, `pushShiftTimeToTools crashed: ${errMsg(err)}`)
    );
  }
  if (!options?.skipSheet) {
    void pushShiftTimeToSheetWebhook(payload).catch((err) =>
      log.error({ err }, `pushShiftTimeToSheetWebhook crashed: ${errMsg(err)}`)
    );
  }
}

/** Minimal RFC-4180 CSV parser for Google Sheets gviz CSV output. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface SheetScheduleRow {
  name: string;
  email: string;
  schedule: string;
}

/**
 * Fetches ONLY Column X ("Schedule:") along with Name (Col A) and Email (Col B)
 * from the configured Google Sheet.
 */
export async function fetchSchedulesFromSheet(
  csvUrl: string = process.env.SHIFT_TIMES_SHEET_CSV_URL || DEFAULT_SHIFT_SHEET_CSV_URL
): Promise<SheetScheduleRow[]> {
  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Sheet CSV (${res.status} ${res.statusText})`);
  }
  const csvText = await res.text();
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];

  const headerRow = rows[0].map((h) => h.trim().toLowerCase());
  const emailCol = headerRow.findIndex((h) => h === 'email');
  // Column X is 0-based index 23; also look up by header "schedule:" / "schedule"
  let scheduleCol = headerRow.findIndex((h) => h.startsWith('schedule'));
  if (scheduleCol === -1) scheduleCol = 23; // Column X fallback

  const nameCol = 0; // Column A
  const resolvedEmailCol = emailCol >= 0 ? emailCol : 1; // Column B fallback

  const results: SheetScheduleRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameCol] || '').trim();
    const email = (r[resolvedEmailCol] || '').trim().toLowerCase();
    const rawSchedule = (r[scheduleCol] || '').trim();
    if (!email || !rawSchedule) continue;
    results.push({
      name,
      email,
      schedule: normalizeScheduleFormat(rawSchedule),
    });
  }
  return results;
}

/**
 * Imports Column X schedules from the Google Sheet into Nexus `UserShiftTime`
 * keyed by Nexus `User.id` (UUID).
 */
export async function importShiftTimesFromSheet(options?: {
  updatedBy?: string | null;
  pushToTools?: boolean;
}) {
  const sheetRows = await fetchSchedulesFromSheet();
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
  });

  const userByEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u]));

  const synced: ShiftTimeWebhookPayload[] = [];
  const unmatched: SheetScheduleRow[] = [];

  for (const row of sheetRows) {
    const user = userByEmail.get(row.email);
    if (!user) {
      unmatched.push(row);
      continue;
    }

    const record = await db.userShiftTime.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        schedule: row.schedule,
        source: 'GOOGLE_SHEET',
        updatedBy: options?.updatedBy ?? 'google-sheet-import',
      },
      update: {
        schedule: row.schedule,
        source: 'GOOGLE_SHEET',
        updatedBy: options?.updatedBy ?? 'google-sheet-import',
      },
    });

    synced.push({
      userId: user.id,
      email: user.email,
      name: user.name,
      schedule: record.schedule,
      source: 'GOOGLE_SHEET',
      updatedBy: record.updatedBy,
      updatedAt: record.updatedAt.toISOString(),
    });
  }

  await invalidateCache('users:all');

  if (options?.pushToTools && synced.length > 0) {
    queueShiftTimeWebhooks(synced, { skipSheet: true });
  }

  return {
    totalSheetRows: sheetRows.length,
    syncedCount: synced.length,
    unmatchedCount: unmatched.length,
    synced,
    unmatched,
  };
}
