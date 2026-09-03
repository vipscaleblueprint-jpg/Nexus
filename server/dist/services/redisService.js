"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.storeRefreshToken = storeRefreshToken;
exports.getRefreshToken = getRefreshToken;
exports.removeRefreshToken = removeRefreshToken;
exports.blacklistToken = blacklistToken;
exports.isTokenBlacklisted = isTokenBlacklisted;
const ioredis_1 = __importDefault(require("ioredis"));
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
exports.redis = REDIS_URL
    ? new ioredis_1.default(REDIS_URL, {
        lazyConnect: true,
        retryStrategy(times) {
            return Math.min(times * 100, 3000);
        },
    })
    : new ioredis_1.default({
        host: REDIS_HOST,
        port: REDIS_PORT,
        lazyConnect: true,
        retryStrategy(times) {
            return Math.min(times * 100, 3000);
        },
    });
exports.redis.on('error', (err) => {
    console.warn('[Redis Warning]:', err.message);
});
exports.redis.on('connect', () => {
    console.log('[Redis] Connected successfully');
});
// Refresh token storage in Redis
async function storeRefreshToken(userId, token, ttlSeconds = 7 * 24 * 3600) {
    try {
        await exports.redis.set(`refresh:${userId}`, token, 'EX', ttlSeconds);
    }
    catch (err) {
        console.error('Redis storeRefreshToken error:', err);
    }
}
async function getRefreshToken(userId) {
    try {
        return await exports.redis.get(`refresh:${userId}`);
    }
    catch (err) {
        return null;
    }
}
async function removeRefreshToken(userId) {
    try {
        await exports.redis.del(`refresh:${userId}`);
    }
    catch (err) {
        console.error('Redis removeRefreshToken error:', err);
    }
}
// Token Blacklisting in Redis
async function blacklistToken(token, ttlSeconds = 24 * 3600) {
    try {
        await exports.redis.set(`blacklist:${token}`, 'true', 'EX', ttlSeconds);
    }
    catch (err) {
        console.error('Redis blacklistToken error:', err);
    }
}
async function isTokenBlacklisted(token) {
    try {
        const exists = await exports.redis.get(`blacklist:${token}`);
        return exists === 'true';
    }
    catch (err) {
        return false;
    }
}
