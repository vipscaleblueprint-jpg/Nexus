import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/prisma';
import { createLogger, errMsg } from '../config/logger';

import { invalidateCache } from '../services/redisService';

const workerLog = createLogger('task-worker');

interface TaskUpdatePayload {
  taskId: string;
  data: any;
}

export const taskUpdateWorker = new Worker<TaskUpdatePayload>(
  'TaskUpdates',
  async (job: Job<TaskUpdatePayload>) => {
    const { taskId, data } = job.data;
    try {
      workerLog.debug({ taskId }, 'Processing task update job');
      
      await prisma.task.update({
        where: { id: taskId },
        data: data,
      });

      invalidateCache(`task:${taskId}`, 'tasks:all', 'dashboard:all').catch(() => {});

      workerLog.info({ taskId }, 'Task updated successfully in DB');
    } catch (err) {
      workerLog.error({ err, taskId }, `Failed to update task: ${errMsg(err)}`);
      throw err;
    }
  },
  { connection: redis }
);

taskUpdateWorker.on('completed', (job) => {
  workerLog.debug({ jobId: job.id }, 'Job completed');
});

taskUpdateWorker.on('failed', (job, err) => {
  workerLog.error({ jobId: job?.id, err: errMsg(err) }, 'Job failed');
});

taskUpdateWorker.on('error', (err) => {
  workerLog.error(`TaskUpdateWorker Redis error: ${errMsg(err)}`);
});
