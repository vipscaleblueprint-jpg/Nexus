import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger, errMsg } from '../config/logger';
import { runCheckpoint, runDailyAutoQueue } from '../services/autoQueue/autoQueueService';

/** Retired 5-minute top-up job name (kept exported only to clean stale repeatable jobs on startup). */
export const AUTO_QUEUE_JOB = 'taskMapAutoQueue';
/** 5:00 AM Manila: hand out Available tasks to the morning shift. */
export const AUTO_QUEUE_DAILY_JOB = 'taskMapAutoQueueDaily';
/** 1:00 PM Manila: check morning shift doability and hand over unfinished work to noon. */
export const AUTO_QUEUE_1PM_JOB = 'taskMapAutoQueue1pm';
/** 5:00 PM Manila: check noon shift doability, hand over to night, then fill night from Available tasks. */
export const AUTO_QUEUE_5PM_JOB = 'taskMapAutoQueue5pm';

// Runs are no-ops while AUTO_QUEUE_MODE=off (see services/autoQueue/config.ts).
export const autoQueueWorker = new Worker(
  'TaskMapAutoQueue',
  async (job) => {
    if (job.name === AUTO_QUEUE_DAILY_JOB) {
      // Throws AutoQueueBusyError if a PM is mid Reset/Distribute; the job's retries run it again shortly.
      const result = await runDailyAutoQueue();
      return {
        mode: result.mode,
        skipped: result.skipped,
        queued: result.decisions.filter((d) => d.applied).length,
        leftInPool: result.skippedTasks.length,
      };
    }
    if (job.name === AUTO_QUEUE_1PM_JOB || job.name === AUTO_QUEUE_5PM_JOB) {
      const kind = job.name === AUTO_QUEUE_1PM_JOB ? '1pm' : '5pm';
      const result = await runCheckpoint(kind);
      return {
        mode: result.mode,
        skipped: result.skipped,
        handedOver: result.handovers.filter((h) => h.applied).length,
        returned: result.returned.filter((r) => r.applied).length,
        atRisk: result.atRisk.length,
        nightQueued: result.nightFill ? result.nightFill.decisions.filter((d) => d.applied).length : 0,
      };
    }
    return { retired: true };
  },
  { connection: redis, concurrency: 1 },
);

autoQueueWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, job: job?.name }, `Task Map auto-queue failed: ${errMsg(err)}`);
});

autoQueueWorker.on('error', (err) => {
  logger.error(`Task Map auto-queue Redis error: ${errMsg(err)}`);
});
