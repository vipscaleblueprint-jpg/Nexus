import { redis, isRedisReady } from './redisService';
import { isClientUnlockedToday } from '../utils/dailyOtp';
import { createLogger, errMsg } from '../config/logger';

const logger = createLogger('client-lock');

function toolsBaseUrl(): string {
  const isDev = process.env.NODE_ENV === 'development';
  return (process.env.TOOLS_VIP_URL || (isDev ? 'http://localhost:3001' : 'https://tools.vipscaleph.com')).replace(/\/+$/, '');
}

export interface ClientLockStatus {
  clientName: string;
  isLocked: boolean;
  isOvertime: boolean;
  hoursLogged?: number;
  weeklyLimit?: number;
  remainingHours?: number;
  unlockedToday?: boolean;
  unlockedByPmName?: string;
  reason?: string;
}

export async function checkClientLockStatus(clientName: string): Promise<ClientLockStatus> {
  if (!clientName || !clientName.trim()) {
    return { clientName: '', isLocked: false, isOvertime: false };
  }

  const cleanClient = clientName.trim();

  // 1. Check if client has already been unlocked today by a PM OTP
  const unlockStatus = await isClientUnlockedToday(cleanClient);
  if (unlockStatus.unlocked) {
    return {
      clientName: cleanClient,
      isLocked: false,
      isOvertime: true,
      unlockedToday: true,
      unlockedByPmName: unlockStatus.pmName,
      reason: `Client unlocked today by PM ${unlockStatus.pmName}`,
    };
  }

  // 2. Check cached pacing data in Redis (5 min TTL) to avoid hitting Clockify on every action
  const cacheKey = `task_map:pacing:${cleanClient.toLowerCase().replace(/[\s_-]+/g, '')}`;
  let pacingData: { hoursLogged: number; weeklyLimit: number; isLocked?: boolean } | null = null;

  if (isRedisReady()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        pacingData = JSON.parse(cached);
      }
    } catch (err) {
      logger.warn({ err }, 'Redis error reading pacing cache');
    }
  }

  // 3. Fetch from VIPScale tools API if not cached
  if (!pacingData) {
    try {
      const url = `${toolsBaseUrl()}/api/pacing?client=${encodeURIComponent(cleanClient)}`;
      const res = await fetch(url, {
        headers: { 'x-api-key': process.env.VIPSCALE_API_KEY || '' },
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const json = await res.json();
        pacingData = {
          hoursLogged: Number(json.hoursLogged) || 0,
          weeklyLimit: Number(json.weeklyLimit) || 0,
          isLocked: Boolean(json.isLocked || (json.weeklyLimit > 0 && json.hoursLogged >= json.weeklyLimit)),
        };

        if (isRedisReady()) {
          await redis.set(cacheKey, JSON.stringify(pacingData), 'EX', 300).catch(() => {});
        }
      }
    } catch (err) {
      logger.warn({ err: errMsg(err), client: cleanClient }, 'Failed to fetch pacing status from tools');
    }
  }

  if (!pacingData || !pacingData.weeklyLimit || pacingData.weeklyLimit <= 0) {
    return { clientName: cleanClient, isLocked: false, isOvertime: false };
  }

  const isOvertime = pacingData.hoursLogged >= pacingData.weeklyLimit;
  const isLocked = isOvertime;

  return {
    clientName: cleanClient,
    isLocked,
    isOvertime,
    hoursLogged: pacingData.hoursLogged,
    weeklyLimit: pacingData.weeklyLimit,
    remainingHours: Math.max(0, pacingData.weeklyLimit - pacingData.hoursLogged),
    reason: isOvertime
      ? `Client exceeded weekly hour limit (${pacingData.hoursLogged.toFixed(1)} / ${pacingData.weeklyLimit.toFixed(1)} hrs)`
      : undefined,
  };
}
