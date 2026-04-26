-- Seller-connected payment accounts. Replaces the previous centralized model
-- where all sellers shared one platform merchant account per provider. Funds
-- now settle directly to the seller's bank/PayPal, which takes the platform
-- out of the funds flow (and out of money-transmitter licensing scope).
--
-- Tokens are encrypted at rest with AES-256-GCM — see server/src/lib/crypto.ts.
-- Stripe rows have null tokens (Connect uses the Stripe-Account header with
-- our platform secret key, not per-seller tokens). PayPal rows also have null
-- tokens (we use our platform client credentials + payee.merchant_id on each
-- order). Square rows hold the OAuth access_token + refresh_token.

CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'SQUARE', 'PAYPAL');

CREATE TYPE "SellerAccountStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'RESTRICTED',
    'DISCONNECTED'
);

CREATE TABLE "SellerPaymentAccount" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "SellerAccountStatus" NOT NULL DEFAULT 'PENDING',
    "accountId" VARCHAR(200) NOT NULL,
    "accessToken" VARCHAR(5000),
    "refreshToken" VARCHAR(5000),
    "tokenExpiresAt" TIMESTAMP(3),
    "scope" VARCHAR(500),
    "locationId" VARCHAR(100),
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "onboardedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SellerPaymentAccount_pkey" PRIMARY KEY ("id")
);

-- One account row per (user, provider). Re-onboarding updates in place so the
-- original onboardedAt timestamp and any status transition history stay intact.
CREATE UNIQUE INDEX "SellerPaymentAccount_userId_provider_key"
    ON "SellerPaymentAccount"("userId", "provider");

-- Admin queue: "show me all sellers whose Stripe went RESTRICTED this week."
CREATE INDEX "SellerPaymentAccount_provider_status_idx"
    ON "SellerPaymentAccount"("provider", "status");

ALTER TABLE "SellerPaymentAccount"
    ADD CONSTRAINT "SellerPaymentAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
