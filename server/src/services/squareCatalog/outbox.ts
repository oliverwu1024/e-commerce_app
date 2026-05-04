// Outbox writer + enqueue helpers. Called from the listing CRUD handlers
// inside the same Prisma transaction as the listing change, so we never
// lose a sync intent — even if BullMQ enqueue fails afterwards, the row
// sits in Postgres and the reconciler picks it up.
//
// Flow:
//   Listing tx                ┐
//     INSERT into Listing     │ same transaction
//     INSERT into Outbox      ┘
//   ── outside tx ──
//   Try enqueue to BullMQ
//     if success: mark outbox row ENQUEUED
//     if failure: leave it PENDING — reconciler will catch up
//
// We intentionally enqueue OUTSIDE the transaction. If we enqueued inside
// and the transaction rolled back, BullMQ would have a job pointing at a
// listing that never existed.

import type { Prisma } from '../../generated/prisma/client.js';
import prisma from '../../lib/prisma.js';
import { findAccount } from '../sellerPaymentAccounts.js';
import { getSquareCatalogQueue } from '../../queue/queues.js';
import { logger } from '../../utils/logger.js';
import type { ListingSnapshot } from './mapper.js';

export type OutboxKind =
  | 'LISTING_UPSERT'
  | 'LISTING_DELETE'
  | 'INVENTORY_ADJUST'
  | 'IMAGE_DELETE';

/**
 * Snapshot of the intent at write-time. Persisted on the outbox row so a
 * debugger can replay regardless of subsequent edits. The shape is a
 * discriminated union by `kind`, but stored in JSON so Prisma's type
 * system doesn't enforce it — the worker re-reads as needed and validates
 * before acting.
 */
export type OutboxPayload =
  | {
      kind: 'LISTING_UPSERT';
      listing: ListingSnapshot;
    }
  | {
      kind: 'LISTING_DELETE';
      listing: ListingSnapshot;
    }
  | {
      kind: 'INVENTORY_ADJUST';
      listing: ListingSnapshot;
      inventoryDelta: number;
    }
  | {
      kind: 'IMAGE_DELETE';
      // Square server ids (from ListingImage.squareImageId) that should be
      // batch-deleted from the seller's catalog. Captured at write time
      // because the underlying ListingImage rows are about to be — or
      // already have been — removed.
      squareImageIds: string[];
    };

export type CreateOutboxArgs = {
  tx: Prisma.TransactionClient;
  listingId: string;
  sellerId: string;
  kind: OutboxKind;
  payload: OutboxPayload;
};

/**
 * Insert an outbox row inside an existing transaction. Returns the row id —
 * caller passes that id to enqueueOutbox after the transaction commits.
 *
 * No-ops (returns null) if the seller has not opted in to catalog sync.
 * The decision is made at write time so a flipped-off seller stops
 * generating sync work immediately, without needing to drain a queue.
 */
export async function createOutboxRow(
  args: CreateOutboxArgs,
): Promise<string | null> {
  const seller = await args.tx.user.findUnique({
    where: { id: args.sellerId },
    select: { squareCatalogSyncEnabled: true },
  });
  if (!seller?.squareCatalogSyncEnabled) return null;

  const row = await args.tx.squareSyncOutbox.create({
    data: {
      kind: args.kind,
      listingId: args.listingId,
      sellerId: args.sellerId,
      payload: args.payload as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Enqueue a previously-created outbox row into BullMQ. Call AFTER the
 * Postgres transaction commits — never inside the tx, because a rollback
 * would orphan the BullMQ job.
 *
 * Idempotent: a row already ENQUEUED or PROCESSED is silently skipped.
 * Failure to enqueue (Redis down, etc.) is logged and swallowed — the
 * row stays PENDING and the reconciler will pick it up on its next pass.
 */
export async function enqueueOutbox(outboxId: string): Promise<void> {
  if (!outboxId) return;
  // Re-read because we may be racing the reconciler. Updating with a
  // status guard means double-enqueues don't double-publish.
  const row = await prisma.squareSyncOutbox.findUnique({
    where: { id: outboxId },
    select: {
      id: true,
      status: true,
      kind: true,
      listingId: true,
      sellerId: true,
      payload: true,
    },
  });
  if (!row) return;
  if (row.status !== 'PENDING') return;

  const queue = getSquareCatalogQueue();
  if (!queue) {
    // Redis isn't configured — leave the row PENDING. The seller's UI will
    // show "queued" and the reconciler / queue-back-online cron will pick
    // it up when we restart with REDIS_URL set.
    logger.warn('square.catalog.enqueue.queue_unavailable', { outboxId });
    return;
  }

  // Verify seller has an active Square account before enqueueing. Avoids
  // burning attempts in BullMQ for sellers who toggled sync on without
  // connecting Square first.
  const account = await findAccount(row.sellerId, 'SQUARE');
  if (!account || account.status !== 'ACTIVE' || !account.accessToken) {
    logger.warn('square.catalog.enqueue.no_active_square_account', {
      outboxId,
      sellerId: row.sellerId,
      status: account?.status ?? 'NONE',
    });
    return;
  }

  try {
    const job = await queue.add(
      mapKindToJobName(row.kind),
      buildJobData(row.kind, row.id, row.listingId, row.sellerId, row.payload),
      {
        // Job id ties the BullMQ job to the outbox row. Idempotent enqueue —
        // if BullMQ already has this id, add() returns the existing job.
        jobId: `outbox-${row.id}`,
      },
    );
    await prisma.squareSyncOutbox.update({
      where: { id: row.id },
      data: {
        status: 'ENQUEUED',
        jobId: job.id ?? `outbox-${row.id}`,
        enqueuedAt: new Date(),
      },
    });
  } catch (err) {
    logger.error('square.catalog.enqueue.failed', {
      outboxId,
      err: String(err),
    });
    // Don't throw — the request that triggered this shouldn't 500 just
    // because BullMQ is unreachable. Reconciler picks this up later.
  }
}

function mapKindToJobName(
  kind: OutboxKind,
): 'listing.upsert' | 'listing.delete' | 'inventory.adjust' | 'image.delete' {
  if (kind === 'LISTING_UPSERT') return 'listing.upsert';
  if (kind === 'LISTING_DELETE') return 'listing.delete';
  if (kind === 'INVENTORY_ADJUST') return 'inventory.adjust';
  return 'image.delete';
}

function buildJobData(
  kind: OutboxKind,
  outboxId: string,
  listingId: string,
  sellerId: string,
  payload: unknown,
):
  | { kind: 'listing.upsert'; outboxId: string; listingId: string; sellerId: string }
  | { kind: 'listing.delete'; outboxId: string; listingId: string; sellerId: string }
  | { kind: 'inventory.adjust'; outboxId: string; listingId: string; sellerId: string; quantity: number }
  | { kind: 'image.delete'; outboxId: string; listingId: string; sellerId: string; squareImageIds: string[] } {
  if (kind === 'INVENTORY_ADJUST') {
    const qty =
      payload &&
      typeof payload === 'object' &&
      'inventoryDelta' in payload &&
      typeof (payload as { inventoryDelta?: unknown }).inventoryDelta === 'number'
        ? (payload as { inventoryDelta: number }).inventoryDelta
        : 0;
    return {
      kind: 'inventory.adjust',
      outboxId,
      listingId,
      sellerId,
      quantity: qty,
    };
  }
  if (kind === 'IMAGE_DELETE') {
    const ids =
      payload &&
      typeof payload === 'object' &&
      'squareImageIds' in payload &&
      Array.isArray((payload as { squareImageIds?: unknown }).squareImageIds)
        ? ((payload as { squareImageIds: unknown[] }).squareImageIds.filter(
            (x): x is string => typeof x === 'string' && x.length > 0,
          ) as string[])
        : [];
    return {
      kind: 'image.delete',
      outboxId,
      listingId,
      sellerId,
      squareImageIds: ids,
    };
  }
  return {
    kind: kind === 'LISTING_DELETE' ? 'listing.delete' : 'listing.upsert',
    outboxId,
    listingId,
    sellerId,
  };
}

/**
 * Build the snapshot used in OutboxPayload from the live Listing+images
 * row. Centralised so workers and the reconciler use the same projection.
 */
export type ListingForSnapshot = {
  id: string;
  title: string;
  description: string;
  price: { toString(): string } | string | number;
  category: string;
  brand: string | null;
  condition: 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
  status: 'ACTIVE' | 'HIDDEN' | 'ON_HOLD' | 'SOLD' | 'REMOVED';
  images: { url: string; displayOrder: number }[];
};

export function snapshotListing(
  listing: ListingForSnapshot,
  currency = 'AUD',
): ListingSnapshot {
  const priceStr =
    typeof listing.price === 'string'
      ? listing.price
      : typeof listing.price === 'number'
        ? String(listing.price)
        : listing.price.toString();
  // Prisma returns Decimal as a string-like with up to 2 decimals; convert
  // dollars to cents. Round to nearest cent to dodge floating-point drift
  // (`19.99 * 100 === 1998.9999...` on some inputs).
  const cents = Math.round(Number(priceStr) * 100);
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    priceCents: cents,
    currency,
    condition: listing.condition,
    brand: listing.brand,
    category: listing.category,
    status: listing.status,
    images: [...listing.images]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((i) => ({ url: i.url })),
  };
}
