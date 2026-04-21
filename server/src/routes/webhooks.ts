import { Router, Request, Response } from 'express';
import { WebhooksHelper } from 'square';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  getStripeClient,
  getStripeWebhookSecret,
} from '../config/stripe.js';
import {
  getSquareClient,
  getSquareWebhookSignatureKey,
  getSquareWebhookUrl,
} from '../config/square.js';
import { markOrderPaid } from '../services/orderPayments.js';

const router = Router();

// Replay-dedupe: insert `(provider, eventId)` before processing. If the insert
// hits the unique constraint, we've already handled this event — ack and skip.
// If processing throws, delete the dedupe row so the provider's retry can
// reprocess. Terminal statuses from markOrderPaid (including amount_mismatch)
// keep the row so we don't repeatedly alert-log on retries.
async function processWithDedupe<T>(
  provider: 'STRIPE' | 'SQUARE',
  eventId: string,
  orderId: string | null,
  process: () => Promise<T>,
): Promise<{ duplicate: true } | { duplicate: false; result: T }> {
  try {
    await prisma.processedWebhookEvent.create({
      data: { provider, eventId, orderId },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return { duplicate: true };
    }
    throw err;
  }

  try {
    const result = await process();
    return { duplicate: false, result };
  } catch (err) {
    await prisma.processedWebhookEvent
      .delete({
        where: { provider_eventId: { provider, eventId } },
      })
      .catch(() => {
        /* best-effort undo; surface the original error either way */
      });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/stripe
// Mounted with express.raw — req.body is a Buffer so the signature verifier
// can see the exact bytes Stripe signed.
//
// Local dev: run `stripe listen --forward-to localhost:5000/api/webhooks/stripe`
// and copy the printed whsec_... into STRIPE_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      req.body as Buffer,
      sig,
      getStripeWebhookSecret(),
    );
  } catch (err) {
    console.error('Stripe signature verification failed:', err);
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        id?: string;
        metadata?: Record<string, string | null> | null;
        client_reference_id?: string | null;
        amount_total?: number | null;
        currency?: string | null;
      };
      const orderId = session.metadata?.orderId ?? session.client_reference_id ?? null;
      if (!orderId) {
        // Unrelated session (e.g. a manual test). Ack and move on.
        res.json({ received: true, note: 'no orderId metadata' });
        return;
      }
      if (session.amount_total == null || !session.currency) {
        // Shouldn't happen for a successful checkout, but don't mark paid if
        // we can't validate the amount.
        console.error('[stripe webhook] session missing amount/currency', {
          sessionId: session.id,
          orderId,
        });
        res.json({ received: true, note: 'missing amount/currency' });
        return;
      }

      const outcome = await processWithDedupe('STRIPE', event.id, orderId, () =>
        markOrderPaid(orderId, 'STRIPE', {
          amountCents: String(session.amount_total),
          currency: session.currency!,
        }),
      );

      if (outcome.duplicate) {
        res.json({ received: true, duplicate: true });
        return;
      }

      const result = outcome.result;
      if (result.status === 'amount_mismatch') {
        console.error('[stripe webhook] payment amount mismatch — NOT marking paid', {
          orderId,
          sessionId: session.id,
          eventId: event.id,
          expected: result.expected,
          reported: result.reported,
        });
      }
      res.json({ received: true, result: result.status });
      return;
    }

    // Other event types acked but not processed.
    res.json({ received: true, ignored: event.type });
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    // Return 500 so Stripe retries on transient failures (DB blips etc.).
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/square
// Square sends payment.updated events; we extract reference_id from the
// underlying order (set when the payment link was created) to map back to
// our order UUID.
//
// Local dev: expose port 5000 via ngrok or similar and set the webhook URL in
// the Square Developer Dashboard → Webhooks → Add subscription. Copy the
// signature key into SQUARE_WEBHOOK_SIGNATURE_KEY.
// ---------------------------------------------------------------------------
router.post('/square', async (req: Request, res: Response) => {
  const signatureHeader = req.headers['x-square-hmacsha256-signature'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    res.status(400).json({ error: 'Missing Square signature header' });
    return;
  }

  // Square expects a string body for verification; req.body is Buffer from express.raw.
  const bodyString = (req.body as Buffer).toString('utf8');
  let notificationUrl: string;
  try {
    notificationUrl = getSquareWebhookUrl();
  } catch (err) {
    console.error('Square webhook called but SQUARE_WEBHOOK_URL is not configured:', err);
    res.status(500).json({ error: 'Square webhook URL not configured' });
    return;
  }

  let isValid: boolean;
  try {
    isValid = await WebhooksHelper.verifySignature({
      requestBody: bodyString,
      signatureHeader,
      signatureKey: getSquareWebhookSignatureKey(),
      notificationUrl,
    });
  } catch (err) {
    console.error('Square signature verification threw:', err);
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }

  if (!isValid) {
    // Most common cause: SQUARE_WEBHOOK_URL mismatch with the URL configured in
    // the Square Dashboard. Log it so debugging doesn't require reading code.
    console.warn(
      `Square webhook signature invalid. Verified against notificationUrl=${notificationUrl}. ` +
        'Ensure SQUARE_WEBHOOK_URL matches the subscription URL in the Square Dashboard exactly.',
    );
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  // Square webhook payloads use snake_case per their documented format, but
  // the existing parser assumed camelCase. Extract with fallback so we don't
  // silently miss real events in either convention.
  type SquareWebhookPayment = {
    id?: string;
    status?: string;
    order_id?: string;
    orderId?: string;
    amount_money?: { amount?: number; currency?: string };
    amountMoney?: { amount?: number | string; currency?: string };
  };
  let event: {
    type?: string;
    event_id?: string;
    eventId?: string;
    data?: { object?: { payment?: SquareWebhookPayment } };
  };
  try {
    event = JSON.parse(bodyString);
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  try {
    if (event.type !== 'payment.updated') {
      res.json({ received: true, ignored: event.type });
      return;
    }

    const squareEventId = event.event_id ?? event.eventId;
    if (!squareEventId) {
      console.error('[square webhook] event missing event_id');
      res.status(400).json({ error: 'Missing event_id' });
      return;
    }

    const payment = event.data?.object?.payment;
    const squarePaymentOrderId = payment?.order_id ?? payment?.orderId;
    if (!payment || payment.status !== 'COMPLETED' || !squarePaymentOrderId) {
      res.json({ received: true, note: 'payment not in COMPLETED state or missing orderId' });
      return;
    }

    const amountMoney = payment.amount_money ?? payment.amountMoney;
    if (amountMoney?.amount == null || !amountMoney?.currency) {
      console.error('[square webhook] payment missing amount/currency', {
        paymentId: payment.id,
      });
      res.json({ received: true, note: 'missing amount/currency' });
      return;
    }

    // Look up the Square order to get its reference_id (= our order UUID).
    const squareOrderResp = await getSquareClient().orders.get({ orderId: squarePaymentOrderId });
    const ourOrderId = squareOrderResp.order?.referenceId;
    if (!ourOrderId) {
      console.warn('Square payment completed but order has no referenceId:', squarePaymentOrderId);
      res.json({ received: true, note: 'no referenceId on Square order' });
      return;
    }

    const outcome = await processWithDedupe('SQUARE', squareEventId, ourOrderId, () =>
      markOrderPaid(ourOrderId, 'SQUARE', {
        amountCents: String(amountMoney.amount),
        currency: amountMoney.currency!,
      }),
    );

    if (outcome.duplicate) {
      res.json({ received: true, duplicate: true });
      return;
    }

    const result = outcome.result;
    if (result.status === 'amount_mismatch') {
      console.error('[square webhook] payment amount mismatch — NOT marking paid', {
        orderId: ourOrderId,
        squarePaymentId: payment.id,
        eventId: squareEventId,
        expected: result.expected,
        reported: result.reported,
      });
    }
    res.json({ received: true, result: result.status });
  } catch (err) {
    console.error('Square webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
