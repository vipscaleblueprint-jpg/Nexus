import pino from 'pino';
import { optionalEnv } from './env';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Application logger.
 *
 * Output is one plain line per event: time, then message. The structured
 * object pino normally appends is suppressed via `hideObject`, so nothing
 * prints as JSON. Set LOG_JSON=true to get the full structured stream back
 * (useful when piping to a log shipper).
 *
 * LOG_LEVEL overrides the default level (info in production, debug otherwise).
 */
export const logger = pino({
  level: optionalEnv('LOG_LEVEL') ?? (isProd ? 'info' : 'debug'),

  // Never let credentials reach the log stream.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'otp',
      '*.password',
      '*.*.password',
      '*.*.*.password',
      '*.token',
      '*.*.token',
      '*.options.password',
      '*.options.url',
      'options.password',
      'options.url',
      '*.connection.password',
      'err.options.password',
      'err.options.url',
      'redis.options.password',
      'redis.options.url',
    ],
    censor: '[redacted]',
  },

  ...(optionalEnv('LOG_JSON') === 'true'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            // One line per event: no trailing object, no stack dumps.
            hideObject: true,
            messageFormat: '{msg}',
          },
        },
      }),
});

/**
 * Strips passwords from URIs (e.g. redis://:secret@host:port or postgres://user:secret@host:port).
 */
export function maskUriSecrets(text: string): string {
  if (!text) return text;
  return text.replace(/:\/\/([^/\s@]+):([^/\s]+)@/g, '://$1:[redacted]@')
             .replace(/:\/\/:([^/\s]+)@/g, '://:[redacted]@');
}

/**
 * Error text for a log message. Because the structured object is hidden in
 * line mode, the reason has to live in the message itself or it is lost.
 * Full stacks are still available under LOG_JSON=true.
 */
export function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return maskUriSecrets(raw);
}

/** Namespaced child logger, e.g. createLogger('redis') -> { module: 'redis' }. */
export function createLogger(module: string) {
  return logger.child({ module });
}
