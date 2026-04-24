// Platform fee + return-URL config for the connected-accounts flow.
//
// We express the fee as a percentage (basis points) rather than a flat
// amount so it scales with order size. Default 5% if unset, which is a
// typical marketplace cut for secondary-market electronics. Override via
// env for experiments.
//
// NOT a fee collected separately — it's the slice of each payment the
// platform keeps via Stripe's `application_fee_amount`. Square has no
// native platform fee; amount is informational there until we build
// out-of-band invoicing.
export function getPlatformFeeBasisPoints(): number {
  const raw = process.env.PLATFORM_FEE_BPS;
  if (!raw) return 500; // 5.00%
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 2000) {
    throw new Error(
      `PLATFORM_FEE_BPS must be a number between 0 and 2000 (0–20%), got "${raw}"`,
    );
  }
  return Math.round(n);
}

export function platformFeeForCents(amountCents: number): number {
  const bps = getPlatformFeeBasisPoints();
  // Floor rather than round so the platform never accidentally takes more
  // than the configured fee due to rounding, which could short the seller
  // by a cent and create a "math doesn't add up" complaint.
  return Math.floor((amountCents * bps) / 10000);
}

// Return URL Stripe / Square redirect the seller back to after they
// finish provider-side onboarding. Always lands on /account/payments so
// the user sees the updated status card.
export function getSellerOnboardingReturnUrl(): string {
  const base = process.env.CLIENT_URL?.split(',')[0]?.trim() || 'http://localhost:3000';
  return `${base}/account/payments`;
}

// Refresh URL is where the provider sends the seller back if the onboarding
// link expires before they complete it (Stripe Account Links are short-lived).
// Landing on /account/payments lets them just click Connect again.
export function getSellerOnboardingRefreshUrl(): string {
  return getSellerOnboardingReturnUrl();
}
