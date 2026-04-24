import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { uuidSchema } from '../schemas/common.js';
import { addCartItemSchema } from '../schemas/cart.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const cartWriteLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many cart changes, please try again later' },
});

const CART_ITEM_SELECT = {
  id: true,
  createdAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      price: true,
      category: true,
      brand: true,
      condition: true,
      status: true,
      seller: {
        select: { id: true, username: true, location: true },
      },
      images: {
        orderBy: { displayOrder: 'asc' },
        take: 1,
        select: { id: true, url: true },
      },
    },
  },
} satisfies Prisma.CartItemSelect;

const EMPTY_CART_RESPONSE = {
  cart: { items: [], subtotal: '0.00', itemCount: 0, checkoutableCount: 0 },
};

// GET /api/cart — Current user's cart with items, subtotal, and counts.
// Purge REMOVED cart items as cleanup; the where-filter below is the authoritative
// guarantee that REMOVED never reaches the response, so purge failure is non-fatal.
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    try {
      await prisma.cartItem.deleteMany({
        where: {
          cart: { userId: req.userId! },
          listing: { status: 'REMOVED' },
        },
      });
    } catch (purgeErr) {
      console.error('Cart REMOVED purge failed (non-fatal):', purgeErr);
    }

    const cart = await prisma.cart.findUnique({
      where: { userId: req.userId! },
      select: {
        items: {
          orderBy: { createdAt: 'desc' },
          where: { listing: { status: { not: 'REMOVED' } } },
          select: CART_ITEM_SELECT,
        },
      },
    });

    if (!cart) {
      res.json(EMPTY_CART_RESPONSE);
      return;
    }

    const checkoutable = cart.items.filter((item) => item.listing.status === 'ACTIVE');
    const subtotal = checkoutable.reduce(
      (sum, item) => sum.add(item.listing.price),
      new Prisma.Decimal(0),
    );

    res.json({
      cart: {
        items: cart.items,
        subtotal: subtotal.toFixed(2),
        itemCount: cart.items.length,
        checkoutableCount: checkoutable.length,
      },
    });
  } catch (err) {
    console.error('Get cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cart/items — Add a listing to the cart
router.post('/items', authenticate, cartWriteLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = addCartItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { listingId } = parsed.data;

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true },
    });

    if (!listing || listing.status === 'REMOVED') {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }

    if (listing.sellerId === req.userId) {
      res.status(400).json({ error: 'You cannot add your own listing to cart' });
      return;
    }

    if (listing.status !== 'ACTIVE') {
      res.status(400).json({ error: 'This listing is no longer available' });
      return;
    }

    const cart = await prisma.cart.upsert({
      where: { userId: req.userId! },
      update: {},
      create: { userId: req.userId! },
      select: { id: true },
    });

    try {
      await prisma.cartItem.create({
        data: { cartId: cart.id, listingId },
      });
      res.status(201).json({ message: 'Added to cart' });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.json({ message: 'Already in cart' });
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error('Add cart item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cart/items/:listingId — Remove a listing from the cart
router.delete(
  '/items/:listingId',
  authenticate,
  cartWriteLimiter,
  async (req: Request<{ listingId: string }>, res: Response) => {
    try {
      const { listingId } = req.params;
      if (!uuidSchema.safeParse(listingId).success) {
        res.status(400).json({ error: 'Invalid listing ID' });
        return;
      }

      const cart = await prisma.cart.findUnique({
        where: { userId: req.userId! },
        select: { id: true },
      });

      if (cart) {
        await prisma.cartItem.deleteMany({
          where: { cartId: cart.id, listingId },
        });
      }

      res.json({ message: 'Removed from cart' });
    } catch (err) {
      console.error('Remove cart item error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
