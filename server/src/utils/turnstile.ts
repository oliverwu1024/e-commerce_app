// Cloudflare Turnstile siteverify.
// Token flow: client widget posts a one-time token in the request body;
// we forward it to Cloudflare along with our secret and the client IP.
// Tokens are single-use and short-lived (~5 min).

import { logger } from './logger.js';

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const TURNSTILE_ENABLED = Boolean(TURNSTILE_SECRET_KEY);

type SiteverifyResponse = {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
};

// Returns true when the token is valid (or when Turnstile is disabled, so
// dev environments without a key can still register). Returns false for
// missing / invalid tokens. Network failures are logged and treated as
// "valid" so a Cloudflare outage doesn't brick our signup funnel — the rate
// limiter still caps abuse in that window.
export async function verifyTurnstile(token: string | undefined, remoteIp: string | undefined): Promise<boolean> {
  if (!TURNSTILE_ENABLED) return true;
  if (!token) return false;

  const form = new URLSearchParams();
  form.append('secret', TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      logger.error('turnstile.siteverify.non_200', { status: res.status });
      return true;
    }
    const data = (await res.json()) as SiteverifyResponse;
    if (!data.success) {
      logger.warn('turnstile.token.rejected', { errorCodes: data['error-codes'] ?? [] });
    }
    return data.success;
  } catch (err) {
    logger.error('turnstile.siteverify.network_error', { err: String(err), failingOpen: true });
    return true;
  }
}
