import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Options, Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request } from 'express';
import { getRedisConnection, isQueueConfigured } from '../queue/connection.js';
import { logger } from '../utils/logger.js';

// Per-user key when authenticated, IPv6-safe IP key otherwise. The library's
// default keys everyone on `req.ip` — behind a NAT or shared proxy that lets
// one abusive user burn the bucket for every colocated user. Keying on
// `req.userId` first isolates authenticated requests per account.
function userOrIpKey(req: Request): string {
  if (req.userId) return `u:${req.userId}`;
  return ipKeyGenerator(req.ip ?? '');
}

// Shared Redis-backed store across all limiters in this process. Without it
// each Railway replica enforces its own bucket — the effective ceiling on
// brute-force is N × max where N is the replica count. Falls back to the
// in-memory store when REDIS_URL is unset (single-process dev only).
let cachedStore: Store | null | undefined;
function getRedisStoreOrNull(): Store | null {
  if (cachedStore !== undefined) return cachedStore;
  if (!isQueueConfigured()) {
    logger.warn('rate-limiter.redis_unset_using_memory_store');
    cachedStore = null;
    return null;
  }
  const conn = getRedisConnection();
  cachedStore = new RedisStore({
    // rate-limit-redis types `sendCommand` as `(...args: string[]) => Promise<RedisReply>`.
    // ioredis's `call` accepts `(command, ...args)` and returns `Promise<unknown>`.
    // The shapes line up at runtime; cast through `unknown` so TS accepts it.
    sendCommand: (...args: string[]) =>
      conn.call(args[0], ...args.slice(1)) as unknown as Promise<string | number>,
    prefix: 'rl:',
  });
  return cachedStore;
}

export function createRateLimiter(opts: Partial<Options>) {
  const store = getRedisStoreOrNull();
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    ...(store ? { store } : {}),
    ...opts,
  });
}
