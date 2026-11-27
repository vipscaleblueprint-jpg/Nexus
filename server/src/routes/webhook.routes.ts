import { Router } from 'express';
import { handleGalaxyTask, handleGalaxyStatus, handleGalaxySubtask, syncClients, syncUsers, assistantChanged, handleUserLogout } from '../controllers/webhook.controller';
import { handleSheetUpdate, handleSheetComment, handleSheetProgress, resolveNexusLinks, verifyClientOtp, getSheetClientLockStatus, getNotesForTodayItems } from '../controllers/sheets.controller';
import { handleShiftTimeWebhook } from '../controllers/shiftTime.controller';

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

// MA Daily Schedule sheets (forwarded by n8n or Apps Script)
router.post('/sheets/update', handleSheetUpdate);
router.post('/sheets/comment', handleSheetComment);
router.post('/sheets/progress', handleSheetProgress);
router.post('/sheets/nexus-links', resolveNexusLinks);
router.post('/sheets/notes-for-today', getNotesForTodayItems);
router.post('/sheets/verify-otp', verifyClientOtp);
router.get('/sheets/client-lock-status', getSheetClientLockStatus);

// Shift Times two-way sync webhook (from VIPScale Tools or Google Sheets / n8n)
router.post('/shift-times', handleShiftTimeWebhook);

export default router;
