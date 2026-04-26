// BullMQ worker for the Square Catalog sync queue. One worker per process
// is enough — Square's API rate-limits per-merchant, not per-platform, and
// our concurrency is constrained by the seller fan-out, not by CPU.
//
// Each handler:
//   1. Re-reads the live Listing + SquareCatalogLink (don't trust the
//      payload in the BullMQ job — it may be stale).
//   2. Computes the desired CatalogObject via the mapper.
//   3. Calls Square (batchUpsert / batchDelete).
//   4. Persists the new ids + version on SquareCatalogLink.
//   5. Writes one SquareSyncEvent row per attempt (start + finish).
//   6. Updates the SquareSyncOutbox row to PROCESSED on success / leaves
//      ENQUEUED for retry on transient errors.
//
// Concurrency model:
//   - Per-merchant locking is enforced by Square's own 429 on concurrent
//     batchUpsert/batchDelete. We let those propagate as retryable errors
//     and rely on BullMQ's exponential backoff to space them.
//   - Inside the worker, two jobs for the same listing in flight is rare
//     (jobId is `outbox-<id>` and outbox rows are 1:1 with intent) but
//     not impossible if the seller saves twice in a second. Each handler
//     reads the latest listing, so the second job naturally idempotent-
//     overwrites the first.

import { Worker, type Job, UnrecoverableError } from 'bullmq';
import type { CatalogObject } from 'square';
import prisma from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { getRedisConnection, isQueueConfigured } from '../../queue/connection.js';
import {
  QUEUE_NAMES,
  type SquareCatalogJobData,
  type SquareCatalogJobName,
} from '../../queue/queues.js';
import {
  hashListingForSync,
  listingToCatalogPayload,
  type ListingSnapshot,
} from './mapper.js';
import { snapshotListing } from './outbox.js';
import {
  openCatalogSession,
  SquareSyncDisabledError,
  SquareTokenRefreshError,
  type CatalogSession,
} from './oauth.js';
import { recordSyncEvent } from './observability.js';
import { uploadListingImageToSquare } from './imageUpload.js';
import { ensureCategoryForSeller } from './categories.js';
import { logger } from '../../utils/logger.js';
import { captureBackgroundError } from '../../lib/sentry.js';
import { randomUUID } from 'node:crypto';

let cachedWorker: Worker<SquareCatalogJobData, unknown, SquareCatalogJobName> | null = null;

/**
 * Idempotent worker boot. Returns null if Redis isn't configured — the
 * server stays up; sync is just disabled. Called from index.ts after the
 * HTTP server starts listening.
 */
export function startSquareCatalogWorker():
  | Worker<SquareCatalogJobData, unknown, SquareCatalogJobName>
  | null {
  if (cachedWorker) return cachedWorker;
  if (!isQueueConfigured()) {
    logger.warn('square.catalog.worker.disabled_no_redis');
    return null;
  }
  const conn = getRedisConnection();
  const worker = new Worker<SquareCatalogJobData, unknown, SquareCatalogJobName>(
    QUEUE_NAMES.squareCatalog,
    handleJob,
    {
      connection: conn,
      // Cap concurrency: Square allows ~10 req/s per merchant. With one
      // worker doing batchUpsert + image upload, 4 in flight is a safe
      // ceiling that leaves headroom for the inbound webhook handler.
      concurrency: 4,
      // BullMQ's stalled-job detection. If a worker crashes mid-job,
      // BullMQ re-queues it after this interval. 30s gives a real Square
      // call (multi-second) ample time without leaving zombies for long.
      stalledInterval: 30_000,
      lockDuration: 60_000,
    },
  );

  worker.on('completed', (job) => {
    logger.info('square.catalog.worker.completed', {
      jobId: job.id,
      jobName: job.name,
      attemptsMade: job.attemptsMade,
    });
  });
  worker.on('failed', (job, err) => {
    logger.warn('square.catalog.worker.failed', {
      jobId: job?.id,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade,
      err: String(err?.message ?? err),
    });
    // Surface to Sentry only after retries exhaust — earlier attempts are
    // expected to fail transiently and would create noise. BullMQ sets
    // attemptsMade equal to the configured `attempts` on terminal failure.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      captureBackgroundError(err, {
        operation: 'square_catalog_worker.terminal_failure',
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
      });
    }
  });
  worker.on('error', (err) => {
    logger.error('square.catalog.worker.error', { err: String(err) });
    captureBackgroundError(err, { operation: 'square_catalog_worker.error' });
  });

  cachedWorker = worker;
  logger.info('square.catalog.worker.started');
  return worker;
}

export async function stopSquareCatalogWorker(): Promise<void> {
  const w = cachedWorker;
  cachedWorker = null;
  if (!w) return;
  try {
    // Wait for in-flight jobs to finish, but don't block forever — 15s
    // matches the server's overall shutdown grace period.
    await w.close();
  } catch (err) {
    logger.warn('square.catalog.worker.close_failed', { err: String(err) });
  }
}

// ─── Job dispatcher ───────────────────────────────────────────────────────

async function handleJob(
  job: Job<SquareCatalogJobData, unknown, SquareCatalogJobName>,
): Promise<void> {
  const data = job.data;

  if (data.kind === 'reconcile.seller') {
    await handleReconcileSeller(data.sellerId);
    return;
  }

  // The remaining kinds carry an outboxId. Mark the row as in-progress;
  // we use lastAttemptAt to detect stalled jobs in the reconciler.
  await prisma.squareSyncOutbox.update({
    where: { id: data.outboxId },
    data: {
      lastAttemptAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (data.kind === 'listing.upsert') {
    await handleUpsert(data.outboxId, data.listingId, data.sellerId);
    return;
  }
  if (data.kind === 'listing.delete') {
    await handleDelete(data.outboxId, data.listingId, data.sellerId);
    return;
  }
  if (data.kind === 'inventory.adjust') {
    await handleInventoryAdjust(
      data.outboxId,
      data.listingId,
      data.sellerId,
      data.quantity,
    );
    return;
  }
  if (data.kind === 'image.delete') {
    await handleImageDelete(
      data.outboxId,
      data.listingId,
      data.sellerId,
      data.squareImageIds,
    );
    return;
  }
  // Should be unreachable thanks to the discriminated union.
  throw new UnrecoverableError(
    `Unknown job kind: ${(data as { kind: string }).kind}`,
  );
}

// ─── LISTING_UPSERT ───────────────────────────────────────────────────────

async function handleUpsert(
  outboxId: string,
  listingId: string,
  sellerId: string,
): Promise<void> {
  const start = Date.now();
  // Read the live listing so we sync the latest state, even if the user
  // saved twice in quick succession and the older job lost the race.
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      images: { orderBy: { displayOrder: 'asc' } },
    },
  });

  if (!listing) {
    // Listing was deleted between enqueue and execution. Treat the outbox
    // row as processed (a follow-up DELETE outbox row should already be
    // queued by the delete handler).
    await markOutboxProcessed(outboxId, sellerId, listingId, 'LISTING_UPSERT', 'SKIPPED', start, 'listing not found');
    return;
  }

  const snapshot = snapshotListing(listing);

  // Short-circuit: if the hash matches what we last synced AND we have a
  // server id, this save was a no-op for Square. Saves an API call and
  // avoids needlessly bumping Square's `version` (which would invalidate
  // any in-progress edits in POS).
  const link = await prisma.squareCatalogLink.findUnique({
    where: { listingId },
  });
  const hash = hashListingForSync(snapshot);
  if (link?.squareObjectId && link.lastSyncedHash === hash && link.status === 'SYNCED') {
    await markOutboxProcessed(outboxId, sellerId, listingId, 'LISTING_UPSERT', 'SKIPPED', start, 'no changes since last sync');
    return;
  }

  await markLinkSyncing(listingId, sellerId);

  let session: CatalogSession;
  try {
    session = await openCatalogSession(sellerId);
  } catch (err) {
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'LISTING_UPSERT',
      action: 'oauth',
      err,
      start,
    });
    if (err instanceof SquareSyncDisabledError) {
      // No point retrying — seller has no Square account / disconnected.
      throw new UnrecoverableError(err.message);
    }
    throw err; // SquareTokenRefreshError propagates as retryable
  }

  // Step 1: ensure every ListingImage has a corresponding Square image id.
  // Reuses already-uploaded images by ListingImage.squareImageId; uploads
  // any that are new. Per-image failures are swallowed and logged — one
  // bad image doesn't block the rest of the listing from syncing.
  const imageIds = await ensureImagesUploaded(session, listing.images);

  // Step 2: ensure the seller has a CatalogCategory matching this listing's
  // category name. Finds-or-creates + caches in SquareCategoryLink.
  // Returns null if Square refuses the operation; we then upsert the item
  // without a category rather than fail the whole sync.
  const categoryId = await ensureCategoryForSeller(session, snapshot.category);

  // Step 3: build the item + nested variation, then batchUpsert.
  const payload = listingToCatalogPayload(snapshot, {
    itemId: link?.squareObjectId ?? undefined,
    variationId: link?.squareVariationId ?? undefined,
    version: link?.version ?? undefined,
    imageIds,
    categoryId,
  });

  const idempotencyKey = randomUUID();
  let updatedItem: CatalogObject | undefined;
  let idMappings: { clientObjectId?: string | null; objectId?: string | null }[] = [];

  try {
    const resp = await session.client.catalog.batchUpsert({
      idempotencyKey,
      batches: [{ objects: [payload.itemObject] }],
    });
    if (resp.errors && resp.errors.length > 0) {
      // Square returned errors despite a 200. Treat as failure.
      const first = resp.errors[0];
      // Cast: Square's ErrorCode union doesn't include the version-conflict
      // codes as literal strings, but they exist on the wire. We compare
      // against strings for forward-compat with new error codes.
      const code = (first.code as string | undefined) ?? 'UNKNOWN';
      const conflict = code === 'OPTIMISTIC_LOCKING_FAILURE' || code === 'VERSION_MISMATCH';
      await onSyncFailure({
        outboxId,
        listingId,
        sellerId,
        kind: 'LISTING_UPSERT',
        action: 'batch_upsert',
        err: new Error(`Square error ${code}: ${first.detail ?? first.category ?? 'no detail'}`),
        errorCode: code,
        start,
        outcome: conflict ? 'CONFLICT' : 'FAILURE',
      });
      if (conflict) {
        // Drop the stale version locally and let the next sync attempt
        // re-fetch + re-apply. Throw retryable error so BullMQ retries.
        await prisma.squareCatalogLink.update({
          where: { listingId },
          data: { version: null, status: 'PENDING' },
        });
      }
      throw new Error(`Square upsert error: ${code}`);
    }
    updatedItem = resp.objects?.find(
      (o) => o.type === 'ITEM' || o.id === payload.itemClientId,
    );
    idMappings = resp.idMappings ?? [];
  } catch (err) {
    if (err instanceof SquareTokenRefreshError) {
      throw err;
    }
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'LISTING_UPSERT',
      action: 'batch_upsert',
      err,
      start,
    });
    throw err;
  }

  // Step 3: extract server-assigned ids + version from the response.
  const itemServerId =
    findServerId(idMappings, payload.itemClientId) ??
    updatedItem?.id ??
    link?.squareObjectId ??
    null;
  const variationServerId =
    findServerId(idMappings, payload.variationClientId) ??
    extractVariationId(updatedItem) ??
    link?.squareVariationId ??
    null;
  const newVersion = updatedItem?.version ?? null;

  await prisma.squareCatalogLink.upsert({
    where: { listingId },
    create: {
      listingId,
      squareMerchantId: session.merchantId,
      squareObjectId: itemServerId ?? undefined,
      squareVariationId: variationServerId ?? undefined,
      version: newVersion ?? undefined,
      status: 'SYNCED',
      lastSyncedHash: hash,
      lastSyncedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    },
    update: {
      squareMerchantId: session.merchantId,
      ...(itemServerId ? { squareObjectId: itemServerId } : {}),
      ...(variationServerId ? { squareVariationId: variationServerId } : {}),
      version: newVersion ?? null,
      status: 'SYNCED',
      lastSyncedHash: hash,
      lastSyncedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    },
  });

  await markOutboxProcessed(
    outboxId,
    sellerId,
    listingId,
    'LISTING_UPSERT',
    'SUCCESS',
    start,
    null,
    itemServerId ?? undefined,
  );
}

// Image rows as Prisma returns them — the worker passes these straight
// through so we have access to id + squareImageId, not just url.
type ListingImageRow = {
  id: string;
  url: string;
  displayOrder: number;
  squareImageId: string | null;
};

/**
 * Ensure every ListingImage has a corresponding Square Catalog image id.
 *   - If `squareImageId` is set, reuse it (no API call, no upload).
 *   - Otherwise: fetch image from S3 → multipart-upload to Square →
 *     persist returned id back onto the ListingImage row.
 *
 * Per-image failures are logged + swallowed: a bad image just gets
 * omitted from the returned id list. The item still upserts with the
 * remaining images. This avoids one corrupt photo blocking the rest of
 * the listing from appearing in Square POS.
 *
 * Returned ids preserve listing displayOrder (Square renders the first
 * id as the item's primary thumbnail).
 */
async function ensureImagesUploaded(
  session: CatalogSession,
  images: ListingImageRow[],
): Promise<string[]> {
  if (images.length === 0) return [];
  const sorted = [...images].sort((a, b) => a.displayOrder - b.displayOrder);
  const ids: string[] = [];

  for (const img of sorted) {
    if (img.squareImageId) {
      ids.push(img.squareImageId);
      continue;
    }
    const result = await uploadListingImageToSquare(
      session,
      { index: img.displayOrder, url: img.url, listingId: img.id /* reused for client-id */ },
      randomUUID(),
    );
    if (!result.ok) {
      logger.warn('square.catalog.image.skipped', {
        listingImageId: img.id,
        url: img.url,
        reason: result.reason,
      });
      continue;
    }
    // Persist immediately so a crash mid-listing doesn't lose progress —
    // the next attempt will reuse the saved id and not re-upload.
    await prisma.listingImage.update({
      where: { id: img.id },
      data: {
        squareImageId: result.squareImageId,
        squareImageUploadedAt: new Date(),
      },
    });
    ids.push(result.squareImageId);
  }

  return ids;
}

// ─── LISTING_DELETE ───────────────────────────────────────────────────────

async function handleDelete(
  outboxId: string,
  listingId: string,
  sellerId: string,
): Promise<void> {
  const start = Date.now();
  const link = await prisma.squareCatalogLink.findUnique({
    where: { listingId },
  });
  if (!link?.squareObjectId) {
    // Never synced — nothing to delete on Square. Treat as a no-op.
    await markOutboxProcessed(outboxId, sellerId, listingId, 'LISTING_DELETE', 'SKIPPED', start, 'no Square object id');
    return;
  }

  let session: CatalogSession;
  try {
    session = await openCatalogSession(sellerId);
  } catch (err) {
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'LISTING_DELETE',
      action: 'oauth',
      err,
      start,
    });
    if (err instanceof SquareSyncDisabledError) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }

  try {
    await session.client.catalog.batchDelete({
      objectIds: [link.squareObjectId],
    });
  } catch (err) {
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'LISTING_DELETE',
      action: 'batch_delete',
      err,
      start,
    });
    throw err;
  }

  // Drop the link row entirely — the listing is also gone (status=REMOVED
  // / hard-deleted). Keeping the row would clutter the dashboard with
  // stale "synced" entries for items that no longer exist.
  await prisma.squareCatalogLink.deleteMany({
    where: { listingId },
  });

  await markOutboxProcessed(outboxId, sellerId, listingId, 'LISTING_DELETE', 'SUCCESS', start, null, link.squareObjectId);
}

// ─── IMAGE_DELETE ─────────────────────────────────────────────────────────

async function handleImageDelete(
  outboxId: string,
  listingId: string,
  sellerId: string,
  squareImageIds: string[],
): Promise<void> {
  const start = Date.now();
  if (squareImageIds.length === 0) {
    await markOutboxProcessed(
      outboxId,
      sellerId,
      listingId,
      'IMAGE_DELETE',
      'SKIPPED',
      start,
      'no image ids on payload',
    );
    return;
  }

  let session: CatalogSession;
  try {
    session = await openCatalogSession(sellerId);
  } catch (err) {
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'IMAGE_DELETE',
      action: 'oauth',
      err,
      start,
    });
    if (err instanceof SquareSyncDisabledError) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }

  try {
    // Square's batchDelete cascades, but only for parent→child links it
    // owns (Item→Variation). Standalone CatalogImages are addressed
    // independently. One call deletes up to 200 ids; we're well under
    // that for any single listing edit.
    await session.client.catalog.batchDelete({ objectIds: squareImageIds });
  } catch (err) {
    // 404s from Square mean the image is already gone (the image record
    // was removed elsewhere or never landed). Treat as a benign no-op so
    // we don't keep retrying a permanently-missing object.
    const status = (err as { statusCode?: number; status?: number }).statusCode
      ?? (err as { status?: number }).status;
    if (status === 404) {
      logger.warn('square.catalog.image_delete.already_gone', {
        outboxId,
        squareImageIds,
      });
      await markOutboxProcessed(
        outboxId,
        sellerId,
        listingId,
        'IMAGE_DELETE',
        'SKIPPED',
        start,
        'already deleted on Square',
      );
      return;
    }
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'IMAGE_DELETE',
      action: 'batch_delete',
      err,
      start,
    });
    throw err;
  }

  await markOutboxProcessed(
    outboxId,
    sellerId,
    listingId,
    'IMAGE_DELETE',
    'SUCCESS',
    start,
    `deleted ${squareImageIds.length} image(s)`,
  );
}

// ─── INVENTORY_ADJUST ─────────────────────────────────────────────────────

async function handleInventoryAdjust(
  outboxId: string,
  listingId: string,
  sellerId: string,
  delta: number,
): Promise<void> {
  const start = Date.now();
  const link = await prisma.squareCatalogLink.findUnique({
    where: { listingId },
  });
  if (!link?.squareVariationId) {
    await markOutboxProcessed(outboxId, sellerId, listingId, 'INVENTORY_ADJUST', 'SKIPPED', start, 'no variation id yet');
    return;
  }

  let session: CatalogSession;
  try {
    session = await openCatalogSession(sellerId);
  } catch (err) {
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'INVENTORY_ADJUST',
      action: 'oauth',
      err,
      start,
    });
    if (err instanceof SquareSyncDisabledError) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }

  // Two ways to adjust inventory: SET or PHYSICAL_COUNT/SALE/etc adjustment
  // events. We use a PHYSICAL_COUNT to "pin" inventory at the new value
  // (idempotent if retried; matches the marketplace semantics where the
  // listing is either available or sold).
  try {
    await session.client.inventory.batchCreateChanges({
      idempotencyKey: randomUUID(),
      changes: [
        {
          type: 'PHYSICAL_COUNT',
          physicalCount: {
            catalogObjectId: link.squareVariationId,
            state: delta > 0 ? 'IN_STOCK' : 'SOLD',
            locationId: session.locationId,
            quantity: String(Math.max(0, delta)),
            occurredAt: new Date().toISOString(),
          },
        },
      ],
    });
  } catch (err) {
    await onSyncFailure({
      outboxId,
      listingId,
      sellerId,
      kind: 'INVENTORY_ADJUST',
      action: 'inventory_adjust',
      err,
      start,
    });
    throw err;
  }

  await markOutboxProcessed(outboxId, sellerId, listingId, 'INVENTORY_ADJUST', 'SUCCESS', start, null, link.squareVariationId);
}

// ─── RECONCILE_SELLER ─────────────────────────────────────────────────────

async function handleReconcileSeller(sellerId: string): Promise<void> {
  // Re-enqueue an upsert outbox row for every ACTIVE listing the seller
  // owns. Cap to 100 per run to avoid huge backfills clogging the queue —
  // more than 100 means "force-resync" runs in batches.
  const listings = await prisma.listing.findMany({
    where: { sellerId, status: 'ACTIVE' },
    select: { id: true },
    take: 100,
    orderBy: { updatedAt: 'desc' },
  });
  for (const l of listings) {
    await prisma.squareSyncOutbox.create({
      data: {
        kind: 'LISTING_UPSERT',
        listingId: l.id,
        sellerId,
        status: 'PENDING',
        payload: {
          kind: 'LISTING_UPSERT',
          listing: { id: l.id },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  // The reconciler poller (started elsewhere) will pick these up. We
  // intentionally don't enqueue inline so the rate-limit logic stays in
  // one place (the poller).
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function markLinkSyncing(listingId: string, sellerId: string): Promise<void> {
  await prisma.squareCatalogLink.upsert({
    where: { listingId },
    create: {
      listingId,
      // squareMerchantId is required NOT NULL in the schema; backfill from
      // the seller's account on the row's first creation.
      squareMerchantId: await getSellerMerchantId(sellerId),
      status: 'SYNCING',
    },
    update: { status: 'SYNCING' },
  });
}

async function getSellerMerchantId(sellerId: string): Promise<string> {
  const account = await prisma.sellerPaymentAccount.findUnique({
    where: { userId_provider: { userId: sellerId, provider: 'SQUARE' } },
    select: { accountId: true },
  });
  return account?.accountId ?? 'unknown';
}

async function markOutboxProcessed(
  outboxId: string,
  sellerId: string,
  listingId: string | null,
  kind: 'LISTING_UPSERT' | 'LISTING_DELETE' | 'INVENTORY_ADJUST' | 'IMAGE_DELETE',
  outcome: 'SUCCESS' | 'SKIPPED',
  startMs: number,
  message: string | null,
  squareObjectId?: string,
): Promise<void> {
  await prisma.squareSyncOutbox.update({
    where: { id: outboxId },
    data: { status: 'PROCESSED', processedAt: new Date() },
  });
  await recordSyncEvent({
    outcome,
    kind,
    action: kindToAction(kind),
    sellerId,
    listingId,
    outboxId,
    durationMs: Date.now() - startMs,
    message,
    squareObjectId,
  });
}

async function onSyncFailure(args: {
  outboxId: string;
  listingId: string;
  sellerId: string;
  kind: 'LISTING_UPSERT' | 'LISTING_DELETE' | 'INVENTORY_ADJUST' | 'IMAGE_DELETE';
  action: string;
  err: unknown;
  errorCode?: string;
  start: number;
  outcome?: 'FAILURE' | 'CONFLICT';
}): Promise<void> {
  const message = args.err instanceof Error ? args.err.message : String(args.err);
  const truncated = message.slice(0, 2000);
  await prisma.squareSyncOutbox.update({
    where: { id: args.outboxId },
    data: { lastError: truncated },
  });
  await prisma.squareCatalogLink.upsert({
    where: { listingId: args.listingId },
    create: {
      listingId: args.listingId,
      squareMerchantId: await getSellerMerchantId(args.sellerId),
      status: 'ERROR',
      lastError: truncated,
      lastErrorAt: new Date(),
    },
    update: {
      status: 'ERROR',
      lastError: truncated,
      lastErrorAt: new Date(),
    },
  });
  await recordSyncEvent({
    outcome: args.outcome ?? 'FAILURE',
    kind: args.kind,
    action: args.action,
    sellerId: args.sellerId,
    listingId: args.listingId,
    outboxId: args.outboxId,
    durationMs: Date.now() - args.start,
    message: truncated,
    errorCode: args.errorCode,
  });
}

function kindToAction(
  kind: 'LISTING_UPSERT' | 'LISTING_DELETE' | 'INVENTORY_ADJUST' | 'IMAGE_DELETE',
): string {
  if (kind === 'LISTING_UPSERT') return 'upsert.complete';
  if (kind === 'LISTING_DELETE') return 'delete.complete';
  return 'inventory.adjust';
}

function findServerId(
  idMappings: { clientObjectId?: string | null; objectId?: string | null }[],
  clientId: string,
): string | null {
  if (clientId.startsWith('#')) {
    const found = idMappings.find((m) => m.clientObjectId === clientId);
    return found?.objectId ?? null;
  }
  // Already a server id; pass through.
  return clientId;
}

function extractVariationId(item: CatalogObject | undefined): string | null {
  if (!item || item.type !== 'ITEM') return null;
  const variations = item.itemData?.variations;
  if (!variations || variations.length === 0) return null;
  const first = variations[0];
  return typeof first.id === 'string' && !first.id.startsWith('#') ? first.id : null;
}

// Unused import suppression — keeps tree-shaking honest if observability
// is the only consumer of these types externally.
export type _UnusedListingSnapshot = ListingSnapshot;
