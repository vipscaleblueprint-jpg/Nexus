import { Router } from 'express';
// @ts-ignore - IDE cache issue
import { getTasks, postActivity } from '../controllers/external.controller';

const router = Router();

// These routes should be protected by API Key
router.get('/tasks', getTasks);
router.post('/activity', postActivity);

export default router;

