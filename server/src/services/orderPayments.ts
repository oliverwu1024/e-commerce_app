import prisma from '../lib/prisma.js';
import type { PaymentMethod } from '../generated/prisma/client.js';

export type PaidResult =
  | { status: 'completed' }
  | { status: 'already_completed' }
  | { status: 'not_confirmed' }
  | { status: 'not_found' };

/**
 * Move an order CONFIRMED → COMPLETED and its listing ON_HOLD → SOLD in one
 * transaction. Idempotent: a second call on the same order returns
 * 'already_completed' without mutating anything.
 *
 * Called by webhook handlers (Stripe) and synchronous capture handlers
 * (PayPal, Square) after payment confirmation.
 */
export async function markOrderPaid(
  orderId: string,
  paymentMethod: PaymentMethod,
): Promise<PaidResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, listingId: true },
    });

    if (!order) return { status: 'not_found' } as const;
    if (order.status === 'COMPLETED') return { status: 'already_completed' } as const;
    if (order.status !== 'CONFIRMED') return { status: 'not_confirmed' } as const;

    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: 'CONFIRMED' },
      data: { status: 'COMPLETED', paymentMethod },
    });
    if (count === 0) return { status: 'not_confirmed' } as const;

    await tx.listing.updateMany({
      where: { id: order.listingId, status: 'ON_HOLD' },
      data: { status: 'SOLD' },
    });

    return { status: 'completed' } as const;
  });
}
