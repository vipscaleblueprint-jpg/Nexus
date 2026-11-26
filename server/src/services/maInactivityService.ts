import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { invalidateCache } from './redisService';
import { getTaskMapOperationalDateStr } from './taskMapService';

function getIo() {
  try {
    return require('../server').io;
  } catch {
    return null;
  }
}

interface ShiftDutyHours {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

/**
 * Parses time string like "5:12 PM", "05:12 pm", "9:06:00 AM", "17:12" into minutes from start of day (0-1439).
 */
export function parseTimeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim().toLowerCase();
  const m = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;

  let hrs = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = (m[3] || '').toLowerCase();

  if (ampm === 'pm' && hrs < 12) hrs += 12;
  if (ampm === 'am' && hrs === 12) hrs = 0;
  if (hrs < 0 || hrs > 23 || mins < 0 || mins > 59) return null;

  return hrs * 60 + mins;
}

/**
 * Formats minutes from midnight back to 12-hour "h:mm A" format for logging and comments.
 */
export function formatMinutesToTime(mins: number): string {
  let hrs = Math.floor(mins / 60) % 24;
  const remM = mins % 60;
  const ampm = hrs >= 12 ? 'PM' : 'AM';
  if (hrs > 12) hrs -= 12;
  if (hrs === 0) hrs = 12;
  return `${hrs}:${remM.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Checks if current minute of day is inside a shift window (handles overnight shifts).
 */
export function isWithinShift(
  s: { startHour: number; startMinute?: number; endHour: number; endMinute?: number },
  currentTotalMinutes: number
): boolean {
  const startMins = s.startHour * 60 + (s.startMinute || 0);
  const endMins = s.endHour * 60 + (s.endMinute || 0);
  if (startMins <= endMins) {
    return currentTotalMinutes >= startMins && currentTotalMinutes < endMins;
  }
  // Overnight shift (e.g. 17:00 to 02:00)
  return currentTotalMinutes >= startMins || currentTotalMinutes < endMins;
}

/**
 * Retrieves current hour and minute in Asia/Manila (UTC+8).
 */
export function getCurrentManilaTime(date = new Date()): {
  hour: number;
  minute: number;
  totalMinutes: number;
  dateStr: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
  }

  // Handle midnight 24 edge case
  if (hour === 24) hour = 0;

  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
    dateStr: getTaskMapOperationalDateStr(date),
  };
}

/**
 * Checks all MAs with tasks in "In progress" status whose duty schedule ended
 * and who have logged no new activity/row in their daily schedule for >= 1 hour.
 *
 * Rules:
 *   triggerMinutes = max(dutyEndTime, lastActivityTime) + 60 minutes
 *   e.g. Bea schedule 8am-5pm:
 *     - If last row is 5:12pm -> trigger at 6:12pm (5:12pm + 1h)
 *     - If last row was 3:45pm -> trigger at 6:00pm (5:00pm + 1h)
 *     - If last row is 6:12pm (overtime) -> trigger at 7:12pm (6:12pm + 1h)
 *
 * When triggered:
 *   - Automatically changes task sub-status to "Hand-over"
 *   - Retains "In progress" main status
 *   - Moves task to Available tasks (assigneeId: null)
 */
export async function checkAndHandoverInactiveMaTasks(): Promise<{
  checkedCount: number;
  handedOverCount: number;
  details: Array<{ maName: string; taskIds: string[]; reason: string }>;
}> {
  const now = new Date();
  const manila = getCurrentManilaTime(now);

  // 1. Fetch active shift configs
  const shiftConfigs = await (prisma as any).auditShiftConfig.findMany({
    where: { isActive: true },
  }).catch(() => []);

  // 2. Query all tasks currently "In progress" assigned to an individual user
  const inProgressTasks = await prisma.task.findMany({
    where: {
      status: { in: ['IN PROGRESS', 'In progress', 'IN_PROGRESS'] },
      assigneeId: { not: null },
    },
    include: {
      assignee: { select: { id: true, name: true, email: true, roles: true } },
    },
  });

  if (inProgressTasks.length === 0) {
    return { checkedCount: 0, handedOverCount: 0, details: [] };
  }

  // Group in-progress tasks by assignee
  const tasksByMa = new Map<string, typeof inProgressTasks>();
  for (const t of inProgressTasks) {
    if (!t.assigneeId) continue;
    if (!tasksByMa.has(t.assigneeId)) {
      tasksByMa.set(t.assigneeId, []);
    }
    tasksByMa.get(t.assigneeId)!.push(t);
  }

  // 3. For each MA with in-progress tasks, check duty schedule and latest activity
  const results: Array<{ maName: string; taskIds: string[]; reason: string }> = [];
  let totalHandedOver = 0;

  for (const [maId, tasks] of tasksByMa.entries()) {
    const ma = tasks[0].assignee;
    if (!ma) continue;

    const maNameClean = (ma.name || ma.email || '').toLowerCase().trim();

    // Determine MA's duty schedule (defaults to Day Shift 8:00 AM - 6:30 PM Manila)
    let duty: ShiftDutyHours = {
      startHour: 8,
      startMinute: 0,
      endHour: 18,
      endMinute: 30,
    };

    // Match all shifts where MA is configured in memberIds or memberNames
    const userShifts = shiftConfigs.filter((s: any) => {
      const ids: string[] = s.memberIds || [];
      const names: string[] = (s.memberNames || []).map((n: string) => (n || '').toLowerCase().trim());
      return ids.includes(ma.id) || names.includes(maNameClean) || names.some((n: string) => maNameClean.includes(n));
    });

    const isCurrentlyOnShift = userShifts.some((s: any) => isWithinShift(s, manila.totalMinutes));

    if (userShifts.length > 0) {
      // Find the latest duty end time across all assigned shifts
      let maxEnd = -1;
      let chosenShift = userShifts[0];

      for (const s of userShifts) {
        let eMins = s.endHour * 60 + (s.endMinute || 0);
        if (s.endHour < s.startHour) {
          eMins += 24 * 60; // Handle overnight wrap
        }
        if (eMins > maxEnd) {
          maxEnd = eMins;
          chosenShift = s;
        }
      }

      duty = {
        startHour: chosenShift.startHour,
        startMinute: chosenShift.startMinute || 0,
        endHour: chosenShift.endHour,
        endMinute: chosenShift.endMinute || 0,
      };
    }

    const dutyEndMinutes = duty.endHour * 60 + duty.endMinute;

    // Determine MA's latest activity in daily schedule sheet for today
    let latestActivityMinutes: number | null = null;
    let latestActivityTimeStr: string | null = null;

    // Check TaskMapRecords for this MA
    const taskIds = tasks.map((t: any) => t.id);
    const records = await prisma.taskMapRecord.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, pmReviews: true, updatedAt: true },
    });

    for (const rec of records) {
      let revs: any = rec.pmReviews;
      if (typeof revs === 'string') {
        try { revs = JSON.parse(revs); } catch { revs = []; }
      }
      if (Array.isArray(revs)) {
        for (const r of revs) {
          if (r.type === 'SHEET_PROGRESS' && r.maName && (r.maName.toLowerCase().trim() === maNameClean || maNameClean.includes(r.maName.toLowerCase().trim()))) {
            const timeCandidate = r.timeOut || r.timeIn;
            const parsedM = parseTimeToMinutes(timeCandidate);
            if (parsedM !== null) {
              if (latestActivityMinutes === null || parsedM > latestActivityMinutes) {
                latestActivityMinutes = parsedM;
                latestActivityTimeStr = timeCandidate;
              }
            }
          }
        }
      }
    }

    // If no sheet progress time was found on these tasks, check the MA's most recent comments today
    if (latestActivityMinutes === null) {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const recentComment = await prisma.taskComment.findFirst({
        where: {
          userId: ma.id,
          createdAt: { gte: todayStart },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (recentComment) {
        const cManila = getCurrentManilaTime(recentComment.createdAt);
        latestActivityMinutes = cManila.totalMinutes;
        latestActivityTimeStr = formatMinutesToTime(cManila.totalMinutes);
      }
    }

    // Effective baseline: max(dutyEndTime, lastActivityTime)
    const effectiveBaselineMinutes = latestActivityMinutes !== null
      ? Math.max(dutyEndMinutes, latestActivityMinutes)
      : dutyEndMinutes;

    // Trigger time is exactly 1 hour after effective baseline
    const triggerMinutes = effectiveBaselineMinutes + 60;

    // Check if current time has reached or passed the trigger threshold.
    // Active shift check guarantees an MA on duty is never prematurely marked as past duty end.
    const isPastDutyEnd = !isCurrentlyOnShift && manila.totalMinutes >= dutyEndMinutes;
    const isPastTrigger = manila.totalMinutes >= triggerMinutes;

    if (isPastDutyEnd && isPastTrigger) {
      const reason = `Duty ended at ${formatMinutesToTime(dutyEndMinutes)}, latest activity was ${latestActivityTimeStr || 'none'} (threshold: ${formatMinutesToTime(triggerMinutes)}, current: ${formatMinutesToTime(manila.totalMinutes)})`;
      
      logger.info({ maId, maName: ma.name, reason, taskCount: tasks.length }, '[AutoHandover] Triggering automatic handover for inactive MA');

      const handedOverTaskIds: string[] = [];

      for (const t of tasks) {
        // Set sub-status to "Hand-over", keep cadence or in-progress main status, unassign MA to move to Available tasks
        const isCadence = ['DAILY', 'WEEKLY', 'MONTHLY'].includes((t.status || '').toUpperCase().trim());
        await prisma.task.update({
          where: { id: t.id },
          data: {
            assigneeId: null,
            assignees: { set: [] },
            status: isCadence ? t.status : (t.status || 'In progress'), // preserve cadence status or retain in-progress
          },
        });

        // Update TaskMapRecord
        await (prisma as any).taskMapRecord.upsert({
          where: { taskId: t.id },
          create: {
            taskId: t.id,
            statuses: ['Hand-over'],
            handedOver: true,
          },
          update: {
            statuses: ['Hand-over'],
            handedOver: true,
          },
        });

        // Add task comment documenting the automatic handover
        await prisma.taskComment.create({
          data: {
            taskId: t.id,
            userId: ma.id,
            content: `**Sub-status updated**: "Hand-over" (Shift ended & MA inactive — returned to Available tasks for reassignment) [System Auto-Handover]`,
          },
        }).catch(() => {});

        await invalidateCache(`task:${t.id}`, 'task-map:all', 'tasks:all');
        handedOverTaskIds.push(t.id);
      }

      totalHandedOver += handedOverTaskIds.length;
      results.push({
        maName: ma.name || ma.email,
        taskIds: handedOverTaskIds,
        reason,
      });

      // Broadcast real-time update
      getIo()?.emit('task_map:updated');
    }
  }

  return {
    checkedCount: tasksByMa.size,
    handedOverCount: totalHandedOver,
    details: results,
  };
}

export interface SheetActivityLogRow {
  rowNumber: number | null;
  date: string | null;
  timeIn: string | null;
  timeOut: string | null;
  client: string | null;
  task: string | null;
  status: string | null;
}

export interface MaSheetActivityStatus {
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

const INACTIVITY_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function formatGvizDateValue(raw: string): string | null {
  const m = raw.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const hasTime = m[4] !== undefined;

  if (year === 1899 && hasTime) {
    let hrs = parseInt(m[4], 10);
    const mins = parseInt(m[5], 10);
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    if (hrs > 12) hrs -= 12;
    if (hrs === 0) hrs = 12;
    return `${hrs}:${String(mins).padStart(2, '0')} ${ampm}`;
  }

  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function readGvizCell(cell: any): string | null {
  if (!cell) return null;
  if (cell.f !== undefined && cell.f !== null) {
    const formatted = String(cell.f).trim();
    if (formatted) return formatted;
  }
  if (cell.v !== undefined && cell.v !== null) {
    const raw = String(cell.v).trim();
    if (!raw) return null;
    if (raw.startsWith('Date(')) {
      return formatGvizDateValue(raw) || raw;
    }
    return raw;
  }
  return null;
}

function parseSheetDateToManilaKey(dateStr?: string | null): string | null {
  const raw = (dateStr || '').trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }

  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  const hasTime = /\d{1,2}:\d{2}/.test(raw);
  const parsed = hasTime ? new Date(raw) : new Date(`${raw} 12:00:00`);
  if (!isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  }
  return null;
}

function parseSheetRowManilaTimestamp(
  dateStr?: string | null,
  timeStr?: string | null,
  referenceStart?: Date | null
): Date | null {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return null;

  const dateKey = parseSheetDateToManilaKey(dateStr);
  if (!dateKey) return null;

  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  const dt = new Date(
    `${dateKey}T${String(hours).padStart(2, '0')}:${String(remMins).padStart(2, '0')}:00+08:00`
  );
  if (isNaN(dt.getTime())) return null;

  // Handle overnight shifts where Time Out passes midnight relative to Time In on the same row
  if (referenceStart && dt.getTime() < referenceStart.getTime()) {
    const diff = referenceStart.getTime() - dt.getTime();
    if (diff <= 16 * 60 * 60 * 1000) {
      return new Date(dt.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  return dt;
}

function formatElapsedMinutes(totalMinutes: number): string {
  const safeMins = Math.max(0, Math.round(totalMinutes));
  if (safeMins < 60) return `${safeMins}m`;
  const hours = Math.floor(safeMins / 60);
  const mins = safeMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

async function fetchLast5RowsFromGoogleSheet(dailySheetUrl: string): Promise<SheetActivityLogRow[] | null> {
  const idMatch = dailySheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch?.[1]) return null;
  const spreadsheetId = idMatch[1];
  const gidMatch = dailySheetUrl.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch?.[1] || null;

  const candidateUrls = [
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=2025`,
    ...(gid ? [`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&gid=${gid}`] : []),
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json`,
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const txt = await res.text();
      if (!txt || txt.trim().startsWith('<') || !txt.includes('setResponse(')) continue;

      const jsonStr = txt.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
      const parsed = JSON.parse(jsonStr);
      if (parsed?.status === 'error' || !Array.isArray(parsed?.table?.rows)) continue;

      const cols: Array<{ label?: string; id?: string }> = parsed.table.cols || [];
      const findColIdx = (patterns: string[], fallbackIdx: number) => {
        const idx = cols.findIndex((c) => {
          const lbl = (c?.label || '').toLowerCase().trim();
          return lbl && patterns.some((p) => lbl.includes(p));
        });
        return idx !== -1 ? idx : fallbackIdx;
      };

      const dateIdx = findColIdx(['date'], 0);
      const timeInIdx = findColIdx(['time in'], 1);
      const timeOutIdx = findColIdx(['time out'], 2);
      const clientIdx = findColIdx(['client'], 6);
      const taskIdx = findColIdx(['task:'], 8);
      const statusIdx = findColIdx(['task status'], 13);

      const activityRows: SheetActivityLogRow[] = [];
      let lastSeenDate: string | null = null;

      parsed.table.rows.forEach((row: any, idx: number) => {
        const cells = row?.c || [];
        const dateVal = readGvizCell(cells[dateIdx]);
        if (dateVal) lastSeenDate = dateVal;

        const timeIn = readGvizCell(cells[timeInIdx]);
        const timeOut = readGvizCell(cells[timeOutIdx]);
        const client = readGvizCell(cells[clientIdx]);
        const task = readGvizCell(cells[taskIdx]);
        const status = readGvizCell(cells[statusIdx]);

        // Skip empty / date-only template rows
        if (!timeIn && !timeOut && !client && !task) return;

        activityRows.push({
          rowNumber: idx + 2,
          date: dateVal || lastSeenDate,
          timeIn,
          timeOut,
          client,
          task,
          status,
        });
      });

      if (activityRows.length > 0) {
        return activityRows.slice(-5);
      }
    } catch {
      // Try next candidate URL
    }
  }

  return null;
}

/**
 * Checks whether a user (MA) is inactive by pulling the last 5 populated rows from their
 * Google Daily Schedule spreadsheet (falling back to DailySheetLog if unavailable) and
 * comparing current Manila time against the latest row's Time Out / Time In (> 2 hours = inactive).
 */
export async function checkMaSheetActivityStatus(userId: string): Promise<MaSheetActivityStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, dailySheetUrl: true },
  });

  if (!user) {
    return {
      userId,
      userName: 'Team Member',
      isInactive: false,
      thresholdHours: 2,
      elapsedMinutes: null,
      elapsedLabel: null,
      lastActivityAt: null,
      lastRow: null,
      recentRows: [],
      source: 'NONE',
      reason: 'User not found',
    };
  }

  const userName = user.name || user.email || 'Team Member';
  let recentRows: SheetActivityLogRow[] = [];
  let source: 'GOOGLE_SHEET' | 'DAILY_SHEET_LOG' | 'NONE' = 'NONE';

  if (user.dailySheetUrl) {
    const sheetRows = await fetchLast5RowsFromGoogleSheet(user.dailySheetUrl);
    if (sheetRows && sheetRows.length > 0) {
      recentRows = sheetRows;
      source = 'GOOGLE_SHEET';
    }
  }

  if (recentRows.length === 0) {
    const maKey = userName.trim().toLowerCase();
    const dbLogs = await prisma.dailySheetLog.findMany({
      where: {
        OR: [{ userId: user.id }, { maKey }],
      },
      orderBy: [{ dateKey: 'desc' }, { submittedAt: 'desc' }],
      take: 5,
    }).catch(() => []);

    if (dbLogs.length > 0) {
      recentRows = [...dbLogs]
        .reverse()
        .map((l) => ({
          rowNumber: l.sheetRow ?? null,
          date: l.dateDisplay || l.dateKey,
          timeIn: l.timeIn ?? null,
          timeOut: l.timeOut ?? null,
          client: l.client ?? null,
          task: l.taskName ?? null,
          status: l.status ?? null,
        }));
      source = 'DAILY_SHEET_LOG';
    }
  }

  if (recentRows.length === 0) {
    return {
      userId: user.id,
      userName,
      isInactive: true,
      thresholdHours: 2,
      elapsedMinutes: null,
      elapsedLabel: null,
      lastActivityAt: null,
      lastRow: null,
      recentRows: [],
      source,
      reason: 'No recent spreadsheet rows found for this user',
    };
  }

  // Scan backwards through the last 5 rows to find the most recent row with Time In or Time Out
  const now = new Date();
  let evaluatedRow: SheetActivityLogRow | null = null;
  let lastTimestamp: Date | null = null;

  for (let i = recentRows.length - 1; i >= 0; i--) {
    const row = recentRows[i];
    if (!row.timeIn && !row.timeOut) continue;
    const inAt = parseSheetRowManilaTimestamp(row.date, row.timeIn);
    const outAt = parseSheetRowManilaTimestamp(row.date, row.timeOut, inAt);
    const candidate = outAt || inAt;
    if (candidate) {
      evaluatedRow = row;
      lastTimestamp = candidate;
      break;
    }
  }

  if (!evaluatedRow || !lastTimestamp) {
    const fallbackRow = recentRows[recentRows.length - 1] || null;
    return {
      userId: user.id,
      userName,
      isInactive: true,
      thresholdHours: 2,
      elapsedMinutes: null,
      elapsedLabel: null,
      lastActivityAt: null,
      lastRow: fallbackRow,
      recentRows,
      source,
      reason: 'Last 5 spreadsheet rows have no valid Time In / Time Out',
    };
  }

  const rawDiffMs = now.getTime() - lastTimestamp.getTime();
  const diffMs = Math.max(0, rawDiffMs);
  const elapsedMinutes = Math.round(diffMs / 60000);
  const elapsedLabel = formatElapsedMinutes(elapsedMinutes);
  const isInactive = diffMs > INACTIVITY_THRESHOLD_MS;

  const refLabel = evaluatedRow.timeOut
    ? `Time Out ${evaluatedRow.timeOut}`
    : `Time In ${evaluatedRow.timeIn}`;

  const reason = isInactive
    ? `Last log (${refLabel}${evaluatedRow.date ? ` on ${evaluatedRow.date}` : ''}) was ${elapsedLabel} ago (> 2 hours)`
    : `Active (${refLabel} was ${elapsedLabel} ago)`;

  return {
    userId: user.id,
    userName,
    isInactive,
    thresholdHours: 2,
    elapsedMinutes,
    elapsedLabel,
    lastActivityAt: lastTimestamp.toISOString(),
    lastRow: evaluatedRow,
    recentRows,
    source,
    reason,
  };
}
