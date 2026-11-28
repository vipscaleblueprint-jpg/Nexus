import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  listShiftTimes,
  upsertShiftTime,
  triggerImportShiftTimesFromSheet,
} from '../controllers/shiftTime.controller';

export const shiftTimeRouter = Router();

shiftTimeRouter.get('/', authenticateToken, listShiftTimes);
shiftTimeRouter.put('/:userId', authenticateToken, upsertShiftTime);
shiftTimeRouter.post('/import-sheet', authenticateToken, triggerImportShiftTimesFromSheet);
