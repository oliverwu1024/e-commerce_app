import prisma from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

// CARD-flow orders open a `sellerDeclineDeadline` at PAID time. After it
// expires the seller can no longer /decline (the route enforces this) — but
// without a sweep, the deadline column would stay set forever, leaving stale
// "Decline available until …" badges in the UI long after the window has
// closed. This sweeper nulls expired deadlines so the UI gates on a single
// truthy column and the route doesn't have to compare timestamps every render.
//
// Idempotent: the conditional WHERE on (deadline NOT NULL AND deadline < now)
// makes a re-tick a no-op, and a concurrent /decline call writes
// `sellerDeclineDeadline=null` itself before the sweep gets there.

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 min — finer-grained than orderSweep
const BATCH_SIZE = 200;

let timer: NodeJS.Timeout | undefined;

export async function sweepExpiredDeclineWindows(): Promise<number> {
  const now = new Date();
  const candidates = await prisma.order.findMany({
    where: {
      sellerDeclineDeadline: { not: null, lt: now },
    },
    take: BATCH_SIZE,
    select: { id: true },
  });
  if (candidates.length === 0) return 0;

  const { count } = await prisma.order.updateMany({
    where: {
      id: { in: candidates.map((c) => c.id) },
      sellerDeclineDeadline: { not: null, lt: now },
    },
    data: { sellerDeclineDeadline: null },
  });
  if (count > 0) {
    logger.info('declineWindowSweep.cleared', { count });
  }
  return count;
}

export function startDeclineWindowSweep(): void {
  if (timer) return; // idempotent — called from index.ts
  // Run once on boot so a container restart doesn't delay clearing by
  // up to one tick.
  sweepExpiredDeclineWindows().catch((err) =>
    logger.error('declineWindowSweep.boot_failed', { err: String(err) }),
  );
  timer = setInterval(() => {
    sweepExpiredDeclineWindows().catch((err) =>
      logger.error('declineWindowSweep.tick_failed', { err: String(err) }),
    );
  }, SWEEP_INTERVAL_MS);
  // Don't hold the event loop open during shutdown.
  timer.unref();
}

export function stopDeclineWindowSweep(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
