import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenBlacklisted } from '../services/redisService';
import { SystemRole, RoleType } from '@prisma/client';

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

const JWT_SECRET = process.env.JWT_SECRET || 'nexus-default-jwt-secret-key-2026';

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  // Read token from HttpOnly cookie first, or fallback to Authorization header
  let token = req.cookies?.accessToken;

  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  // Check if token is blacklisted in Redis
  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    return res.status(401).json({ error: 'Token has been revoked' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUserPayload;
    req.user = decoded;
    req.token = token;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// System Role Guard (e.g. ADMIN only)
export function requireSystemRole(...allowedSystemRoles: SystemRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    if (!allowedSystemRoles.includes(req.user.systemRole)) {
      return res.status(403).json({
        error: `Requires system role: ${allowedSystemRoles.join(', ')}`,
      });
    }

    next();
  };
}

// Job Role Guard (e.g. PM, AUDITOR, CRM)
export function requireJobRole(...allowedJobRoles: RoleType[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const userJobRoles = req.user.roles || [];
    const hasRole = allowedJobRoles.some((role) => userJobRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({
        error: `Requires job role permission: ${allowedJobRoles.join(', ')}`,
      });
    }

    next();
  };
}
