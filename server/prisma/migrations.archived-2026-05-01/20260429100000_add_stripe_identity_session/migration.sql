-- Track the user's active Stripe Identity verification session id (vs_...).
-- Set when /verify-id/stripe-session creates the session; cleared once the
-- webhook confirms a terminal state. Nullable so legacy users (manual flow)
-- and unverified users have no session.
ALTER TABLE "User" ADD COLUMN "idVerificationSessionId" VARCHAR(200);
