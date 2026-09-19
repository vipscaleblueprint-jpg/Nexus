import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { invalidateCache } from '../services/redisService';

export const getTeams = async (req: Request, res: Response) => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        teamRoles: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(teams);
  } catch (error: any) {
    req.log.error({ error }, 'Error fetching teams');
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
};

export const createTeam = async (req: Request, res: Response) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const team = await prisma.team.create({
      data: { name, color },
      include: { teamRoles: true },
    });
    await invalidateCache('teams:all');
    res.status(201).json(team);
  } catch (error: any) {
    req.log.error({ error }, 'Error creating team');
    res.status(500).json({ error: 'Failed to create team' });
  }
};

export const updateTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    const team = await prisma.team.update({
      where: { id },
      data: { name, color },
      include: { teamRoles: true },
    });
    await invalidateCache('teams:all');
    res.json(team);
  } catch (error: any) {
    req.log.error({ error }, 'Error updating team');
    res.status(500).json({ error: 'Failed to update team' });
  }
};

export const deleteTeam = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.team.delete({ where: { id } });
    await invalidateCache('teams:all');
    res.status(204).send();
  } catch (error: any) {
    req.log.error({ error }, 'Error deleting team');
    res.status(500).json({ error: 'Failed to delete team' });
  }
};

export const createTeamRole = async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const role = await prisma.teamRole.create({
      data: { name, teamId },
    });
    await invalidateCache('teams:all');
    res.status(201).json(role);
  } catch (error: any) {
    req.log.error({ error }, 'Error creating team role');
    res.status(500).json({ error: 'Failed to create team role' });
  }
};

export const updateTeamRole = async (req: Request, res: Response) => {
  try {
    const { roleId } = req.params;
    const { name } = req.body;
    const role = await prisma.teamRole.update({
      where: { id: roleId },
      data: { name },
    });
    await invalidateCache('teams:all');
    res.json(role);
  } catch (error: any) {
    req.log.error({ error }, 'Error updating team role');
    res.status(500).json({ error: 'Failed to update team role' });
  }
};

export const deleteTeamRole = async (req: Request, res: Response) => {
  try {
    const { roleId } = req.params;
    await prisma.teamRole.delete({ where: { id: roleId } });
    await invalidateCache('teams:all');
    res.status(204).send();
  } catch (error: any) {
    req.log.error({ error }, 'Error deleting team role');
    res.status(500).json({ error: 'Failed to delete team role' });
  }
};
