import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';
import {
  canEditShiftTimes,
  importShiftTimesFromSheet,
  isShiftTimeSpecialEditor,
  normalizeScheduleFormat,
  queueShiftTimeWebhooks,
  ShiftTimeWebhookPayload,
} from '../services/shiftTimeSync';
import { requireApiKey } from './webhook.controller';
import type { AuthRequest } from '../types';

const db = prisma as any;

function isSystemEmail(email: string): boolean {
  return email.toLowerCase().endsWith('@system.local');
}

async function fetchAllShiftTimeEntries() {
  const users: any[] = await db.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      roles: true,
      systemRole: true,
      employmentType: true,
      shiftTime: {
        select: {
          id: true,
          schedule: true,
          source: true,
          updatedBy: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return users
    .filter((u) => !isSystemEmail(u.email))
    .map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      roles: u.roles,
      systemRole: u.systemRole,
      employmentType: u.employmentType,
      isSpecialEditor: isShiftTimeSpecialEditor(u.email),
      schedule: u.shiftTime?.schedule ?? '',
      source: u.shiftTime?.source ?? null,
      updatedBy: u.shiftTime?.updatedBy ?? null,
      updatedAt: u.shiftTime?.updatedAt?.toISOString() ?? null,
    }));
}

/**
 * GET /api/shift-times
 * Lists all active Nexus users with their UUID-keyed shift schedule.
 */
export async function listShiftTimes(req: AuthRequest, res: Response) {
  try {
    const entries = await fetchAllShiftTimeEntries();
    const canEdit = canEditShiftTimes(req.user);

    return res.json({
      shiftTimes: entries,
      canEdit,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load shift times' });
  }
}

/**
 * PUT /api/shift-times/:userId
 * Updates a user's shift schedule in Nexus (by UUID) and pushes to VIPScale Tools via webhook.
 * Allowed for ADMINs and special editor gwyndelacruz.2903@gmail.com.
 */
export async function upsertShiftTime(req: AuthRequest, res: Response) {
  try {
    if (!canEditShiftTimes(req.user)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions to edit shift times' });
    }

    const { userId } = req.params;
    const rawSchedule = typeof req.body?.schedule === 'string' ? req.body.schedule : '';
    const schedule = normalizeScheduleFormat(rawSchedule);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedBy = req.user?.email || 'nexus-ui';

    if (!schedule) {
      await db.userShiftTime.deleteMany({ where: { userId: user.id } });
    } else {
      await db.userShiftTime.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          schedule,
          source: 'NEXUS',
          updatedBy,
        },
        update: {
          schedule,
          source: 'NEXUS',
          updatedBy,
        },
      });
    }

    const nowIso = new Date().toISOString();
    const payload: ShiftTimeWebhookPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      schedule,
      source: 'NEXUS',
      updatedBy,
      updatedAt: nowIso,
    };

    await invalidateCache('users:all');
    io.emit('shift_times:updated', payload);
    queueShiftTimeWebhooks(payload);

    return res.json({
      success: true,
      shiftTime: payload,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update shift time' });
  }
}

/**
 * POST /api/shift-times/import-sheet
 * Pulls Column X ("Schedule:") from the Google Sheet, upserts into Nexus by UUID,
 * and pushes the synced schedules to VIPScale Tools.
 */
export async function triggerImportShiftTimesFromSheet(req: AuthRequest, res: Response) {
  try {
    if (!canEditShiftTimes(req.user)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions to import shift times' });
    }

    const result = await importShiftTimesFromSheet({
      updatedBy: req.user?.email || 'nexus-ui',
      pushToTools: true,
    });

    io.emit('shift_times:updated', { bulk: true, syncedCount: result.syncedCount });

    return res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to import shift times from sheet' });
  }
}

/**
 * GET /api/external/shift-times (API-key authenticated for VIPScale Tools / n8n)
 */
export async function getExternalShiftTimes(req: Request, res: Response) {
  if (!requireApiKey(req, res)) return;
  try {
    const entries = await fetchAllShiftTimeEntries();
    return res.json({ success: true, shiftTimes: entries });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch shift times' });
  }
}

/**
 * POST /api/webhooks/shift-times
 * Inbound webhook from VIPScale Tools or Google Sheets / n8n.
 * Accepts either a single item `{ userId?, email?, schedule, source?, updatedBy? }`
 * or `{ updates: [...] }` for bulk sync.
 */
export async function handleShiftTimeWebhook(req: Request, res: Response) {
  if (!requireApiKey(req, res)) return;

  try {
    const body = req.body || {};
    const items: Array<{
      userId?: string;
      email?: string;
      schedule?: string;
      source?: string;
      updatedBy?: string;
    }> = Array.isArray(body.updates) ? body.updates : [body];

    const defaultSource =
      typeof body.source === 'string' && body.source.trim()
        ? body.source.trim().toUpperCase()
        : 'VIPSCALE';

    const applied: ShiftTimeWebhookPayload[] = [];
    const notFound: Array<{ userId?: string; email?: string }> = [];

    for (const item of items) {
      const userId = typeof item.userId === 'string' ? item.userId.trim() : '';
      const email = typeof item.email === 'string' ? item.email.trim().toLowerCase() : '';
      if (!userId && !email) continue;

      const user = userId
        ? await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, email: true },
          })
        : await prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            select: { id: true, name: true, email: true },
          });

      if (!user) {
        notFound.push({ userId: userId || undefined, email: email || undefined });
        continue;
      }

      const schedule = normalizeScheduleFormat(typeof item.schedule === 'string' ? item.schedule : '');
      const source =
        typeof item.source === 'string' && item.source.trim()
          ? item.source.trim().toUpperCase()
          : defaultSource;
      const updatedBy =
        typeof item.updatedBy === 'string' && item.updatedBy.trim()
          ? item.updatedBy.trim()
          : source.toLowerCase();

      if (!schedule) {
        await db.userShiftTime.deleteMany({ where: { userId: user.id } });
      } else {
        await db.userShiftTime.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            schedule,
            source,
            updatedBy,
          },
          update: {
            schedule,
            source,
            updatedBy,
          },
        });
      }

      const payload: ShiftTimeWebhookPayload = {
        userId: user.id,
        email: user.email,
        name: user.name,
        schedule,
        source,
        updatedBy,
        updatedAt: new Date().toISOString(),
      };
      applied.push(payload);
    }

    if (applied.length > 0) {
      await invalidateCache('users:all');
      for (const item of applied) {
        io.emit('shift_times:updated', item);
      }

      // Prevent echo loops: only forward to VIPScale if the update did NOT originate from VIPScale.
      const toForwardToTools = applied.filter((a) => a.source !== 'VIPSCALE');
      if (toForwardToTools.length > 0) {
        queueShiftTimeWebhooks(
          toForwardToTools.length === 1 ? toForwardToTools[0] : toForwardToTools,
          { skipSheet: toForwardToTools.every((a) => a.source === 'GOOGLE_SHEET') }
        );
      } else {
        // Originated from VIPScale: still forward to Google Sheet webhook if configured, but skip VIPScale echo.
        queueShiftTimeWebhooks(applied.length === 1 ? applied[0] : applied, { skipTools: true });
      }
    }

    return res.status(200).json({
      success: true,
      appliedCount: applied.length,
      applied,
      notFound,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to process shift time webhook' });
  }
}
