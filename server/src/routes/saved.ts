import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { uuidSchema } from '../schemas/common.js';
import { paginationSchema } from '../schemas/listings.js';
import { authenticate } from '../middleware/auth.js';
import { PUBLIC_LOCATION_SELECT, projectPublicSeller } from '../services/publicLocation.js';

const router = Router();

// GET /api/saved — Get current user's saved listings
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.SavedListingWhereInput = {
      userId: req.userId!,
      listing: { status: 'ACTIVE' },
    };

    const [items, total] = await Promise.all([
      prisma.savedListing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          listing: {
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
                  ...PUBLIC_LOCATION_SELECT,
                },
              },
              images: {
                orderBy: { displayOrder: 'asc' },
                take: 1,
                select: { id: true, url: true },
              },
            },
          },
        },
      }),
      prisma.savedListing.count({ where }),
    ]);

    const listings = items.map((item) => ({
      ...item.listing,
      seller: projectPublicSeller(item.listing.seller),
      savedAt: item.createdAt,
    }));

    res.json({
      listings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Get saved listings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/saved/ids — Get just the IDs of saved listings (for heart state)
router.get('/ids', authenticate, async (req: Request, res: Response) => {
  try {
    const saved = await prisma.savedListing.findMany({
      where: { userId: req.userId! },
      select: { listingId: true },
    });
    res.json({ ids: saved.map((s) => s.listingId) });
  } catch (err) {
    console.error('Get saved IDs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/saved/:listingId — Save a listing
router.post('/:listingId', authenticate, async (req: Request<{ listingId: string }>, res: Response) => {
  try {
    const { listingId } = req.params;
    if (!uuidSchema.safeParse(listingId).success) {
      res.status(400).json({ error: 'Invalid listing ID' });
      return;
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true },
    });

    if (!listing || listing.status === 'REMOVED') {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }

    if (listing.sellerId === req.userId) {
      res.status(400).json({ error: 'You cannot save your own listing' });
      return;
    }

    await prisma.savedListing.create({
      data: { userId: req.userId!, listingId },
    });

    res.status(201).json({ message: 'Listing saved' });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.json({ message: 'Listing already saved' });
      return;
    }
    console.error('Save listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/saved/:listingId — Unsave a listing
router.delete('/:listingId', authenticate, async (req: Request<{ listingId: string }>, res: Response) => {
  try {
    const { listingId } = req.params;
    if (!uuidSchema.safeParse(listingId).success) {
      res.status(400).json({ error: 'Invalid listing ID' });
      return;
    }

    await prisma.savedListing.deleteMany({
      where: { userId: req.userId!, listingId },
    });

    res.json({ message: 'Listing unsaved' });
  } catch (err) {
    console.error('Unsave listing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
