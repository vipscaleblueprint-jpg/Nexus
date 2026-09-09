import Redis from 'ioredis';
import { requireEnv, optionalEnv } from '../config/env';
import { createLogger, errMsg } from '../config/logger';

const log = createLogger('redis');

const REDIS_URL = optionalEnv('REDIS_URL');

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    })
  : new Redis({
      host: requireEnv('REDIS_HOST'),
      port: parseInt(requireEnv('REDIS_PORT'), 10),
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

redis.on('error', (err) => {
  log.warn({ err }, `Redis connection error: ${errMsg(err)}`);
});

redis.on('connect', () => {
  log.info('Connected successfully');
});

// Refresh token storage in Redis
export async function storeRefreshToken(userId: string, token: string, ttlSeconds: number = 7 * 24 * 3600) {
  try {
    await redis.set(`refresh:${userId}`, token, 'EX', ttlSeconds);
  } catch (err) {
    log.error({ err }, `storeRefreshToken failed: ${errMsg(err)}`);
  }
}

export async function getRefreshToken(userId: string): Promise<string | null> {
  try {
    return await redis.get(`refresh:${userId}`);
  } catch (err) {
    return null;
  }
}

export async function removeRefreshToken(userId: string) {
  try {
    await redis.del(`refresh:${userId}`);
  } catch (err) {
    log.error({ err }, `removeRefreshToken failed: ${errMsg(err)}`);
  }
}

// Token Blacklisting in Redis
export async function blacklistToken(token: string, ttlSeconds: number = 24 * 3600) {
  try {
    await redis.set(`blacklist:${token}`, 'true', 'EX', ttlSeconds);
  } catch (err) {
    log.error({ err }, `blacklistToken failed: ${errMsg(err)}`);
  }
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const exists = await redis.get(`blacklist:${token}`);
    return exists === 'true';
  } catch (err) {
    return false;
  }
}

// In-Memory Fallback Store
const inMemoryOTPStore = new Map<string, { otp: string; expiresAt: number }>();
const inMemoryCacheStore = new Map<string, { value: string; expiresAt: number }>();

// OTP (One-Time Password) Storage for Forgot Password Flow (10-min default TTL)
export async function storeOTP(email: string, otp: string, ttlSeconds: number = 600) {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    await redis.set(`otp:${normalizedEmail}`, otp, 'EX', ttlSeconds);
  } catch (err) {
    log.warn({ err }, `storeOTP failed, falling back to in-memory store: ${errMsg(err)}`);
    inMemoryOTPStore.set(normalizedEmail, {
      otp,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

export async function getOTP(email: string): Promise<string | null> {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const otp = await redis.get(`otp:${normalizedEmail}`);
    if (otp) return otp;
  } catch (err) {
    log.warn({ err }, `getOTP failed, checking in-memory fallback: ${errMsg(err)}`);
  }

  const memoryRecord = inMemoryOTPStore.get(normalizedEmail);
  if (memoryRecord) {
    if (Date.now() > memoryRecord.expiresAt) {
      inMemoryOTPStore.delete(normalizedEmail);
      return null;
    }
    return memoryRecord.otp;
  }

  return null;
}

export async function removeOTP(email: string) {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    await redis.del(`otp:${normalizedEmail}`);
  } catch (err) {
    log.error({ err }, `removeOTP failed: ${errMsg(err)}`);
  }
  inMemoryOTPStore.delete(normalizedEmail);
}

// Generic Redis Cache-Aside & Cache Invalidation Helpers
export async function setCache(key: string, value: any, ttlSeconds: number = 300) {
  try {
    const stringVal = JSON.stringify(value);
    await redis.set(`cache:${key}`, stringVal, 'EX', ttlSeconds);
  } catch (err) {
    inMemoryCacheStore.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(`cache:${key}`);
    if (raw) return JSON.parse(raw) as T;
  } catch (err) {
    // fallback
  }

  const memoryRecord = inMemoryCacheStore.get(key);
  if (memoryRecord) {
    if (Date.now() > memoryRecord.expiresAt) {
      inMemoryCacheStore.delete(key);
      return null;
    }
    return JSON.parse(memoryRecord.value) as T;
  }
  return null;
}

export async function invalidateCache(...keys: string[]) {
  for (const key of keys) {
    try {
      await redis.del(`cache:${key}`);
      if (key.endsWith(':all') || key.includes('*') || key.startsWith('tasks')) {
        const prefix = key.replace(/:all$/, '').replace(/\*$/, '');
        const matching = await redis.keys(`cache:${prefix}*`);
        if (matching.length > 0) {
          await redis.del(...matching);
        }
      }
    } catch (err) {
      // ignore
    }
    inMemoryCacheStore.delete(key);
    for (const memKey of inMemoryCacheStore.keys()) {
      if (memKey.startsWith(key.replace(/:all$/, ''))) {
        inMemoryCacheStore.delete(memKey);
      }
    }
  }
}
