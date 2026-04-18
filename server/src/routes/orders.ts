import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many checkout attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Thrown inside the checkout transaction to force rollback on a lost race.
class CheckoutConflict extends Error {}

// POST /api/orders/checkout
// Converts the user's cart into one PENDING_CONFIRMATION order per listing.
// Atomically flips ACTIVE → ON_HOLD inside the tx so concurrent checkouts of the
// same listing cannot both succeed (loser sees count mismatch and rolls back).
router.post('/checkout', authenticate, checkoutLimiter, async (req: Request, res: Response) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.userId! },
      select: {
        id: true,
        items: {
          orderBy: { createdAt: 'desc' },
          select: {
            listingId: true,
            listing: {
              select: { id: true, title: true, status: true, sellerId: true },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      res.status(400).json({ error: 'Your cart is empty' });
      return;
    }

    // Friendly pre-checks — surface known-bad state before paying the cost of a tx.
    const unavailable = cart.items.find((i) => i.listing.status !== 'ACTIVE');
    if (unavailable) {
      res.status(409).json({
        error: `"${unavailable.listing.title}" is no longer available. Please remove it from your cart.`,
        listingId: unavailable.listingId,
      });
      return;
    }
    const ownListing = cart.items.find((i) => i.listing.sellerId === req.userId);
    if (ownListing) {
      res.status(400).json({
        error: 'You cannot buy your own listing',
        listingId: ownListing.listingId,
      });
      return;
    }

    const listingIds = cart.items.map((i) => i.listingId);

    try {
      const orders = await prisma.$transaction(
        async (tx) => {
          // Atomic claim: the status='ACTIVE' guard ensures that if any listing has
          // already been claimed by another checkout, count < listingIds.length and
          // we throw to roll back.
          const { count } = await tx.listing.updateMany({
            where: { id: { in: listingIds }, status: 'ACTIVE' },
            data: { status: 'ON_HOLD' },
          });
          if (count !== listingIds.length) {
            throw new CheckoutConflict();
          }

          const locked = await tx.listing.findMany({
            where: { id: { in: listingIds } },
            select: { id: true, price: true, sellerId: true },
          });
          const lockedById = new Map(locked.map((l) => [l.id, l]));

          // Iterate cart.items (ordered by createdAt desc) so output matches GET order.
          const created = [];
          for (const item of cart.items) {
            const l = lockedById.get(item.listingId)!;
            const order = await tx.order.create({
              data: {
                listingId: l.id,
                buyerId: req.userId!,
                sellerId: l.sellerId,
                amount: l.price,
                status: 'PENDING_CONFIRMATION',
              },
              select: {
                id: true,
                amount: true,
                status: true,
                createdAt: true,
                listing: {
                  select: {
                    id: true,
                    title: true,
                    images: {
                      orderBy: { displayOrder: 'asc' },
                      take: 1,
                      select: { id: true, url: true },
                    },
                  },
                },
                seller: { select: { id: true, username: true, location: true } },
              },
            });
            created.push(order);
          }

          await tx.cartItem.deleteMany({
            where: { cartId: cart.id, listingId: { in: listingIds } },
          });

          return created;
        },
        { timeout: 15000 },
      );

      res.status(201).json({ orders });
    } catch (err) {
      if (err instanceof CheckoutConflict) {
        // Tx rolled back — safe to re-read to identify the blocking listing.
        const blocker = await prisma.listing.findFirst({
          where: { id: { in: listingIds }, status: { not: 'ACTIVE' } },
          select: { id: true, title: true },
        });
        res.status(409).json({
          error: blocker
            ? `"${blocker.title}" is no longer available. Please remove it from your cart.`
            : 'One or more listings are no longer available',
          ...(blocker && { listingId: blocker.id }),
        });
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
