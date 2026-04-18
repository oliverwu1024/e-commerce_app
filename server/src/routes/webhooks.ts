import { Router, Request, Response } from 'express';
import { WebhooksHelper } from 'square';
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
      const session = event.data.object as { metadata?: Record<string, string | null> | null; client_reference_id?: string | null };
      const orderId = session.metadata?.orderId ?? session.client_reference_id ?? null;
      if (!orderId) {
        // Unrelated session (e.g. a manual test). Ack and move on.
        res.json({ received: true, note: 'no orderId metadata' });
        return;
      }
      const result = await markOrderPaid(orderId, 'STRIPE');
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

  let event: { type?: string; data?: { object?: { payment?: { orderId?: string; status?: string } } } };
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

    const payment = event.data?.object?.payment;
    if (!payment || payment.status !== 'COMPLETED' || !payment.orderId) {
      res.json({ received: true, note: 'payment not in COMPLETED state or missing orderId' });
      return;
    }

    // Look up the Square order to get its reference_id (= our order UUID).
    const squareOrderResp = await getSquareClient().orders.get({ orderId: payment.orderId });
    const ourOrderId = squareOrderResp.order?.referenceId;
    if (!ourOrderId) {
      console.warn('Square payment completed but order has no referenceId:', payment.orderId);
      res.json({ received: true, note: 'no referenceId on Square order' });
      return;
    }

    const result = await markOrderPaid(ourOrderId, 'SQUARE');
    res.json({ received: true, result: result.status });
  } catch (err) {
    console.error('Square webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
