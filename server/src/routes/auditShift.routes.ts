import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getAuditShifts,
  updateAuditShift,
  createAuditShift,
  deleteAuditShift,
  resetAuditShifts,
  triggerShiftSweep,
} from '../controllers/auditShift.controller';

const router = Router();

// Audit shift configuration and sweeps are open to all authenticated users
router.get('/', authenticateToken, getAuditShifts);
router.post('/', authenticateToken, createAuditShift);
router.put('/:id', authenticateToken, updateAuditShift);
router.delete('/:id', authenticateToken, deleteAuditShift);
router.post('/reset', authenticateToken, resetAuditShifts);
router.post('/sweep', authenticateToken, triggerShiftSweep);

export { router as auditShiftRouter };

