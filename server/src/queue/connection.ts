// Single shared ioredis connection used by every BullMQ Queue / Worker /
// QueueEvents in this process. We deliberately use one connection (not the
// per-instance default) because:
//
//   1. Each BullMQ instance opens its own TCP connection by default, which
//      multiplies fast — one queue + one worker + one events listener = three
//      connections per instance. With multiple queues, that adds up.
//   2. ioredis's `maxRetriesPerRequest: null` is required by BullMQ workers
//      (otherwise blocking BRPOPLPUSH commands fail after the default 20
//      retries). Forgetting this is a classic footgun.
//   3. Lazy-connect lets the import be side-effect-free — handy for tests
//      that don't want a Redis dependency at module-load time.
//
// REDIS_URL=redis://[:password@]host:port[/db]. Empty / unset => the queue
// system is considered offline; callers (`isQueueAvailable()`) should fall
// back gracefully (writing only to the outbox) instead of throwing at the
// request edge.

import IORedis, { type Redis, type RedisOptions } from 'ioredis';
import { logger } from '../utils/logger.js';

let cached: Redis | null = null;
let connectAttempted = false;

function buildOptions(): RedisOptions {
  // BullMQ-specific defaults (see https://docs.bullmq.io/guide/connections).
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Lazy connect — don't open a TCP connection until the first command.
    // Lets module imports stay cheap and lets tests skip Redis entirely.
    lazyConnect: true,
    // Reconnect quickly on transient drops; cap the backoff so a long-dead
    // Redis doesn't lock us into multi-minute waits.
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
  };
}

export function isQueueConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/**
 * Returns the singleton ioredis connection, lazily opening it on first call.
 * Throws if REDIS_URL is unset — callers that should degrade gracefully when
 * Redis is missing must check `isQueueConfigured()` first.
 */
export function getRedisConnection(): Redis {
  if (cached) return cached;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL is not set. The catalog sync queue requires Redis. ' +
        'Set REDIS_URL=redis://host:port (or unset to disable the catalog sync feature).',
    );
  }
  const conn = new IORedis(url, buildOptions());
  conn.on('error', (err) => {
    // ioredis surfaces every reconnection attempt as `error` while it
    // retries — log at warn so the noise is visible but doesn't dominate
    // the error stream. Hard failures (auth, etc.) are still here.
    logger.warn('queue.redis.error', { err: String(err) });
  });
  conn.on('ready', () => {
    logger.info('queue.redis.ready');
  });
  conn.on('end', () => {
    // Final disconnect (no more reconnection attempts). After this we'd
    // need a fresh connection — clear the cache so the next getter rebuilds.
    logger.warn('queue.redis.end');
    cached = null;
    connectAttempted = false;
  });
  cached = conn;
  if (!connectAttempted) {
    connectAttempted = true;
    // Kick off the lazy connect so callers see "connected" state without
    // having to issue a command first.
    conn.connect().catch((err) => {
      logger.error('queue.redis.connect_failed', { err: String(err) });
    });
  }
  return conn;
}

/** Disconnect for graceful shutdown. Idempotent. */
export async function closeRedisConnection(): Promise<void> {
  const conn = cached;
  cached = null;
  connectAttempted = false;
  if (!conn) return;
  try {
    // `quit` waits for pending commands; `disconnect` is forceful. Use quit
    // because we may still have BullMQ workers finishing in-flight jobs.
    await conn.quit();
  } catch (err) {
    logger.warn('queue.redis.quit_failed', { err: String(err) });
  }
}
