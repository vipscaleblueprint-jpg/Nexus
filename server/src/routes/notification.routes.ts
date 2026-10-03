import { Router } from 'express';
import {
  getNotifications,
  markAsRead,
  clearNotification,
  deleteCleared,
  markAllAsRead,
  clearAll
} from '../controllers/notification.controller';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import { NextFunction, Response } from 'express';

const router = Router();

router.use((req, res: Response, next: NextFunction) => authenticateToken(req as AuthRequest, res, next));

router.get('/', getNotifications);
router.delete('/cleared', deleteCleared);
router.patch('/read-all', markAllAsRead);
router.patch('/clear-all', clearAll);
router.patch('/:id/read', markAsRead);
router.patch('/:id/clear', clearNotification);

export default router;
