import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { listingQuerySchema, createListingSchemaForUser, updateListingSchemaForUser, paginationSchema } from '../schemas/listings.js';
import { uuidSchema } from '../schemas/common.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const createListingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many listings created, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/listings — Browse listings with filters, search, sort, pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const parsed = listingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { category, brand, condition, minPrice, maxPrice, search, sort, page, limit } = parsed.data;

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
          category: true,
          brand: true,
          condition: true,
          status: true,
          createdAt: true,
          seller: {
            select: {
              id: true,
              username: true,
              location: true,
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
      listings,
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

// GET /api/listings/my — Current user's listings (all statuses)
router.get('/my', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = { sellerId: req.userId! };

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          price: true,
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
    ]);

    res.json({
      listings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('My listings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/listings — Create a new listing
router.post('/', authenticate, createListingLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = createListingSchemaForUser(req.userId!).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { images, ...listingData } = parsed.data;

    const listing = await prisma.listing.create({
      data: {
        ...listingData,
        sellerId: req.userId!,
        images: images?.length
          ? { create: images.map((img) => ({ url: img.url, displayOrder: img.displayOrder })) }
          : undefined,
      },
      include: {
        images: { orderBy: { displayOrder: 'asc' } },
        seller: { select: { id: true, username: true, location: true } },
      },
    });

    res.status(201).json({ listing });
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

    const listing = await prisma.$transaction(async (tx) => {
      // Re-verify ownership + status inside transaction to prevent TOCTOU race
      const current = await tx.listing.findUnique({
        where: { id },
        select: { status: true, sellerId: true },
      });
      if (current?.status !== 'ACTIVE' || current.sellerId !== req.userId) return null;

      if (images !== undefined) {
        await tx.listingImage.deleteMany({ where: { listingId: id } });
        if (images.length > 0) {
          await tx.listingImage.createMany({
            data: images.map((img) => ({ listingId: id, url: img.url, displayOrder: img.displayOrder })),
          });
        }
      }

      return tx.listing.update({
        where: { id },
        data: updateData,
        include: {
          images: { orderBy: { displayOrder: 'asc' } },
          seller: { select: { id: true, username: true, location: true } },
        },
      });
    });

    if (!listing) {
      res.status(409).json({ error: 'Listing is no longer available for editing' });
      return;
    }

    res.json({ listing });
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

    const removed = await prisma.$transaction(async (tx) => {
      // Re-verify ownership + status inside transaction to prevent TOCTOU race
      const current = await tx.listing.findUnique({
        where: { id },
        select: { status: true, sellerId: true },
      });
      if (current?.status !== 'ACTIVE' || current.sellerId !== req.userId) return false;

      await tx.listing.update({
        where: { id },
        data: { status: 'REMOVED' },
      });
      return true;
    });

    if (!removed) {
      res.status(409).json({ error: 'Listing status changed. Please refresh and try again.' });
      return;
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
            location: true,
            createdAt: true,
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

    // Compute seller's avg rating and total completed sales
    const [ratingResult, totalSales] = await Promise.all([
      prisma.review.aggregate({
        where: { sellerId: listing.seller.id },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      prisma.order.count({
        where: { sellerId: listing.seller.id, status: 'COMPLETED' },
      }),
    ]);

    res.json({
      listing: {
        ...listing,
        seller: {
          ...listing.seller,
          avgRating: ratingResult._avg.rating,
          totalReviews: ratingResult._count.rating,
          totalSales,
        },
      },
    });
  } catch (err) {
    console.error('Get listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
