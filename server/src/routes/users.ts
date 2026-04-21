import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { uuidSchema } from '../schemas/common.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/users/:id — public seller profile
// Returns only fields safe for public display. Email, phone, role,
// verification status, idDocumentUrl, etc. are deliberately excluded.
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        bio: true,
        location: true,
        sellerType: true,
        businessName: true,
        createdAt: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [ratingResult, totalSales] = await Promise.all([
      prisma.review.aggregate({
        where: { sellerId: id },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      prisma.order.count({
        where: { sellerId: id, status: 'COMPLETED' },
      }),
    ]);

    res.json({
      user: {
        ...user,
        avgRating: ratingResult._avg.rating,
        totalReviews: ratingResult._count.rating,
        totalSales,
      },
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
