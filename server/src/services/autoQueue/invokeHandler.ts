/**
 * Calls an Express handler in-process and captures its response, so background jobs can reuse
 * controller logic exactly as the UI runs it (same filters, permission checks, notifications,
 * audit logs and socket events) instead of re-implementing it.
 */
import type { Request, Response } from 'express';

export interface InvokeOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  user: { id: string; name?: string | null; email?: string | null };
}

export interface InvokeResult {
  status: number;
  body: any;
}

export function invokeHandler(
  handler: (req: Request, res: Response) => unknown,
  opts: InvokeOptions
): Promise<InvokeResult> {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(payload: any) {
        resolve({ status: statusCode, body: payload });
        return res;
      },
      send(payload: any) {
        resolve({ status: statusCode, body: payload });
        return res;
      },
    };
    const req: any = {
      params: opts.params || {},
      query: opts.query || {},
      body: opts.body || {},
      user: opts.user,
      headers: {},
      cookies: {},
    };
    Promise.resolve(handler(req as Request, res as Response))
      // A handler that returns without responding resolves as a 500 instead of hanging.
      .then(() => resolve({ status: 500, body: { error: 'Handler did not respond' } }))
      .catch(reject);
  });
}
