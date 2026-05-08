import prisma from '../lib/prisma.js';
import { createNotification } from './notifications.js';
import { logger } from '../utils/logger.js';

// SHIPPED orders auto-flip to COMPLETED 14 days after shippedAt. Real
// marketplaces use this window as the final deal closure — if the buyer
// hasn't disputed or marked received, the deal is considered complete so
// the seller's totalSales reflects it and they can receive reviews.
//
// Safety: the `updateMany` uses a conditional WHERE on status+shippedAt so
// multi-instance deploys can't double-flip an order, and a concurrent
// buyer-initiated mark-received (CONFIRMED → COMPLETED via a different
// transition) wins the race cleanly.
const AUTO_COMPLETE_AFTER_DAYS = 14;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 100;

let timer: NodeJS.Timeout | undefined;

export async function sweepShippedOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - AUTO_COMPLETE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.order.findMany({
    where: { status: 'SHIPPED', shippedAt: { lt: cutoff } },
    take: BATCH_SIZE,
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      fulfillmentMethod: true,
      listing: { select: { id: true, title: true } },
    },
  });

  if (candidates.length === 0) return 0;

  let flipped = 0;
  for (const order of candidates) {
    const { count } = await prisma.order.updateMany({
      where: { id: order.id, status: 'SHIPPED', shippedAt: { lt: cutoff } },
      data: { status: 'COMPLETED', deliveredAt: new Date() },
    });
    if (count === 1) {
      flipped++;
      const isPickup = order.fulfillmentMethod === 'PICKUP';
      void createNotification({
        recipientId: order.buyerId,
        type: 'ORDER_COMPLETED',
        title: 'Order auto-completed',
        body: isPickup
          ? `Your order for "${order.listing.title}" has been automatically marked as complete 14 days after the pickup was confirmed. Leave a review if you're happy with the purchase.`
          : `Your order for "${order.listing.title}" has been automatically marked as complete after 14 days in transit. Leave a review if you're happy with the purchase.`,
        actorId: null,
        orderId: order.id,
        listingId: order.listing.id,
      });
    }
  }

  logger.info('orderSweep.complete', { flipped, scanned: candidates.length });
  return flipped;
}

export function startOrderSweep(): void {
  if (timer) return; // idempotent — called from index.ts
  // Run once on boot so container restarts don't delay flips by up to an hour.
  sweepShippedOrders().catch((err) => logger.error('orderSweep.boot_failed', { err: String(err) }));
  timer = setInterval(() => {
    sweepShippedOrders().catch((err) =>
      logger.error('orderSweep.tick_failed', { err: String(err) }),
    );
  }, SWEEP_INTERVAL_MS);
  // Don't hold the event loop open during shutdown.
  timer.unref();
}

export function stopOrderSweep(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
