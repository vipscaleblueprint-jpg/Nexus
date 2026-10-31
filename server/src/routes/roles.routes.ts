import { Router } from 'express';
import { getRoles, createRole, deleteRole, updateRole, getRoleMap } from '../controllers/roles.controller';
import { authenticateToken, requireSystemRole } from '../middleware/auth.middleware';

const router = Router();

// Only authenticated users can view roles and role map
router.get('/', authenticateToken, getRoles);
router.get('/map', authenticateToken, getRoleMap);

// Only admins can create, update and delete roles
router.post('/', authenticateToken, requireSystemRole('ADMIN'), createRole);
router.put('/:id', authenticateToken, requireSystemRole('ADMIN'), updateRole);
router.delete('/:id', authenticateToken, requireSystemRole('ADMIN'), deleteRole);

export { router as rolesRouter };
