import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      reqId?: string;
    }
  }
}

// Per-request log + reqId correlation. Mounted early so every downstream
// handler can set `req.reqId` as a field in its own logger calls to tie
// logs together.
//
// Skipped for /api/health to keep log noise down from load-balancer probes.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/api/health') {
    next();
    return;
  }

  const reqId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  req.reqId = reqId;
  res.setHeader('X-Request-Id', reqId);

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('http', {
      reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      userId: req.userId,
    });
  });
  next();
}
