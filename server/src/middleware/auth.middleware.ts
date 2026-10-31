import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenBlacklisted, getUserRevokedAt } from '../services/redisService';
import { clearAuthCookies } from '../controllers/auth.controller';
import { requireEnv } from '../config/env';
import type {
  AuthRequest,
  AuthenticatedUserPayload,
  SystemRole,
} from '../types';

export type { AuthRequest, AuthenticatedUserPayload };

const JWT_SECRET = requireEnv('JWT_SECRET');

/** Reads one cookie from a raw Cookie header (WebSocket handshakes don't go through cookie-parser). */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  for (const part of (cookieHeader || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Sanitizes and validates a JWT string format before processing. */
export function sanitizeToken(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Standard JWT is three base64url segments separated by dots, max reasonable length ~4096
  if (trimmed.length > 4096) return null;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** The user of a valid, non-revoked access token, or null. Shared by the HTTP and WebSocket auth checks. */
export async function verifyAccessToken(token: string | undefined): Promise<AuthenticatedUserPayload | null> {
  const sanitized = sanitizeToken(token);
  if (!sanitized) return null;
  if (await isTokenBlacklisted(sanitized)) return null;
  try {
    const decoded = jwt.verify(sanitized, JWT_SECRET) as AuthenticatedUserPayload & { iat?: number };
    const revokedAt = await getUserRevokedAt(decoded.id);
    if (revokedAt && decoded.iat && decoded.iat < revokedAt) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  // Already verified earlier in this request (the /api login gate in server.ts runs before route-level checks)
  if (req.user) return next();

  // Read token from HttpOnly cookie first, or fallback to Authorization header
  let rawToken = req.cookies?.accessToken;

  if (!rawToken) {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
      rawToken = match ? match[1] : undefined;
    }
  }

  const token = sanitizeToken(rawToken);
  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  // Check if token is blacklisted in Redis
  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    return res.status(401).json({ error: 'Token has been revoked' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUserPayload & { iat?: number };
    const revokedAt = await getUserRevokedAt(decoded.id);
    if (revokedAt && decoded.iat && decoded.iat < revokedAt) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session has been invalidated. Please log in again.' });
    }
    req.user = decoded;
    req.token = token;
    next();
  } catch (error) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Login gate for a mount point (e.g. app.use('/api', ...)): every first path segment needs a valid session except
 * `publicSections`. Unknown or oddly written paths fall through to the login check, so it fails closed.
 */
export function requireLoginExcept(publicSections: string[]) {
  const open = new Set(publicSections);
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // req.path is relative to the mount: "/tasks/123" -> "tasks"
    if (open.has(req.path.split('/')[1])) return next();
    return authenticateToken(req, res, next);
  };
}

export async function optionalAuthenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user) return next();
  let rawToken = req.cookies?.accessToken;
  if (!rawToken) {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
      rawToken = match ? match[1] : undefined;
    }
  }
  const token = sanitizeToken(rawToken);
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

    // Always the current role from the database: the token's copy can be up to a day old, so trusting it
    // would let a demoted (or deactivated) admin keep admin access until it expires
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { systemRole: true, isActive: true },
      });
      if (dbUser?.isActive && allowedSystemRoles.includes(dbUser.systemRole)) {
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
