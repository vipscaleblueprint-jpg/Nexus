import { Queue } from 'bullmq';
import { redis } from '../config/redis';

// Separate from DailyRollover so a slow AI run never delays the rollovers.
export const autoQueueQueue = new Queue('TaskMapAutoQueue', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1, // the next scheduled run is the retry
    removeOnComplete: true,
    removeOnFail: 50,
  },
});
