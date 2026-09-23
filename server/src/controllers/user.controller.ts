import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache, clearAllCache } from '../services/redisService';
import { syncUsers } from './webhook.controller';

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
  dailySheetUrl: true,
  starRating: true,
  employmentType: true,
  isActive: true,
  systemRole: true,
  roles: true,
  credits: true,
  createdAt: true,
  team: true,
};

// credits is a BigInt column — JSON.stringify (used by res.json and setCache) can't
// serialize those, so it has to be converted before it leaves this function.
function serializeCredits<T extends { credits?: bigint | null }>(user: T) {
  return { ...user, credits: user.credits != null ? Number(user.credits) : null };
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
    const serialized = users.map(serializeCredits);

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

    return res.json({ user: serializeCredits(user) });
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

    await prisma.user.delete({
      where: { id },
    });

    await invalidateCache('users:all', 'teams:all', 'dashboard:all');

    return res.json({ message: 'User deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    return res.status(500).json({ error: err.message });
  }
}

// -----------------------------------------------------------------------------
// API KEYS
// -----------------------------------------------------------------------------

export async function getApiKeys(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const apiKeys = await db.apiKey.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ apiKeys });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createApiKey(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const key = `nx_${crypto.randomBytes(24).toString('hex')}`;

    const apiKey = await db.apiKey.create({
      data: { name, key, userId: id },
    });

    return res.json({ apiKey });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteApiKey(req: Request, res: Response) {
  try {
    const { id, keyId } = req.params;
    await db.apiKey.delete({
      where: { id: keyId, userId: id },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
