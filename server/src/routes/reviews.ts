import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { authenticate } from '../middleware/auth.js';
import { uuidSchema } from '../schemas/common.js';
import {
  createReviewSchema,
  sellerReviewQuerySchema,
} from '../schemas/reviews.js';

const router = Router();

const reviewWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many reviews submitted, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const REVIEW_SELECT = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
  reviewer: { select: { id: true, username: true } },
  seller: { select: { id: true, username: true } },
} satisfies Prisma.ReviewSelect;

// ---------------------------------------------------------------------------
// POST /api/reviews — buyer leaves a review on a completed order
// One review per order (enforced by @unique on Review.orderId).
// ---------------------------------------------------------------------------
router.post('/', authenticate, reviewWriteLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = createReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { orderId, rating, comment } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        buyerId: true,
        sellerId: true,
        status: true,
        review: { select: { id: true } },
      },
    });

    // 404 on non-existent OR non-participant (hide existence from probers).
    if (!order || (order.buyerId !== req.userId && order.sellerId !== req.userId)) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.buyerId !== req.userId) {
      res.status(403).json({ error: 'Only the buyer can review this order' });
      return;
    }
    if (order.status !== 'COMPLETED') {
      res.status(409).json({
        error: 'You can only review an order after it is completed',
      });
      return;
    }
    if (order.review) {
      res.status(409).json({ error: 'You have already reviewed this order' });
      return;
    }

    try {
      const review = await prisma.review.create({
        data: {
          orderId,
          reviewerId: req.userId!,
          sellerId: order.sellerId,
          rating,
          comment: comment ?? null,
        },
        select: REVIEW_SELECT,
      });
      res.status(201).json({ review });
    } catch (err) {
      // Race: concurrent create against the unique(orderId) — return the
      // idempotent 409 the first branch would have returned.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(409).json({ error: 'You have already reviewed this order' });
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reviews/seller/:id — paginated reviews for a seller
// Returns avg rating, total count, and a 1..5 star breakdown so the profile
// page can render a distribution bar without a second round trip.
// ---------------------------------------------------------------------------
router.get('/seller/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid seller ID' });
      return;
    }

    const parsed = sellerReviewQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const [reviews, aggregate, breakdownRows] = await Promise.all([
      prisma.review.findMany({
        where: { sellerId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: REVIEW_SELECT,
      }),
      prisma.review.aggregate({
        where: { sellerId: id },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      prisma.review.groupBy({
        by: ['rating'],
        where: { sellerId: id },
        _count: { rating: true },
      }),
    ]);

    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    for (const row of breakdownRows) {
      if (row.rating >= 1 && row.rating <= 5) {
        breakdown[row.rating as 1 | 2 | 3 | 4 | 5] = row._count.rating;
      }
    }

    const total = aggregate._count.rating;
    res.json({
      reviews,
      avgRating: aggregate._avg.rating,
      totalReviews: total,
      breakdown,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Seller reviews error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
