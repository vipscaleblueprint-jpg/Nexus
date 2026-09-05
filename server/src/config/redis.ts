import { Redis } from 'ioredis';
import { requireEnv } from './env';
import { createLogger } from './logger';

const redisLog = createLogger('redis');

export const redis = new Redis(requireEnv('REDIS_URL'), {
  maxRetriesPerRequest: null,
});

redis.on('connect', () => {
  redisLog.info('Redis connected successfully');
});

redis.on('error', (err) => {
  redisLog.error({ err }, 'Redis connection error');
});
