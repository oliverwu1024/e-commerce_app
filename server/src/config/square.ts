import { SquareClient, SquareEnvironment } from 'square';

let cached: SquareClient | null = null;

export function getSquareClient(): SquareClient {
  if (cached) return cached;
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('SQUARE_ACCESS_TOKEN is not set');
  }
  cached = new SquareClient({
    token,
    environment:
      process.env.SQUARE_ENV === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
  return cached;
}

export function isSquareConfigured(): boolean {
  return Boolean(
    process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID,
  );
}

export function getSquareLocationId(): string {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error('SQUARE_LOCATION_ID is not set');
  return id;
}

export function getSquareWebhookSignatureKey(): string {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) {
    throw new Error('SQUARE_WEBHOOK_SIGNATURE_KEY is not set');
  }
  return key;
}

export function getSquareWebhookUrl(): string {
  const url = process.env.SQUARE_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      'SQUARE_WEBHOOK_URL is not set — Square signatures are computed over the subscribed URL, so verification will always fail without it.',
    );
  }
  return url;
}

/**
 * Startup check: if the webhook signature key is configured but SQUARE_WEBHOOK_URL
 * isn't, every real event will fail verification. Warn loudly at boot — previously
 * this threw, which took the whole server down for tenants that don't use Square.
 * One provider's misconfiguration shouldn't break auth/listings/cart for everyone.
 */
export function validateSquareWebhookConfig(): void {
  if (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY && !process.env.SQUARE_WEBHOOK_URL) {
    console.warn(
      '[square] SQUARE_WEBHOOK_SIGNATURE_KEY is set but SQUARE_WEBHOOK_URL is not. ' +
        'Square verifies signatures against the URL configured in the Developer Dashboard; ' +
        'set SQUARE_WEBHOOK_URL to the same URL, or unset the signature key to disable the ' +
        'Square webhook entirely. All Square events will 500 until this is fixed.',
    );
  }
}
