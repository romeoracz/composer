import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function withRequestId(req: Request, _res: Response, next: NextFunction) {
  (req as any).rid = (req.headers['x-request-id'] as string) || randomUUID();
  next();
}

export function logInfo(message: string, meta: Record<string, unknown> = {}) {
  const base = { level: 'info', t: Date.now(), ...meta } as any;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: message, ...base }));
}

export function logError(message: string, meta: Record<string, unknown> = {}) {
  const base = { level: 'error', t: Date.now(), ...meta } as any;
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ msg: message, ...base }));
}
