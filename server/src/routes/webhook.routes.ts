import { Router } from 'express';
import { handleGalaxyTask, handleGalaxyStatus, handleGalaxySubtask, syncClients, syncUsers, assistantChanged, handleUserLogout } from '../controllers/webhook.controller';
import { handleSheetUpdate, handleSheetComment, resolveNexusLinks } from '../controllers/sheets.controller';

const router = Router();

// User session revocation / logout webhook from tools
router.post('/user-logout', handleUserLogout);

// Galaxy Webhooks
router.post('/sync-clients', syncClients);
router.post('/sync-users', syncUsers);
router.post('/assistant-changed', assistantChanged);
router.post('/galaxy/task', handleGalaxyTask);
router.post('/galaxy/status', handleGalaxyStatus);
router.post('/galaxy/subtask', handleGalaxySubtask);

// MA Daily Schedule sheets (forwarded by n8n)
router.post('/sheets/update', handleSheetUpdate);
router.post('/sheets/comment', handleSheetComment);
router.post('/sheets/nexus-links', resolveNexusLinks);

export default router;
