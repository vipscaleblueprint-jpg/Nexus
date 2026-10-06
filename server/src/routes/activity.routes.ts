import { Router } from 'express';
import { getAuditLogs } from '../controllers/activity.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateToken);
router.get('/all', getAuditLogs);

export default router;