import { Router } from 'express';
import {
  getTaskMapData,
  getOptions,
  upsertOption,
  deleteOption,
  getShifts,
  updateShifts,
  updateTaskStatuses,
  claimTask,
  assignTaskMapTask,
  handlePmReviewAction,
  runRollover,
  updateTaskMeta,
  getTaskTimeline,
} from '../controllers/taskMap.controller';
import { authenticateToken } from '../middleware/auth.middleware';

export const taskMapRouter = Router();

// Protect all routes with authenticated user
taskMapRouter.use(authenticateToken);

taskMapRouter.get('/data', getTaskMapData);
taskMapRouter.get('/options', getOptions);
taskMapRouter.post('/options', upsertOption);
taskMapRouter.delete('/options/:id', deleteOption);

taskMapRouter.get('/shifts', getShifts);
taskMapRouter.put('/shifts', updateShifts);

taskMapRouter.patch('/tasks/:id/statuses', updateTaskStatuses);
taskMapRouter.patch('/tasks/:id/claim', claimTask);
taskMapRouter.patch('/tasks/:id/assign', assignTaskMapTask);
taskMapRouter.post('/tasks/:id/pm-review', handlePmReviewAction);
taskMapRouter.post('/rollover', runRollover);
taskMapRouter.patch('/tasks/:id/meta', updateTaskMeta);
taskMapRouter.get('/tasks/:id/timeline', getTaskTimeline);
