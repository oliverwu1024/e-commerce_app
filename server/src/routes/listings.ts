import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { listingQuerySchema, createListingSchemaForUser, updateListingSchemaForUser, paginationSchema } from '../schemas/listings.js';
import { uuidSchema } from '../schemas/common.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { getSellerStats } from '../services/sellerStats.js';
import { FEATURES } from '../config/features.js';
import { PUBLIC_LOCATION_SELECT, projectPublicSeller } from '../services/publicLocation.js';
import {
  createOutboxRow,
  enqueueOutbox,
  snapshotListing,
} from '../services/squareCatalog/index.js';

const router = Router();

const createListingLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many listings created, please try again later' },
});

// Guard the public browse/search endpoint against enumeration abuse. Keys on
// user when authenticated (most visitors are anonymous, so this largely falls
// back to IP).
const browseLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, please slow down' },
});

// GET /api/listings — Browse listings with filters, search, sort, pagination
router.get('/', browseLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = listingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { category, brand, condition, minPrice, maxPrice, search, sellerId, sort, page, limit } = parsed.data;

    // Build filter conditions
    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
    };

    if (category) {
      where.category = { equals: category, mode: 'insensitive' };
    }

    if (brand) {
      where.brand = { equals: brand, mode: 'insensitive' };
    }

    if (condition) {
      where.condition = condition;
    }

    if (sellerId) {
      where.sellerId = sellerId;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {
        ...(minPrice !== undefined && { gte: minPrice }),
        ...(maxPrice !== undefined && { lte: maxPrice }),
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build sort order
    let orderBy: Prisma.ListingOrderByWithRelationInput;
    switch (sort) {
      case 'price_asc':
        orderBy = { price: 'asc' };
        break;
      case 'price_desc':
        orderBy = { price: 'desc' };
        break;
      default:
        orderBy = { createdAt: 'desc' };
    }

    const skip = (page - 1) * limit;

    // Run count and data queries in parallel
    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          price: true,
          fulfillmentMethod: true,
          shippingPrice: true,
          category: true,
          brand: true,
          condition: true,
          status: true,
          createdAt: true,
          seller: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              ...PUBLIC_LOCATION_SELECT,
            },
          },
          images: {
            orderBy: { displayOrder: 'asc' },
            take: 1,
            select: {
              id: true,
              url: true,
            },
          },
        },
      }),
      prisma.listing.count({ where }),
    ]);

    res.json({
      listings: listings.map((l) => ({ ...l, seller: projectPublicSeller(l.seller) })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Browse listings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/listings/my — Current user's listings (all statuses by default;
// pass ?status=ACTIVE|ON_HOLD|SOLD|REMOVED to filter)
router.get('/my', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const statusParam = req.query.status;
    const validStatus =
      typeof statusParam === 'string' &&
      ['ACTIVE', 'ON_HOLD', 'SOLD', 'REMOVED'].includes(statusParam)
        ? (statusParam as 'ACTIVE' | 'ON_HOLD' | 'SOLD' | 'REMOVED')
        : undefined;

    const where: { sellerId: string; status?: typeof validStatus } = {
      sellerId: req.userId!,
    };
    if (validStatus) where.status = validStatus;

    const [listings, total, statusCounts] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          price: true,
          fulfillmentMethod: true,
          shippingPrice: true,
          category: true,
          brand: true,
          condition: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          images: {
            orderBy: { displayOrder: 'asc' },
            take: 1,
            select: { id: true, url: true },
          },
        },
      }),
      prisma.listing.count({ where }),
      // Counts always reflect ALL the seller's listings, regardless of any
      // status filter on the visible page — used by the dashboard tab badges.
      prisma.listing.groupBy({
        by: ['status'],
        where: { sellerId: req.userId! },
        _count: { status: true },
      }),
    ]);

    const counts = { ACTIVE: 0, ON_HOLD: 0, SOLD: 0, REMOVED: 0 };
    for (const row of statusCounts) counts[row.status] = row._count.status;

    res.json({
      listings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      counts,
    });
  } catch (err) {
    console.error('My listings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/listings — Create a new listing
router.post('/', authenticate, createListingLimiter, async (req: Request, res: Response) => {
  try {
    // Seller must be fully verified before listing. The check covers email +
    // phone for everyone, and then sellerType-specific: PERSONAL=ID approved,
    // BUSINESS=ABN verified. 403 with a `missing` array so the client can
    // point the user to the right verification step.
    const seller = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        sellerType: true,
        emailVerified: true,
        phoneVerified: true,
        abnVerified: true,
        idVerification: true,
        addressLine1: true,
        suburb: true,
        postcode: true,
        state: true,
      },
    });
    if (!seller) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const missing: string[] = [];
    if (!seller.emailVerified) missing.push('email');
    if (!seller.phoneVerified) missing.push('phone');
    if (seller.sellerType === 'PERSONAL') {
      // Skip the ID gate when the feature flag is off — must stay in sync
      // with computeCanSell() in routes/users.ts.
      if (FEATURES.idVerificationEnabled && seller.idVerification !== 'APPROVED') {
        missing.push('id');
      }
    } else if (!seller.abnVerified) {
      missing.push('abn');
    }
    // Address gate. Postcode + state are public on listings; line1 + suburb
    // are needed because PICKUP listings will share the address through the
    // order chat, and POST listings need the full address for return labels
    // / disputes. All four are required regardless of fulfillmentMethod so
    // sellers can switch a listing's fulfillment later without re-prompting.
    if (
      !seller.addressLine1 ||
      !seller.suburb ||
      !seller.postcode ||
      !seller.state
    ) {
      missing.push('address');
    }
    if (missing.length > 0) {
      res.status(403).json({
        error: 'Complete seller verification before listing.',
        missing,
      });
      return;
    }

    const parsed = createListingSchemaForUser(req.userId!).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { images, ...listingData } = parsed.data;

    // Wrap in a transaction so the outbox row is committed atomically
    // with the Listing — we never end up with a synced listing that has
    // no outbox row, or vice versa.
    const { listing, outboxId } = await prisma.$transaction(async (tx) => {
      const created = await tx.listing.create({
        data: {
          ...listingData,
          sellerId: req.userId!,
          images: images?.length
            ? { create: images.map((img) => ({ url: img.url, displayOrder: img.displayOrder })) }
            : undefined,
        },
        include: {
          images: { orderBy: { displayOrder: 'asc' } },
          seller: {
            select: { id: true, username: true, ...PUBLIC_LOCATION_SELECT },
          },
        },
      });
      const oid = await createOutboxRow({
        tx,
        listingId: created.id,
        sellerId: req.userId!,
        kind: 'LISTING_UPSERT',
        payload: {
          kind: 'LISTING_UPSERT',
          listing: snapshotListing(created),
        },
      });
      return { listing: created, outboxId: oid };
    });

    // Enqueue OUTSIDE the tx — if BullMQ is down, the row stays PENDING
    // and the reconciler picks it up later.
    if (outboxId) {
      void enqueueOutbox(outboxId);
    }

    res.status(201).json({
      listing: { ...listing, seller: projectPublicSeller(listing.seller) },
    });
  } catch (err) {
    console.error('Create listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/listings/:id — Edit a listing (owner only, must be ACTIVE)
router.put('/:id', authenticate, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid listing ID' });
      return;
    }

    const existing = await prisma.listing.findUnique({
      where: { id },
      select: { sellerId: true, status: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }

    if (existing.sellerId !== req.userId) {
      res.status(403).json({ error: 'You can only edit your own listings' });
      return;
    }

    if (existing.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Only active listings can be edited' });
      return;
    }

    const parsed = updateListingSchemaForUser(req.userId!).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { images, ...updateData } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      // Re-verify ownership + status inside transaction to prevent TOCTOU race
      const current = await tx.listing.findUnique({
        where: { id },
        select: { status: true, sellerId: true },
      });
      if (current?.status !== 'ACTIVE' || current.sellerId !== req.userId) return null;

      if (images !== undefined) {
        // Preserve ListingImage rows whose URL is unchanged so their
        // squareImageId (if any) carries over — otherwise every save would
        // re-upload every image to Square Catalog. Two-phase update so
        // displayOrder + URL collisions don't fight the (listingId,
        // displayOrder) unique constraint mid-transaction:
        //   Phase 1: drop rows whose URLs are gone from the new list
        //   Phase 2: bump survivors to a high displayOrder (out of the way)
        //   Phase 3: insert any genuinely-new URLs
        //   Phase 4: assign final displayOrder to every row in one pass
        const currentRows = await tx.listingImage.findMany({
          where: { listingId: id },
          select: { id: true, url: true },
        });
        const desiredUrls = new Set(images.map((img) => img.url));
        const toDelete = currentRows.filter((r) => !desiredUrls.has(r.url));
        if (toDelete.length > 0) {
          await tx.listingImage.deleteMany({
            where: { id: { in: toDelete.map((r) => r.id) } },
          });
        }

        const survivorByUrl = new Map(
          currentRows
            .filter((r) => desiredUrls.has(r.url))
            .map((r) => [r.url, r.id] as const),
        );

        // Bump survivors to a temporary high displayOrder so the final
        // assignment doesn't collide with rows still holding old slots.
        let tempOrder = 1000;
        for (const id of survivorByUrl.values()) {
          await tx.listingImage.update({
            where: { id },
            data: { displayOrder: tempOrder++ },
          });
        }

        for (const img of images) {
          if (!survivorByUrl.has(img.url)) {
            const created = await tx.listingImage.create({
              data: { listingId: id, url: img.url, displayOrder: tempOrder++ },
              select: { id: true, url: true },
            });
            survivorByUrl.set(created.url, created.id);
          }
        }

        // Final pass: assign each image its requested displayOrder.
        for (const img of images) {
          const rowId = survivorByUrl.get(img.url);
          if (rowId) {
            await tx.listingImage.update({
              where: { id: rowId },
              data: { displayOrder: img.displayOrder },
            });
          }
        }
      }

      const updated = await tx.listing.update({
        where: { id },
        data: updateData,
        include: {
          images: { orderBy: { displayOrder: 'asc' } },
          seller: {
          select: { id: true, username: true, ...PUBLIC_LOCATION_SELECT },
        },
        },
      });
      const oid = await createOutboxRow({
        tx,
        listingId: updated.id,
        sellerId: req.userId!,
        kind: 'LISTING_UPSERT',
        payload: {
          kind: 'LISTING_UPSERT',
          listing: snapshotListing(updated),
        },
      });
      return { listing: updated, outboxId: oid };
    });

    if (!result) {
      res.status(409).json({ error: 'Listing is no longer available for editing' });
      return;
    }

    if (result.outboxId) {
      void enqueueOutbox(result.outboxId);
    }

    res.json({
      listing: { ...result.listing, seller: projectPublicSeller(result.listing.seller) },
    });
  } catch (err) {
    console.error('Update listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/listings/:id — Soft delete (set status to REMOVED)
router.delete('/:id', authenticate, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid listing ID' });
      return;
    }

    const existing = await prisma.listing.findUnique({
      where: { id },
      select: { sellerId: true, status: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }

    if (existing.sellerId !== req.userId) {
      res.status(403).json({ error: 'You can only remove your own listings' });
      return;
    }

    if (existing.status === 'REMOVED') {
      res.status(400).json({ error: 'Listing is already removed' });
      return;
    }

    if (existing.status === 'SOLD') {
      res.status(400).json({ error: 'Cannot remove a sold listing' });
      return;
    }

    if (existing.status === 'ON_HOLD') {
      res.status(400).json({ error: 'Cannot remove a listing with a pending order. Cancel the order first.' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Re-verify ownership + status inside transaction to prevent TOCTOU race
      const current = await tx.listing.findUnique({
        where: { id },
        select: { status: true, sellerId: true },
      });
      if (current?.status !== 'ACTIVE' || current.sellerId !== req.userId) {
        return { removed: false, outboxId: null as string | null };
      }

      const updated = await tx.listing.update({
        where: { id },
        data: { status: 'REMOVED' },
        include: { images: { orderBy: { displayOrder: 'asc' } } },
      });
      const oid = await createOutboxRow({
        tx,
        listingId: id,
        sellerId: req.userId!,
        kind: 'LISTING_DELETE',
        payload: {
          kind: 'LISTING_DELETE',
          listing: snapshotListing(updated),
        },
      });
      return { removed: true, outboxId: oid };
    });

    if (!result.removed) {
      res.status(409).json({ error: 'Listing status changed. Please refresh and try again.' });
      return;
    }

    if (result.outboxId) {
      void enqueueOutbox(result.outboxId);
    }

    res.json({ message: 'Listing removed successfully' });
  } catch (err) {
    console.error('Delete listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/listings/:id — Single listing with seller info
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid listing ID' });
      return;
    }

    const listing = await prisma.listing.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        fulfillmentMethod: true,
        shippingPrice: true,
        category: true,
        subcategory: true,
        platform: true,
        brand: true,
        condition: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        seller: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            createdAt: true,
            ...PUBLIC_LOCATION_SELECT,
          },
        },
        images: {
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true,
            url: true,
            displayOrder: true,
          },
        },
      },
    });

    if (!listing || listing.status === 'REMOVED') {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }

    const stats = await getSellerStats(listing.seller.id);

    const publicSeller = projectPublicSeller(listing.seller);
    res.json({
      listing: {
        ...listing,
        seller: {
          ...publicSeller,
          avgRating: stats.avgRating,
          totalReviews: stats.totalReviews,
          totalSales: stats.totalSales,
        },
      },
    });
  } catch (err) {
    console.error('Get listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
