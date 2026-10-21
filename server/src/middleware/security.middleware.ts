import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { requireEnv } from '../config/env';
import { createLogger } from '../config/logger';

const log = createLogger('security');

// Banned User-Agent patterns for bots, automated security scanners, and API testing tools
const BANNED_USER_AGENTS = [
  /postmanruntime/i,
  /insomnia/i,
  /curl/i,
  /python-requests/i,
  /python-urllib/i,
  /go-http-client/i,
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /wget/i,
  /apachebench/i,
  /gobuster/i,
  /dirbuster/i,
  /zgrab/i,
  /masscan/i,
  /libcurl/i,
  /httpx/i,
  /nuclei/i,
  /aiohttp/i,
  /java\//i,
  /node-fetch/i,
];

// Simple in-memory rate limiter per IP (100 requests / minute)
const rateLimitMap = new Map<string, { count: number; expiresAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 120;

// Expired entries are otherwise only replaced when the same IP comes back, so one-off visitors and scanners
// would accumulate forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now > record.expiresAt) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'development') return next();

  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();

  const record = rateLimitMap.get(clientIp);

  if (!record || now > record.expiresAt) {
    rateLimitMap.set(clientIp, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    log.warn({ clientIp }, 'Rate limit exceeded');
    return res.status(429).json({
      error: 'Too many requests. Please slow down and try again later.',
    });
  }

  record.count += 1;
  return next();
}

// Bot & Automated Scanner Blocker (Active when NODE_ENV !== 'development')
export function botBlocker(req: Request, res: Response, next: NextFunction) {
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (!isDevelopment) {
    const userAgent = req.headers['user-agent'] || '';

    // Block empty User-Agent in production
    if (!userAgent.trim()) {
      log.warn({ ip: req.ip }, 'Blocked request with empty User-Agent');
      return res.status(403).json({ error: 'Access denied. Missing User-Agent header.' });
    }

    const isBanned = BANNED_USER_AGENTS.some((pattern) => pattern.test(userAgent));
    if (isBanned) {
      log.warn({ ip: req.ip, userAgent }, 'Blocked automated tool/bot User-Agent');
      return res.status(403).json({
        error: 'Access denied. Automated security tools and API testing utilities are restricted in production.',
      });
    }
  }

  return next();
}

// Strict CORS Middleware Configuration
const corsOrigin = requireEnv('CORS_ORIGIN');
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or same-origin)
    if (!origin || origin === corsOrigin || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    try {
      const hostname = new URL(origin).hostname;
      if (hostname === 'vipscaleph.com' || hostname.endsWith('.vipscaleph.com')) {
        return callback(null, true);
      }
    } catch {}
    callback(new Error(`CORS origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  // Lets the frontend perf monitor read how long each request spent on the server
  exposedHeaders: ['Server-Timing'],
  // Let browsers cache preflight (OPTIONS) results for 2 hours (Chrome's cap) instead of sending one
  // before every request — each preflight is an extra full round trip.
  maxAge: 7200,
};
