// Public + seller + admin endpoints for the Square Catalog sync feature.
// One file so the surface is easy to audit; subdirectories would split a
// small set of routes that all logically belong together.

import { Router, type Request, type Response } from 'express';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { listFeaturedItems, rebuildFeaturedItems } from '../services/squareCatalog/featured.js';
import { findAccount } from '../services/sellerPaymentAccounts.js';
import { enqueueOutbox } from '../services/squareCatalog/index.js';
import { Prisma } from '../generated/prisma/client.js';
import { logger } from '../utils/logger.js';
import { getMetricsSnapshot } from '../services/squareCatalog/observability.js';

const router = Router();

// Public Featured rail. Cached server-side; this endpoint is just a thin
// shell so the homepage can fetch fast.
const featuredLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  message: { error: 'Too many requests' },
});

router.get('/featured', featuredLimiter, async (_req: Request, res: Response) => {
  try {
    const items = await listFeaturedItems();
    // Mark cacheable so a downstream CDN can hold it for ~60s.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    res.json({ items });
  } catch (err) {
    logger.error('square.catalog.featured_endpoint_failed', { err: String(err) });
    res.status(500).json({ error: 'Failed to load featured items' });
  }
});

// ─── Seller endpoints ─────────────────────────────────────────────────────

const sellerSyncLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: { error: 'Too many sync requests, please slow down' },
});

// GET /api/square-catalog/sync — current toggle + last 50 events for the
// signed-in seller. Powers the seller settings panel.
router.get('/sync', authenticate, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const [user, account, links, recentEvents] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        squareCatalogSyncEnabled: true,
        squareCatalogSyncEnabledAt: true,
      },
    }),
    findAccount(userId, 'SQUARE'),
    prisma.squareCatalogLink.findMany({
      where: { listing: { sellerId: userId } },
      select: {
        listingId: true,
        status: true,
        squareObjectId: true,
        version: true,
        lastSyncedAt: true,
        lastError: true,
        lastErrorAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.squareSyncEvent.findMany({
      where: { sellerId: userId },
      select: {
        id: true,
        outcome: true,
        kind: true,
        action: true,
        message: true,
        listingId: true,
        createdAt: true,
        durationMs: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const squareConnected = Boolean(
    account && account.status === 'ACTIVE' && account.accessToken,
  );

  res.json({
    enabled: Boolean(user?.squareCatalogSyncEnabled),
    enabledAt: user?.squareCatalogSyncEnabledAt ?? null,
    squareConnected,
    summary: {
      total: links.length,
      synced: links.filter((l) => l.status === 'SYNCED').length,
      pending: links.filter((l) => l.status === 'PENDING' || l.status === 'SYNCING').length,
      error: links.filter((l) => l.status === 'ERROR').length,
    },
    links,
    recentEvents,
  });
});

// PUT /api/square-catalog/sync/toggle — flip the per-seller opt-in.
// Refuses to enable if the seller hasn't connected Square yet — the
// toggle is meaningless without an account to write to.
router.put(
  '/sync/toggle',
  authenticate,
  sellerSyncLimiter,
  async (req: Request, res: Response) => {
    const enabled = Boolean((req.body as { enabled?: unknown }).enabled);
    if (enabled) {
      const account = await findAccount(req.userId!, 'SQUARE');
      if (!account || account.status !== 'ACTIVE' || !account.accessToken) {
        res.status(400).json({
          error: 'Connect Square at /account/payments before enabling catalog sync.',
        });
        return;
      }
    }
    const updated = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        squareCatalogSyncEnabled: enabled,
        squareCatalogSyncEnabledAt: enabled ? new Date() : null,
      },
      select: {
        squareCatalogSyncEnabled: true,
        squareCatalogSyncEnabledAt: true,
      },
    });

    // Backfill: when the seller flips ON, queue an upsert for every
    // ACTIVE listing they own. Capped to 100 — anything past that is
    // out-of-scope for v1 and we'd add a paginated background job later.
    if (enabled) {
      const listings = await prisma.listing.findMany({
        where: { sellerId: req.userId!, status: 'ACTIVE' },
        select: { id: true },
        take: 100,
      });
      for (const l of listings) {
        const created = await prisma.squareSyncOutbox.create({
          data: {
            kind: 'LISTING_UPSERT',
            listingId: l.id,
            sellerId: req.userId!,
            status: 'PENDING',
            payload: {
              kind: 'LISTING_UPSERT',
              listing: { id: l.id },
            } as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        void enqueueOutbox(created.id);
      }
    }

    res.json({
      enabled: updated.squareCatalogSyncEnabled,
      enabledAt: updated.squareCatalogSyncEnabledAt,
    });
  },
);

// POST /api/square-catalog/sync/listings/:id/resync — manually re-enqueue a
// single listing for the signed-in seller.
router.post(
  '/sync/listings/:id/resync',
  authenticate,
  sellerSyncLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const listing = await prisma.listing.findUnique({
      where: { id },
      select: { sellerId: true, status: true },
    });
    if (!listing || listing.sellerId !== req.userId) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }
    if (listing.status === 'REMOVED') {
      res.status(400).json({ error: 'Cannot resync a removed listing' });
      return;
    }
    const out = await prisma.squareSyncOutbox.create({
      data: {
        kind: 'LISTING_UPSERT',
        listingId: id,
        sellerId: req.userId!,
        status: 'PENDING',
        payload: {
          kind: 'LISTING_UPSERT',
          listing: { id },
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    void enqueueOutbox(out.id);
    res.json({ enqueued: true, outboxId: out.id });
  },
);

// ─── Admin endpoints ──────────────────────────────────────────────────────
// These are admin-gated by checking req.userId's role in the handler — the
// existing /api/admin/* router does the same; we mount under our own prefix
// because logically the catalog stuff is its own concern.

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { role: true },
  });
  if (u?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// GET /api/square-catalog/admin/health — platform-wide sync metrics
router.get('/admin/health', authenticate, async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const [bySeller, byOutcome, last24] = await Promise.all([
    prisma.user.findMany({
      where: { squareCatalogSyncEnabled: true },
      select: {
        id: true,
        username: true,
        squareCatalogSyncEnabledAt: true,
        _count: { select: { squareSyncEvents: true } },
      },
      take: 200,
    }),
    prisma.squareSyncEvent.groupBy({
      by: ['outcome'],
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      _count: { _all: true },
    }),
    prisma.squareSyncEvent.findMany({
      where: {
        outcome: 'FAILURE',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        sellerId: true,
        listingId: true,
        kind: true,
        action: true,
        message: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  res.json({
    sellers: bySeller,
    outcomesLast24h: byOutcome,
    failuresLast24h: last24,
    metrics: getMetricsSnapshot(),
  });
});

// POST /api/square-catalog/admin/sellers/:id/resync — admin-triggered
// force-resync for one seller. Enqueues an upsert for each of their
// ACTIVE listings (cap 100).
router.post(
  '/admin/sellers/:id/resync',
  authenticate,
  async (req: Request<{ id: string }>, res: Response) => {
    if (!(await requireAdmin(req, res))) return;
    const sellerId = req.params.id;
    const listings = await prisma.listing.findMany({
      where: { sellerId, status: 'ACTIVE' },
      select: { id: true },
      take: 100,
    });
    const ids: string[] = [];
    for (const l of listings) {
      const created = await prisma.squareSyncOutbox.create({
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
        select: { id: true },
      });
      ids.push(created.id);
      void enqueueOutbox(created.id);
    }
    res.json({ enqueued: ids.length });
  },
);

// POST /api/square-catalog/admin/featured/rebuild — admin-only "refresh
// the public Featured rail now" action. Useful after changing the demo
// merchant's catalog so the change appears immediately rather than waiting
// for the daily cron.
router.post(
  '/admin/featured/rebuild',
  authenticate,
  async (req: Request, res: Response) => {
    if (!(await requireAdmin(req, res))) return;
    const result = await rebuildFeaturedItems();
    res.json(result);
  },
);

export default router;
