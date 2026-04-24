import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
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
// Connected-accounts model: in the Stripe Dashboard → Developers → Webhooks,
// the endpoint to subscribe here is the **Connect** endpoint (not the
// platform one). STRIPE_WEBHOOK_SECRET is that Connect endpoint's signing
// secret. Connect events include `event.account` identifying the connected
// account — we don't need to read it since we route by `metadata.orderId`,
// but it's there for auditing.
//
// Local dev: `stripe listen --forward-connect --forward-to
// localhost:5000/api/webhooks/stripe` (note `--forward-connect`). Copy the
// printed whsec_... into STRIPE_WEBHOOK_SECRET.
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
        payment_intent?: string | null;
      };
      // event.account is populated for Connect events (i.e., every session
      // under the new flow). Logged for audit only — metadata.orderId is
      // the authoritative link back to our record.
      const stripeAccountId = (event as unknown as { account?: string }).account ?? null;
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
          stripeAccountId,
        });
        res.json({ received: true, note: 'missing amount/currency' });
        return;
      }

      const outcome = await processWithDedupe('STRIPE', event.id, orderId, () =>
        markOrderPaid(orderId, 'STRIPE', {
          amountCents: String(session.amount_total),
          currency: session.currency!,
          providerId: session.payment_intent ?? null,
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

    if (event.type === 'account.updated') {
      // Stripe pinged us because a connected account's state changed —
      // KYC newly satisfied, requirements added, payouts paused, etc.
      // Sync our SellerPaymentAccount row so buyers stop seeing a Pay
      // button against a restricted seller. event.account holds the
      // Stripe account ID; the event payload is the Account itself.
      const account = event.data.object as {
        id?: string;
        charges_enabled?: boolean;
        payouts_enabled?: boolean;
        requirements?: { disabled_reason?: string | null } | null;
      };
      const accountId = account.id ?? (event as unknown as { account?: string }).account ?? null;
      if (!accountId) {
        res.json({ received: true, note: 'account.updated missing account id' });
        return;
      }
      const charges = Boolean(account.charges_enabled);
      const payouts = Boolean(account.payouts_enabled);
      const restricted = Boolean(account.requirements?.disabled_reason);
      const status = restricted ? 'RESTRICTED' : charges ? 'ACTIVE' : 'PENDING';
      // Use updateMany so we silently no-op if we don't have a matching
      // row (e.g., Stripe forwarding events for an account this platform
      // doesn't own — unlikely but cheap to defend against).
      const { count } = await prisma.sellerPaymentAccount.updateMany({
        where: { provider: 'STRIPE', accountId },
        data: {
          status,
          chargesEnabled: charges,
          payoutsEnabled: payouts,
          lastSyncedAt: new Date(),
        },
      });
      res.json({ received: true, updated: count });
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
// LEGACY: Square webhooks tied to the platform access token. Connected-
// account Square (per-seller OAuth) doesn't register webhooks automatically
// per merchant — new orders confirm payment via the polling endpoint
// POST /api/orders/:id/pay/square/confirm instead. This handler is left in
// place to resolve any in-flight legacy orders; safe to remove once all
// pre-migration orders have finalized.
//
// Local dev (legacy only): expose port 5000 via ngrok and set the webhook
// URL in the Square Developer Dashboard → Webhooks → Add subscription.
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

// ---------------------------------------------------------------------------
// POST /api/webhooks/email — inbound email webhook
//
// Receives parsed email events from whatever inbound provider you've wired to
// support@electromarket-app.com (Resend Inbound, Mailgun Inbound Parse,
// Cloudflare Email Routing → Worker → here, etc.). Auth is a shared secret
// in `X-Email-Secret` (env: EMAIL_WEBHOOK_SECRET) — providers send it as a
// custom header configured in their dashboard.
//
// Expected JSON body:
//   {
//     from:     "alice@gmail.com",
//     to:       "support@electromarket-app.com",          // informational
//     subject:  "Re: My order [#abc12345]",
//     text:     "...plain-text body, ideally with quoted history stripped...",
//     html?:    "...optional HTML body...",
//     fromName?:"Alice Example"                            // if provider parses it
//   }
//
// Threading: we extract `[#<submission-id-prefix>]` from the subject. If
// matched, the email is appended as an INBOUND ContactReply on that
// submission (and status flips back to NEW so the admin sees there's a
// new message). If no tag, treat as a fresh inbound — create a new
// ContactSubmission with status=NEW.
// ---------------------------------------------------------------------------
router.post('/email', async (req: Request, res: Response) => {
  // Verify the shared secret. Providers vary in capability — most allow
  // adding custom headers. If yours can't, prefix the path with the secret
  // and update this check accordingly. Use timingSafeEqual to avoid leaking
  // length-discriminating timing on a brute-force attempt.
  const expected = process.env.EMAIL_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[email webhook] EMAIL_WEBHOOK_SECRET not configured');
    res.status(503).json({ error: 'Inbound email not configured' });
    return;
  }
  const provided = req.headers['x-email-secret'];
  if (typeof provided !== 'string') {
    res.status(401).json({ error: 'Missing X-Email-Secret' });
    return;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid secret' });
    return;
  }

  // We're mounted under express.raw — req.body is a Buffer. Parse manually.
  let payload: {
    from?: string;
    fromName?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  };
  try {
    payload = JSON.parse((req.body as Buffer).toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const fromEmail = (payload.from || '').trim().toLowerCase();
  const subject = (payload.subject || '').trim();
  const body = (payload.text || payload.html || '').trim();

  if (!fromEmail || !subject || !body) {
    res.status(400).json({ error: 'Missing from / subject / body' });
    return;
  }

  // Subject thread tag: [#<12-char-prefix>]. Inserted by sendAdminContactReply
  // on every outbound, preserved by mail clients in the reply. Match
  // case-insensitively because some clients lowercase header values.
  const tagMatch = subject.match(/\[#([a-z0-9]+)\]/i);
  const idPrefix = tagMatch ? tagMatch[1].toLowerCase() : null;

  try {
    if (idPrefix) {
      // Find a submission whose UUID starts with the tag. Prisma's `startsWith`
      // is case-insensitive when paired with `mode: 'insensitive'`. UUID alpha
      // chars are lowercase already so this should always match exactly, but
      // we use insensitive as a safety net.
      const submission = await prisma.contactSubmission.findFirst({
        where: { id: { startsWith: idPrefix, mode: 'insensitive' } },
        select: { id: true, status: true, fromEmail: true },
      });
      if (submission) {
        await prisma.$transaction([
          prisma.contactReply.create({
            data: {
              submissionId: submission.id,
              body,
              direction: 'INBOUND',
              // adminId stays null — this is the customer.
            },
          }),
          // Customer just replied → reopen the thread for admin attention.
          prisma.contactSubmission.update({
            where: { id: submission.id },
            data: { status: 'NEW' },
          }),
        ]);
        res.json({ received: true, threadedTo: submission.id });
        return;
      }
      // Tag present but no match (admin closed + DB cleared, replied to a
      // forwarded chain, etc.). Fall through to new-submission creation so
      // the message isn't lost.
      console.warn(`[email webhook] thread tag #${idPrefix} not found — creating new submission`);
    }

    // No matching thread → cold email to support. Create a new submission.
    // fromName is optional from providers; default to local-part for the
    // "Hi <name>," salutation in the admin UI.
    const fromName = (payload.fromName || fromEmail.split('@')[0] || 'Unknown').slice(0, 100);
    // Strip our own subject tag from the persisted subject so it doesn't
    // visibly carry forward in the admin UI.
    const cleanedSubject = subject.replace(/\s*\[#[a-z0-9]+\]\s*/gi, ' ').trim().slice(0, 150);
    const fresh = await prisma.contactSubmission.create({
      data: {
        fromName,
        fromEmail,
        subject: cleanedSubject || '(no subject)',
        message: body.slice(0, 3000),
      },
    });
    res.json({ received: true, createdSubmission: fresh.id });
  } catch (err) {
    console.error('[email webhook] handler failed:', err);
    res.status(500).json({ error: 'Inbound handler failed' });
  }
});

export default router;
