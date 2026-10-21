import Redis from 'ioredis';
import { requireEnv, optionalEnv } from '../config/env';
import { createLogger, errMsg } from '../config/logger';

const log = createLogger('redis');

const REDIS_URL = optionalEnv('REDIS_URL');

const REDIS_OPTIONS = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  retryStrategy(times: number) {
    return Math.min(times * 500, 5000);
  },
};

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, REDIS_OPTIONS)
  : new Redis({
      host: requireEnv('REDIS_HOST'),
      port: parseInt(requireEnv('REDIS_PORT'), 10),
      ...REDIS_OPTIONS,
    });

export function isRedisReady(): boolean {
  return redis.status === 'ready';
}

redis.on('error', (err) => {
  log.warn(`Redis connection error: ${errMsg(err)}`);
});

redis.on('connect', () => {
  log.info('Connected successfully');
});

// In-Memory Fallback Stores
const inMemoryRefreshTokens = new Map<string, string>();
const inMemoryBlacklistedTokens = new Set<string>();
const inMemoryRevokedSessions = new Map<string, number>();
const inMemoryOTPStore = new Map<string, { otp: string; expiresAt: number }>();
const inMemoryOTPAttempts = new Map<string, { count: number; expiresAt: number }>();
const inMemoryCacheStore = new Map<string, { value: string; expiresAt: number }>();

// Refresh token storage in Redis
export async function storeRefreshToken(userId: string, token: string, ttlSeconds: number = 7 * 24 * 3600) {
  inMemoryRefreshTokens.set(userId, token);
  if (isRedisReady()) {
    try {
      await redis.set(`refresh:${userId}`, token, 'EX', ttlSeconds);
    } catch (err) {
      log.error({ err }, `storeRefreshToken failed: ${errMsg(err)}`);
    }
  }
}

export async function getRefreshToken(userId: string): Promise<string | null> {
  if (isRedisReady()) {
    try {
      return await redis.get(`refresh:${userId}`);
    } catch (err) {
      return null;
    }
  }
  return inMemoryRefreshTokens.get(userId) ?? null;
}

export async function removeRefreshToken(userId: string) {
  inMemoryRefreshTokens.delete(userId);
  if (isRedisReady()) {
    try {
      await redis.del(`refresh:${userId}`);
    } catch (err) {
      log.error({ err }, `removeRefreshToken failed: ${errMsg(err)}`);
    }
  }
}

// Token Blacklisting in Redis
export async function blacklistToken(token: string, ttlSeconds: number = 24 * 3600) {
  inMemoryBlacklistedTokens.add(token);
  if (isRedisReady()) {
    try {
      await redis.set(`blacklist:${token}`, 'true', 'EX', ttlSeconds);
    } catch (err) {
      log.error({ err }, `blacklistToken failed: ${errMsg(err)}`);
    }
  }
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  if (inMemoryBlacklistedTokens.has(token)) return true;
  if (isRedisReady()) {
    try {
      const exists = await redis.get(`blacklist:${token}`);
      return exists === 'true';
    } catch (err) {
      return false;
    }
  }
  return false;
}

// Session revocation timestamp per user (invalidates all JWTs minted before this timestamp)
export async function revokeUserSessions(userId: string, ttlSeconds: number = 7 * 24 * 3600) {
  const timestamp = Math.floor(Date.now() / 1000);
  inMemoryRevokedSessions.set(userId, timestamp);
  if (isRedisReady()) {
    try {
      await redis.set(`revoked_at:${userId}`, String(timestamp), 'EX', ttlSeconds);
    } catch (err) {
      log.error({ err }, `revokeUserSessions failed: ${errMsg(err)}`);
    }
  }
}

export async function getUserRevokedAt(userId: string): Promise<number | null> {
  if (isRedisReady()) {
    try {
      const val = await redis.get(`revoked_at:${userId}`);
      if (val) return parseInt(val, 10);
    } catch (err) {
      // Fall back to in-memory check
    }
  }
  return inMemoryRevokedSessions.get(userId) ?? null;
}

// OTP (One-Time Password) Storage for Forgot Password Flow (10-min default TTL)
export async function storeOTP(email: string, otp: string, ttlSeconds: number = 600) {
  const normalizedEmail = email.toLowerCase().trim();
  inMemoryOTPAttempts.delete(normalizedEmail);
  inMemoryOTPStore.set(normalizedEmail, {
    otp,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  if (isRedisReady()) {
    try {
      await redis.multi().set(`otp:${normalizedEmail}`, otp, 'EX', ttlSeconds).del(`otp-attempts:${normalizedEmail}`).exec();
    } catch (err) {
      log.warn({ err }, `storeOTP failed, falling back to in-memory store: ${errMsg(err)}`);
    }
  }
}

export async function getOTP(email: string): Promise<string | null> {
  const normalizedEmail = email.toLowerCase().trim();
  if (isRedisReady()) {
    try {
      const otp = await redis.get(`otp:${normalizedEmail}`);
      if (otp) return otp;
    } catch (err) {
      log.warn({ err }, `getOTP failed, checking in-memory fallback: ${errMsg(err)}`);
    }
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
  inMemoryOTPStore.delete(normalizedEmail);
  inMemoryOTPAttempts.delete(normalizedEmail);
  if (isRedisReady()) {
    try {
      await redis.del(`otp:${normalizedEmail}`, `otp-attempts:${normalizedEmail}`);
    } catch (err) {
      log.error({ err }, `removeOTP failed: ${errMsg(err)}`);
    }
  }
}

/** Counts a wrong reset-code guess for this email and returns the total so far (for the current code). */
export async function recordFailedOTPAttempt(email: string, ttlSeconds: number = 600): Promise<number> {
  const normalizedEmail = email.toLowerCase().trim();
  const record = inMemoryOTPAttempts.get(normalizedEmail);
  const count = record && record.expiresAt > Date.now() ? record.count + 1 : 1;
  inMemoryOTPAttempts.set(normalizedEmail, { count, expiresAt: Date.now() + ttlSeconds * 1000 });

  if (isRedisReady()) {
    try {
      const key = `otp-attempts:${normalizedEmail}`;
      const redisCount = await redis.incr(key);
      if (redisCount === 1) await redis.expire(key, ttlSeconds);
      return redisCount;
    } catch (err) {}
  }
  return count;
}

// Generic Redis Cache-Aside & Cache Invalidation Helpers

function cacheFamily(key: string) {
  return key.split(':')[0];
}

function familyIndexKey(family: string) {
  return `cache:__index:${family}`;
}

let cacheEpoch = 0;
const familyGenerations = new Map<string, number>();

export function getCacheGeneration(key: string): string {
  return `${cacheEpoch}.${familyGenerations.get(cacheFamily(key)) ?? 0}`;
}

function bumpFamilyGeneration(key: string) {
  const family = cacheFamily(key);
  familyGenerations.set(family, (familyGenerations.get(family) ?? 0) + 1);
}

export async function setCache(key: string, value: any, ttlSeconds: number = 300, generation?: string) {
  if (generation !== undefined && generation !== getCacheGeneration(key)) return;
  inMemoryCacheStore.set(key, {
    value: JSON.stringify(value),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  if (isRedisReady()) {
    try {
      const stringVal = JSON.stringify(value);
      const now = Date.now();
      const index = familyIndexKey(cacheFamily(key));
      await redis
        .multi()
        .set(`cache:${key}`, stringVal, 'EX', ttlSeconds)
        .zadd(index, now + ttlSeconds * 1000, key)
        .zremrangebyscore(index, '-inf', now)
        .exec();
    } catch (err) {}
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  if (isRedisReady()) {
    try {
      const raw = await redis.get(`cache:${key}`);
      if (raw) return JSON.parse(raw) as T;
    } catch (err) {}
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

/** Wipes every cache:* entry, leaving refresh tokens, OTPs, and blacklisted tokens untouched. */
export async function clearAllCache(): Promise<number> {
  cacheEpoch++;
  inMemoryCacheStore.clear();
  if (isRedisReady()) {
    try {
      const keys = await scanKeys('cache:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      return keys.length;
    } catch (err) {
      log.error({ err }, `clearAllCache failed: ${errMsg(err)}`);
      return 0;
    }
  }
  return 0;
}

async function scanKeys(pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

export async function invalidateCache(...keys: string[]) {
  keys.forEach(bumpFamilyGeneration);
  keys.forEach((key) => {
    inMemoryCacheStore.delete(key);
    for (const memKey of inMemoryCacheStore.keys()) {
      if (memKey.startsWith(key.replace(/:all$/, ''))) {
        inMemoryCacheStore.delete(memKey);
      }
    }
  });

  if (isRedisReady()) {
    await Promise.all(keys.map(async (key) => {
      try {
        const index = familyIndexKey(cacheFamily(key));
        if (key.endsWith(':all') || key.includes('*') || key.startsWith('tasks')) {
          const prefix = key.replace(/:all$/, '').replace(/\*$/, '');
          const matching = (await redis.zrange(index, 0, -1)).filter((cached) => cached.startsWith(prefix));
          await redis
            .multi()
            .del(`cache:${key}`, ...matching.map((cached) => `cache:${cached}`))
            .zrem(index, key, ...matching)
            .exec();
        } else {
          await redis.multi().del(`cache:${key}`).zrem(index, key).exec();
        }
      } catch (err) {}
    }));
  }
}
