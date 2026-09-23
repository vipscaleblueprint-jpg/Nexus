import { Router } from 'express';
import { listUsers, listTeams, updateUser, deleteUser, getApiKeys, createApiKey, deleteApiKey, triggerSyncUsers, triggerClearCache } from '../controllers/user.controller';
import { authenticateToken, requireSystemRole } from '../middleware/auth.middleware';
import { idParams, validate } from '../validation';
import { updateUserSchema } from '../validation/schemas';

export const userRouter = Router();

userRouter.get('/', listUsers);
userRouter.get('/teams', listTeams);
if (process.env.NODE_ENV === 'development') {
  userRouter.post('/sync-users', authenticateToken, requireSystemRole('ADMIN'), triggerSyncUsers);
  userRouter.post('/clear-cache', authenticateToken, requireSystemRole('ADMIN'), triggerClearCache);
}
userRouter.get('/:id/api-keys', authenticateToken, getApiKeys);
userRouter.post('/:id/api-keys', authenticateToken, createApiKey);
userRouter.delete('/:id/api-keys/:keyId', authenticateToken, deleteApiKey);
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
