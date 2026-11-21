import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger, errMsg } from '../config/logger';
import { runAutoQueue } from '../services/autoQueue/autoQueueService';

export const AUTO_QUEUE_JOB = 'taskMapAutoQueue';

// Moves Available tasks into on-shift MAs' columns (see autoQueueService). Does nothing while AUTO_QUEUE_MODE=off.
export const autoQueueWorker = new Worker(
  'TaskMapAutoQueue',
  async () => {
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
  logger.error({ jobId: job?.id }, `Task Map auto-queue failed: ${errMsg(err)}`);
});

autoQueueWorker.on('error', (err) => {
  logger.error(`Task Map auto-queue Redis error: ${errMsg(err)}`);
});
