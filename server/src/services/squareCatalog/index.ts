// Public surface of the catalog-sync subsystem. index.ts (the server entry)
// imports `startSquareCatalogSync` and `stopSquareCatalogSync` only — every
// other module here is private to this directory.

import { startSquareCatalogWorker, stopSquareCatalogWorker } from './worker.js';
import { startReconciler, stopReconciler } from './reconciler.js';
import { startDailyFailureSummary, stopDailyFailureSummary } from './observability.js';
import { startFeaturedRebuildSchedule, stopFeaturedRebuildSchedule } from './featured.js';
import { closeQueues } from '../../queue/queues.js';
import { closeRedisConnection, isQueueConfigured } from '../../queue/connection.js';
import { logger } from '../../utils/logger.js';

let started = false;

/**
 * Boot the catalog sync subsystem: BullMQ worker, reconciler, daily summary.
 * Idempotent — safe to call from multiple lifecycle hooks. No-op if Redis
 * isn't configured.
 *
 * Designed to be called AFTER the HTTP server starts listening, so a startup
 * failure here doesn't block the rest of the app from coming up.
 */
export function startSquareCatalogSync(): void {
  if (started) return;
  // Featured rebuild runs even without Redis — it's a read-from-Square,
  // write-to-Postgres job that doesn't depend on the queue.
  startFeaturedRebuildSchedule();
  if (!isQueueConfigured()) {
    logger.warn('square.catalog.boot.skipped_no_redis');
    return;
  }
  startSquareCatalogWorker();
  startReconciler();
  startDailyFailureSummary();
  started = true;
  logger.info('square.catalog.boot.complete');
}

/**
 * Tear down the catalog sync subsystem on graceful shutdown. Stops the
 * worker (waiting briefly for in-flight jobs), the reconciler timer, and
 * the daily summary timer; closes the queue + Redis connection.
 */
export async function stopSquareCatalogSync(): Promise<void> {
  stopFeaturedRebuildSchedule();
  if (!started) return;
  started = false;
  stopReconciler();
  stopDailyFailureSummary();
  await stopSquareCatalogWorker();
  await closeQueues();
  await closeRedisConnection();
  logger.info('square.catalog.boot.shutdown');
}

export { enqueueOutbox, createOutboxRow, snapshotListing } from './outbox.js';
export type { OutboxKind, OutboxPayload } from './outbox.js';
