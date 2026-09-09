import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

export const getRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.workspaceRole.findMany({
      orderBy: { createdAt: 'asc' },
    });
    res.json(roles);
  } catch (error: any) {
    req.log.error({ error }, 'Error fetching roles');
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
};

export const createRole = async (req: Request, res: Response) => {
  try {
    const { name, color } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const role = await prisma.workspaceRole.create({
      data: {
        name: name.toUpperCase(),
        color,
      },
    });

    res.status(201).json(role);
  } catch (error: any) {
    req.log.error({ error }, 'Error creating role');
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Role already exists' });
    }
    res.status(500).json({ error: 'Failed to create role' });
  }
};

export const deleteRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Check if the role exists
    const role = await prisma.workspaceRole.findUnique({
      where: { id },
    });

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Optional: we could check if any user has this role before deleting,
    // but Prisma's String type for user roles means deleting the role here
    // just means it disappears from the dropdown. The string remains on the user
    // until modified. This allows graceful degradation.

    await prisma.workspaceRole.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error: any) {
    req.log.error({ error }, 'Error deleting role');
    res.status(500).json({ error: 'Failed to delete role' });
  }
};
