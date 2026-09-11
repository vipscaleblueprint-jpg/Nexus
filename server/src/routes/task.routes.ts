import { Router } from 'express';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  createAttachmentUrl,
  createTaskComment,
  getTaskComments,
  toggleCommentReaction,
  getTaskActivities,
  getLiveBlocksData,
  createSubtask,
  updateSubtask,
  deleteSubtask,
} from '../controllers/task.controller';
import { idParams, idAndSubtaskIdParams, validate } from '../validation';
import {
  attachmentUrlSchema,
  createTaskSchema,
  listTasksQuery,
  moveTaskSchema,
  updateTaskSchema,
} from '../validation/schemas';
import { optionalAuthenticateToken } from '../middleware/auth.middleware';

export const taskRouter = Router();

taskRouter.get('/live-blocks', getLiveBlocksData);
taskRouter.get('/', validate({ query: listTasksQuery }), listTasks);
taskRouter.post('/', validate({ body: createTaskSchema }), createTask);

// Specific paths before '/:id' so they are not swallowed by the param route.
taskRouter.patch('/:id/move', optionalAuthenticateToken, validate({ params: idParams, body: moveTaskSchema }), moveTask);
taskRouter.post(
  '/:id/attachments/r2-url',
  validate({ params: idParams, body: attachmentUrlSchema }),
  createAttachmentUrl
);
taskRouter.post('/:id/comments', validate({ params: idParams }), createTaskComment);
taskRouter.get('/:id/comments', validate({ params: idParams }), getTaskComments);
taskRouter.post('/:id/comments/:commentId/reactions', toggleCommentReaction);
taskRouter.get('/:id/activities', validate({ params: idParams }), getTaskActivities);

taskRouter.post('/:id/subtasks', optionalAuthenticateToken, validate({ params: idParams }), createSubtask);
taskRouter.patch('/:id/subtasks/:subtaskId', optionalAuthenticateToken, validate({ params: idAndSubtaskIdParams }), updateSubtask);
taskRouter.delete('/:id/subtasks/:subtaskId', optionalAuthenticateToken, validate({ params: idAndSubtaskIdParams }), deleteSubtask);

taskRouter.get('/:id', validate({ params: idParams }), getTask);
taskRouter.patch('/:id', optionalAuthenticateToken, validate({ params: idParams, body: updateTaskSchema }), updateTask);
taskRouter.delete('/:id', validate({ params: idParams }), deleteTask);
