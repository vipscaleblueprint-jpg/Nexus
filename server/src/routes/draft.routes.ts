import { Router, Response, NextFunction } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import {
  getDrafts,
  saveDraft,
  deleteDraft,
  deleteDraftByTask,
} from '../controllers/draft.controller';

const router = Router();

router.use((req, res: Response, next: NextFunction) =>
  authenticateToken(req as AuthRequest, res, next)
);

router.get('/', (req, res) => getDrafts(req as AuthRequest, res));
router.post('/', (req, res) => saveDraft(req as AuthRequest, res));
router.delete('/task/:taskId', (req, res) => deleteDraftByTask(req as AuthRequest, res));
router.delete('/:id', (req, res) => deleteDraft(req as AuthRequest, res));

export default router;

