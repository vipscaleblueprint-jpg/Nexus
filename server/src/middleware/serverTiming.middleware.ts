import { Request, Response, NextFunction } from 'express';
import { requireEnv } from '../config/env';

/**
 * Adds `Server-Timing: app;dur=<ms>` to every response so the browser's perf monitor can split a slow
 * request into time spent on this server vs. on the network. `Timing-Allow-Origin` lets the frontend
 * (a different origin) read response sizes and network timings from the Resource Timing API.
 *
 * Also counts in-flight requests for the runtime metrics log.
 */
const corsOrigin = requireEnv('CORS_ORIGIN');
let inFlight = 0;

export function getInFlightRequests() {
  return inFlight;
}

const START = Symbol('requestStart');

/** Milliseconds since this request reached the server, or undefined if serverTiming didn't run. */
export function getElapsedMs(res: unknown): number | undefined {
  const start = (res as any)?.[START] as bigint | undefined;
  return start === undefined ? undefined : Number(process.hrtime.bigint() - start) / 1e6;
}

export function serverTiming(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  (res as any)[START] = start;
  inFlight++;
  let counted = true;
  const done = () => {
    if (counted) {
      counted = false;
      inFlight--;
    }
  };
  res.on('finish', done);
  res.on('close', done);

  // Same rule as corsOptions: the configured origin, or any origin in development
  const origin = req.headers.origin;
  const timingOrigin = origin && (origin === corsOrigin || process.env.NODE_ENV === 'development') ? origin : null;

  // Headers must be set before they are sent; hook writeHead, which every response path goes through.
  const originalWriteHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: any[]) {
    if (!res.headersSent) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      res.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`);
      if (timingOrigin) res.setHeader('Timing-Allow-Origin', timingOrigin);
    }
    return (originalWriteHead as any).apply(this, args);
  } as any;

  next();
}
