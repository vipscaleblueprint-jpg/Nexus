import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache, clearAllCache } from '../services/redisService';
import { syncUsers } from './webhook.controller';
import { queueUserPush } from '../services/toolsSync';
import { generateApiKey } from '../utils/apiKey';
import { decryptText } from '../utils/encryption';
import type { AuthRequest } from '../types';

export async function triggerSyncUsers(req: Request, res: Response) {
  req.headers['x-api-key'] = process.env.VIPSCALE_API_KEY;
  return syncUsers(req, res);
}

export async function triggerClearCache(req: Request, res: Response) {
  const cleared = await clearAllCache();
  return res.json({ success: true, clearedKeys: cleared });
}

// Typed shorthand to avoid IDE stale-cache false positives on new Prisma models
const db = prisma as any;

/** Fields safe to expose in the roster. Excludes password and googleId. */
const rosterSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  imageUrl: true,
  confettiUrl: true,
  dailySheetUrl: true,
  starRating: true,
  employmentType: true,
  isActive: true,
  systemRole: true,
  roles: true,
  credits: true,
  createdAt: true,
  team: true,
  notificationPreferences: true,
};

// credits is a BigInt column — JSON.stringify (used by res.json and setCache) can't
// serialize those, so it has to be converted before it leaves this function.
// Also decrypt confettiUrl and soundUrl if encrypted at rest.
function serializeUser<T extends { credits?: bigint | null; confettiUrl?: string | null; notificationPreferences?: any }>(user: T) {
  let notificationPreferences = user.notificationPreferences;
  if (notificationPreferences && typeof notificationPreferences === 'object') {
    notificationPreferences = {
      ...notificationPreferences,
      soundUrl: decryptText(notificationPreferences.soundUrl),
      uploadedSoundUrl: decryptText(notificationPreferences.uploadedSoundUrl),
    };
    if (Array.isArray(notificationPreferences.uploadedSounds)) {
      notificationPreferences.uploadedSounds = notificationPreferences.uploadedSounds.map((s: any) => ({
        ...s,
        url: decryptText(s.url),
      }));
    }
    if (notificationPreferences.typeSounds && typeof notificationPreferences.typeSounds === 'object') {
      const typeSounds: any = {};
      for (const [key, val] of Object.entries(notificationPreferences.typeSounds)) {
        if (val && typeof val === 'object') {
          typeSounds[key] = {
            ...val,
            soundUrl: decryptText((val as any).soundUrl),
          };
        } else {
          typeSounds[key] = val;
        }
      }
      notificationPreferences.typeSounds = typeSounds;
    }
  }
  return {
    ...user,
    credits: user.credits != null ? Number(user.credits) : null,
    confettiUrl: decryptText(user.confettiUrl),
    notificationPreferences,
  };
}

// GET /api/users - Redis Cache-Aside
export async function listUsers(req: Request, res: Response) {
  try {
    const cachedUsers = await getCache<any[]>('users:all');
    if (cachedUsers) {
      return res.json({ users: cachedUsers, cached: true });
    }

    const users = await prisma.user.findMany({
      select: rosterSelect,
      orderBy: { name: 'asc' },
    });
    const serialized = users.map(serializeUser);

    await setCache('users:all', serialized, 300);

    return res.json({ users: serialized, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/users/teams - Redis Cache-Aside
export async function listTeams(req: Request, res: Response) {
  try {
    const cachedTeams = await getCache<any[]>('teams:all');
    if (cachedTeams) {
      return res.json({ teams: cachedTeams, cached: true });
    }

    const teams = await prisma.team.findMany({
      include: {
        members: {
          select: { id: true, name: true, email: true, roles: true },
        },
        teamRoles: true,
      },
    });

    await setCache('teams:all', teams, 300);

    return res.json({ teams, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/users/:id
export async function updateUser(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const {
      dailySheetUrl,
      starRating,
      roles,
      systemRole,
      employmentType,
      isActive,
    } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(dailySheetUrl !== undefined && { dailySheetUrl }),
        ...(starRating !== undefined && { starRating }),
        ...(roles !== undefined && { roles }),
        ...(systemRole !== undefined && { systemRole }),
        ...(employmentType !== undefined && { employmentType }),
        ...(isActive !== undefined && { isActive }),
      },
      select: rosterSelect,
    });

    await invalidateCache('users:all', 'teams:all', 'dashboard:all');
    // The tools are the source of truth for these fields, so mirror the edit there.
    queueUserPush(user.email);

    return res.json({ user: serializeUser(user) });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/users/:id
export async function deleteUser(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if ((req as any).user?.id === id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const deleted = await prisma.user.delete({
      where: { id },
      select: { email: true },
    });

    await invalidateCache('users:all', 'teams:all', 'dashboard:all');
    // No Nexus user left, so the push marks the assistant inactive in the tools.
    queueUserPush(deleted.email);

    return res.json({ message: 'User deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    return res.status(500).json({ error: err.message });
  }
}

// -----------------------------------------------------------------------------
// API KEYS
// -----------------------------------------------------------------------------

// A key acts as its owner on the external API (an admin's key can delete users and change roles),
// so a user can only list, create and delete their own
function ownsKeysOf(req: Request, userId: string) {
  return (req as AuthRequest).user?.id === userId;
}

export async function getApiKeys(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!ownsKeysOf(req, id)) return res.status(403).json({ error: 'You can only manage your own API keys' });
    const apiKeys = await db.apiKey.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });
    // Mask raw/hashed key so credentials are never exposed after initial generation
    const sanitizedKeys = apiKeys.map((k: any) => ({
      ...k,
      key: null,
    }));
    return res.json({ apiKeys: sanitizedKeys });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createApiKey(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!ownsKeysOf(req, id)) return res.status(403).json({ error: 'You can only manage your own API keys' });

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { rawKey, hashedKey } = generateApiKey();

    const apiKey = await db.apiKey.create({
      data: { name, key: hashedKey, userId: id },
    });

    // Return the raw plaintext key once to the client for copying
    return res.json({
      apiKey: {
        ...apiKey,
        key: rawKey,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteApiKey(req: Request, res: Response) {
  try {
    const { id, keyId } = req.params;
    if (!ownsKeysOf(req, id)) return res.status(403).json({ error: 'You can only manage your own API keys' });
    await db.apiKey.delete({
      where: { id: keyId, userId: id },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
