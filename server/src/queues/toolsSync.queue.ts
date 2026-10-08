import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export const toolsSyncQueue = new Queue('ToolsSync', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1, // the next scheduled run is the retry
    removeOnComplete: true,
    removeOnFail: 50,
  },
});
