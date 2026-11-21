import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { redis, isRedisReady } from '../services/redisService';
import { createLogger } from '../config/logger';
import { io } from '../server';

const logger = createLogger('daily-otp');

export function getManilaDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isUserProjectManagerOrAdmin(user: { systemRole?: string; roles?: string[] } | null | undefined): boolean {
  if (!user) return false;
  if (user.systemRole === 'ADMIN') return true;
  const pmPattern = /project\s*manager|\bpm\b|senior\s*(?:pm|project\s*manager)|lead/i;
  return (user.roles || []).some((r) => pmPattern.test((r || '').trim()));
}

export function generateDailyOtpForUser(userId: string, dateStr?: string): string {
  const date = dateStr || getManilaDateString();
  const secret = process.env.DAILY_OTP_SECRET || 'nexus-pm-authenticator-salt-2026';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${userId.trim()}:${date}`);
  const hash = hmac.digest('hex');
  const num = parseInt(hash.substring(0, 8), 16) % 10000;
  return String(num).padStart(4, '0');
}

export async function getActiveProjectManagers() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, roles: true, systemRole: true },
  });
  return users.filter(isUserProjectManagerOrAdmin);
}

export async function verifyDailyOtp(
  otpInput: string,
  dateStr?: string
): Promise<{ valid: boolean; pm?: { id: string; name: string; email: string } }> {
  if (!otpInput || typeof otpInput !== 'string') return { valid: false };
  const cleanOtp = otpInput.trim();
  if (!/^\d{4}$/.test(cleanOtp)) return { valid: false };

  const targetDate = dateStr || getManilaDateString();
  const pms = await getActiveProjectManagers();

  for (const pm of pms) {
    const pmOtp = generateDailyOtpForUser(pm.id, targetDate);
    if (pmOtp === cleanOtp) {
      return { valid: true, pm: { id: pm.id, name: pm.name, email: pm.email } };
    }
  }

  return { valid: false };
}

const inMemoryClientUnlocks = new Map<string, { pmId: string; pmName: string; expiresAt: number }>();

function getClientUnlockKey(clientName: string, dateStr?: string): string {
  const cleanClient = (clientName || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const date = dateStr || getManilaDateString();
  return `client_unlock:${cleanClient}:${date}`;
}

export async function isClientUnlockedToday(clientName: string): Promise<{ unlocked: boolean; pmName?: string }> {
  if (!clientName) return { unlocked: false };
  const key = getClientUnlockKey(clientName);

  if (isRedisReady()) {
    try {
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        return { unlocked: true, pmName: parsed.pmName };
      }
    } catch (err) {
      logger.warn({ err }, 'Redis get error for client unlock key');
    }
  }

  const mem = inMemoryClientUnlocks.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return { unlocked: true, pmName: mem.pmName };
  }

  return { unlocked: false };
}

export async function setClientUnlockedToday(
  clientName: string,
  pm: { id: string; name: string }
): Promise<void> {
  if (!clientName) return;
  const key = getClientUnlockKey(clientName);
  const payload = JSON.stringify({ pmId: pm.id, pmName: pm.name, unlockedAt: Date.now() });

  if (isRedisReady()) {
    try {
      await redis.set(key, payload, 'EX', 86400);
    } catch (err) {
      logger.warn({ err }, 'Redis set error for client unlock key');
    }
  }

  inMemoryClientUnlocks.set(key, {
    pmId: pm.id,
    pmName: pm.name,
    expiresAt: Date.now() + 86400 * 1000,
  });
}

/**
 * Finds all active users whose systemRole or roles match ADMIN, admin, Admins, ADMINS, etc.
 * (and active PMs), creates a TaskNotification for each in PostgreSQL, and emits `notification_received`
 * to their user socket room so the Nexus Notification Bell rings and updates in real time.
 */
export async function notifyAdminsOfClientOtpUnlock({
  pm,
  clientName,
  maName,
  sheet,
  maUserId,
}: {
  pm: { id: string; name: string; email?: string };
  clientName: string;
  maName: string;
  sheet?: string | null;
  maUserId?: string | null;
}): Promise<void> {
  try {
    const allUsers = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, systemRole: true, roles: true },
    });

    // Match all variants: ADMIN, admin, Admins, ADMINS, or PM roles
    const recipients = allUsers.filter((u) => {
      const sysRole = (u.systemRole || '').trim();
      const roles = u.roles || [];
      const isAdmin = /admin/i.test(sysRole) || roles.some((r) => /admin/i.test((r || '').trim()));
      const isPm = /project\s*manager|\bpm\b|senior\s*(?:pm|project\s*manager)|lead/i.test(sysRole) || roles.some((r) => /project\s*manager|\bpm\b|senior\s*(?:pm|project\s*manager)|lead/i.test((r || '').trim()));
      return isAdmin || isPm;
    });

    const recipientIds = new Set(recipients.map((r) => r.id));
    if (maUserId && !recipientIds.has(maUserId)) {
      recipients.push({ id: maUserId, systemRole: 'MEMBER', roles: [] });
    }

    if (recipients.length === 0) return;

    const notifTitle = `${pm.name} authorized overtime for ${clientName}`;
    const notifContent = `${maName} logged work on overtime client "${clientName}" using ${pm.name}'s Daily OTP${sheet ? ` on "${sheet}"` : ''}`;

    await prisma.taskNotification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        actorId: pm.id,
        taskId: null,
        type: 'CLIENT_OVERHOURS_OTP_UNLOCK',
        title: notifTitle,
        content: notifContent,
        isRead: false,
      })),
    });

    // Real-time broadcast to each recipient's personal socket room
    for (const r of recipients) {
      io.to(`user:${r.id}`).emit('notification_received', {
        type: 'CLIENT_OVERHOURS_OTP_UNLOCK',
        title: notifTitle,
        content: notifContent,
      });
    }
  } catch (err) {
    logger.error({ err }, 'Failed to create TaskNotification for client OTP unlock');
  }
}


