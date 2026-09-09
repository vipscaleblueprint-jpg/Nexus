import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenBlacklisted } from '../services/redisService';
import { requireEnv } from '../config/env';
import type {
  AuthRequest,
  AuthenticatedUserPayload,
  SystemRole,
} from '../types';

export type { AuthRequest, AuthenticatedUserPayload };

const JWT_SECRET = requireEnv('JWT_SECRET');

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

export async function optionalAuthenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  let token = req.cookies?.accessToken;
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUserPayload;
    req.user = decoded;
    req.token = token;
  } catch {}
  next();
}

import { prisma } from '../config/prisma';

// System Role Guard (e.g. ADMIN only)
export function requireSystemRole(...allowedSystemRoles: SystemRole[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    if (allowedSystemRoles.includes(req.user.systemRole)) {
      return next();
    }

    // Check fresh systemRole from database in case role was recently updated
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { systemRole: true },
      });
      if (dbUser && allowedSystemRoles.includes(dbUser.systemRole)) {
        req.user.systemRole = dbUser.systemRole;
        return next();
      }
    } catch (e) {}

    return res.status(403).json({
      error: `Requires system role: ${allowedSystemRoles.join(', ')}`,
    });
  };
}

// Job Role Guard (e.g. PM, AUDITOR, CRM)
export function requireJobRole(...allowedJobRoles: string[]) {
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
