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
import { LISTING_IMAGE_TYPES, LISTING_VIDEO_TYPES, verifyS3Upload } from '../lib/s3Verify.js';
import { logger } from '../utils/logger.js';

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

    // Build sort order. When a search query is present we override this
    // with relevance (ts_rank) — sorting by price on a search query
    // produces near-irrelevant results at the top.
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

    // Search path: full-text search via tsvector + GIN. The searchVector
    // column is a STORED generated column populated from
    // title + brand + category + description with weighted setweight
    // levels (A→D respectively), so a hit on the title outranks one in
    // the description. websearch_to_tsquery accepts user-friendly query
    // syntax: "iphone -case OR samsung". We get back ranked ids in one
    // query, then fetch full rows in the second so the response shape
    // exactly matches the non-search path.
    // We use the same projection shape in both branches; bind it explicitly
    // so the conditional doesn't force the broader Listing type.
    type ListingRow = {
      id: string;
      title: string;
      price: Prisma.Decimal;
      fulfillmentMethod: 'POST_ONLY' | 'PICKUP_ONLY' | 'BOTH';
      shippingPrice: Prisma.Decimal | null;
      category: string;
      brand: string | null;
      condition: 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
      status: 'ACTIVE' | 'ON_HOLD' | 'SOLD' | 'REMOVED';
      createdAt: Date;
      seller: {
        id: string;
        username: string;
        avatarUrl: string | null;
        sellerType: 'PERSONAL' | 'BUSINESS';
        location: string | null;
        addressLine1: string | null;
        suburb: string | null;
        postcode: string | null;
        state: string | null;
        showFullAddressPublicly: boolean;
      };
      images: { id: string; url: string }[];
    };
    let listings: ListingRow[];
    let total: number;
    if (search) {
      const rankedRows = await prisma.$queryRaw<
        { id: string; rank: number }[]
      >(
        Prisma.sql`
          SELECT id, ts_rank("searchVector", websearch_to_tsquery('english', ${search})) AS rank
          FROM "Listing"
          WHERE "searchVector" @@ websearch_to_tsquery('english', ${search})
            AND status = 'ACTIVE'
            ${category ? Prisma.sql`AND lower(category) = lower(${category})` : Prisma.empty}
            ${brand ? Prisma.sql`AND lower(brand) = lower(${brand})` : Prisma.empty}
            ${condition ? Prisma.sql`AND condition = ${condition}::"Condition"` : Prisma.empty}
            ${sellerId ? Prisma.sql`AND "sellerId" = ${sellerId}` : Prisma.empty}
            ${minPrice !== undefined ? Prisma.sql`AND price >= ${minPrice}` : Prisma.empty}
            ${maxPrice !== undefined ? Prisma.sql`AND price <= ${maxPrice}` : Prisma.empty}
          ORDER BY rank DESC, "createdAt" DESC
          LIMIT ${limit} OFFSET ${skip}
        `,
      );
      const totalRow = await prisma.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM "Listing"
          WHERE "searchVector" @@ websearch_to_tsquery('english', ${search})
            AND status = 'ACTIVE'
            ${category ? Prisma.sql`AND lower(category) = lower(${category})` : Prisma.empty}
            ${brand ? Prisma.sql`AND lower(brand) = lower(${brand})` : Prisma.empty}
            ${condition ? Prisma.sql`AND condition = ${condition}::"Condition"` : Prisma.empty}
            ${sellerId ? Prisma.sql`AND "sellerId" = ${sellerId}` : Prisma.empty}
            ${minPrice !== undefined ? Prisma.sql`AND price >= ${minPrice}` : Prisma.empty}
            ${maxPrice !== undefined ? Prisma.sql`AND price <= ${maxPrice}` : Prisma.empty}
        `,
      );
      total = Number(totalRow[0]?.count ?? 0);

      const ids = rankedRows.map((r) => r.id);
      const rankById = new Map(rankedRows.map((r) => [r.id, r.rank]));
      listings = ids.length === 0
        ? []
        : (await prisma.listing.findMany({
            where: { id: { in: ids } },
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
                select: { id: true, url: true },
              },
            },
          })).sort((a, b) => (rankById.get(b.id) ?? 0) - (rankById.get(a.id) ?? 0));
    } else {
      // Non-search path: standard Prisma query, unchanged.
      [listings, total] = await Promise.all([
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
    }

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
    logger.error('listings.browse.failed', { err: String(err) });
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
    logger.error('listings.mine.failed', { err: String(err) });
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

    const { images, videos, ...listingData } = parsed.data;

    // MIME-verify each image URL via S3 HEAD before persisting. The
    // presigned-URL flow already constrains Content-Type at signature
    // time, but AWS doesn't actually inspect the bytes — a hostile
    // client could sign as image/jpeg and upload anything. Failing here
    // means: didn't actually upload, or uploaded a different file type
    // than declared. Either way, refuse the listing.
    if (images && images.length > 0) {
      for (const img of images) {
        const result = await verifyS3Upload(img.url, {
          allowedContentTypes: LISTING_IMAGE_TYPES,
        });
        if (!result.ok) {
          res.status(400).json({
            error:
              result.reason === 'not_found'
                ? 'Image upload not found. Please re-upload and try again.'
                : 'Image type does not match what was uploaded. Please re-upload as JPEG, PNG, or WebP.',
          });
          return;
        }
      }
    }

    // Same byte-level verification for videos. magic-byte mismatch on a
    // video most often means the user signed as `video/mp4` but PUT a
    // browser MOV/HEVC variant whose ftyp brand we don't accept.
    if (videos && videos.length > 0) {
      for (const vid of videos) {
        const result = await verifyS3Upload(vid.url, {
          allowedContentTypes: LISTING_VIDEO_TYPES,
          maxBytes: 100 * 1024 * 1024,
        });
        if (!result.ok) {
          res.status(400).json({
            error:
              result.reason === 'not_found'
                ? 'Video upload not found. Please re-upload and try again.'
                : result.reason === 'too_big'
                ? 'Video must be under 100 MB.'
                : 'Video type does not match what was uploaded. Please re-upload as MP4 or WebM.',
          });
          return;
        }
      }
    }

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
          videos: videos?.length
            ? {
                create: videos.map((vid) => ({
                  url: vid.url,
                  mimeType: vid.mimeType,
                  sizeBytes: vid.sizeBytes,
                  displayOrder: vid.displayOrder,
                })),
              }
            : undefined,
        },
        include: {
          images: { orderBy: { displayOrder: 'asc' } },
          videos: { orderBy: { displayOrder: 'asc' } },
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
    logger.error('listings.create.failed', { err: String(err) });
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

    const { images, videos, ...updateData } = parsed.data;

    // Verify any NEW image URLs (those not already on this listing). Old
    // URLs were verified at their original upload; re-checking them on
    // every save would double the latency for no security gain.
    if (images && images.length > 0) {
      const existingUrls = new Set(
        (
          await prisma.listingImage.findMany({
            where: { listingId: id },
            select: { url: true },
          })
        ).map((r) => r.url),
      );
      for (const img of images) {
        if (existingUrls.has(img.url)) continue;
        const verifyResult = await verifyS3Upload(img.url, {
          allowedContentTypes: LISTING_IMAGE_TYPES,
        });
        if (!verifyResult.ok) {
          res.status(400).json({
            error:
              verifyResult.reason === 'not_found'
                ? 'Image upload not found. Please re-upload and try again.'
                : 'Image type does not match what was uploaded. Please re-upload as JPEG, PNG, or WebP.',
          });
          return;
        }
      }
    }

    // Same skip-if-existing approach for videos: we don't re-HEAD a URL
    // that's already on this listing, only newly-introduced ones.
    if (videos && videos.length > 0) {
      const existingVideoUrls = new Set(
        (
          await prisma.listingVideo.findMany({
            where: { listingId: id },
            select: { url: true },
          })
        ).map((r) => r.url),
      );
      for (const vid of videos) {
        if (existingVideoUrls.has(vid.url)) continue;
        const verifyResult = await verifyS3Upload(vid.url, {
          allowedContentTypes: LISTING_VIDEO_TYPES,
          maxBytes: 100 * 1024 * 1024,
        });
        if (!verifyResult.ok) {
          res.status(400).json({
            error:
              verifyResult.reason === 'not_found'
                ? 'Video upload not found. Please re-upload and try again.'
                : verifyResult.reason === 'too_big'
                ? 'Video must be under 100 MB.'
                : 'Video type does not match what was uploaded. Please re-upload as MP4 or WebM.',
          });
          return;
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Re-verify ownership + status inside transaction to prevent TOCTOU race
      const current = await tx.listing.findUnique({
        where: { id },
        select: { status: true, sellerId: true },
      });
      if (current?.status !== 'ACTIVE' || current.sellerId !== req.userId) return null;

      // Captured outbox ids for outside-tx enqueue (LISTING_UPSERT and
      // optionally an IMAGE_DELETE for any orphaned Square images).
      let imageDeleteOutboxId: string | null = null;

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
          // Pull squareImageId so we can enqueue an IMAGE_DELETE outbox
          // row for any rows that are about to be removed — otherwise
          // those Square CatalogImage objects orphan and count against
          // the seller's catalog quota forever.
          select: { id: true, url: true, squareImageId: true },
        });
        const desiredUrls = new Set(images.map((img) => img.url));
        const toDelete = currentRows.filter((r) => !desiredUrls.has(r.url));
        if (toDelete.length > 0) {
          await tx.listingImage.deleteMany({
            where: { id: { in: toDelete.map((r) => r.id) } },
          });
          const orphanedSquareIds = toDelete
            .map((r) => r.squareImageId)
            .filter((x): x is string => Boolean(x));
          if (orphanedSquareIds.length > 0) {
            imageDeleteOutboxId = await createOutboxRow({
              tx,
              listingId: id,
              sellerId: req.userId!,
              kind: 'IMAGE_DELETE',
              payload: {
                kind: 'IMAGE_DELETE',
                squareImageIds: orphanedSquareIds,
              },
            });
          }
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

      // Same four-phase reconcile for videos. With max=1 the two
      // intermediate phases are no-ops, but mirroring the image flow
      // means we don't have to revisit this if/when we raise the cap.
      // Note: no IMAGE_DELETE-equivalent outbox row — videos aren't
      // synced to Square Catalog, so removing one only deletes a DB row
      // (the S3 object stays, same as images today).
      if (videos !== undefined) {
        const currentVideoRows = await tx.listingVideo.findMany({
          where: { listingId: id },
          select: { id: true, url: true },
        });
        const desiredVideoUrls = new Set(videos.map((v) => v.url));
        const videosToDelete = currentVideoRows.filter(
          (r) => !desiredVideoUrls.has(r.url),
        );
        if (videosToDelete.length > 0) {
          await tx.listingVideo.deleteMany({
            where: { id: { in: videosToDelete.map((r) => r.id) } },
          });
        }

        const videoSurvivorByUrl = new Map(
          currentVideoRows
            .filter((r) => desiredVideoUrls.has(r.url))
            .map((r) => [r.url, r.id] as const),
        );

        let tempVideoOrder = 1000;
        for (const rowId of videoSurvivorByUrl.values()) {
          await tx.listingVideo.update({
            where: { id: rowId },
            data: { displayOrder: tempVideoOrder++ },
          });
        }

        for (const vid of videos) {
          if (!videoSurvivorByUrl.has(vid.url)) {
            const created = await tx.listingVideo.create({
              data: {
                listingId: id,
                url: vid.url,
                mimeType: vid.mimeType,
                sizeBytes: vid.sizeBytes,
                displayOrder: tempVideoOrder++,
              },
              select: { id: true, url: true },
            });
            videoSurvivorByUrl.set(created.url, created.id);
          }
        }

        for (const vid of videos) {
          const rowId = videoSurvivorByUrl.get(vid.url);
          if (rowId) {
            await tx.listingVideo.update({
              where: { id: rowId },
              data: { displayOrder: vid.displayOrder },
            });
          }
        }
      }

      const updated = await tx.listing.update({
        where: { id },
        data: updateData,
        include: {
          images: { orderBy: { displayOrder: 'asc' } },
          videos: { orderBy: { displayOrder: 'asc' } },
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
      return { listing: updated, outboxId: oid, imageDeleteOutboxId };
    });

    if (!result) {
      res.status(409).json({ error: 'Listing is no longer available for editing' });
      return;
    }

    if (result.outboxId) {
      void enqueueOutbox(result.outboxId);
    }
    if (result.imageDeleteOutboxId) {
      void enqueueOutbox(result.imageDeleteOutboxId);
    }

    res.json({
      listing: { ...result.listing, seller: projectPublicSeller(result.listing.seller) },
    });
  } catch (err) {
    logger.error('listings.update.failed', { err: String(err) });
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
        return {
          removed: false,
          outboxId: null as string | null,
          imageDeleteOutboxId: null as string | null,
        };
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

      // Square's batchDelete cascades Item→Variation but NOT Item→
      // CatalogImage (images are independent objects referenced by id).
      // So when we soft-delete a listing, capture every CatalogImage id
      // we ever uploaded for it and queue an IMAGE_DELETE so the
      // seller's catalog quota doesn't accumulate orphans.
      const orphanedSquareIds = updated.images
        .map((img) => img.squareImageId)
        .filter((x): x is string => Boolean(x));
      let imageDeleteOutboxId: string | null = null;
      if (orphanedSquareIds.length > 0) {
        imageDeleteOutboxId = await createOutboxRow({
          tx,
          listingId: id,
          sellerId: req.userId!,
          kind: 'IMAGE_DELETE',
          payload: {
            kind: 'IMAGE_DELETE',
            squareImageIds: orphanedSquareIds,
          },
        });
      }

      return { removed: true, outboxId: oid, imageDeleteOutboxId };
    });

    if (!result.removed) {
      res.status(409).json({ error: 'Listing status changed. Please refresh and try again.' });
      return;
    }

    if (result.outboxId) {
      void enqueueOutbox(result.outboxId);
    }
    if (result.imageDeleteOutboxId) {
      void enqueueOutbox(result.imageDeleteOutboxId);
    }

    res.json({ message: 'Listing removed successfully' });
  } catch (err) {
    logger.error('listings.delete.failed', { err: String(err) });
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
        videos: {
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true,
            url: true,
            mimeType: true,
            sizeBytes: true,
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
    logger.error('listings.get.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
