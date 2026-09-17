import { Router } from 'express';
// @ts-ignore - IDE cache issue
import { 
  getTasks, 
  getTask,
  createTask,
  updateTask,
  postActivity, 
  postComment, 
  updateComment,
  deleteComment,
  createSubtask,
  updateSubtask
} from '../controllers/external.controller';

const router = Router();

// Task Core Operations
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.get('/tasks/:taskId', getTask);
router.patch('/tasks/:taskId', updateTask);

// Task Activity & Comments
router.post('/activity', postActivity);
router.post('/comment', postComment);
router.put('/comment', updateComment);
router.delete('/comment/:commentId', deleteComment);

// Task Subtasks
router.post('/tasks/:taskId/subtasks', createSubtask);
router.patch('/tasks/:taskId/subtasks/:subtaskId', updateSubtask);

export default router;
