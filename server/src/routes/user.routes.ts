import { Router } from 'express';
import { listUsers, listTeams, updateUser, deleteUser, getApiKeys, createApiKey } from '../controllers/user.controller';
import { authenticateToken, requireSystemRole } from '../middleware/auth.middleware';
import { idParams, validate } from '../validation';
import { updateUserSchema } from '../validation/schemas';

export const userRouter = Router();

userRouter.get('/', listUsers);
userRouter.get('/teams', listTeams);
userRouter.get('/:id/api-keys', authenticateToken, getApiKeys);
userRouter.post('/:id/api-keys', authenticateToken, createApiKey);
userRouter.patch(
  '/:id',
  authenticateToken,
  requireSystemRole('ADMIN'),
  validate({ params: idParams, body: updateUserSchema }),
  updateUser
);
userRouter.delete(
  '/:id',
  authenticateToken,
  requireSystemRole('ADMIN'),
  validate({ params: idParams }),
  deleteUser
);
