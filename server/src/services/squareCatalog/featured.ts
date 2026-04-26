// Public Featured rail powered by a curated demo Square Catalog. NOT
// per-seller — uses a single platform-owned access token (set via
// SQUARE_FEATURED_ACCESS_TOKEN) pointing at our own demo merchant. The
// rail demonstrates Square Catalog read APIs without needing a real seller
// to opt in.
//
// Caching strategy:
//   1. Read from SquareFeaturedItem (Postgres) — always fast, always
//      available even if Square is down.
//   2. A "rebuild" job pulls from Square Catalog and upserts the rows.
//      Triggered nightly (cron) or manually (admin endpoint).
//   3. We don't read directly from Square in the request path — the
//      homepage shouldn't 502 if Square has a hiccup.

import { SquareClient, SquareEnvironment } from 'square';
import prisma from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

export type FeaturedItem = {
  id: string;
  squareObjectId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  currency: string;
  rank: number;
};

/**
 * Read-side: returns the cached featured items, ranked. Empty array if
 * the rebuild has never run / no items present. Anonymous-friendly (no
 * auth required).
 */
export async function listFeaturedItems(): Promise<FeaturedItem[]> {
  const rows = await prisma.squareFeaturedItem.findMany({
    orderBy: [{ rank: 'asc' }, { name: 'asc' }],
    take: 12,
  });
  return rows.map((r) => ({
    id: r.id,
    squareObjectId: r.squareObjectId,
    name: r.name,
    description: r.description,
    imageUrl: r.imageUrl,
    priceCents: r.priceCents,
    currency: r.currency,
    rank: r.rank,
  }));
}

/**
 * Rebuild the featured cache from Square. Pulls every CatalogItem from the
 * demo merchant (paginated), upserts rows by squareObjectId, then deletes
 * rows that weren't touched (they've been removed from the demo catalog).
 *
 * Returns counts so admins can verify the rebuild worked.
 */
export async function rebuildFeaturedItems(): Promise<{
  upserted: number;
  removed: number;
  errors?: string[];
}> {
  const token = process.env.SQUARE_FEATURED_ACCESS_TOKEN;
  if (!token) {
    return {
      upserted: 0,
      removed: 0,
      errors: ['SQUARE_FEATURED_ACCESS_TOKEN not set'],
    };
  }

  const client = new SquareClient({
    token,
    environment:
      process.env.SQUARE_ENV === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });

  const errors: string[] = [];
  const startedAt = new Date();
  let upserted = 0;

  try {
    // ListCatalog yields a Page<CatalogObject>; iterate the AsyncIterable.
    // types=ITEM filters to items only; variations come nested.
    const page = await client.catalog.list({ types: 'ITEM,IMAGE' });

    // Cache image objects by id so we can resolve item.image_ids → URL.
    const imagesById: Record<string, string> = {};
    const items: Array<{
      id: string;
      name: string;
      description: string | null;
      priceCents: number;
      currency: string;
      imageId: string | null;
    }> = [];

    for await (const obj of page) {
      if (obj.type === 'IMAGE') {
        const url = obj.imageData?.url ?? null;
        if (obj.id && url) imagesById[obj.id] = url;
      } else if (obj.type === 'ITEM') {
        const item = obj.itemData;
        if (!item) continue;
        // Find the first variation's price as the headline price.
        const firstVar = item.variations?.[0];
        const priceMoney =
          firstVar && 'itemVariationData' in firstVar
            ? firstVar.itemVariationData?.priceMoney
            : null;
        if (!priceMoney?.amount) continue;
        items.push({
          id: obj.id,
          name: item.name?.slice(0, 200) ?? 'Untitled',
          description: (item.descriptionPlaintext ?? item.description ?? null)?.slice(0, 2000) ?? null,
          priceCents: Number(priceMoney.amount),
          currency: priceMoney.currency ?? 'USD',
          imageId: item.imageIds?.[0] ?? null,
        });
      }
    }

    for (const it of items) {
      const imageUrl = it.imageId ? imagesById[it.imageId] ?? null : null;
      await prisma.squareFeaturedItem.upsert({
        where: { squareObjectId: it.id },
        create: {
          squareObjectId: it.id,
          name: it.name,
          description: it.description,
          imageUrl,
          priceCents: it.priceCents,
          currency: it.currency,
          rank: 0,
          lastSeenAt: startedAt,
        },
        update: {
          name: it.name,
          description: it.description,
          imageUrl,
          priceCents: it.priceCents,
          currency: it.currency,
          lastSeenAt: startedAt,
        },
      });
      upserted += 1;
    }
  } catch (err) {
    logger.error('square.catalog.featured.rebuild_failed', { err: String(err) });
    errors.push(String(err));
  }

  // Anything not touched in this rebuild is gone from the demo catalog.
  const stale = await prisma.squareFeaturedItem.deleteMany({
    where: { lastSeenAt: { lt: startedAt } },
  });
  return { upserted, removed: stale.count, errors: errors.length ? errors : undefined };
}

// ─── Background refresh ───────────────────────────────────────────────────

let rebuildTimer: NodeJS.Timeout | null = null;

export function startFeaturedRebuildSchedule(): void {
  if (rebuildTimer) return;
  if (!process.env.SQUARE_FEATURED_ACCESS_TOKEN) return;
  // Initial rebuild after 30s, then daily. Skipping the initial-immediate
  // rebuild because boot is already busy.
  const ONE_DAY = 24 * 60 * 60 * 1000;
  rebuildTimer = setTimeout(function tick() {
    rebuildFeaturedItems()
      .then((r) =>
        logger.info('square.catalog.featured.rebuild_complete', {
          upserted: r.upserted,
          removed: r.removed,
        }),
      )
      .catch((err) =>
        logger.error('square.catalog.featured.rebuild_threw', { err: String(err) }),
      );
    rebuildTimer = setTimeout(tick, ONE_DAY);
  }, 30_000);
}

export function stopFeaturedRebuildSchedule(): void {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
}
