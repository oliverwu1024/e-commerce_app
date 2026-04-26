// Inbound Square webhook handler for Catalog + Inventory events.
//
// Events we subscribe to:
//   - catalog.version.updated  — anything in the seller's catalog changed
//                                 (item created/edited/deleted, image moved,
//                                 etc.). Carries the new version number.
//   - inventory.count.updated   — variation inventory changed (sale at POS,
//                                 manual adjustment, recount).
//
// Our response strategy is "trust the catalog version, then fetch":
//   1. Verify HMAC signature against the configured key + URL.
//   2. Dedupe by event_id (Square at-least-once).
//   3. For catalog: find the SquareCatalogLink whose version is < event
//      version; for each affected item, fetch the latest CatalogObject and
//      apply selected fields (name, description, price) to the Listing.
//   4. For inventory: find the link by squareVariationId; if the marketplace
//      listing's stock is out-of-sync with Square's reported count, mark
//      the listing SOLD or back to ACTIVE depending on direction.
//
// Conflict resolution:
//   We ALWAYS write Square → DB on inbound, then write DB → Square on next
//   marketplace edit. This is "last writer wins" with marketplace edits
//   bumping the version, so a marketplace edit during an inbound sync may
//   briefly clobber the Square write. The version-aware outbound path
//   reads the new version and writes a follow-up sync, so steady state
//   converges. CONFLICT events are logged for investigation.

import type { Request, Response } from 'express';
import { WebhooksHelper } from 'square';
import prisma from '../../lib/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { logger } from '../../utils/logger.js';
import { recordSyncEvent } from './observability.js';
import { applyCatalogItemToListing } from './mapper.js';
import { openCatalogSession, SquareSyncDisabledError } from './oauth.js';

function getCatalogWebhookSignatureKey(): string | null {
  return process.env.SQUARE_CATALOG_WEBHOOK_SIGNATURE_KEY || null;
}

function getCatalogWebhookUrl(): string | null {
  return process.env.SQUARE_CATALOG_WEBHOOK_URL || null;
}

export async function handleSquareCatalogWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const sigKey = getCatalogWebhookSignatureKey();
  const url = getCatalogWebhookUrl();
  if (!sigKey || !url) {
    // Feature disabled — but acknowledge so Square doesn't retry. Log so
    // operators know events are coming in but going nowhere.
    logger.warn('square.catalog.webhook.disabled', {
      hasSignatureKey: Boolean(sigKey),
      hasUrl: Boolean(url),
    });
    res.json({ received: true, ignored: 'catalog webhook not configured' });
    return;
  }

  const signatureHeader = req.headers['x-square-hmacsha256-signature'];
  if (typeof signatureHeader !== 'string' || !signatureHeader) {
    res.status(400).json({ error: 'Missing Square signature header' });
    return;
  }

  // req.body is a Buffer because the route is mounted under express.raw.
  const bodyString = (req.body as Buffer).toString('utf8');

  let isValid: boolean;
  try {
    isValid = await WebhooksHelper.verifySignature({
      requestBody: bodyString,
      signatureHeader,
      signatureKey: sigKey,
      notificationUrl: url,
    });
  } catch (err) {
    logger.error('square.catalog.webhook.verify_threw', { err: String(err) });
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }
  if (!isValid) {
    logger.warn('square.catalog.webhook.invalid_signature', { url });
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  let event: SquareCatalogWebhookPayload;
  try {
    event = JSON.parse(bodyString) as SquareCatalogWebhookPayload;
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const eventId = event.event_id ?? event.eventId;
  const merchantId = event.merchant_id ?? event.merchantId;
  if (!eventId || !merchantId) {
    res.status(400).json({ error: 'Missing event_id / merchant_id' });
    return;
  }

  // Dedupe: insert the event row before processing. Unique constraint
  // throws on replay.
  try {
    await prisma.squareCatalogWebhookEvent.create({
      data: {
        eventId,
        merchantId,
        type: event.type ?? 'unknown',
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      res.json({ received: true, duplicate: true });
      return;
    }
    throw err;
  }

  try {
    if (event.type === 'catalog.version.updated') {
      await handleCatalogVersionUpdated(eventId, merchantId, event);
    } else if (event.type === 'inventory.count.updated') {
      await handleInventoryCountUpdated(eventId, merchantId, event);
    } else {
      // Unsubscribed types still ack — Square will keep sending until we
      // unsubscribe in the dashboard, and we don't want to 4xx and trigger
      // retries for events we knowingly ignore.
      res.json({ received: true, ignored: event.type });
      return;
    }
    res.json({ received: true });
  } catch (err) {
    logger.error('square.catalog.webhook.handler_failed', {
      err: String(err),
      eventId,
      merchantId,
      type: event.type,
    });
    // Drop the dedupe row so a retry can re-enter.
    await prisma.squareCatalogWebhookEvent
      .delete({ where: { eventId } })
      .catch(() => undefined);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

// ─── catalog.version.updated ──────────────────────────────────────────────

async function handleCatalogVersionUpdated(
  eventId: string,
  merchantId: string,
  event: SquareCatalogWebhookPayload,
): Promise<void> {
  // The event payload for catalog.version.updated has the catalog version
  // but NOT the changed object id — we need to query Square to find what
  // moved. Strategy: pull all SquareCatalogLink rows for this merchant
  // whose version is null or behind the new event version, fetch each,
  // and apply.
  const catalogVersion = event.data?.object?.catalog_version?.updated_at;
  const start = Date.now();

  // Find a seller this merchant_id corresponds to. There could in theory
  // be multiple users with the same merchant_id (very rare; possible if
  // a user disconnects + a different user reconnects the same Square
  // merchant). We process each.
  const accounts = await prisma.sellerPaymentAccount.findMany({
    where: { provider: 'SQUARE', accountId: merchantId, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (accounts.length === 0) {
    logger.warn('square.catalog.webhook.unknown_merchant', { merchantId });
    return;
  }

  for (const acc of accounts) {
    let session;
    try {
      session = await openCatalogSession(acc.userId);
    } catch (err) {
      if (err instanceof SquareSyncDisabledError) continue;
      throw err;
    }

    // Fetch the items linked to this seller's listings. Square's
    // ListCatalog returns the whole catalog, which is wasteful — instead
    // we batchGet our known item ids.
    const links = await prisma.squareCatalogLink.findMany({
      where: { squareMerchantId: merchantId, squareObjectId: { not: null } },
      select: {
        listingId: true,
        squareObjectId: true,
        version: true,
      },
    });
    if (links.length === 0) continue;

    const ids = links
      .map((l) => l.squareObjectId)
      .filter((x): x is string => Boolean(x));
    // Square's batchGet takes up to 1000 ids per call. Marketplaces with
    // more than that should chunk; we're well under for the foreseeable
    // future, but enforce a slice to be safe.
    const batch = ids.slice(0, 1000);
    let resp;
    try {
      resp = await session.client.catalog.batchGet({
        objectIds: batch,
      });
    } catch (err) {
      logger.error('square.catalog.webhook.batch_get_failed', {
        err: String(err),
        merchantId,
        count: batch.length,
      });
      continue;
    }

    for (const obj of resp.objects ?? []) {
      if (obj.type !== 'ITEM') continue;
      const link = links.find((l) => l.squareObjectId === obj.id);
      if (!link) continue;

      // If our stored version is >= remote, skip — we already applied or
      // we wrote it ourselves.
      if (link.version != null && obj.version != null && link.version >= obj.version) {
        await recordSyncEvent({
          outcome: 'SKIPPED',
          kind: 'LISTING_UPSERT',
          action: 'inbound.catalog_version_updated',
          sellerId: acc.userId,
          listingId: link.listingId,
          squareObjectId: obj.id,
          squareEventId: eventId,
          message: 'remote version not newer than local',
        });
        continue;
      }

      const updates = applyCatalogItemToListing(obj);
      if (Object.keys(updates).length === 0) {
        // Nothing recognisable to apply. Still bump our recorded version
        // so we don't keep refetching.
        if (obj.version != null) {
          await prisma.squareCatalogLink.update({
            where: { listingId: link.listingId },
            data: { version: obj.version },
          });
        }
        continue;
      }

      // Write back. We DON'T enqueue an outbound sync here — that would
      // round-trip the same change. The outbound flow only fires on
      // marketplace-side edits, and the link's lastSyncedHash will be
      // updated on the next regular save.
      await prisma.$transaction(async (tx) => {
        const data: Record<string, unknown> = {};
        if (typeof updates.title === 'string') data.title = updates.title;
        if (typeof updates.description === 'string') data.description = updates.description;
        if (typeof updates.priceCents === 'number') {
          data.price = (updates.priceCents / 100).toFixed(2);
        }
        if (Object.keys(data).length > 0) {
          await tx.listing.update({
            where: { id: link.listingId },
            data: data as Prisma.ListingUpdateInput,
          });
        }
        await tx.squareCatalogLink.update({
          where: { listingId: link.listingId },
          data: {
            version: obj.version ?? null,
            lastSyncedAt: new Date(),
          },
        });
      });

      await recordSyncEvent({
        outcome: 'SUCCESS',
        kind: 'LISTING_UPSERT',
        action: 'inbound.catalog_version_updated',
        sellerId: acc.userId,
        listingId: link.listingId,
        squareObjectId: obj.id,
        squareEventId: eventId,
        durationMs: Date.now() - start,
      });
    }
  }
}

// ─── inventory.count.updated ──────────────────────────────────────────────

async function handleInventoryCountUpdated(
  eventId: string,
  merchantId: string,
  event: SquareCatalogWebhookPayload,
): Promise<void> {
  const counts = event.data?.object?.inventory_counts ?? [];
  if (counts.length === 0) return;

  for (const count of counts) {
    const variationId = count.catalog_object_id;
    if (!variationId) continue;
    const link = await prisma.squareCatalogLink.findFirst({
      where: { squareMerchantId: merchantId, squareVariationId: variationId },
      select: { listingId: true },
      // Latest in case multiple link rows somehow point to the same variation.
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!link) continue;

    const account = await prisma.sellerPaymentAccount.findFirst({
      where: { provider: 'SQUARE', accountId: merchantId },
      select: { userId: true },
    });
    if (!account) continue;

    // Marketplace inventory is binary: ACTIVE = available, SOLD = gone.
    // If Square reports IN_STOCK with quantity > 0, ensure listing is
    // ACTIVE. If OUT_OF_STOCK or quantity 0, mark SOLD.
    const qty = Number(count.quantity ?? '0');
    const state = count.state;
    const targetStatus =
      qty > 0 && (state === 'IN_STOCK' || state === 'RECEIVED_FROM_VENDOR')
        ? 'ACTIVE'
        : qty === 0 || state === 'SOLD'
          ? 'SOLD'
          : null;

    if (!targetStatus) continue;
    // Only touch ACTIVE → SOLD or vice versa; never override ON_HOLD or
    // REMOVED, which are marketplace-canonical states.
    const current = await prisma.listing.findUnique({
      where: { id: link.listingId },
      select: { status: true },
    });
    if (!current) continue;
    if (current.status !== 'ACTIVE' && current.status !== 'SOLD') continue;
    if (current.status === targetStatus) continue;

    await prisma.listing.update({
      where: { id: link.listingId },
      data: { status: targetStatus },
    });
    await recordSyncEvent({
      outcome: 'SUCCESS',
      kind: 'INVENTORY_ADJUST',
      action: 'inbound.inventory_count_updated',
      sellerId: account.userId,
      listingId: link.listingId,
      squareObjectId: variationId,
      squareEventId: eventId,
      message: `Square reports ${state} qty=${qty} → listing ${targetStatus}`,
    });
  }
}

// ─── Types ────────────────────────────────────────────────────────────────

// Square sends snake_case but the SDK speaks camelCase; we accept both.
type SquareCatalogWebhookPayload = {
  type?: string;
  event_id?: string;
  eventId?: string;
  merchant_id?: string;
  merchantId?: string;
  data?: {
    object?: {
      catalog_version?: { updated_at?: string };
      inventory_counts?: Array<{
        catalog_object_id?: string;
        quantity?: string;
        state?: string;
        location_id?: string;
      }>;
    };
  };
};
