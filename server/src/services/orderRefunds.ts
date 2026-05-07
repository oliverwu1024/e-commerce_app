import prisma from '../lib/prisma.js';
import { SquareClient, SquareEnvironment } from 'square';
import { getStripeClient, isStripeConfigured } from '../config/stripe.js';
import { findAccount } from './sellerPaymentAccounts.js';
import { createNotification } from './notifications.js';
import { logger } from '../utils/logger.js';

export type RefundOutcome =
  | { ok: true; refundProviderId: string | null; fullyRefunded: boolean }
  | { ok: false; status: number; error: string };

/**
 * Issue a refund of `amountCents` against an order. Dispatches to the
 * correct provider based on the order's paymentMethod, updates the order
 * + writes a Refund audit row in a single transaction, and notifies the buyer.
 *
 * Used by:
 *   - POST /api/orders/:id/refund  (seller-initiated, amount may be partial)
 *   - POST /api/orders/:id/decline (auto full-refund on seller decline within
 *                                   the CARD-flow decline window)
 *
 * Callers handle auth + status-machine checks (PAID/SHIPPED/COMPLETED, role,
 * deadline, etc.) — this helper only owns the financial side.
 */
export async function refundOrder(input: {
  orderId: string;
  issuedById: string;
  reason: string | null;
  amountCents: number;
}): Promise<RefundOutcome> {
  const { orderId, issuedById, reason, amountCents } = input;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      amount: true,
      status: true,
      buyerId: true,
      sellerId: true,
      paymentMethod: true,
      paymentProviderId: true,
      totalRefundedCents: true,
      listing: { select: { id: true, title: true } },
    },
  });
  if (!order) return { ok: false, status: 404, error: 'Order not found' };
  if (!order.paymentMethod) {
    return { ok: false, status: 409, error: 'Order has no payment method on record' };
  }

  const totalCents = Math.round(Number(order.amount) * 100);
  const remainingCents = totalCents - order.totalRefundedCents;
  if (remainingCents <= 0) {
    return { ok: false, status: 409, error: 'Order has already been fully refunded.' };
  }
  if (amountCents <= 0 || amountCents > remainingCents) {
    return {
      ok: false,
      status: 400,
      error: `Refund amount exceeds remaining refundable balance (${remainingCents} cents).`,
    };
  }

  let refundProviderId: string | null = null;

  if (order.paymentMethod === 'STRIPE') {
    if (!isStripeConfigured()) {
      return { ok: false, status: 503, error: 'Stripe is not configured on this server' };
    }
    const sellerAccount = await findAccount(order.sellerId, 'STRIPE');
    if (!sellerAccount?.accountId) {
      return {
        ok: false,
        status: 503,
        error: 'Cannot refund: seller no longer has a connected Stripe account.',
      };
    }
    if (!order.paymentProviderId) {
      return {
        ok: false,
        status: 409,
        error:
          'No Stripe payment_intent on record for this order. Refund must be issued manually from the Stripe dashboard.',
      };
    }
    try {
      // Deterministic key — a network retry of the same refund returns the
      // original Stripe refund instead of double-issuing.
      const idempotencyKey = `refund-${order.id}-${order.totalRefundedCents}-${amountCents}`;
      const refund = await getStripeClient().refunds.create(
        { payment_intent: order.paymentProviderId, amount: amountCents },
        { stripeAccount: sellerAccount.accountId, idempotencyKey },
      );
      refundProviderId = refund.id;
    } catch (err) {
      logger.error('orderRefunds.stripe.failed', { err: String(err) });
      return { ok: false, status: 502, error: 'Stripe refund failed; nothing changed.' };
    }
  } else if (order.paymentMethod === 'SQUARE') {
    const sellerAccount = await findAccount(order.sellerId, 'SQUARE');
    if (!sellerAccount?.accessToken) {
      return {
        ok: false,
        status: 503,
        error: 'Cannot refund: seller no longer has a connected Square account.',
      };
    }
    if (!order.paymentProviderId) {
      return {
        ok: false,
        status: 409,
        error:
          'No Square payment ID on record for this order. Refund must be issued manually from the Square dashboard.',
      };
    }
    try {
      const sellerSquare = new SquareClient({
        token: sellerAccount.accessToken,
        environment:
          process.env.SQUARE_ENV === 'production'
            ? SquareEnvironment.Production
            : SquareEnvironment.Sandbox,
      });
      const idempotencyKey = `refund-${order.id}-${order.totalRefundedCents}-${amountCents}`;
      const resp = await sellerSquare.refunds.refundPayment({
        idempotencyKey,
        paymentId: order.paymentProviderId,
        amountMoney: { amount: BigInt(amountCents), currency: 'AUD' },
      });
      refundProviderId = resp.refund?.id ?? null;
    } catch (err) {
      logger.error('orderRefunds.square.failed', { err: String(err) });
      return { ok: false, status: 502, error: 'Square refund failed; nothing changed.' };
    }
  }
  // CASH / BANK_TRANSFER / PAYPAL: no provider call. Seller is expected to
  // have moved the money offline; we only persist the audit row.

  const fullyRefundedAfter = order.totalRefundedCents + amountCents >= totalCents;
  const channel = order.paymentMethod;

  const writeOutcome = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] },
        // Belt-and-braces against double-refund: the order's running total
        // must still match the snapshot above, otherwise a concurrent refund
        // raced ahead of us.
        totalRefundedCents: order.totalRefundedCents,
      },
      data: {
        status: fullyRefundedAfter ? 'REFUNDED' : undefined,
        totalRefundedCents: { increment: amountCents },
        refundedAt: new Date(),
        refundReason: reason ?? null,
        refundProviderId,
        // A full refund (incl. seller-decline) makes the decline button
        // meaningless — clear the deadline so the UI gates on a single
        // sentinel and the sweep job has nothing left to scan.
        ...(fullyRefundedAfter ? { sellerDeclineDeadline: null } : {}),
      },
    });
    if (updated.count === 0) return { ok: false as const };
    await tx.refund.create({
      data: {
        orderId,
        issuedById,
        amountCents,
        reason: reason ?? null,
        providerId: refundProviderId,
        channel,
      },
    });
    return { ok: true as const };
  });

  if (!writeOutcome.ok) {
    // Provider call already moved money; the order moved out from under us.
    // Don't try to undo the provider refund — log loudly so an admin can
    // reconcile manually.
    logger.error('orderRefunds.provider_refunded_state_changed', {
      orderId,
      refundProviderId,
      amountCents,
    });
    return {
      ok: false,
      status: 500,
      error:
        'Provider refund succeeded but the order state changed concurrently. Contact support to reconcile.',
    };
  }

  const refundDollars = (amountCents / 100).toFixed(2);
  const totalDollars = (totalCents / 100).toFixed(2);
  const notifBody = fullyRefundedAfter
    ? `Your payment of $${refundDollars} for "${order.listing.title}" has been refunded${reason ? `: ${reason}` : '.'}`
    : `A partial refund of $${refundDollars} (of $${totalDollars}) has been issued for "${order.listing.title}"${reason ? `: ${reason}` : '.'}`;
  void createNotification({
    recipientId: order.buyerId,
    type: 'ORDER_REFUNDED',
    title: fullyRefundedAfter ? 'Refund issued' : 'Partial refund issued',
    body: notifBody,
    actorId: order.sellerId,
    orderId,
    listingId: order.listing.id,
  });

  return { ok: true, refundProviderId, fullyRefunded: fullyRefundedAfter };
}
