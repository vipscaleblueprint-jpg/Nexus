import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    })
  : new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

redis.on('error', (err) => {
  console.warn('[Redis Warning]:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected successfully');
});

// Refresh token storage in Redis
export async function storeRefreshToken(userId: string, token: string, ttlSeconds: number = 7 * 24 * 3600) {
  try {
    await redis.set(`refresh:${userId}`, token, 'EX', ttlSeconds);
  } catch (err) {
    console.error('Redis storeRefreshToken error:', err);
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
    console.error('Redis removeRefreshToken error:', err);
  }
}

// Token Blacklisting in Redis
export async function blacklistToken(token: string, ttlSeconds: number = 24 * 3600) {
  try {
    await redis.set(`blacklist:${token}`, 'true', 'EX', ttlSeconds);
  } catch (err) {
    console.error('Redis blacklistToken error:', err);
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
