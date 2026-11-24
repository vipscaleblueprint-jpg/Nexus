import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger, errMsg } from '../config/logger';
import { runAutoQueue, runDailyAutoQueue } from '../services/autoQueue/autoQueueService';

/** Every 5 minutes: top up MAs on shift right now. */
export const AUTO_QUEUE_JOB = 'taskMapAutoQueue';
/** 5:00 AM Manila: hand out the whole Available pool to everyone scheduled today. */
export const AUTO_QUEUE_DAILY_JOB = 'taskMapAutoQueueDaily';

// Both do nothing while AUTO_QUEUE_MODE=off (see services/autoQueue/config.ts).
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
    const result = await runAutoQueue();
    return {
      mode: result.mode,
      skipped: result.skipped,
      queued: result.decisions.filter((d) => d.applied).length,
      decided: result.decisions.length,
    };
  },
  { connection: redis, concurrency: 1 },
);

autoQueueWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, job: job?.name }, `Task Map auto-queue failed: ${errMsg(err)}`);
});

autoQueueWorker.on('error', (err) => {
  logger.error(`Task Map auto-queue Redis error: ${errMsg(err)}`);
});
