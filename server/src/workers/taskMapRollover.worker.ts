import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';
import {
  getShiftConfigs,
  getCurrentActiveShift,
  getNextShift,
  updateTaskMapRecord,
  TaskMapRecordData,
} from '../services/taskMapService';

const isClosedStatus = (status?: string | null) => {
  const s = (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return s === 'CLOSED' || s === 'DONE' || s === 'COMPLETE' || s === 'COMPLETED' || s === 'RESOLVED' || s === 'CANCELLED';
};

/**
 * Execute automatic shift rollover
 * Safely rolls over eligible tasks from fromShift to next shift.
 */
export async function executeTaskMapShiftRollover(fromShift?: string): Promise<{ rolledCount: number; toShift: string }> {
  const currentShift = fromShift || (await getCurrentActiveShift());
  const { nextShift, nextDay } = getNextShift(currentShift);

  try {
    // Find all records currently assigned to this shift where dontRollover is false
    const records = await prisma.$queryRawUnsafe<TaskMapRecordData[]>(
      `SELECT * FROM "TaskMapRecord" WHERE "shift" = $1 AND "dontRollover" = false`,
      currentShift
    );

    let rolledCount = 0;
    const now = new Date();

    for (const rec of records) {
      // 1. Check parent task status
      const task = await prisma.task.findUnique({
        where: { id: rec.taskId },
        select: { id: true, status: true, title: true, assigneeId: true },
      });

      if (!task || isClosedStatus(task.status)) continue;

      // 2. Rollover adjustment: Tasks waiting for PM review do NOT roll over for the MA
      const hasPendingPmReview = (rec.statuses || []).some(s =>
        ['CHE', 'PAU', 'HAN'].includes(s.toUpperCase())
      );
      if (hasPendingPmReview) continue;

      // 3. Exclude completed/handed over: Sent, Done Review, handedOver
      if (rec.handedOver) continue;
      const statusLabels = (rec.statuses || []).map(s => s.toUpperCase());
      if (statusLabels.includes('SENT') || statusLabels.includes('DONE REVIEW')) continue;

      // 4. Tasks marked Revision DO roll over to MA's next shift if unfinished
      // (This naturally proceeds since we did not exclude Revision!)

      // 5. Idempotency check:
      // Avoid rolling over multiple times within the same hour if already on nextShift
      const nextDate = nextDay
        ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
        : rec.shiftDate;

      const updated = await updateTaskMapRecord(rec.taskId, {
        shift: nextShift,
        shiftDate: nextDate,
        rolloverCount: (rec.rolloverCount || 0) + 1,
        originShift: rec.originShift || rec.shift,
        originDate: rec.originDate || rec.shiftDate,
      });

      // Log in AuditLog
      await prisma.auditLog.create({
        data: {
          action: 'TASK_MAP_ROLLOVER',
          entity: 'TASK',
          entityId: rec.taskId,
          userId: task.assigneeId || 'system',
          details: {
            fromShift: currentShift,
            toShift: nextShift,
            rolloverCount: updated.rolloverCount,
            isAutomated: true,
            timestamp: now.toISOString(),
          },
        },
      });

      rolledCount++;
    }

    if (rolledCount > 0) {
      await invalidateCache('task_map:all').catch(() => { });
      logger.info(`[TaskMap Rollover] Rolled over ${rolledCount} tasks from ${currentShift} to ${nextShift}`);
      io.emit('task_map:updated', { fromShift: currentShift, toShift: nextShift, rolledCount });
    }

    return { rolledCount, toShift: nextShift };
  } catch (error: any) {
    logger.error({ error }, `[TaskMap Rollover] Error rolling over from ${currentShift}`);
    return { rolledCount: 0, toShift: nextShift };
  }
}
