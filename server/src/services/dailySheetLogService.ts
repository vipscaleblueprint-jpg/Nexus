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
    // If not matched by sheetRow yet, check if there is an unrowed session for the same task
    if (!existing && input.taskId) {
      existing = await prisma.dailySheetLog.findFirst({
        where: {
          dateKey,
          maKey,
          taskId: input.taskId,
          subtaskId: input.subtaskId || null,
          sheetRow: null,
        },
        orderBy: { submittedAt: 'desc' },
      });
    }
  } else if (input.taskId) {
    existing = await prisma.dailySheetLog.findFirst({
      where: {
        dateKey,
        maKey,
        taskId: input.taskId,
        subtaskId: input.subtaskId || null,
        ...(cleanTimeOut ? {} : { timeOut: null }),
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  const resolvedSheetRow =
    input.sheetRow === null ? null : (sheetRow ?? existing?.sheetRow ?? null);

  const dataPayload = {
    dateKey,
    dateDisplay: input.date ? String(input.date).trim() : existing?.dateDisplay || dateKey,
    maName,
    maKey,
    userId: input.userId !== undefined ? input.userId : existing?.userId || null,
    taskId: input.taskId !== undefined ? input.taskId : existing?.taskId || null,
    subtaskId: input.subtaskId !== undefined ? input.subtaskId : existing?.subtaskId || null,
    sheetRow: resolvedSheetRow,
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

  // If the Google Spreadsheet (with an explicit sheetRow) updates this task/MA,
  // retire any unrowed (sheetRow: null) live NEXUS_BOARD sessions for the same task
  // so erased/replaced Nexus rows in the sheet never override the spreadsheet's Time In.
  if ((input.source === 'GOOGLE_SHEET' || !input.source) && sheetRow && saved.taskId) {
    await prisma.dailySheetLog.updateMany({
      where: {
        dateKey,
        isLive: true,
        id: { not: saved.id },
        taskId: saved.taskId,
        subtaskId: saved.subtaskId || null,
        sheetRow: null,
        ...(saved.userId ? { OR: [{ maKey }, { userId: saved.userId }] } : { maKey }),
      },
      data: {
        isLive: false,
        timeOut: cleanTimeOut || cleanTimeIn || '11:59 PM',
        endedAt: startedAt || new Date(),
      },
    });
  }

  // If this entry is live, close any older open live entries for this MA on the same day.
  // Match by account as well as name: the Task Map logs under the account name ("Cherilyn")
  // while the sheet logs under its title name ("Che"), and both are the same person.
  // Strictly avoid closing an entry for the same task or closing newly started unrowed sessions.
  if (isLive) {
    const closeTimeOut = cleanTimeIn || '11:59 PM';
    await prisma.dailySheetLog.updateMany({
      where: {
        dateKey,
        isLive: true,
        id: { not: saved.id },
        ...(saved.taskId ? { taskId: { not: saved.taskId } } : {}),
        AND: [
          saved.userId ? { OR: [{ maKey }, { userId: saved.userId }] } : { maKey },
          ...(sheetRow ? [{ OR: [{ sheetRow: { lt: sheetRow } }, { sheetRow: null }] }] : []),
        ],
      },
      data: {
        isLive: false,
        timeOut: closeTimeOut,
        endedAt: startedAt || new Date(),
      },
    });
  } else if (cleanTimeOut) {
    // When a Time Out arrives for this MA, close any lingering open live logs
    // on the same row, earlier rows, or unrowed sessions for this MA on the same day
    // so an older/unmatched "No task inputted" row cannot keep the MA live.
    await prisma.dailySheetLog.updateMany({
      where: {
        dateKey,
        isLive: true,
        id: { not: saved.id },
        AND: [
          saved.userId ? { OR: [{ maKey }, { userId: saved.userId }] } : { maKey },
          ...(sheetRow
            ? [{ OR: [{ sheetRow: { lte: sheetRow } }, { sheetRow: null }] }]
            : saved.taskId
              ? [{ OR: [{ taskId: saved.taskId }, { taskId: null }] }]
              : []),
        ],
      },
      data: {
        isLive: false,
        timeOut: cleanTimeOut,
        endedAt: endedAt || new Date(),
      },
    });
  }

  return saved;
}

/**
 * Closes every still-live DailySheetLog session for a task (or one of its subtasks).
 * The Task Map treats a live log as "working on it right now", so a card that leaves
 * In Progress (back to Queue, unassigned, On-hold) must end its session or it snaps back.
 * Pass subtaskId to close only that subtask's sessions; omit it to close all of the task's.
 */
export async function closeLiveDailySheetLogsForTask(params: {
  taskId: string;
  subtaskId?: string | null;
  timeOut: string;
}) {
  if (!params.taskId) return 0;
  const res = await prisma.dailySheetLog.updateMany({
    where: {
      taskId: params.taskId,
      ...(params.subtaskId ? { subtaskId: params.subtaskId } : {}),
      isLive: true,
    },
    data: { isLive: false, timeOut: params.timeOut, endedAt: new Date() },
  });
  return res.count;
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
  const bySubtaskId = new Map<string, (typeof logs)[number]>();
  const liveByMaKey = new Map<string, (typeof logs)[number]>();

  for (const log of logs) {
    if (log.isLive && !liveByMaKey.has(log.maKey)) {
      liveByMaKey.set(log.maKey, log);
    }
    if (log.subtaskId) {
      const existingSub = bySubtaskId.get(log.subtaskId);
      if (!existingSub || (!existingSub.isLive && log.isLive)) {
        bySubtaskId.set(log.subtaskId, log);
      }
    } else if (log.taskId) {
      const existing = byTaskId.get(log.taskId);
      // Prefer live entry first, then most recently submitted
      if (!existing || (!existing.isLive && log.isLive)) {
        byTaskId.set(log.taskId, log);
      }
    }
  }

  return { dateKey, logs, byTaskId, bySubtaskId, liveByMaKey };
}
