// Server-side feature flags. Toggled via env vars at deploy time.
//
// idVerificationEnabled — gates the whole government-ID flow. When false:
//   - PERSONAL sellers can post listings without `idVerification === APPROVED`
//   - GET /api/users/profile reports the flag so the client hides the step
//   - POST /api/users/verify-id and /verify-id/stripe-session both 503
//   - Admin queue + Stripe Identity webhook handler are left intact for an
//     eventual re-enable; nothing here deletes data.
//
// Flip on by setting `ID_VERIFICATION_ENABLED=true` in Railway/.env.
// Default off — sole-trader / pre-ABN deployments don't need to touch
// Stripe Identity at all.

export const FEATURES = {
  idVerificationEnabled: process.env.ID_VERIFICATION_ENABLED === 'true',
};
