/**
 * Server-only Express request types.
 */

import type { Request } from 'express';
import type { RoleType, SystemRole } from './enums';

/** JWT payload carried in the accessToken cookie / Authorization header. */
export interface AuthenticatedUserPayload {
  id: string;
  email: string;
  systemRole: SystemRole;
  roles: RoleType[];
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUserPayload;
  token?: string;
}
