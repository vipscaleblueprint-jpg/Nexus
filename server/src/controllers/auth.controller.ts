import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { PrismaClient, RoleType, SystemRole, EmploymentType } from '@prisma/client';
import {
  storeRefreshToken,
  getRefreshToken,
  removeRefreshToken,
  blacklistToken,
} from '../services/redisService';
import { AuthRequest } from '../middleware/auth.middleware';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'nexus-default-jwt-secret-key-2026';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'nexus-default-jwt-refresh-secret-2026';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback';
const FRONTEND_URL = process.env.CORS_ORIGIN || 'http://localhost:3000';

const IS_PROD = process.env.NODE_ENV === 'production';

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  rememberMe: boolean = true
) {
  // Access Token Cookie (1 day)
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 24 * 3600 * 1000,
  });

  // Refresh Token Cookie (7 days if rememberMe, otherwise Session Cookie)
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    ...(rememberMe ? { maxAge: 7 * 24 * 3600 * 1000 } : {}),
  });
}

function clearAuthCookies(res: Response) {
  res.clearCookie('accessToken', { httpOnly: true, sameSite: 'lax' });
  res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'lax' });
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  systemRole: z.nativeEnum(SystemRole).optional(),
  primaryRole: z.nativeEnum(RoleType).optional(),
  secondaryRole: z.nativeEnum(RoleType).optional(),
  tertiaryRole: z.nativeEnum(RoleType).optional(),
  minorRole: z.nativeEnum(RoleType).optional(),
  employmentType: z.nativeEnum(EmploymentType).optional(),
  dailySheetUrl: z.string().url().optional(),
  starRating: z.number().min(1).max(3).optional(),
  teamId: z.string().optional(),
  rememberMe: z.boolean().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  rememberMe: z.boolean().optional(),
});

function generateTokens(user: {
  id: string;
  email: string;
  systemRole: SystemRole;
  primaryRole: RoleType | null;
  secondaryRole: RoleType | null;
  tertiaryRole: RoleType | null;
  minorRole: RoleType | null;
}) {
  const roles: RoleType[] = [];
  if (user.primaryRole) roles.push(user.primaryRole);
  if (user.secondaryRole) roles.push(user.secondaryRole);
  if (user.tertiaryRole) roles.push(user.tertiaryRole);
  if (user.minorRole) roles.push(user.minorRole);

  const payload = {
    id: user.id,
    email: user.email,
    systemRole: user.systemRole,
    roles,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });
  const refreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

  return { accessToken, refreshToken, roles };
}

export async function signup(req: Request, res: Response) {
  try {
    const data = signupSchema.parse(req.body);
    const rememberMe = data.rememberMe ?? true;

    const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
        systemRole: data.systemRole || 'MEMBER',
        primaryRole: data.primaryRole,
        secondaryRole: data.secondaryRole,
        tertiaryRole: data.tertiaryRole,
        minorRole: data.minorRole,
        employmentType: data.employmentType || 'FULL_TIME',
        dailySheetUrl: data.dailySheetUrl,
        starRating: data.starRating || 1,
        teamId: data.teamId,
      },
      include: { team: true },
    });

    const { accessToken, refreshToken, roles } = generateTokens(user);
    await storeRefreshToken(user.id, refreshToken);

    // Set HttpOnly Cookies
    setAuthCookies(res, accessToken, refreshToken, rememberMe);

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
        primaryRole: user.primaryRole,
        secondaryRole: user.secondaryRole,
        tertiaryRole: user.tertiaryRole,
        minorRole: user.minorRole,
        roles,
        starRating: user.starRating,
        employmentType: user.employmentType,
        team: user.team,
      },
      rememberMe,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    return res.status(500).json({ error: err.message || 'Signup failed' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password, rememberMe = true } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { team: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { accessToken, refreshToken, roles } = generateTokens(user);
    await storeRefreshToken(user.id, refreshToken);

    // Set HttpOnly Cookies
    setAuthCookies(res, accessToken, refreshToken, rememberMe);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        systemRole: user.systemRole,
        primaryRole: user.primaryRole,
        secondaryRole: user.secondaryRole,
        tertiaryRole: user.tertiaryRole,
        minorRole: user.minorRole,
        roles,
        starRating: user.starRating,
        employmentType: user.employmentType,
        dailySheetUrl: user.dailySheetUrl,
        team: user.team,
      },
      rememberMe,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    return res.status(500).json({ error: err.message || 'Login failed' });
  }
}

// -----------------------------------------------------------------------------
// GOOGLE OAUTH FLOW
// -----------------------------------------------------------------------------

export function googleAuth(req: Request, res: Response) {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: GOOGLE_CALLBACK_URL,
    client_id: GOOGLE_CLIENT_ID,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
  };

  const qs = new URLSearchParams(options).toString();
  return res.redirect(`${rootUrl}?${qs}`);
}

export async function googleCallback(req: Request, res: Response) {
  const code = req.query.code as string;
  if (!code) {
    return res.redirect(`${FRONTEND_URL}?error=Google%20auth%20code%20missing`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokenData.error_description || 'Failed to exchange Google code');
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userRes.json();

    let user = await prisma.user.findUnique({ where: { email: googleUser.email } });

    if (!user) {
      const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name || googleUser.email.split('@')[0],
          avatarUrl: googleUser.picture,
          password: randomPassword,
          systemRole: 'MEMBER',
          employmentType: 'FULL_TIME',
          starRating: 1,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          avatarUrl: user.avatarUrl || googleUser.picture,
        },
      });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    await storeRefreshToken(user.id, refreshToken);

    // Set HttpOnly Cookies
    setAuthCookies(res, accessToken, refreshToken, true);

    return res.redirect(FRONTEND_URL);
  } catch (err: any) {
    console.error('Google Callback Error:', err.message);
    return res.redirect(`${FRONTEND_URL}?error=${encodeURIComponent(err.message)}`);
  }
}

export async function refresh(req: Request, res: Response) {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { id: string };
    const storedToken = await getRefreshToken(decoded.id);

    if (!storedToken || storedToken !== refreshToken) {
      return res.status(403).json({ error: 'Invalid or revoked refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User account disabled' });
    }

    const tokens = generateTokens(user);
    await storeRefreshToken(user.id, tokens.refreshToken);

    // Set updated HttpOnly Cookies
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken, true);

    return res.json({ message: 'Token refreshed successfully' });
  } catch (err: any) {
    return res.status(403).json({ error: 'Invalid refresh token' });
  }
}

export async function logout(req: AuthRequest, res: Response) {
  try {
    if (req.user) {
      await removeRefreshToken(req.user.id);
    }
    if (req.token) {
      await blacklistToken(req.token);
    }

    clearAuthCookies(res);
    return res.json({ message: 'Logged out successfully' });
  } catch (err: any) {
    clearAuthCookies(res);
    return res.status(500).json({ error: err.message });
  }
}

export async function getMe(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        dailySheetUrl: true,
        starRating: true,
        employmentType: true,
        isActive: true,
        systemRole: true,
        primaryRole: true,
        secondaryRole: true,
        tertiaryRole: true,
        minorRole: true,
        lastLoginAt: true,
        createdAt: true,
        team: true,
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

const updateProfileSchema = z.object({
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  dailySheetUrl: z.string().url().optional(),
  starRating: z.number().min(1).max(3).optional(),
  employmentType: z.nativeEnum(EmploymentType).optional(),
  systemRole: z.nativeEnum(SystemRole).optional(),
  primaryRole: z.nativeEnum(RoleType).nullable().optional(),
  secondaryRole: z.nativeEnum(RoleType).nullable().optional(),
  tertiaryRole: z.nativeEnum(RoleType).nullable().optional(),
  minorRole: z.nativeEnum(RoleType).nullable().optional(),
  teamId: z.string().nullable().optional(),
});

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const data = updateProfileSchema.parse(req.body);

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data,
      include: { team: true },
    });

    return res.json({ user: updatedUser });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    return res.status(500).json({ error: err.message });
  }
}
