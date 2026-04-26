// Queue registry. Each queue is created once per process and reused — BullMQ
// requires Queue / Worker / QueueEvents to share the same connection options
// (or have isolated ones), and creating multiple Queue instances against the
// same name leaks listeners.
//
// The `squareCatalog` queue carries every kind of catalog mutation (upsert,
// soft-delete, reconciliation). Job kind is encoded in the BullMQ `name` so
// the worker can fan out to handlers without us maintaining N separate queues.

import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConnection, isQueueConfigured } from './connection.js';
import { logger } from '../utils/logger.js';

export const QUEUE_NAMES = {
  squareCatalog: 'square-catalog-sync',
} as const;

export type SquareCatalogJobName =
  | 'listing.upsert'
  | 'listing.delete'
  | 'inventory.adjust'
  | 'reconcile.seller';

export type SquareCatalogJobData =
  | { kind: 'listing.upsert'; outboxId: string; listingId: string; sellerId: string }
  | { kind: 'listing.delete'; outboxId: string; listingId: string; sellerId: string }
  | { kind: 'inventory.adjust'; outboxId: string; listingId: string; sellerId: string; quantity: number }
  | { kind: 'reconcile.seller'; sellerId: string };

let cachedSquareCatalogQueue: Queue<SquareCatalogJobData, unknown, SquareCatalogJobName> | null = null;

/**
 * Lazy-create the catalog sync queue. Returns null when Redis isn't
 * configured so callers can degrade to "outbox-only" mode (the row is
 * persisted; a future reconciliation job will pick it up once Redis is back).
 */
export function getSquareCatalogQueue():
  | Queue<SquareCatalogJobData, unknown, SquareCatalogJobName>
  | null {
  if (!isQueueConfigured()) return null;
  if (cachedSquareCatalogQueue) return cachedSquareCatalogQueue;
  const conn = getRedisConnection();
  cachedSquareCatalogQueue = new Queue<
    SquareCatalogJobData,
    unknown,
    SquareCatalogJobName
  >(QUEUE_NAMES.squareCatalog, {
    connection: conn,
    defaultJobOptions: defaultSquareCatalogJobOptions(),
  });
  cachedSquareCatalogQueue.on('error', (err) => {
    logger.warn('queue.square_catalog.error', { err: String(err) });
  });
  return cachedSquareCatalogQueue;
}

export function defaultSquareCatalogJobOptions(): JobsOptions {
  return {
    // Exponential backoff: 5s, 25s, 125s, 625s, 3125s (~52min). Capped at
    // 5 attempts because a sync that's failed five times needs human
    // attention, not more retries.
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    // Keep a bounded recent history in Redis for debugging without letting
    // Redis grow unbounded — anything beyond is in our own SquareSyncEvent
    // audit log anyway.
    removeOnComplete: { age: 60 * 60 * 24 * 3, count: 1000 },
    removeOnFail: { age: 60 * 60 * 24 * 14, count: 1000 },
  };
}

export async function closeQueues(): Promise<void> {
  const q = cachedSquareCatalogQueue;
  cachedSquareCatalogQueue = null;
  if (q) {
    try {
      await q.close();
    } catch (err) {
      logger.warn('queue.square_catalog.close_failed', { err: String(err) });
    }
  }
}
