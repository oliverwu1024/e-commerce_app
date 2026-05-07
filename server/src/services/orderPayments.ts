import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PaymentMethod } from '../generated/prisma/client.js';
import { createNotification } from './notifications.js';
import { createOutboxRow, enqueueOutbox, snapshotListing } from './squareCatalog/index.js';

export type PaidResult =
  | { status: 'completed' }
  | { status: 'already_completed' }
  | { status: 'not_confirmed' }
  | { status: 'not_found' }
  | {
      status: 'amount_mismatch';
      expected: { amountCents: string; currency: string };
      reported: { amountCents: string; currency: string };
    };

export const EXPECTED_CURRENCY = 'AUD';

// Seller-decline window for CARD-flow orders. Once payment captures, the
// seller has this long to /decline (auto-refund). After the window, the
// /decline path 409s and the order proceeds to ship-or-dispute. Mirror in
// minutes for tighter sandbox testing if needed.
const CARD_SELLER_DECLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Move an order CONFIRMED → COMPLETED and its listing ON_HOLD → SOLD in one
 * transaction. Idempotent: a second call on the same order returns
 * 'already_completed' without mutating anything.
 *
 * The `reported` argument is the amount and currency the payment provider
 * claims was charged. We compare it to the stored order amount *before*
 * flipping state — signature verification catches forged webhooks, but does
 * NOT catch a misconfigured Stripe product, a wrong-currency Square location,
 * or a tampered client-side amount. A mismatch returns 'amount_mismatch'
 * without mutating the order; callers should ack (200) and alert-log.
 *
 * Called by webhook handlers (Stripe) and synchronous confirm handlers
 * (Square) after payment confirmation.
 */
export async function markOrderPaid(
  orderId: string,
  paymentMethod: PaymentMethod,
  reported: { amountCents: string; currency: string; providerId?: string | null },
): Promise<PaidResult> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, listingId: true, amount: true, paymentFlow: true },
    });

    if (!order) return { status: 'not_found' } as const;

    const expectedCents = new Prisma.Decimal(order.amount).mul(100).toFixed(0);
    const reportedCurrency = reported.currency.toUpperCase();
    if (
      reportedCurrency !== EXPECTED_CURRENCY ||
      reported.amountCents !== expectedCents
    ) {
      return {
        status: 'amount_mismatch' as const,
        expected: { amountCents: expectedCents, currency: EXPECTED_CURRENCY },
        reported: { amountCents: reported.amountCents, currency: reportedCurrency },
      };
    }

    // Treat any post-payment status as already-paid (idempotent)
    if (order.status === 'PAID' || order.status === 'SHIPPED' || order.status === 'COMPLETED') {
      return { status: 'already_completed' } as const;
    }
    if (order.status !== 'CONFIRMED') return { status: 'not_confirmed' } as const;

    // Open the seller's decline window only on CARD orders — OFFLINE flow
    // never offers /decline (the seller chose to confirm offline; the
    // /cancel path covers refusal there). Computed here so it gets persisted
    // atomically with the PAID flip; the sweep job clears it on expiry.
    const declineDeadline =
      order.paymentFlow === 'CARD'
        ? new Date(Date.now() + CARD_SELLER_DECLINE_WINDOW_MS)
        : null;

    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: 'CONFIRMED' },
      data: {
        // PAID = money captured, listing off-market, awaiting shipment.
        // The order won't reach COMPLETED until the buyer marks received
        // (or auto-flip after N days; not yet implemented).
        status: 'PAID',
        paymentMethod,
        // Provider's payment identifier — used later to issue refunds
        // through the same provider account that took the charge.
        ...(reported.providerId ? { paymentProviderId: reported.providerId } : {}),
        // Close the payment session so cancel is no longer blocked. Keeps the
        // invariant "post-payment ⇒ paymentSessionState=COMPLETED" for the
        // admin stuck-orders query.
        paymentSessionState: 'COMPLETED',
        ...(declineDeadline ? { sellerDeclineDeadline: declineDeadline } : {}),
      },
    });
    if (count === 0) return { status: 'not_confirmed' } as const;

    // Listing flips to SOLD on PAID — item is off-market the moment the
    // seller has the money, regardless of when fulfilment completes.
    const flipped = await tx.listing.updateMany({
      where: { id: order.listingId, status: 'ON_HOLD' },
      data: { status: 'SOLD' },
    });

    // Push inventory=0 to Square if the seller has catalog sync enabled
    // — keeps their POS shelf in sync. Outbox-only inside the tx so the
    // sync is durable even if BullMQ is down at the moment.
    let outboxId: string | null = null;
    if (flipped.count > 0) {
      const fullListing = await tx.listing.findUnique({
        where: { id: order.listingId },
        include: { images: { orderBy: { displayOrder: 'asc' } } },
      });
      if (fullListing) {
        outboxId = await createOutboxRow({
          tx,
          listingId: fullListing.id,
          sellerId: fullListing.sellerId,
          kind: 'INVENTORY_ADJUST',
          payload: {
            kind: 'INVENTORY_ADJUST',
            listing: snapshotListing(fullListing),
            inventoryDelta: 0,
          },
        });
      }
    }

    return { status: 'completed' as const, outboxId };
  });

  // Push the inventory=0 sync to Square once the tx has committed. Failure
  // here is non-fatal — the row stays PENDING and the reconciler picks it up.
  if (result.status === 'completed' && result.outboxId) {
    void enqueueOutbox(result.outboxId);
  }

  // Notify both sides on a successful capture. Happens outside the tx so a
  // notification failure can't roll back the payment. Only ORDER_PAID/
  // ORDER_COMPLETED since amount_mismatch / already_completed don't warrant
  // notifications (the user either sees an error or nothing changed).
  if (result.status === 'completed') {
    void (async () => {
      const full = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          buyerId: true,
          sellerId: true,
          listing: { select: { id: true, title: true } },
          buyer: { select: { username: true } },
          seller: { select: { username: true } },
        },
      });
      if (!full) return;
      void createNotification({
        recipientId: full.sellerId,
        type: 'ORDER_PAID',
        title: 'Payment received',
        body: `${full.buyer.username} paid for "${full.listing.title}" via ${paymentMethod.toLowerCase().replace('_', ' ')}.`,
        actorId: full.buyerId,
        orderId,
        listingId: full.listing.id,
      });
      void createNotification({
        recipientId: full.buyerId,
        type: 'ORDER_COMPLETED',
        title: 'Payment confirmed',
        body: `Your payment for "${full.listing.title}" was received.`,
        actorId: full.sellerId,
        orderId,
        listingId: full.listing.id,
      });
    })();
  }

  return result;
}

/**
 * Batch sibling of markOrderPaid: fans out a single provider session that
 * covered N orders (all from the same buyer + seller + paymentFlow) to mark
 * each PAID atomically. Used by Stripe webhook + Square confirm endpoints when
 * the buyer paid a multi-listing seller-group in one redirect.
 *
 * Cross-checks `reported.amountCents` against the SUM of order amounts (the
 * provider's session.amount_total / Square order totalMoney). Per-order
 * amount validation isn't meaningful here — Stripe charges the buyer one
 * total, not N separate amounts.
 *
 * Idempotent: a re-run for orders already PAID returns 'already_completed'
 * if every order is already past CONFIRMED. Mixed states return
 * 'not_confirmed' (some orders advanced under us — caller should investigate).
 */
export async function markOrdersPaidBatch(
  orderIds: string[],
  paymentMethod: PaymentMethod,
  reported: { amountCents: string; currency: string; providerId?: string | null },
): Promise<PaidResult> {
  if (orderIds.length === 0) return { status: 'not_found' };

  const result = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        status: true,
        listingId: true,
        amount: true,
        paymentFlow: true,
      },
    });

    if (orders.length !== orderIds.length) {
      return { status: 'not_found' } as const;
    }

    // Sum of expected per-order amounts must equal what the provider charged
    // — defends against a misconfigured Checkout Session, a tampered metadata
    // payload, or a forgery whose amounts don't reconcile.
    const expectedTotalCents = orders
      .reduce(
        (sum, o) => sum.plus(new Prisma.Decimal(o.amount).mul(100)),
        new Prisma.Decimal(0),
      )
      .toFixed(0);
    const reportedCurrency = reported.currency.toUpperCase();
    if (
      reportedCurrency !== EXPECTED_CURRENCY ||
      reported.amountCents !== expectedTotalCents
    ) {
      return {
        status: 'amount_mismatch' as const,
        expected: { amountCents: expectedTotalCents, currency: EXPECTED_CURRENCY },
        reported: {
          amountCents: reported.amountCents,
          currency: reportedCurrency,
        },
      };
    }

    // Idempotency: if every order is already past CONFIRMED, treat as a re-
    // delivery of the same webhook (the most common cause). If a SUBSET is
    // post-payment and the rest are still CONFIRMED, return not_confirmed —
    // the order's natural state machine is broken and a human should look.
    const postPaymentStatuses: typeof orders[number]['status'][] = [
      'PAID',
      'SHIPPED',
      'COMPLETED',
    ];
    const allPostPayment = orders.every((o) => postPaymentStatuses.includes(o.status));
    if (allPostPayment) return { status: 'already_completed' } as const;
    if (!orders.every((o) => o.status === 'CONFIRMED')) {
      return { status: 'not_confirmed' } as const;
    }

    // Everyone in the batch flips together — N rows guarded on status=CONFIRMED
    // so a concurrent /cancel or /pay can't strand half the orders PAID.
    const declineDeadline =
      orders[0].paymentFlow === 'CARD'
        ? new Date(Date.now() + CARD_SELLER_DECLINE_WINDOW_MS)
        : null;
    const { count } = await tx.order.updateMany({
      where: { id: { in: orderIds }, status: 'CONFIRMED' },
      data: {
        status: 'PAID',
        paymentMethod,
        ...(reported.providerId ? { paymentProviderId: reported.providerId } : {}),
        paymentSessionState: 'COMPLETED',
        ...(declineDeadline ? { sellerDeclineDeadline: declineDeadline } : {}),
      },
    });
    if (count !== orderIds.length) return { status: 'not_confirmed' } as const;

    // Fan listings ON_HOLD → SOLD. updateMany conditional on ON_HOLD so a
    // listing that's already moved (rare race) stays where it is.
    const listingIds = orders.map((o) => o.listingId);
    await tx.listing.updateMany({
      where: { id: { in: listingIds }, status: 'ON_HOLD' },
      data: { status: 'SOLD' },
    });

    // Outbox per listing for Square Catalog inventory=0. Outbox-only inside
    // the tx so syncs are durable across a Redis outage.
    const outboxIds: string[] = [];
    for (const order of orders) {
      const fullListing = await tx.listing.findUnique({
        where: { id: order.listingId },
        include: { images: { orderBy: { displayOrder: 'asc' } } },
      });
      if (!fullListing) continue;
      const outboxId = await createOutboxRow({
        tx,
        listingId: fullListing.id,
        sellerId: fullListing.sellerId,
        kind: 'INVENTORY_ADJUST',
        payload: {
          kind: 'INVENTORY_ADJUST',
          listing: snapshotListing(fullListing),
          inventoryDelta: 0,
        },
      });
      if (outboxId) outboxIds.push(outboxId);
    }

    return { status: 'completed' as const, outboxIds };
  });

  if (result.status === 'completed' && result.outboxIds.length > 0) {
    for (const outboxId of result.outboxIds) void enqueueOutbox(outboxId);
  }

  if (result.status === 'completed') {
    // Notifications fire outside the tx so a notification failure can't
    // roll back the payment. One notification per order per side.
    void (async () => {
      const full = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          listing: { select: { id: true, title: true } },
          buyer: { select: { username: true } },
          seller: { select: { username: true } },
        },
      });
      for (const order of full) {
        void createNotification({
          recipientId: order.sellerId,
          type: 'ORDER_PAID',
          title: 'Payment received',
          body: `${order.buyer.username} paid for "${order.listing.title}" via ${paymentMethod.toLowerCase().replace('_', ' ')}.`,
          actorId: order.buyerId,
          orderId: order.id,
          listingId: order.listing.id,
        });
        void createNotification({
          recipientId: order.buyerId,
          type: 'ORDER_COMPLETED',
          title: 'Payment confirmed',
          body: `Your payment for "${order.listing.title}" was received.`,
          actorId: order.sellerId,
          orderId: order.id,
          listingId: order.listing.id,
        });
      }
    })();
  }

  return result;
}
