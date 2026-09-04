import { Router } from 'express';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  createAttachmentUrl,
} from '../controllers/task.controller';
import { idParams, validate } from '../validation';
import {
  attachmentUrlSchema,
  createTaskSchema,
  listTasksQuery,
  moveTaskSchema,
  updateTaskSchema,
} from '../validation/schemas';

export const taskRouter = Router();

taskRouter.get('/', validate({ query: listTasksQuery }), listTasks);
taskRouter.post('/', validate({ body: createTaskSchema }), createTask);

// Specific paths before '/:id' so they are not swallowed by the param route.
taskRouter.patch('/:id/move', validate({ params: idParams, body: moveTaskSchema }), moveTask);
taskRouter.post(
  '/:id/attachments/r2-url',
  validate({ params: idParams, body: attachmentUrlSchema }),
  createAttachmentUrl
);

taskRouter.get('/:id', validate({ params: idParams }), getTask);
taskRouter.patch('/:id', validate({ params: idParams, body: updateTaskSchema }), updateTask);
taskRouter.delete('/:id', validate({ params: idParams }), deleteTask);
