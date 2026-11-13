import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import { invalidateCache } from '../services/redisService';
import {
  getDbShiftConfigs,
  invalidateAuditShiftsCache,
  sweepInReviewTasksForShiftAudits,
  getManilaHourAndMinute,
  getActiveManilaShift,
  DEFAULT_SHIFTS,
} from '../services/auditAutoAssign';

/**
 * Checks if a user's roles include any auditor specialization.
 */
export function isAuditorRole(roles: string[] = []): boolean {
  if (!roles || !Array.isArray(roles)) return false;
  return roles.some((r) => typeof r === 'string' && r.toLowerCase().includes('audit'));
}

/**
 * Get all configured audit shifts, eligible users, and current Manila shift status.
 */
export const getAuditShifts = async (req: Request, res: Response) => {
  try {
    let shifts = await (prisma as any).auditShiftConfig.findMany({
      orderBy: { order: 'asc' },
    });

    if (!shifts || shifts.length === 0) {
      shifts = DEFAULT_SHIFTS;
    }

    // Fetch active users for auditor & member selection
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        roles: true,
        systemRole: true,
      },
      orderBy: { name: 'asc' },
    });

    // Enrich each shift with members (auditors + normal users) and isAudit flag
    const enrichedShifts = shifts.map((s: any) => {
      const auditorIdSet = new Set<string>((s.auditorIds || []).map((id: string) => id.trim()));
      const memberIdSet = new Set<string>((s.memberIds || []).map((id: string) => id.trim()));
      const memberNameSet = new Set<string>((s.memberNames || []).map((n: string) => n.trim().toLowerCase()));
      const auditorNameSet = new Set<string>((s.auditorNames || []).map((n: string) => n.trim().toLowerCase()));

      const members = users
        .filter((u) => {
          if (memberIdSet.has(u.id) || auditorIdSet.has(u.id)) return true;
          const uName = (u.name || '').trim().toLowerCase();
          if (!uName) return false;
          if (memberNameSet.has(uName) || auditorNameSet.has(uName)) {
            return true;
          }
          for (const token of [...memberNameSet, ...auditorNameSet]) {
            if (token && (uName.startsWith(`${token} `) || (token.length >= 3 && uName.includes(token)))) {
              return true;
            }
          }
          return false;
        })
        .map((u) => ({
          ...u,
          isAudit: isAuditorRole(u.roles) || auditorIdSet.has(u.id),
        }));

      return {
        ...s,
        members,
      };
    });

    const { hour, minute } = getManilaHourAndMinute();
    const activeShiftKey = await getActiveManilaShift();

    const formattedTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      hourCycle: 'h12',
    }).format(new Date());

    res.json({
      shifts: enrichedShifts,
      users,
      currentManilaTime: {
        hour,
        minute,
        formatted: formattedTime,
        timezone: 'Asia/Manila (UTC+8)',
      },
      activeShiftKey,
    });
  } catch (error: any) {
    req.log.error({ error }, 'Error fetching audit shifts');
    res.status(500).json({ error: 'Failed to fetch audit shifts' });
  }
};

/**
 * Update an existing audit shift configuration.
 */
export const updateAuditShift = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      shiftKey,
      startHour,
      startMinute,
      endHour,
      endMinute,
      auditorNames,
      auditorIds,
      memberNames,
      memberIds,
      isActive,
      order,
    } = req.body;

    const data: any = {};
    if (name !== undefined) data.name = String(name).trim();
    if (shiftKey !== undefined) data.shiftKey = String(shiftKey).trim().toUpperCase();
    if (startHour !== undefined) data.startHour = Math.max(0, Math.min(23, parseInt(startHour, 10)));
    if (startMinute !== undefined) data.startMinute = Math.max(0, Math.min(59, parseInt(startMinute, 10)));
    if (endHour !== undefined) data.endHour = Math.max(0, Math.min(23, parseInt(endHour, 10)));
    if (endMinute !== undefined) data.endMinute = Math.max(0, Math.min(59, parseInt(endMinute, 10)));
    if (Array.isArray(auditorNames)) data.auditorNames = auditorNames.map((s: string) => String(s).trim());
    if (Array.isArray(auditorIds)) data.auditorIds = auditorIds.map((s: string) => String(s).trim());
    if (Array.isArray(memberNames)) data.memberNames = memberNames.map((s: string) => String(s).trim());
    if (Array.isArray(memberIds)) data.memberIds = memberIds.map((s: string) => String(s).trim());
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (order !== undefined) data.order = parseInt(order, 10);

    const updated = await (prisma as any).auditShiftConfig.update({
      where: { id },
      data,
    });

    invalidateAuditShiftsCache();
    await invalidateCache('task_map:*').catch(() => {});
    io.emit('audit_shifts:updated', updated);
    io.emit('task_map:shifts_updated', { source: 'audit_shifts', updated });

    res.json({ success: true, shift: updated });
  } catch (error: any) {
    req.log.error({ error }, 'Error updating audit shift');
    res.status(500).json({ error: 'Failed to update audit shift' });
  }
};

/**
 * Create a new audit shift configuration.
 */
export const createAuditShift = async (req: Request, res: Response) => {
  try {
    const {
      name,
      shiftKey,
      startHour,
      startMinute = 0,
      endHour,
      endMinute = 0,
      auditorNames = [],
      auditorIds = [],
      memberNames = [],
      memberIds = [],
      isActive = true,
      order = 0,
    } = req.body;

    if (!name || !shiftKey || startHour === undefined || endHour === undefined) {
      return res.status(400).json({ error: 'Name, shiftKey, startHour, and endHour are required' });
    }

    const created = await (prisma as any).auditShiftConfig.create({
      data: {
        name: String(name).trim(),
        shiftKey: String(shiftKey).trim().toUpperCase(),
        startHour: Math.max(0, Math.min(23, parseInt(startHour, 10))),
        startMinute: Math.max(0, Math.min(59, parseInt(startMinute, 10))),
        endHour: Math.max(0, Math.min(23, parseInt(endHour, 10))),
        endMinute: Math.max(0, Math.min(59, parseInt(endMinute, 10))),
        auditorNames: Array.isArray(auditorNames) ? auditorNames.map((s: string) => String(s).trim()) : [],
        auditorIds: Array.isArray(auditorIds) ? auditorIds.map((s: string) => String(s).trim()) : [],
        memberNames: Array.isArray(memberNames) ? memberNames.map((s: string) => String(s).trim()) : [],
        memberIds: Array.isArray(memberIds) ? memberIds.map((s: string) => String(s).trim()) : [],
        isActive: Boolean(isActive),
        order: parseInt(order, 10) || 0,
      },
    });

    invalidateAuditShiftsCache();
    await invalidateCache('task_map:*').catch(() => {});
    io.emit('audit_shifts:updated', created);
    io.emit('task_map:shifts_updated', { source: 'audit_shifts', created });

    res.status(201).json({ success: true, shift: created });
  } catch (error: any) {
    req.log.error({ error }, 'Error creating audit shift');
    res.status(500).json({ error: 'Failed to create audit shift' });
  }
};

/**
 * Delete an audit shift configuration.
 */
export const deleteAuditShift = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await (prisma as any).auditShiftConfig.delete({
      where: { id },
    });

    invalidateAuditShiftsCache();
    await invalidateCache('task_map:*').catch(() => {});
    io.emit('audit_shifts:updated', { id, deleted: true });
    io.emit('task_map:shifts_updated', { source: 'audit_shifts', id, deleted: true });

    res.json({ success: true, message: 'Shift deleted successfully' });
  } catch (error: any) {
    req.log.error({ error }, 'Error deleting audit shift');
    res.status(500).json({ error: 'Failed to delete audit shift' });
  }
};

/**
 * Reset audit shifts back to standard defaults (AM, PM_AFTERNOON, PM_NIGHT).
 */
export const resetAuditShifts = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
    });

    function resolveIds(names: string[]) {
      const ids: string[] = [];
      for (const name of names) {
        const norm = name.toLowerCase();
        const user = users.find(
          (u) =>
            (u.name && u.name.toLowerCase().includes(norm)) ||
            (u.email && u.email.toLowerCase().includes(norm))
        );
        if (user && !ids.includes(user.id)) {
          ids.push(user.id);
        }
      }
      return ids;
    }

    // Delete existing
    await (prisma as any).auditShiftConfig.deleteMany({});

    // Seed defaults
    for (const def of DEFAULT_SHIFTS) {
      const auditorIds = resolveIds(def.auditorNames);
      await (prisma as any).auditShiftConfig.create({
        data: {
          shiftKey: def.shiftKey,
          name: def.name,
          startHour: def.startHour,
          startMinute: def.startMinute,
          endHour: def.endHour,
          endMinute: def.endMinute,
          auditorNames: def.auditorNames,
          auditorIds,
          isActive: true,
          order: def.order,
        },
      });
    }

    invalidateAuditShiftsCache();
    await invalidateCache('task_map:*').catch(() => {});
    io.emit('audit_shifts:updated');
    io.emit('task_map:shifts_updated', { source: 'audit_shifts', reset: true });

    const fresh = await (prisma as any).auditShiftConfig.findMany({
      orderBy: { order: 'asc' },
    });

    res.json({ success: true, shifts: fresh });
  } catch (error: any) {
    req.log.error({ error }, 'Error resetting audit shifts');
    res.status(500).json({ error: 'Failed to reset audit shifts' });
  }
};

/**
 * Manually trigger a shift sweep on in-review tasks.
 */
export const triggerShiftSweep = async (req: Request, res: Response) => {
  try {
    const { shift } = req.body;
    const result = await sweepInReviewTasksForShiftAudits(shift);
    res.json({ success: true, ...result });
  } catch (error: any) {
    req.log.error({ error }, 'Error running shift sweep');
    res.status(500).json({ error: 'Failed to execute shift sweep' });
  }
};

