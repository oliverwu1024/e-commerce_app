import Stripe from 'stripe';

type StripeInstance = Stripe.Stripe;

let cached: StripeInstance | null = null;

/**
 * Lazy client — the server shouldn't fail to boot just because Stripe keys
 * aren't configured. The /pay endpoint returns 503 if the provider is asked
 * for but not set up.
 */
export function getStripeClient(): StripeInstance {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  cached = new Stripe(key);
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  }
  return secret;
}

// Stripe Identity events fire on the platform endpoint, not the Connect
// endpoint used for charges. They need their own signing secret because
// each Stripe webhook endpoint has its own whsec_. Configure a second
// endpoint in the Stripe Dashboard (events:
// `identity.verification_session.*`) and put its secret here.
export function getStripeIdentityWebhookSecret(): string {
  const secret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_IDENTITY_WEBHOOK_SECRET is not set');
  }
  return secret;
}
