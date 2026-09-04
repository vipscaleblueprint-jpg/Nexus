import pinoHttp from 'pino-http';
import { logger } from '../config/logger';
import type { AuthenticatedUserPayload } from '../types';

/**
 * Per-request logging: one line of
 * `<ip> <method> <path> <status> <duration>ms user=<id>`, prefixed with the
 * time by the pretty printer.
 *
 * Levels follow status: 5xx -> error, 4xx -> warn, anything slower than
 * SLOW_REQUEST_MS -> warn, everything else -> info.
 * Health checks are silenced so uptime probes don't flood the stream.
 */

/** Requests at or above this take a warn level, so they stand out. */
const SLOW_REQUEST_MS = 1000;

// Express rewrites req.url to the router-relative path while dispatching, and
// these callbacks run at response time — so the full path must come from
// originalUrl, which is left untouched.
function fullPath(req: any) {
  return req.originalUrl ?? req.url;
}

function clientIp(req: { headers: Record<string, any>; socket: { remoteAddress?: string } }) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? '-';
  // Normalise IPv4-mapped IPv6 (::ffff:127.0.0.1) and loopback.
  return raw.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
}

// pino-http records responseTime on the response once it finishes.
function duration(res: any) {
  const ms = res.responseTime;
  return typeof ms === 'number' ? `${ms}ms` : '-';
}

/**
 * These callbacks run at response time, so authenticateToken has already
 * populated req.user on any authenticated route.
 */
function actor(req: any) {
  const user: AuthenticatedUserPayload | undefined = req.user;
  return user ? ` user=${user.id}` : '';
}

function line(req: any, res: any) {
  return `${clientIp(req)} ${req.method} ${fullPath(req)} ${res.statusCode} ${duration(res)}${actor(req)}`;
}

export const httpLogger = pinoHttp({
  logger,

  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if ((res as any).responseTime >= SLOW_REQUEST_MS) return 'warn';
    return 'info';
  },

  customSuccessMessage(req, res) {
    return line(req, res);
  },

  customErrorMessage(req, res, err) {
    return `${line(req, res)} - ${err.message}`;
  },

  autoLogging: {
    ignore: (req) => req.url === '/api/health',
  },

  // Structured detail, visible under LOG_JSON=true. Kept off the pretty line
  // so it stays readable, but present for whatever ships the logs.
  serializers: {
    req(req) {
      // Depending on pino-http's version the Express request is either the
      // serializer argument itself or hangs off `.raw`.
      const raw: any = (req as any).raw ?? req;
      return {
        id: req.id,
        method: req.method,
        url: fullPath(req),
        userId: raw.user?.id,
        ip: clientIp(raw),
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'],
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
        contentLength: res.getHeader?.('content-length'),
      };
    },
  },
});
