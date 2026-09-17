import { Router } from 'express';
// @ts-ignore - IDE cache issue
import { getTasks, postActivity, postComment, updateComment } from '../controllers/external.controller';

const router = Router();

// These routes are protected by API Key (Bearer token or x-api-key header)
router.get('/tasks', getTasks);
router.post('/activity', postActivity);
router.post('/comment', postComment);
router.put('/comment', updateComment);

export default router;
