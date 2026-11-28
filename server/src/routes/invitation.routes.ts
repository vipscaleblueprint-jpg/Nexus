import { Router } from 'express';
import {
  listInvitations,
  createInvitation,
  revokeInvitation,
  resendInvitation,
  deleteInvitation,
} from '../controllers/invitation.controller';
import { authenticateToken, requireSystemRole } from '../middleware/auth.middleware';
import { idParams, validate, validateBody } from '../validation';
import { createInvitationSchema } from '../validation/schemas';

export const invitationRouter = Router();

// All invitation routes require ADMIN system role
invitationRouter.use(authenticateToken, requireSystemRole('ADMIN'));

invitationRouter.get('/', listInvitations);
invitationRouter.post('/', validateBody(createInvitationSchema), createInvitation);
invitationRouter.post('/:id/revoke', validate({ params: idParams }), revokeInvitation);
invitationRouter.delete('/:id', validate({ params: idParams }), deleteInvitation);
invitationRouter.post('/:id/resend', validate({ params: idParams }), resendInvitation);
