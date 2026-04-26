-- Buyer disputes: one per order, opened by the buyer when a paid order
-- has gone wrong (item not received / not as described / damaged). Notifies
-- seller + admin; admin owns resolution. Refund (if any) is issued via the
-- existing /refund endpoint — Dispute.status just records the outcome.

CREATE TYPE "DisputeStatus" AS ENUM (
    'OPEN',
    'RESOLVED_REFUND',
    'RESOLVED_NO_REFUND',
    'WITHDRAWN'
);

CREATE TYPE "DisputeReason" AS ENUM (
    'NOT_RECEIVED',
    'NOT_AS_DESCRIBED',
    'DAMAGED',
    'OTHER'
);

-- Notification type bumps to support the dispute + refund flows.
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_REFUNDED';
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_DISPUTED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RESOLVED';

CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reason" "DisputeReason" NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" VARCHAR(2000),
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "resolvedById" TEXT,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- One dispute per order. Reopening = withdrawn → admin re-opens via direct DB
-- edit OR buyer reaches out via order messages — keep it tight in v1.
CREATE UNIQUE INDEX "Dispute_orderId_key" ON "Dispute"("orderId");

-- Backs the admin queue: oldest-first OPEN disputes.
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");
CREATE INDEX "Dispute_sellerId_idx" ON "Dispute"("sellerId");

ALTER TABLE "Dispute"
    ADD CONSTRAINT "Dispute_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispute"
    ADD CONSTRAINT "Dispute_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispute"
    ADD CONSTRAINT "Dispute_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispute"
    ADD CONSTRAINT "Dispute_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
