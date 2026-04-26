// Reconciler poller. Two responsibilities, one process:
//
//   1. Outbox sweeper — pick up SquareSyncOutbox rows that didn't make it
//      into BullMQ (Redis was down at write time, request crashed mid-add,
//      etc.) and enqueue them now. Idempotent: jobId derives from outboxId,
//      so a row that was added but not yet marked ENQUEUED gets picked up
//      cleanly.
//
//   2. Stale-job rescuer — find outbox rows stuck in ENQUEUED for >10 min
//      with no terminal event. Either BullMQ lost them (rare, but possible
//      across crashes) or they're hung. Re-enqueue with a fresh job id.
//
// Runs every 60 seconds with jitter. A single global lock (per-process)
// prevents overlapping ticks from doubling work — sufficient for our
// single-instance deployment. If we ever scale horizontally we'd need a
// Postgres advisory lock here.

import prisma from '../../lib/prisma.js';
import { enqueueOutbox } from './outbox.js';
import { logger } from '../../utils/logger.js';

const RECONCILE_INTERVAL_MS = 60_000;
const STALE_AFTER_MS = 10 * 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startReconciler(): void {
  if (timer) return;
  // Initial run at +5s so the server has time to finish booting.
  timer = setTimeout(function tick() {
    runReconciliation().catch((err) =>
      logger.error('square.catalog.reconciler.tick_failed', { err: String(err) }),
    );
    // Add jitter (±10s) to spread DB load if multiple instances ever exist.
    const jitter = Math.floor((Math.random() - 0.5) * 20_000);
    timer = setTimeout(tick, RECONCILE_INTERVAL_MS + jitter);
  }, 5_000);
}

export function stopReconciler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function runReconciliation(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await Promise.all([sweepPending(), rescueStuck()]);
  } finally {
    running = false;
  }
}

async function sweepPending(): Promise<void> {
  // Cap to 50 per tick to avoid surge-enqueueing during recovery — the
  // queue's backoff would just push them back out anyway.
  const rows = await prisma.squareSyncOutbox.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true },
  });
  if (rows.length === 0) return;
  logger.debug('square.catalog.reconciler.sweep_pending', { count: rows.length });
  for (const row of rows) {
    await enqueueOutbox(row.id);
  }
}

async function rescueStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const rows = await prisma.squareSyncOutbox.findMany({
    where: {
      status: 'ENQUEUED',
      OR: [
        { lastAttemptAt: { lt: cutoff } },
        { lastAttemptAt: null, enqueuedAt: { lt: cutoff } },
      ],
    },
    take: 20,
    select: { id: true },
  });
  if (rows.length === 0) return;
  logger.warn('square.catalog.reconciler.rescue_stuck', { count: rows.length });
  // Reset to PENDING so sweepPending re-enqueues with a fresh BullMQ job
  // (using a new jobId so BullMQ doesn't dedupe against the stuck one).
  for (const row of rows) {
    await prisma.squareSyncOutbox.update({
      where: { id: row.id },
      data: {
        status: 'PENDING',
        // Clear jobId so the next enqueue picks a new one and won't
        // conflict with whatever ghost job BullMQ may still hold.
        jobId: null,
      },
    });
  }
}
