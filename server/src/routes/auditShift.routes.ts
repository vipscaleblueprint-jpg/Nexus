import { Router } from 'express';
import { authenticateToken, requireSystemRole } from '../middleware/auth.middleware';
import {
  getAuditShifts,
  updateAuditShift,
  createAuditShift,
  deleteAuditShift,
  resetAuditShifts,
  triggerShiftSweep,
} from '../controllers/auditShift.controller';

const router = Router();

// All audit shift management requires an authenticated ADMIN user
router.get('/', authenticateToken, requireSystemRole('ADMIN'), getAuditShifts);
router.post('/', authenticateToken, requireSystemRole('ADMIN'), createAuditShift);
router.put('/:id', authenticateToken, requireSystemRole('ADMIN'), updateAuditShift);
router.delete('/:id', authenticateToken, requireSystemRole('ADMIN'), deleteAuditShift);
router.post('/reset', authenticateToken, requireSystemRole('ADMIN'), resetAuditShifts);
router.post('/sweep', authenticateToken, requireSystemRole('ADMIN'), triggerShiftSweep);

export { router as auditShiftRouter };

