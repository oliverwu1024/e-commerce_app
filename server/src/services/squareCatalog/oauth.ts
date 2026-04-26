// Square OAuth lifecycle for catalog sync. Wraps the SellerPaymentAccount
// row so callers (workers, webhook handlers, REST handlers) get a fresh
// access token without thinking about expiry, refresh, or DB encryption.
//
// Square access tokens expire 30 days after issuance. The `expires_at` in
// the OAuth response is authoritative; we refresh proactively when the token
// is within `REFRESH_BUFFER_MS` of expiry. A failed refresh marks the
// account DISCONNECTED and notifies the seller — there's no recovery path
// other than re-authorizing.
//
// All calls go through `withCatalogClient(userId, fn)` so:
//   - We always have a fresh token
//   - We always know the seller's location_id (Square Catalog calls don't
//     all need it, but the inventory ones do, and surfacing it consistently
//     keeps callers honest)
//   - Token refresh races are serialized per-seller so two concurrent
//     workers don't both burn refresh tokens (Square invalidates the old
//     refresh on every successful exchange).

import { SquareClient, SquareEnvironment } from 'square';
import {
  findAccount,
  markDisconnected,
  upsertAccount,
  type DecryptedPaymentAccount,
} from '../sellerPaymentAccounts.js';
import { sendTokenExpiringEmail } from './emails.js';
import { logger } from '../../utils/logger.js';

// Refresh when the token is within 5 days of expiry. Square refresh tokens
// are valid for 90 days, so an idle account that hasn't synced in 85+ days
// will hit a hard "re-authorize" wall — that's acceptable, and rare.
const REFRESH_BUFFER_MS = 5 * 24 * 60 * 60 * 1000;

// Square's OAuth refresh endpoint URL. Same env split as the rest of the
// integration: prod hits squareup.com, sandbox hits squareupsandbox.com.
function squareOauthBase(): string {
  return process.env.SQUARE_ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

// Per-seller refresh promise, used to serialize concurrent refreshes for the
// same seller. Without this, two workers that both notice an expiring token
// race to call /oauth2/token; the slower one's request 400s because Square
// invalidated the refresh token after the faster one succeeded.
const refreshInflight = new Map<string, Promise<DecryptedPaymentAccount>>();

export type CatalogSession = {
  client: SquareClient;
  accessToken: string;
  merchantId: string;
  locationId: string;
  account: DecryptedPaymentAccount;
};

export class SquareSyncDisabledError extends Error {
  readonly code: 'NO_ACCOUNT' | 'DISCONNECTED' | 'NOT_CONFIGURED' | 'NO_LOCATION';
  constructor(code: SquareSyncDisabledError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export class SquareTokenRefreshError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number, message: string) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

/**
 * Fetch a usable Square Catalog client for the given seller, refreshing the
 * OAuth token if it's near expiry. The returned client is configured with
 * the seller's access token (not the platform's) so every catalog call is
 * scoped to their merchant.
 */
export async function withCatalogClient<T>(
  userId: string,
  fn: (session: CatalogSession) => Promise<T>,
): Promise<T> {
  const session = await openCatalogSession(userId);
  return fn(session);
}

export async function openCatalogSession(userId: string): Promise<CatalogSession> {
  const account = await getValidAccount(userId);
  if (!account.locationId) {
    throw new SquareSyncDisabledError(
      'NO_LOCATION',
      'Square account has no default location_id. Reconnect to refresh.',
    );
  }
  if (!account.accessToken) {
    // Should be unreachable — getValidAccount enforces this — but TS can't
    // tell.
    throw new SquareSyncDisabledError('DISCONNECTED', 'No access token on account');
  }
  const client = buildClientForToken(account.accessToken);
  return {
    client,
    accessToken: account.accessToken,
    merchantId: account.accountId,
    locationId: account.locationId,
    account,
  };
}

function buildClientForToken(token: string): SquareClient {
  return new SquareClient({
    token,
    environment:
      process.env.SQUARE_ENV === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
}

/**
 * Returns a SellerPaymentAccount with a non-expired access token. Triggers
 * a refresh if the token is within REFRESH_BUFFER_MS of expiry.
 *
 * Throws SquareSyncDisabledError if:
 *   - The seller has no Square account (NO_ACCOUNT)
 *   - The account is DISCONNECTED or has no access token
 *   - The refresh failed (after which the account is marked DISCONNECTED)
 */
async function getValidAccount(userId: string): Promise<DecryptedPaymentAccount> {
  const account = await findAccount(userId, 'SQUARE');
  if (!account) {
    throw new SquareSyncDisabledError('NO_ACCOUNT', 'Seller has no Square account on file');
  }
  if (account.status === 'DISCONNECTED' || !account.accessToken) {
    throw new SquareSyncDisabledError(
      'DISCONNECTED',
      'Square account is disconnected — seller must re-authorize',
    );
  }
  if (!isExpiringSoon(account.tokenExpiresAt)) {
    return account;
  }

  // Coalesce concurrent refresh attempts for the same seller. The first
  // caller does the work, the rest await its result.
  const existing = refreshInflight.get(userId);
  if (existing) return existing;

  const promise = refreshAccount(account)
    .finally(() => refreshInflight.delete(userId));
  refreshInflight.set(userId, promise);
  return promise;
}

function isExpiringSoon(expiresAt: Date | null): boolean {
  if (!expiresAt) return false; // unknown — trust it; we'll find out via 401
  return expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;
}

async function refreshAccount(
  account: DecryptedPaymentAccount,
): Promise<DecryptedPaymentAccount> {
  const appId = process.env.SQUARE_APPLICATION_ID;
  const appSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!appId || !appSecret) {
    throw new SquareSyncDisabledError(
      'NOT_CONFIGURED',
      'SQUARE_APPLICATION_ID / SQUARE_APPLICATION_SECRET not set — cannot refresh',
    );
  }
  if (!account.refreshToken) {
    // Account predates the refresh-token-aware OAuth flow. Mark
    // disconnected so the next sync attempt cleanly fails closed and the
    // seller is prompted to reconnect.
    await markDisconnected(account.userId, 'SQUARE');
    throw new SquareSyncDisabledError(
      'DISCONNECTED',
      'No refresh token stored — seller must re-authorize',
    );
  }

  const start = Date.now();
  const resp = await fetch(`${squareOauthBase()}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    logger.error('square.catalog.oauth.refresh_failed', {
      userId: account.userId,
      httpStatus: resp.status,
      durationMs: Date.now() - start,
      bodyHead: body.slice(0, 200),
    });
    // 4xx from Square's refresh endpoint = the refresh token is invalid
    // (revoked / already-used / expired). Mark disconnected so we stop
    // trying. 5xx is transient — surface as a refresh error so the worker
    // retries the job, not the disconnection.
    if (resp.status >= 400 && resp.status < 500) {
      await markDisconnected(account.userId, 'SQUARE');
      // Best-effort notify; failure is non-fatal.
      void sendTokenExpiringEmail(account.userId).catch((err) =>
        logger.warn('square.catalog.token_expiring_email_failed', {
          userId: account.userId,
          err: String(err),
        }),
      );
    }
    throw new SquareTokenRefreshError(
      resp.status,
      `Square OAuth refresh failed (${resp.status})`,
    );
  }

  const json = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: string;
    merchant_id?: string;
  };
  if (!json.access_token || !json.refresh_token) {
    throw new SquareTokenRefreshError(
      resp.status,
      'Square OAuth refresh returned incomplete payload',
    );
  }

  const updated = await upsertAccount({
    userId: account.userId,
    provider: 'SQUARE',
    accountId: json.merchant_id ?? account.accountId,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenExpiresAt: json.expires_at ? new Date(json.expires_at) : null,
    // status / chargesEnabled / payoutsEnabled remain whatever they were —
    // refresh doesn't change those.
  });

  logger.info('square.catalog.oauth.refresh_success', {
    userId: account.userId,
    durationMs: Date.now() - start,
    expiresAt: updated.tokenExpiresAt?.toISOString() ?? null,
  });
  return updated;
}
