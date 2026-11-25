import { prisma } from '../config/prisma';
import { getManilaDateStr, isClosedStatus, parseManilaTimeToIso } from './taskMapService';

export interface UpsertDailySheetLogInput {
  date?: string | null;
  maName: string;
  userId?: string | null;
  taskId?: string | null;
  subtaskId?: string | null;
  sheetRow?: number | null;
  spreadsheetId?: string | null;
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
  source?: string;
}

/**
 * Normalizes any incoming sheet date string (YYYY-MM-DD, MM/DD/YYYY, "Wednesday, November 25, 2026")
 * into canonical YYYY-MM-DD in Asia/Manila timezone.
 */
export function normalizeSheetDateKey(rawDate?: string | null): string {
  const raw = (rawDate || '').trim();
  if (!raw) return getManilaDateStr();

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }

  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return getManilaDateStr(parsed);
  }

  return getManilaDateStr();
}

function isFinishedStatus(status?: string | null): boolean {
  if (!status) return false;
  if (isClosedStatus(status)) return true;
  const s = status.trim().toUpperCase().replace(/[\s_-]+/g, '');
  return (
    s === 'TOREVIEW' ||
    s === 'INREVIEW' ||
    s === 'HANDOVER' ||
    s === 'HANDEDOVER' ||
    s === 'ONHOLD' ||
    s === 'PAUSED'
  );
}

/**
 * Stores or updates a livework / sheet submission in DailySheetLog for that day.
 * Acts as the historical ledger for the day, and automatically closes older open live
 * entries for the same MA when a newer live row is clocked in.
 */
export async function upsertDailySheetLog(input: UpsertDailySheetLogInput) {
  const maName = (input.maName || '').trim();
  if (!maName) return null;

  const maKey = maName.toLowerCase();
  const dateKey = normalizeSheetDateKey(input.date);
  const cleanTimeIn = input.timeIn ? String(input.timeIn).trim() : null;
  const cleanTimeOut = input.timeOut ? String(input.timeOut).trim() : null;
  const isMissingTime = Boolean(input.isMissingTime);
  const status = input.status ? String(input.status).trim() : null;
  const sheetRow = input.sheetRow && Number(input.sheetRow) > 0 ? Number(input.sheetRow) : null;

  const isLive = Boolean(
    cleanTimeIn &&
      !cleanTimeOut &&
      !isMissingTime &&
      !isFinishedStatus(status)
  );

  const startedAtIso = cleanTimeIn ? parseManilaTimeToIso(dateKey, cleanTimeIn) : null;
  const endedAtIso = cleanTimeOut ? parseManilaTimeToIso(dateKey, cleanTimeOut) : null;
  const startedAt = startedAtIso ? new Date(startedAtIso) : null;
  const endedAt = endedAtIso ? new Date(endedAtIso) : null;

  // Match existing entry for the same day + MA + sheetRow (if provided),
  // or same day + MA + taskId when updating an open session without sheetRow.
  let existing = null;
  if (sheetRow) {
    existing = await prisma.dailySheetLog.findFirst({
      where: { dateKey, maKey, sheetRow },
      orderBy: { submittedAt: 'desc' },
    });
  } else if (input.taskId) {
    existing = await prisma.dailySheetLog.findFirst({
      where: {
        dateKey,
        maKey,
        taskId: input.taskId,
        ...(cleanTimeOut ? {} : { timeOut: null }),
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  const dataPayload = {
    dateKey,
    dateDisplay: input.date ? String(input.date).trim() : existing?.dateDisplay || dateKey,
    maName,
    maKey,
    userId: input.userId !== undefined ? input.userId : existing?.userId || null,
    taskId: input.taskId !== undefined ? input.taskId : existing?.taskId || null,
    subtaskId: input.subtaskId !== undefined ? input.subtaskId : existing?.subtaskId || null,
    sheetRow: sheetRow ?? existing?.sheetRow ?? null,
    spreadsheetId: input.spreadsheetId !== undefined ? input.spreadsheetId : existing?.spreadsheetId || null,
    client: input.client !== undefined ? input.client : existing?.client || null,
    taskName: input.taskName !== undefined ? input.taskName : existing?.taskName || null,
    timeIn: cleanTimeIn ?? existing?.timeIn ?? null,
    timeOut: cleanTimeOut !== undefined ? cleanTimeOut : existing?.timeOut ?? null,
    isMissingTime,
    isUpwork: input.isUpwork !== undefined ? Boolean(input.isUpwork) : existing?.isUpwork ?? false,
    timeTracker: input.timeTracker !== undefined ? input.timeTracker : existing?.timeTracker || null,
    status: status ?? existing?.status ?? null,
    taskDeliverables:
      input.taskDeliverables !== undefined
        ? input.taskDeliverables
        : existing?.taskDeliverables || null,
    taskUpdateAndDeliverables:
      input.taskUpdateAndDeliverables !== undefined
        ? input.taskUpdateAndDeliverables
        : existing?.taskUpdateAndDeliverables || null,
    taskLink: input.taskLink !== undefined ? input.taskLink : existing?.taskLink || null,
    source: input.source || existing?.source || 'GOOGLE_SHEET',
    isLive,
    startedAt: startedAt ?? existing?.startedAt ?? null,
    endedAt: endedAt ?? existing?.endedAt ?? null,
    submittedAt: new Date(),
  };

  let saved;
  if (existing) {
    saved = await prisma.dailySheetLog.update({
      where: { id: existing.id },
      data: dataPayload,
    });
  } else {
    saved = await prisma.dailySheetLog.create({
      data: dataPayload,
    });
  }

  // If this entry is live, close any older open live entries for this MA on the same day
  if (isLive) {
    const closeTimeOut = cleanTimeIn || '11:59 PM';
    await prisma.dailySheetLog.updateMany({
      where: {
        dateKey,
        maKey,
        isLive: true,
        id: { not: saved.id },
        ...(sheetRow ? { OR: [{ sheetRow: null }, { sheetRow: { lt: sheetRow } }] } : {}),
      },
      data: {
        isLive: false,
        timeOut: closeTimeOut,
        endedAt: startedAt || new Date(),
      },
    });
  }

  return saved;
}

/**
 * Deletes a DailySheetLog row when a Google Sheet row is explicitly cleared/deleted.
 */
export async function clearDailySheetLogRow(params: {
  date?: string | null;
  maName: string;
  sheetRow: number;
}) {
  const maKey = (params.maName || '').trim().toLowerCase();
  if (!maKey || !params.sheetRow || params.sheetRow <= 0) return 0;

  const dateKey = normalizeSheetDateKey(params.date);
  const res = await prisma.dailySheetLog.deleteMany({
    where: {
      dateKey,
      maKey,
      sheetRow: Number(params.sheetRow),
    },
  });
  return res.count;
}

/**
 * Fetches all DailySheetLog records for a given Manila dateKey (YYYY-MM-DD),
 * ordered with live entries first, then newest submission/start time.
 */
export async function getDailySheetLogsForDate(
  dateInput?: string | null,
  filters?: { maName?: string; search?: string }
) {
  const dateKey = normalizeSheetDateKey(dateInput);
  const maKeyFilter = filters?.maName && filters.maName !== 'ALL' ? filters.maName.trim().toLowerCase() : null;

  const logs = await prisma.dailySheetLog.findMany({
    where: {
      dateKey,
      ...(maKeyFilter ? { maKey: maKeyFilter } : {}),
    },
    orderBy: [{ isLive: 'desc' }, { submittedAt: 'desc' }, { sheetRow: 'desc' }],
  });

  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    return logs.filter(
      (l) =>
        (l.taskName || '').toLowerCase().includes(q) ||
        (l.client || '').toLowerCase().includes(q) ||
        (l.maName || '').toLowerCase().includes(q) ||
        (l.taskDeliverables || '').toLowerCase().includes(q) ||
        (l.taskUpdateAndDeliverables || '').toLowerCase().includes(q)
    );
  }

  return logs;
}

/**
 * Builds lookup maps for a date's DailySheetLog records so Task Map board sorting
 * and livework state can derive directly from that day's sheet submissions.
 */
export async function getDailySheetLogsIndexForDate(dateInput?: string | null) {
  const dateKey = normalizeSheetDateKey(dateInput);
  const logs = await getDailySheetLogsForDate(dateKey);

  const byTaskId = new Map<string, (typeof logs)[number]>();
  const liveByMaKey = new Map<string, (typeof logs)[number]>();

  for (const log of logs) {
    if (log.isLive && !liveByMaKey.has(log.maKey)) {
      liveByMaKey.set(log.maKey, log);
    }
    if (log.taskId) {
      const existing = byTaskId.get(log.taskId);
      // Prefer live entry first, then most recently submitted
      if (!existing || (!existing.isLive && log.isLive)) {
        byTaskId.set(log.taskId, log);
      }
    }
  }

  return { dateKey, logs, byTaskId, liveByMaKey };
}
