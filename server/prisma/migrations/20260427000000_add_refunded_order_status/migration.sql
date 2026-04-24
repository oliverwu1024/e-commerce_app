-- Adds REFUNDED to OrderStatus and refund metadata fields on Order.
-- Refund flow: seller can post-payment refund a buyer (item returned,
-- dispute outcome, etc.). Routes through the seller's connected payment
-- account so the buyer's original card is credited; for cash/bank the
-- seller has already settled out-of-band so we only flip status.

ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

-- Captured at PAID time; required to issue provider refunds later.
-- Stripe payment_intent id / Square payment id. Null for cash/bank.
ALTER TABLE "Order" ADD COLUMN "paymentProviderId" VARCHAR(200);

ALTER TABLE "Order" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "refundReason" VARCHAR(500);
-- Provider's refund identifier (Stripe re_..., Square refund_id) for audit.
-- Null for cash / bank transfer refunds where no provider call was made.
ALTER TABLE "Order" ADD COLUMN "refundProviderId" VARCHAR(200);
