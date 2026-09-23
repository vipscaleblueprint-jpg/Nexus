import { Router } from 'express';
import { handleGalaxyTask, handleGalaxyStatus, handleGalaxySubtask, syncClients, syncUsers } from '../controllers/webhook.controller';

const router = Router();

// Galaxy Webhooks
router.post('/sync-clients', syncClients);
router.post('/sync-users', syncUsers);
router.post('/galaxy/task', handleGalaxyTask);
router.post('/galaxy/status', handleGalaxyStatus);
router.post('/galaxy/subtask', handleGalaxySubtask);

export default router;
