import { Router } from 'express';
import { getRoles, createRole, deleteRole, updateRole } from '../controllers/roles.controller';
import { authenticateToken, requireSystemRole } from '../middleware/auth.middleware';

const router = Router();

// Only authenticated users can view roles
router.get('/', authenticateToken, getRoles);

// Only admins can create, update and delete roles
router.post('/', authenticateToken, requireSystemRole('ADMIN'), createRole);
router.put('/:id', authenticateToken, requireSystemRole('ADMIN'), updateRole);
router.delete('/:id', authenticateToken, requireSystemRole('ADMIN'), deleteRole);

export { router as rolesRouter };
