import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache } from '../services/redisService';

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
  primaryRole: true,
  secondaryRole: true,
  tertiaryRole: true,
  minorRole: true,
  createdAt: true,
  team: true,
};

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

    await setCache('users:all', users, 300);

    return res.json({ users, cached: false });
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
          select: { id: true, name: true, email: true, primaryRole: true },
        },
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
      primaryRole,
      secondaryRole,
      tertiaryRole,
      minorRole,
      systemRole,
      employmentType,
      isActive,
    } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(dailySheetUrl !== undefined && { dailySheetUrl }),
        ...(starRating !== undefined && { starRating }),
        ...(primaryRole !== undefined && { primaryRole }),
        ...(secondaryRole !== undefined && { secondaryRole }),
        ...(tertiaryRole !== undefined && { tertiaryRole }),
        ...(minorRole !== undefined && { minorRole }),
        ...(systemRole !== undefined && { systemRole }),
        ...(employmentType !== undefined && { employmentType }),
        ...(isActive !== undefined && { isActive }),
      },
      select: rosterSelect,
    });

    await invalidateCache('users:all', 'teams:all', 'dashboard:all');

    return res.json({ user });
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
