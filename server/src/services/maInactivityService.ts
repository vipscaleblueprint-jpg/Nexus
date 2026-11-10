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
 * Parses time string like "5:12 PM", "05:12 pm", "17:12" into minutes from start of day (0-1439).
 */
export function parseTimeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim().toLowerCase();
  const m = clean.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;

  let hrs = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = (m[3] || '').toLowerCase();

  if (ampm === 'pm' && hrs < 12) hrs += 12;
  if (ampm === 'am' && hrs === 12) hrs = 0;

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

    // Determine MA's duty schedule
    let duty: ShiftDutyHours = {
      startHour: 8,
      startMinute: 0,
      endHour: 17,
      endMinute: 0,
    };

    // Match by memberIds or memberNames in AuditShiftConfig
    const matchedShift = shiftConfigs.find((s: any) => {
      const ids: string[] = s.memberIds || [];
      const names: string[] = (s.memberNames || []).map((n: string) => (n || '').toLowerCase().trim());
      return ids.includes(ma.id) || names.includes(maNameClean) || names.some((n: string) => maNameClean.includes(n));
    });

    if (matchedShift) {
      duty = {
        startHour: matchedShift.startHour,
        startMinute: matchedShift.startMinute || 0,
        endHour: matchedShift.endHour,
        endMinute: matchedShift.endMinute || 0,
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

    // Check if current time has reached or passed the trigger threshold
    // (Ensure we are after duty end, so we never trigger early during the shift)
    const isPastDutyEnd = manila.totalMinutes >= dutyEndMinutes;
    const isPastTrigger = manila.totalMinutes >= triggerMinutes;

    if (isPastDutyEnd && isPastTrigger) {
      const reason = `Duty ended at ${formatMinutesToTime(dutyEndMinutes)}, latest activity was ${latestActivityTimeStr || 'none'} (threshold: ${formatMinutesToTime(triggerMinutes)}, current: ${formatMinutesToTime(manila.totalMinutes)})`;
      
      logger.info({ maId, maName: ma.name, reason, taskCount: tasks.length }, '[AutoHandover] Triggering automatic handover for inactive MA');

      const handedOverTaskIds: string[] = [];

      for (const t of tasks) {
        // Set sub-status to "Hand-over", keep "In progress" main status, unassign MA to move to Available tasks
        await prisma.task.update({
          where: { id: t.id },
          data: {
            assigneeId: null,
            assignees: { set: [] },
            status: 'In progress', // strictly retain in-progress main status
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
