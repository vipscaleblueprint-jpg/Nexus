import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export const taskUpdatesQueue = new Queue('TaskUpdates', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
