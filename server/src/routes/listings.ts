import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { listingQuerySchema } from '../schemas/listings.js';

const router = Router();

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
    const where: Record<string, unknown> = {
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
      where.title = { contains: search, mode: 'insensitive' };
    }

    // Build sort order
    let orderBy: Record<string, string>;
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

// GET /api/listings/:id — Single listing with seller info
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;

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

    if (!listing) {
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
