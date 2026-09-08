import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest } from '../middleware/auth.middleware';

// GET /api/invitations - Admin Only
export async function listInvitations(req: AuthRequest, res: Response) {
  try {
    // Automatically update expired invitations
    await prisma.invitation.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    const invitations = await prisma.invitation.findMany({
      include: {
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ invitations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/invitations - Admin Only
export async function createInvitation(req: AuthRequest, res: Response) {
  try {
    const { email, role, employmentType, expiresInDays = 7 } = req.body;
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists in the workspace.' });
    }

    // Check if a pending invitation already exists for this email
    const existingInvite = await prisma.invitation.findFirst({
      where: {
        email,
        status: 'PENDING',
      },
    });

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    let invitation;
    if (existingInvite) {
      // Refresh the existing invitation
      invitation = await prisma.invitation.update({
        where: { id: existingInvite.id },
        data: {
          role: role || existingInvite.role,
          employmentType: employmentType || existingInvite.employmentType,
          expiresAt,
          status: 'PENDING',
          invitedById: adminId,
        },
        include: {
          invitedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    } else {
      invitation = await prisma.invitation.create({
        data: {
          email,
          role: role || 'MEMBER',
          employmentType: employmentType || 'FULL_TIME',
          expiresAt,
          status: 'PENDING',
          invitedById: adminId,
        },
        include: {
          invitedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    }

    return res.status(201).json({ invitation });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/invitations/:id - Admin Only
export async function revokeInvitation(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const invite = await prisma.invitation.findUnique({
      where: { id },
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    await prisma.invitation.update({
      where: { id },
      data: { status: 'REVOKED' },
    });

    return res.json({ message: 'Invitation revoked successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/invitations/:id/resend - Admin Only
export async function resendInvitation(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await prisma.invitation.update({
      where: { id },
      data: {
        expiresAt,
        status: 'PENDING',
      },
      include: {
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return res.json({ invitation });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Invitation not found' });
    return res.status(500).json({ error: err.message });
  }
}
