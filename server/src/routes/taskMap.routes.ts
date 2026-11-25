import { Router } from 'express';
import {
  getTaskMapData,
  getAdminTasks,
  getOptions,
  upsertOption,
  deleteOption,
  getShifts,
  updateShifts,
  updateTaskStatuses,
  claimTask,
  assignTaskMapTask,
  transferTaskMapTask,
  resetColumnTasksHandler,
  handlePmReviewAction,
  runRollover,
  runDailyRollover,
  getHistoryDates,
  updateTaskMeta,
  getLaunchMapData,
  getLaunchCandidates,
  updateTaskLaunchMeta,
  getTaskTimeline,
  getUpworkClientsHandler,
  updateUpworkClientsHandler,
  getActiveUpworkSessionsHandler,
  getTaskMapTaskDescription,
  getPendingCrmFollowUpsHandler,
  respondCrmFollowUpHandler,
  acknowledgeCrmFollowUpsHandler,
  getMyDailyOtpHandler,
  verifyClientOtpHandler,
  getClientLockStatusHandler,
  syncSpreadsheetRowHandler,
  getUserDailyScheduleConfigHandler,
  getDailySheetLogsHandler,
  createDailySheetLogHandler,
  createSuperviseCheckHandler,
  deleteSuperviseCheckHandler,
} from '../controllers/taskMap.controller';
import {
  previewAutoQueueHandler,
  resetAutoQueueHandler,
  distributeAutoQueueHandler,
  listAutoQueueExcludedHandler,
  setAutoQueueExcludedHandler,
} from '../controllers/autoQueue.controller';
import { authenticateToken } from '../middleware/auth.middleware';

export const taskMapRouter = Router();

// Protect all routes with authenticated user
taskMapRouter.use(authenticateToken);

taskMapRouter.get('/data', getTaskMapData);
taskMapRouter.get('/admin-tasks', getAdminTasks);
taskMapRouter.get('/launch', getLaunchMapData);
taskMapRouter.get('/launch/candidates', getLaunchCandidates);
taskMapRouter.get('/options', getOptions);
taskMapRouter.post('/options', upsertOption);
taskMapRouter.delete('/options/:id', deleteOption);

taskMapRouter.get('/upwork-clients', getUpworkClientsHandler);
taskMapRouter.post('/upwork-clients', updateUpworkClientsHandler);
taskMapRouter.get('/upwork-active', getActiveUpworkSessionsHandler);

taskMapRouter.get('/shifts', getShifts);
taskMapRouter.put('/shifts', updateShifts);

taskMapRouter.patch('/tasks/:id/statuses', updateTaskStatuses);
taskMapRouter.patch('/tasks/:id/claim', claimTask);
taskMapRouter.patch('/tasks/:id/assign', assignTaskMapTask);
taskMapRouter.post('/tasks/:id/transfer', transferTaskMapTask);
taskMapRouter.post('/columns/:columnId/reset', resetColumnTasksHandler);
taskMapRouter.post('/tasks/:id/pm-review', handlePmReviewAction);
taskMapRouter.post('/auto-queue/preview', previewAutoQueueHandler);
taskMapRouter.post('/auto-queue/reset', resetAutoQueueHandler);
taskMapRouter.post('/auto-queue/distribute', distributeAutoQueueHandler);
taskMapRouter.get('/auto-queue/excluded', listAutoQueueExcludedHandler);
taskMapRouter.put('/auto-queue/excluded', setAutoQueueExcludedHandler);
taskMapRouter.post('/rollover', runRollover);
taskMapRouter.post('/daily-rollover', runDailyRollover);
taskMapRouter.get('/history-dates', getHistoryDates);
taskMapRouter.patch('/tasks/:id/meta', updateTaskMeta);
taskMapRouter.patch('/tasks/:id/launch', updateTaskLaunchMeta);
taskMapRouter.get('/tasks/:id/timeline', getTaskTimeline);
taskMapRouter.get('/task-description', getTaskMapTaskDescription);
taskMapRouter.get('/crm/follow-ups', getPendingCrmFollowUpsHandler);
taskMapRouter.post('/crm/follow-ups/acknowledge', acknowledgeCrmFollowUpsHandler);
taskMapRouter.post('/crm/follow-ups/:id/acknowledge', acknowledgeCrmFollowUpsHandler);
taskMapRouter.post('/crm/follow-ups/:id/respond', respondCrmFollowUpHandler);

// PM Daily Authenticator & Client Lock routes
taskMapRouter.get('/my-daily-otp', getMyDailyOtpHandler);
taskMapRouter.post('/verify-client-otp', verifyClientOtpHandler);
taskMapRouter.get('/client-lock-status', getClientLockStatusHandler);

// Spreadsheet Schedule Row Sync & User Config
taskMapRouter.get('/sheets/user-config', getUserDailyScheduleConfigHandler);
taskMapRouter.post('/sheets/sync-row', syncSpreadsheetRowHandler);
taskMapRouter.get('/sheets/logs', getDailySheetLogsHandler);
taskMapRouter.post('/sheets/logs', createDailySheetLogHandler);

// Supervise 40-min Check-in routes
taskMapRouter.post('/supervise/check', createSuperviseCheckHandler);
taskMapRouter.post('/supervise/uncheck', deleteSuperviseCheckHandler);
