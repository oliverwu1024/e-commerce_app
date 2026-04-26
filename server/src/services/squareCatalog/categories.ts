// Find-or-create + cache for Square Catalog categories. Listing.category is
// a free-string ("Phones", "Laptops") that we want to surface in the
// seller's Square POS as a real CatalogCategory. Square's category is a
// per-merchant object with a server-assigned id, so we have to:
//
//   1. Look up our local SquareCategoryLink cache by (merchantId, name)
//   2. Cache miss → search the seller's Square catalog for a category
//      with that name (so an existing one isn't duplicated)
//   3. Still no match → create a new CatalogCategory via batchUpsert
//   4. Persist the resulting id to SquareCategoryLink
//
// All three steps are idempotent under retry. The local cache is the
// hot-path 99% of the time after warm-up; only the very first listing in
// a category for a given seller pays the round-trip.
//
// Concurrency: a per-(merchantId,name) in-flight Promise prevents two
// concurrent worker handlers from both creating the same category.

import type { CatalogObject } from 'square';
import prisma from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import type { CatalogSession } from './oauth.js';
import { randomUUID } from 'node:crypto';

const inflight = new Map<string, Promise<string | null>>();

/**
 * Returns the server-assigned Square CatalogCategory id for the given
 * marketplace category name, scoped to this seller's merchant. Creates
 * the category on Square if it doesn't exist yet.
 *
 * Returns null only if Square refuses the operation entirely (rate-limit,
 * permissions). Worker treats null as "skip categories on this upsert"
 * — better to sync an item with no category than to fail the whole flow.
 */
export async function ensureCategoryForSeller(
  session: CatalogSession,
  rawName: string,
): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;

  const cacheKey = `${session.merchantId}:${name.toLowerCase()}`;
  const inflightExisting = inflight.get(cacheKey);
  if (inflightExisting) return inflightExisting;

  const promise = resolveCategory(session, name).finally(() => {
    inflight.delete(cacheKey);
  });
  inflight.set(cacheKey, promise);
  return promise;
}

async function resolveCategory(
  session: CatalogSession,
  name: string,
): Promise<string | null> {
  // Step 1: local cache.
  const cached = await prisma.squareCategoryLink.findUnique({
    where: {
      squareMerchantId_name: {
        squareMerchantId: session.merchantId,
        name,
      },
    },
    select: { squareCategoryId: true },
  });
  if (cached) return cached.squareCategoryId;

  // Step 2: search Square for an existing category with that name. Avoids
  // duplicating if a seller previously created the category in their POS
  // dashboard.
  let foundId: string | null = null;
  try {
    const resp = await session.client.catalog.search({
      objectTypes: ['CATEGORY'],
      query: {
        exactQuery: { attributeName: 'name', attributeValue: name },
      },
      limit: 1,
    });
    const obj = resp.objects?.[0];
    if (obj && obj.type === 'CATEGORY' && obj.id) {
      foundId = obj.id;
    }
  } catch (err) {
    // Search failures are non-fatal — fall through to create.
    logger.warn('square.catalog.category.search_failed', {
      merchantId: session.merchantId,
      name,
      err: String(err),
    });
  }

  // Step 3: create if still missing.
  if (!foundId) {
    try {
      const tempId = `#category-${randomUUID()}`;
      const resp = await session.client.catalog.batchUpsert({
        idempotencyKey: randomUUID(),
        batches: [
          {
            objects: [
              {
                type: 'CATEGORY',
                id: tempId,
                presentAtAllLocations: true,
                categoryData: { name },
              } as CatalogObject,
            ],
          },
        ],
      });
      const mapping = resp.idMappings?.find(
        (m) => m.clientObjectId === tempId,
      );
      foundId =
        mapping?.objectId ??
        resp.objects?.find((o) => o.type === 'CATEGORY')?.id ??
        null;
    } catch (err) {
      logger.error('square.catalog.category.create_failed', {
        merchantId: session.merchantId,
        name,
        err: String(err),
      });
      return null;
    }
  }

  if (!foundId) return null;

  // Persist to cache. upsert because a concurrent worker may have raced
  // us through the in-flight guard from a different process.
  try {
    await prisma.squareCategoryLink.upsert({
      where: {
        squareMerchantId_name: {
          squareMerchantId: session.merchantId,
          name,
        },
      },
      create: {
        squareMerchantId: session.merchantId,
        name,
        squareCategoryId: foundId,
      },
      update: { squareCategoryId: foundId },
    });
  } catch (err) {
    // Cache miss is recoverable; not fatal.
    logger.warn('square.catalog.category.cache_persist_failed', {
      merchantId: session.merchantId,
      name,
      err: String(err),
    });
  }

  return foundId;
}
