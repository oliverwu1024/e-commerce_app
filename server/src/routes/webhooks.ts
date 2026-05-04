import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  getStripeClient,
  getStripeWebhookSecret,
  getStripeIdentityWebhookSecret,
} from '../config/stripe.js';
import { markOrderPaid } from '../services/orderPayments.js';
import { findAccount } from '../services/sellerPaymentAccounts.js';
import { handleSquareCatalogWebhook } from '../services/squareCatalog/inbound.js';
import { logger } from '../utils/logger.js';

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
    logger.error('webhook.stripe.bad_signature', { err: String(err) });
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
      // event.account is the connected account that took the payment. We
      // must verify it matches the seller stored against this order — otherwise
      // any merchant connected to our Stripe platform could forge a same-amount
      // session pointing at someone else's orderId and mark that order PAID
      // (the funds settle to the attacker, not the victim seller).
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
        logger.error('webhook.stripe.session_missing_amount_currency', {
          sessionId: session.id,
          orderId,
          stripeAccountId,
        });
        res.json({ received: true, note: 'missing amount/currency' });
        return;
      }

      // Cross-check event.account against the order's seller. Reject before
      // dedupe so a forgery attempt doesn't burn the eventId.
      const orderForAuth = await prisma.order.findUnique({
        where: { id: orderId },
        select: { sellerId: true },
      });
      if (!orderForAuth) {
        logger.error('webhook.stripe.unknown_order', { orderId, stripeAccountId, eventId: event.id });
        res.json({ received: true, note: 'unknown order' });
        return;
      }
      const sellerAccount = await findAccount(orderForAuth.sellerId, 'STRIPE');
      if (!sellerAccount || !sellerAccount.accountId) {
        logger.error('webhook.stripe.seller_no_stripe_account', {
          orderId,
          sellerId: orderForAuth.sellerId,
          stripeAccountId,
          eventId: event.id,
        });
        res.json({ received: true, note: 'seller has no stripe account' });
        return;
      }
      if (stripeAccountId !== sellerAccount.accountId) {
        logger.error('webhook.stripe.account_mismatch', {
          orderId,
          sellerId: orderForAuth.sellerId,
          eventAccount: stripeAccountId,
          expectedAccount: sellerAccount.accountId,
          eventId: event.id,
        });
        res.status(400).json({ error: 'event account does not match order seller' });
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
        logger.error('webhook.stripe.payment_amount_mismatch', {
          orderId,
          sessionId: session.id,
          eventId: event.id,
          expected: result.expected,
          reported: result.reported,
          markingPaid: false,
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
    logger.error('webhook.stripe.handler.failed', { err: String(err) });
    // Return 500 so Stripe retries on transient failures (DB blips etc.).
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/stripe/identity
// Stripe Identity events fire on the platform-level webhook endpoint, not
// the Connect endpoint above. They use a SEPARATE signing secret per the
// Stripe Dashboard's per-endpoint whsec_. Subscribe this endpoint to
// `identity.verification_session.*` events.
//
// Local dev: `stripe listen --forward-to localhost:5000/api/webhooks/stripe/identity`
// (no `--forward-connect` — Identity is platform, not Connect). Copy the
// printed whsec_... into STRIPE_IDENTITY_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------
router.post('/stripe/identity', async (req: Request, res: Response) => {
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
      getStripeIdentityWebhookSecret(),
    );
  } catch (err) {
    logger.error('webhook.stripe_identity.bad_signature', { err: String(err) });
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  try {
    // All identity events carry the VerificationSession as data.object.
    // metadata.userId was set when /verify-id/stripe-session created the
    // session, and is the authoritative link back to our user row.
    const session = event.data.object as {
      id?: string;
      status?: string;
      metadata?: Record<string, string | null> | null;
      last_error?: { code?: string | null; reason?: string | null } | null;
    };
    const userId = session.metadata?.userId ?? null;
    if (!userId) {
      // A session we didn't create (manual test, leftover, mis-configured
      // dashboard endpoint). Ack and ignore.
      res.json({ received: true, note: 'no userId metadata' });
      return;
    }

    // Conditional updates so we don't fight an admin who already approved/
    // rejected manually, or stomp on a different user's session via a
    // mis-configured webhook.
    if (event.type === 'identity.verification_session.verified') {
      const { count } = await prisma.user.updateMany({
        where: { id: userId, idVerificationSessionId: session.id ?? null },
        data: {
          idVerification: 'APPROVED',
          idRejectionReason: null,
          idVerificationSessionId: null,
        },
      });
      res.json({ received: true, updated: count });
      return;
    }

    if (event.type === 'identity.verification_session.requires_input') {
      // The buyer's submission failed (blurry photo, ID mismatch,
      // unsupported document). Stripe's last_error.reason is human-
      // readable and safe to surface.
      const reason =
        session.last_error?.reason ?? 'Stripe could not verify your ID. Please try again.';
      const { count } = await prisma.user.updateMany({
        where: { id: userId, idVerificationSessionId: session.id ?? null },
        data: {
          idVerification: 'REJECTED',
          idRejectionReason: reason.slice(0, 500),
          // Clear the session so the next attempt creates a fresh one
          // rather than reusing the rejected session.
          idVerificationSessionId: null,
        },
      });
      res.json({ received: true, updated: count });
      return;
    }

    if (event.type === 'identity.verification_session.canceled') {
      // User dismissed the flow before submitting. Roll back to
      // NOT_SUBMITTED so they can retry without an admin nudge.
      const { count } = await prisma.user.updateMany({
        where: { id: userId, idVerificationSessionId: session.id ?? null },
        data: {
          idVerification: 'NOT_SUBMITTED',
          idVerificationSessionId: null,
        },
      });
      res.json({ received: true, updated: count });
      return;
    }

    // processing / created / etc. acked but not processed.
    res.json({ received: true, ignored: event.type });
  } catch (err) {
    logger.error('webhook.stripe_identity.handler.failed', { err: String(err) });
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// (Legacy /square payment webhook removed 2026-05-01. Pre-cutover orders
// have all settled; new orders use per-seller connected accounts and confirm
// via the polling endpoint POST /api/orders/:id/pay/square/confirm. Square
// catalog/inventory webhooks live at /square/catalog further below — they
// have a separate signing key and serve a different purpose.)

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
    logger.error('webhook.email.secret_not_configured');
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
  const subject = ((payload.subject || '').trim()) || '(no subject)';
  // Body falls back to subject (so an email like "subject: my order is broken
  // / body: <empty>" still gives the admin something to read), and finally
  // to a placeholder. Only the From address is mandatory — everything else
  // is the customer's prerogative.
  const body =
    (payload.text || payload.html || '').trim() ||
    payload.subject?.trim() ||
    '(no body — sender did not include a message)';

  if (!fromEmail) {
    logger.error('webhook.email.missing_from_address', {
      payloadKeys: Object.keys(payload),
    });
    res.status(400).json({
      error: 'Inbound email is missing a From address — cannot route.',
    });
    return;
  }

  // Subject thread tag: [#<8-char-prefix>]. Inserted by sendAdminContactReply
  // on every outbound, preserved by mail clients in the reply. Allow hyphens
  // in the regex for backwards-compat with old 12-char tags (which crossed
  // the first UUID hyphen — `[#bc078490-b77]`); we strip them before matching.
  const tagMatch = subject.match(/\[#([a-z0-9-]+)\]/i);
  // Drop hyphens, take the first 8 hex chars — that's how new tags look
  // and that's also what `startsWith` on a UUID matches cleanly (UUIDs
  // start with 8 hex chars before the first hyphen).
  const idPrefix = tagMatch
    ? tagMatch[1].toLowerCase().replace(/-/g, '').slice(0, 8)
    : null;

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
      logger.warn('webhook.email.thread_tag_not_found', { idPrefix, fallback: 'creating new submission' });
    }

    // No matching thread → cold email to support. Create a new submission.
    // fromName is optional from providers; default to local-part for the
    // "Hi <name>," salutation in the admin UI.
    const fromName = (payload.fromName || fromEmail.split('@')[0] || 'Unknown').slice(0, 100);
    // Strip our own subject tag from the persisted subject so it doesn't
    // visibly carry forward in the admin UI. Allow hyphens for back-compat
    // with old 12-char tags that included the first UUID hyphen.
    const cleanedSubject = subject.replace(/\s*\[#[a-z0-9-]+\]\s*/gi, ' ').trim().slice(0, 150);
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
    logger.error('webhook.email.handler.failed', { err: String(err) });
    res.status(500).json({ error: 'Inbound handler failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/square/catalog
// Square Catalog + Inventory webhooks: catalog.version.updated and
// inventory.count.updated. Subscribed in the Square Dashboard against the
// signature key SQUARE_CATALOG_WEBHOOK_SIGNATURE_KEY (separate from the
// payments webhook so they can be rotated independently). The notification
// URL in the dashboard must equal SQUARE_CATALOG_WEBHOOK_URL byte-for-byte
// (Square hashes the body + URL together).
//
// Local dev: ngrok port 5000, set SQUARE_CATALOG_WEBHOOK_URL to the ngrok
// HTTPS URL + this path, copy the signature key from the dashboard into
// SQUARE_CATALOG_WEBHOOK_SIGNATURE_KEY, then trigger an event by editing
// any item in your Square sandbox catalog.
// ---------------------------------------------------------------------------
router.post('/square/catalog', async (req: Request, res: Response) => {
  await handleSquareCatalogWebhook(req, res);
});

export default router;
