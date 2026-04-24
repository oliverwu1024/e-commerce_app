import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PaymentMethod } from '../generated/prisma/client.js';
import { createNotification } from './notifications.js';

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
  reported: { amountCents: string; currency: string },
): Promise<PaidResult> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, listingId: true, amount: true },
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

    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: 'CONFIRMED' },
      data: {
        // PAID = money captured, listing off-market, awaiting shipment.
        // The order won't reach COMPLETED until the buyer marks received
        // (or auto-flip after N days; not yet implemented).
        status: 'PAID',
        paymentMethod,
        // Close the payment session so cancel is no longer blocked. Keeps the
        // invariant "post-payment ⇒ paymentSessionState=COMPLETED" for the
        // admin stuck-orders query.
        paymentSessionState: 'COMPLETED',
      },
    });
    if (count === 0) return { status: 'not_confirmed' } as const;

    // Listing flips to SOLD on PAID — item is off-market the moment the
    // seller has the money, regardless of when fulfilment completes.
    await tx.listing.updateMany({
      where: { id: order.listingId, status: 'ON_HOLD' },
      data: { status: 'SOLD' },
    });

    return { status: 'completed' } as const;
  });

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
