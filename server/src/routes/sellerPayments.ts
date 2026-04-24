import { Router, Request, Response } from 'express';
import { randomBytes, createHmac } from 'node:crypto';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { getStripeClient, isStripeConfigured } from '../config/stripe.js';
import {
  getSellerOnboardingRefreshUrl,
  getSellerOnboardingReturnUrl,
} from '../config/platformConnect.js';
import {
  canAcceptPayments,
  findAccount,
  listAccounts,
  markDisconnected,
  toPublic,
  upsertAccount,
} from '../services/sellerPaymentAccounts.js';

const router = Router();

// Onboarding is cheap but provider calls aren't free. Cap to 20 launches
// per 15 min per IP — covers legitimate retries without letting a botnet
// burn through our Stripe / Square API allotment.
const onboardingLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many onboarding attempts, please try again shortly' },
});

// ---------------------------------------------------------------------------
// GET /api/seller/payments — list my connected accounts (summary, no tokens)
// Used by the /account/payments page and by the order-detail view to decide
// which provider buttons to show.
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req: Request, res: Response) => {
  const accounts = await listAccounts(req.userId!);
  res.json({
    accounts: accounts.map(toPublic),
    canAcceptOnline: accounts.some(canAcceptPayments),
  });
});

// ===========================================================================
// STRIPE CONNECT (Standard)
// ===========================================================================
// We use Connect Standard — seller is the merchant of record, Stripe issues
// them the 1099, funds settle to their bank. We never touch the money. The
// platform secret key + `Stripe-Account` header auth each call on their
// behalf.

// POST /api/seller/payments/stripe/onboard
// Idempotent: reuses an existing `acct_...` if one is already on file. On
// the provider end, calling accounts.create twice would make two separate
// Stripe accounts, which is confusing for the seller and impossible to
// clean up from our side.
router.post(
  '/stripe/onboard',
  authenticate,
  onboardingLimiter,
  async (req: Request, res: Response) => {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Stripe is not configured on this server' });
      return;
    }
    try {
      const userId = req.userId!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, sellerType: true, businessName: true },
      });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const existing = await findAccount(userId, 'STRIPE');
      const stripe = getStripeClient();

      let accountId: string;
      if (existing) {
        accountId = existing.accountId;
      } else {
        // business_type hint helps Stripe pre-fill the KYC UI. Not load-bearing
        // — seller can correct on the Stripe-hosted form.
        const created = await stripe.accounts.create({
          type: 'standard',
          email: user.email,
          business_type: user.sellerType === 'BUSINESS' ? 'company' : 'individual',
          ...(user.businessName
            ? { company: { name: user.businessName } }
            : {}),
          metadata: { platformUserId: userId },
        });
        accountId = created.id;
        await upsertAccount({
          userId,
          provider: 'STRIPE',
          accountId,
          status: 'PENDING',
        });
      }

      // Account Links are short-lived (~5 min) and one-shot. Mint a fresh
      // one each click so expiry isn't a UX trap.
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: getSellerOnboardingRefreshUrl(),
        return_url: getSellerOnboardingReturnUrl(),
        type: 'account_onboarding',
      });

      res.json({ url: link.url, accountId });
    } catch (err) {
      console.error('[seller-payments] stripe onboard failed:', err);
      res.status(502).json({ error: 'Failed to start Stripe onboarding' });
    }
  },
);

// POST /api/seller/payments/stripe/sync
// Re-fetch the account from Stripe and update chargesEnabled / payoutsEnabled
// / status. Called by the client on /account/payments mount and after the
// seller returns from Stripe onboarding.
// Also happens via webhook (`account.updated`), but the explicit pull avoids
// waiting on webhook delivery for the immediate UX.
router.post(
  '/stripe/sync',
  authenticate,
  onboardingLimiter,
  async (req: Request, res: Response) => {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Stripe is not configured on this server' });
      return;
    }
    const existing = await findAccount(req.userId!, 'STRIPE');
    if (!existing) {
      res.status(404).json({ error: 'No Stripe account on file' });
      return;
    }
    try {
      const account = await getStripeClient().accounts.retrieve(existing.accountId);
      // Stripe's own fields are the source of truth:
      //   charges_enabled  — can create PaymentIntents on this account
      //   payouts_enabled  — seller's bank is verified + payouts scheduled
      //   details_submitted — KYC form complete
      const charges = Boolean(account.charges_enabled);
      const payouts = Boolean(account.payouts_enabled);
      // disabled_reason is set when Stripe has paused the account.
      const restricted = Boolean(account.requirements?.disabled_reason);
      const status = restricted
        ? 'RESTRICTED'
        : charges
          ? 'ACTIVE'
          : 'PENDING';

      const updated = await upsertAccount({
        userId: req.userId!,
        provider: 'STRIPE',
        accountId: existing.accountId,
        status,
        chargesEnabled: charges,
        payoutsEnabled: payouts,
        onboardedAt: existing.onboardedAt ?? (charges ? new Date() : null),
      });
      res.json({ account: toPublic(updated) });
    } catch (err) {
      console.error('[seller-payments] stripe sync failed:', err);
      res.status(502).json({ error: 'Failed to sync Stripe account status' });
    }
  },
);

// POST /api/seller/payments/stripe/disconnect
// Marks the account DISCONNECTED on our side. We DON'T delete on Stripe's
// side — only the seller can do that from their own Stripe dashboard, and
// keeping the account around means they can re-enable without re-KYC.
router.post(
  '/stripe/disconnect',
  authenticate,
  onboardingLimiter,
  async (req: Request, res: Response) => {
    await markDisconnected(req.userId!, 'STRIPE');
    res.json({ ok: true });
  },
);

// ===========================================================================
// SQUARE — OAuth
// ===========================================================================
// Square authorization is an OAuth 2.0 flow:
//  1. GET /square/authorize redirects the seller to Square's consent page
//  2. Seller approves; Square redirects back to /square/callback with a code
//  3. We exchange the code for (access_token, refresh_token, merchant_id,
//     expires_at), encrypt, and persist.
//  4. Locations are fetched with the seller's access token and we store the
//     first (default) location_id.
//
// Prerequisite env: SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET. These
// come from the Developer Dashboard → OAuth. Different from the legacy
// SQUARE_ACCESS_TOKEN which was a personal token for the platform.

function squareOauthBase(): string {
  return process.env.SQUARE_ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

const SQUARE_OAUTH_SCOPES = [
  'MERCHANT_PROFILE_READ',
  'PAYMENTS_READ',
  'PAYMENTS_WRITE',
  'ORDERS_READ',
  'ORDERS_WRITE',
  'ITEMS_READ',
  'ITEMS_WRITE',
].join('+');

// Signed state: we put the userId + a random nonce in the OAuth state
// param, HMAC'd with SQUARE_OAUTH_STATE_SECRET so an attacker can't forge
// a callback that links their Square account to someone else's user row.
function signSquareState(userId: string): string {
  const secret = process.env.SQUARE_OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error(
      'SQUARE_OAUTH_STATE_SECRET is not set. Generate with `openssl rand -hex 32`.',
    );
  }
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}.${nonce}.${Date.now()}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verifySquareState(state: string): { userId: string } | null {
  try {
    const secret = process.env.SQUARE_OAUTH_STATE_SECRET;
    if (!secret) return null;
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 4) return null;
    const [userId, nonce, tsStr, sig] = parts;
    const expected = createHmac('sha256', secret)
      .update(`${userId}.${nonce}.${tsStr}`)
      .digest('hex');
    if (expected !== sig) return null;
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return null;
    // 10-minute state lifetime — long enough for the Square approval page,
    // short enough that a leaked state isn't useful later.
    if (Date.now() - ts > 10 * 60 * 1000) return null;
    return { userId };
  } catch {
    return null;
  }
}

// GET /api/seller/payments/square/authorize
// Redirects to Square's authorization page. Not JSON — this is a browser
// navigation endpoint.
router.get(
  '/square/authorize',
  authenticate,
  onboardingLimiter,
  async (req: Request, res: Response) => {
    const appId = process.env.SQUARE_APPLICATION_ID;
    if (!appId) {
      res.status(503).json({
        error:
          'Square OAuth not configured. Set SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET.',
      });
      return;
    }
    let state: string;
    try {
      state = signSquareState(req.userId!);
    } catch (err) {
      console.error('[seller-payments] square state sign failed:', err);
      res.status(503).json({ error: 'Square OAuth state signing not configured' });
      return;
    }
    const url = new URL(`${squareOauthBase()}/oauth2/authorize`);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('scope', SQUARE_OAUTH_SCOPES.replace(/\+/g, ' '));
    url.searchParams.set('session', 'false');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  },
);

// GET /api/seller/payments/square/callback
// Square redirects the seller here after they approve. We exchange `code`
// for tokens, fetch their default location, persist, then bounce the
// browser back to /account/payments.
router.get('/square/callback', async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;
  const returnTo = getSellerOnboardingReturnUrl();

  if (error || !code || !state) {
    res.redirect(`${returnTo}?square=denied`);
    return;
  }

  const verified = verifySquareState(state);
  if (!verified) {
    res.redirect(`${returnTo}?square=invalid_state`);
    return;
  }

  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!appId || !appSecret) {
    res.redirect(`${returnTo}?square=not_configured`);
    return;
  }

  try {
    const tokenResp = await fetch(`${squareOauthBase()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResp.ok) {
      console.error('[seller-payments] square token exchange failed:', tokenResp.status);
      res.redirect(`${returnTo}?square=exchange_failed`);
      return;
    }
    const token = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: string;
      merchant_id?: string;
    };
    if (!token.access_token || !token.refresh_token || !token.merchant_id) {
      res.redirect(`${returnTo}?square=incomplete_token`);
      return;
    }

    // Fetch the seller's default location — Square Orders API requires one.
    // We pick the first active location; seller can change it later.
    const locResp = await fetch(`${squareOauthBase()}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Square-Version': '2024-11-20',
      },
    });
    let locationId: string | null = null;
    if (locResp.ok) {
      const locJson = (await locResp.json()) as {
        locations?: { id?: string; status?: string }[];
      };
      locationId =
        locJson.locations?.find((l) => l.status === 'ACTIVE')?.id ??
        locJson.locations?.[0]?.id ??
        null;
    }

    await upsertAccount({
      userId: verified.userId,
      provider: 'SQUARE',
      accountId: token.merchant_id,
      status: 'ACTIVE',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: token.expires_at ? new Date(token.expires_at) : null,
      scope: SQUARE_OAUTH_SCOPES.replace(/\+/g, ' '),
      locationId,
      chargesEnabled: Boolean(locationId),
      payoutsEnabled: Boolean(locationId),
      onboardedAt: new Date(),
    });
    res.redirect(`${returnTo}?square=connected`);
  } catch (err) {
    console.error('[seller-payments] square callback failed:', err);
    res.redirect(`${returnTo}?square=error`);
  }
});

router.post(
  '/square/disconnect',
  authenticate,
  onboardingLimiter,
  async (req: Request, res: Response) => {
    const existing = await findAccount(req.userId!, 'SQUARE');
    if (existing?.accessToken) {
      // Square's /revoke endpoint invalidates the token on their side so a
      // leaked copy can't be used later. Best-effort — we mark disconnected
      // locally even if the revoke call fails.
      try {
        const appId = process.env.SQUARE_APPLICATION_ID;
        const appSecret = process.env.SQUARE_APPLICATION_SECRET;
        if (appId && appSecret) {
          await fetch(`${squareOauthBase()}/oauth2/revoke`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Client ${appSecret}`,
            },
            body: JSON.stringify({
              access_token: existing.accessToken,
              client_id: appId,
            }),
          });
        }
      } catch (err) {
        console.error('[seller-payments] square revoke failed:', err);
      }
    }
    await markDisconnected(req.userId!, 'SQUARE');
    res.json({ ok: true });
  },
);

export default router;
