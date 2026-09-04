import { Router } from 'express';
import { listUsers, listTeams, updateUser } from '../controllers/user.controller';
import { idParams, validate } from '../validation';
import { updateUserSchema } from '../validation/schemas';

export const userRouter = Router();

userRouter.get('/', listUsers);
userRouter.get('/teams', listTeams);
userRouter.patch('/:id', validate({ params: idParams, body: updateUserSchema }), updateUser);
