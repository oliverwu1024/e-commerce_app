-- Square Catalog sync infrastructure.
--   * User: per-seller toggle + flip-time stamp
--   * SquareCatalogLink: 1:1 listing↔Square object mapping with version & state
--   * SquareSyncOutbox: durable change-capture, drives BullMQ
--   * SquareSyncEvent: append-only audit log of every attempt
--   * SquareCatalogWebhookEvent: replay-dedupe for inbound webhooks
--   * SquareFeaturedItem: cached snapshot of demo merchant's featured rail
--
-- Migration is additive — no destructive changes to existing data.

CREATE TYPE "SquareCatalogLinkStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'ERROR');
CREATE TYPE "SquareSyncOutboxKind" AS ENUM ('LISTING_UPSERT', 'LISTING_DELETE', 'INVENTORY_ADJUST');
CREATE TYPE "SquareSyncOutboxStatus" AS ENUM ('PENDING', 'ENQUEUED', 'PROCESSED', 'FAILED');
CREATE TYPE "SquareSyncEventOutcome" AS ENUM ('STARTED', 'SUCCESS', 'FAILURE', 'CONFLICT', 'SKIPPED');

-- Per-seller toggle. Default false so existing sellers don't suddenly start
-- writing to their Square catalogs without explicit opt-in.
ALTER TABLE "User"
    ADD COLUMN "squareCatalogSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "squareCatalogSyncEnabledAt" TIMESTAMP(3);

-- 1:1 mapping listing↔Square Catalog object. Created on first successful
-- sync. version is Square's optimistic-concurrency token.
CREATE TABLE "SquareCatalogLink" (
    "id" TEXT PRIMARY KEY,
    "status" "SquareCatalogLinkStatus" NOT NULL DEFAULT 'PENDING',
    "squareMerchantId" VARCHAR(64) NOT NULL,
    "squareObjectId" VARCHAR(64),
    "squareVariationId" VARCHAR(64),
    "version" BIGINT,
    "lastSyncedHash" VARCHAR(64),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" VARCHAR(2000),
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "listingId" TEXT NOT NULL UNIQUE,
    CONSTRAINT "SquareCatalogLink_listingId_fkey"
        FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SquareCatalogLink_squareMerchantId_status_idx"
    ON "SquareCatalogLink"("squareMerchantId", "status");
CREATE INDEX "SquareCatalogLink_status_lastErrorAt_idx"
    ON "SquareCatalogLink"("status", "lastErrorAt");

-- Outbox pattern: durable record of every sync intent. Worker reads from
-- here even after BullMQ has the job, so a payload that's stale in Redis
-- is still re-derived from the latest Listing state.
CREATE TABLE "SquareSyncOutbox" (
    "id" TEXT PRIMARY KEY,
    "kind" "SquareSyncOutboxKind" NOT NULL,
    "status" "SquareSyncOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "jobId" VARCHAR(64),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(2000),
    "lastAttemptAt" TIMESTAMP(3),
    "enqueuedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listingId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    CONSTRAINT "SquareSyncOutbox_listingId_fkey"
        FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SquareSyncOutbox_sellerId_fkey"
        FOREIGN KEY ("sellerId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SquareSyncOutbox_status_createdAt_idx"
    ON "SquareSyncOutbox"("status", "createdAt");
CREATE INDEX "SquareSyncOutbox_sellerId_status_createdAt_idx"
    ON "SquareSyncOutbox"("sellerId", "status", "createdAt");
CREATE INDEX "SquareSyncOutbox_listingId_idx"
    ON "SquareSyncOutbox"("listingId");

-- Audit log: append-only history of every sync attempt + outcome.
CREATE TABLE "SquareSyncEvent" (
    "id" TEXT PRIMARY KEY,
    "outcome" "SquareSyncEventOutcome" NOT NULL,
    "kind" "SquareSyncOutboxKind" NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "durationMs" INTEGER,
    "message" VARCHAR(2000),
    "errorCode" VARCHAR(64),
    "outboxId" VARCHAR(64),
    "squareObjectId" VARCHAR(64),
    "squareEventId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listingId" TEXT,
    "sellerId" TEXT NOT NULL,
    CONSTRAINT "SquareSyncEvent_listingId_fkey"
        FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SquareSyncEvent_sellerId_fkey"
        FOREIGN KEY ("sellerId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SquareSyncEvent_sellerId_createdAt_idx"
    ON "SquareSyncEvent"("sellerId", "createdAt");
CREATE INDEX "SquareSyncEvent_outcome_createdAt_idx"
    ON "SquareSyncEvent"("outcome", "createdAt");
CREATE INDEX "SquareSyncEvent_listingId_createdAt_idx"
    ON "SquareSyncEvent"("listingId", "createdAt");

-- Inbound webhook replay-dedupe. Separate from ProcessedWebhookEvent
-- (payments) because the catalog event volume + retention horizon differ.
CREATE TABLE "SquareCatalogWebhookEvent" (
    "id" TEXT PRIMARY KEY,
    "eventId" VARCHAR(64) NOT NULL UNIQUE,
    "type" VARCHAR(64) NOT NULL,
    "merchantId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SquareCatalogWebhookEvent_merchantId_createdAt_idx"
    ON "SquareCatalogWebhookEvent"("merchantId", "createdAt");
CREATE INDEX "SquareCatalogWebhookEvent_createdAt_idx"
    ON "SquareCatalogWebhookEvent"("createdAt");

-- Cached snapshot of the demo merchant's featured items. Refreshed by a
-- cron / admin action — read by the public homepage rail. Decouples the
-- rail from Square API uptime.
CREATE TABLE "SquareFeaturedItem" (
    "id" TEXT PRIMARY KEY,
    "squareObjectId" VARCHAR(64) NOT NULL UNIQUE,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "imageUrl" VARCHAR(500),
    "priceCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "SquareFeaturedItem_rank_idx" ON "SquareFeaturedItem"("rank");
CREATE INDEX "SquareFeaturedItem_lastSeenAt_idx" ON "SquareFeaturedItem"("lastSeenAt");
