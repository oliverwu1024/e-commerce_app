// Platform fee + return-URL config for the connected-accounts flow.
//
// Default is 0% — ElectroMarket runs as a free marketplace; the platform
// stays out of the money flow entirely. Sellers receive 100% of the
// buyer's payment direct to their Stripe / Square account.
//
// The infrastructure is kept (rather than ripped out) so the operator can
// flip on a fee later by setting PLATFORM_FEE_BPS on the env. When > 0,
// Stripe charges include `application_fee_amount`; Square has no native
// platform-fee primitive so it would still settle 100% to the seller
// regardless.
export function getPlatformFeeBasisPoints(): number {
  const raw = process.env.PLATFORM_FEE_BPS;
  if (!raw) return 0;
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
