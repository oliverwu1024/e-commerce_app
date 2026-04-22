import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PaymentMethod } from '../generated/prisma/client.js';

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
 * Called by webhook handlers (Stripe, Square) and synchronous capture handlers
 * (PayPal) after payment confirmation.
 */
export async function markOrderPaid(
  orderId: string,
  paymentMethod: PaymentMethod,
  reported: { amountCents: string; currency: string },
): Promise<PaidResult> {
  return prisma.$transaction(async (tx) => {
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

    if (order.status === 'COMPLETED') return { status: 'already_completed' } as const;
    if (order.status !== 'CONFIRMED') return { status: 'not_confirmed' } as const;

    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: 'CONFIRMED' },
      data: {
        status: 'COMPLETED',
        paymentMethod,
        // Close the payment session so cancel is no longer blocked (harmless
        // at this point since the order itself is COMPLETED, but keeps the
        // invariant "status=COMPLETED ⇒ paymentSessionState=COMPLETED" clean
        // for the admin stuck-orders query).
        paymentSessionState: 'COMPLETED',
      },
    });
    if (count === 0) return { status: 'not_confirmed' } as const;

    await tx.listing.updateMany({
      where: { id: order.listingId, status: 'ON_HOLD' },
      data: { status: 'SOLD' },
    });

    return { status: 'completed' } as const;
  });
}
