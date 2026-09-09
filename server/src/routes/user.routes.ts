import { Router } from 'express';
import { listUsers, listTeams, updateUser, deleteUser } from '../controllers/user.controller';
import { authenticateToken, requireSystemRole } from '../middleware/auth.middleware';
import { idParams, validate } from '../validation';
import { updateUserSchema } from '../validation/schemas';

export const userRouter = Router();

userRouter.get('/', listUsers);
userRouter.get('/teams', listTeams);
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
