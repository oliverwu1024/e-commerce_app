import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import {
  OrdersController,
  CheckoutPaymentIntent,
} from '@paypal/paypal-server-sdk';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { authenticate } from '../middleware/auth.js';
import { uuidSchema } from '../schemas/common.js';
import {
  completeOrderSchema,
  messageSchema,
  orderListQuerySchema,
  paySchema,
  paypalCaptureSchema,
  shipSchema,
} from '../schemas/orders.js';
import {
  getStripeClient,
  isStripeConfigured,
} from '../config/stripe.js';
import {
  getSquareClient,
  getSquareLocationId,
  isSquareConfigured,
} from '../config/square.js';
import {
  getPaypalClient,
  isPaypalConfigured,
} from '../config/paypal.js';
import { markOrderPaid } from '../services/orderPayments.js';
import { createNotification } from '../services/notifications.js';
import { sendOrderPlacedEmail, sendNewMessageEmail } from '../utils/email.js';

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many checkout attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const orderMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many order updates, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const messagingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many messages, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Thrown inside the checkout transaction to force rollback on a lost race.
class CheckoutConflict extends Error {}

const ORDER_SUMMARY_SELECT = {
  id: true,
  amount: true,
  status: true,
  paymentMethod: true,
  // Exposed so the Purchases tab can surface the "Release payment lock"
  // escape hatch when a provider tab was closed without cancelling.
  paymentSessionState: true,
  trackingNumber: true,
  shippedAt: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      status: true,
      images: {
        orderBy: { displayOrder: 'asc' },
        take: 1,
        select: { id: true, url: true },
      },
    },
  },
  buyer: { select: { id: true, username: true, location: true, avatarUrl: true } },
  seller: {
    select: { id: true, username: true, location: true, avatarUrl: true, sellerType: true },
  },
  review: { select: { id: true, rating: true } },
} satisfies Prisma.OrderSelect;

const MESSAGE_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  sender: { select: { id: true, username: true, avatarUrl: true } },
} satisfies Prisma.MessageSelect;

// ---------------------------------------------------------------------------
// POST /api/orders/checkout
// Converts the user's cart into one PENDING_CONFIRMATION order per listing.
// Atomically flips ACTIVE → ON_HOLD inside the tx so concurrent checkouts of the
// same listing cannot both succeed (loser sees count mismatch and rolls back).
// ---------------------------------------------------------------------------
router.post('/checkout', authenticate, checkoutLimiter, async (req: Request, res: Response) => {
  try {
    // Require a verified email before the buyer can commit to orders. A
    // working inbox is the minimum recovery path for order updates / dispute
    // correspondence, and keeps pure-bot accounts from creating orders.
    // Sellers are already gated harder (email + phone + ID/ABN) at listing
    // creation.
    const buyer = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { emailVerified: true },
    });
    if (!buyer) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (!buyer.emailVerified) {
      res.status(403).json({
        error: 'Please verify your email before checking out.',
        reason: 'email_unverified',
      });
      return;
    }

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
              select: ORDER_SUMMARY_SELECT,
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

      // Notify each seller + email them so they can confirm. Fire-and-log:
      // notification/email failure mustn't rollback the checkout.
      for (const order of orders) {
        void createNotification({
          recipientId: order.seller.id,
          type: 'ORDER_PLACED',
          title: 'New order',
          body: `${order.buyer.username} wants to buy "${order.listing.title}"`,
          actorId: order.buyer.id,
          orderId: order.id,
          listingId: order.listing.id,
        });
      }
      // Pull seller emails in one query so we can fire emails outside the
      // tx without N round-trips.
      const sellerIds = Array.from(new Set(orders.map((o) => o.seller.id)));
      prisma.user
        .findMany({
          where: { id: { in: sellerIds } },
          select: { id: true, email: true, username: true },
        })
        .then((sellers) => {
          const byId = new Map(sellers.map((s) => [s.id, s]));
          for (const order of orders) {
            const seller = byId.get(order.seller.id);
            if (!seller) continue;
            sendOrderPlacedEmail(
              seller.email,
              seller.username,
              order.listing.title,
              order.buyer.username,
              order.id,
            ).catch((err) => {
              console.error('Failed to send order-placed email:', err);
            });
          }
        })
        .catch((err) => {
          console.error('Failed to fetch seller emails for notifications:', err);
        });

      res.status(201).json({ orders });
    } catch (err) {
      if (err instanceof CheckoutConflict) {
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

// ---------------------------------------------------------------------------
// Shared list handler for /sales + /purchases.
// ---------------------------------------------------------------------------
async function listOrders(
  req: Request,
  res: Response,
  role: 'buyer' | 'seller',
): Promise<void> {
  try {
    const parsed = orderListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit, status, bucket } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput =
      role === 'seller' ? { sellerId: req.userId! } : { buyerId: req.userId! };
    if (status) {
      where.status = status;
    } else if (bucket === 'in_progress') {
      where.status = {
        in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'PAID', 'SHIPPED'],
      };
    } else if (bucket === 'past') {
      where.status = { in: ['COMPLETED', 'CANCELLED'] };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: ORDER_SUMMARY_SELECT,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error(`List ${role} orders error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/orders/sales — orders where the current user is the seller
router.get('/sales', authenticate, (req, res) => listOrders(req, res, 'seller'));

// GET /api/orders/purchases — orders where the current user is the buyer
router.get('/purchases', authenticate, (req, res) => listOrders(req, res, 'buyer'));

// ---------------------------------------------------------------------------
// Messaging — keep above /:id so the /messages path segment isn't eaten.
// ---------------------------------------------------------------------------

// GET /api/orders/:id/messages — message thread (buyer/seller only)
router.get(
  '/:id/messages',
  authenticate,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id },
        select: { buyerId: true, sellerId: true },
      });

      // 404 on non-participants — order IDs are UUIDs and shouldn't be probed.
      if (!order || (order.buyerId !== req.userId && order.sellerId !== req.userId)) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const messages = await prisma.message.findMany({
        where: { orderId: id },
        orderBy: { createdAt: 'asc' },
        select: MESSAGE_SELECT,
      });

      // Mark all messages where THIS user is the receiver as read. Drives
      // the Navbar envelope badge + per-thread unread count in the inbox.
      void prisma.message
        .updateMany({
          where: { orderId: id, receiverId: req.userId!, readAt: null },
          data: { readAt: new Date() },
        })
        .catch((err) => {
          console.error('Failed to mark messages read:', err);
        });

      res.json({ messages });
    } catch (err) {
      console.error('Get messages error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/orders/:id/messages — send a message on an order
router.post(
  '/:id/messages',
  authenticate,
  messagingLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id },
        select: { buyerId: true, sellerId: true },
      });

      if (!order || (order.buyerId !== req.userId && order.sellerId !== req.userId)) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const receiverId = order.buyerId === req.userId ? order.sellerId : order.buyerId;

      const message = await prisma.message.create({
        data: {
          orderId: id,
          senderId: req.userId!,
          receiverId,
          content: parsed.data.content,
        },
        select: MESSAGE_SELECT,
      });

      // Notification + email for the receiver. One round-trip for the
      // receiver identity + listing title, then fire-and-log both.
      void (async () => {
        try {
          const [receiver, orderDetail] = await Promise.all([
            prisma.user.findUnique({
              where: { id: receiverId },
              select: { email: true, username: true },
            }),
            prisma.order.findUnique({
              where: { id },
              select: {
                listing: { select: { id: true, title: true } },
                buyerId: true,
              },
            }),
          ]);
          if (!receiver || !orderDetail) return;

          void createNotification({
            recipientId: receiverId,
            type: 'NEW_MESSAGE',
            title: 'New message',
            body: `${message.sender.username}: ${
              message.content.length > 100
                ? message.content.slice(0, 100) + '…'
                : message.content
            }`,
            actorId: req.userId,
            orderId: id,
            listingId: orderDetail.listing.id,
          });

          const receiverRole = orderDetail.buyerId === receiverId ? 'buyer' : 'seller';
          await sendNewMessageEmail(
            receiver.email,
            receiver.username,
            message.sender.username,
            orderDetail.listing.title,
            message.content,
            id,
            receiverRole,
          );
        } catch (err) {
          console.error('Failed to notify/email receiver of message:', err);
        }
      })();

      res.status(201).json({ message });
    } catch (err) {
      console.error('Send message error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/orders/:id/confirm — seller accepts a pending order
// ---------------------------------------------------------------------------
router.put(
  '/:id/confirm',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const existing = await prisma.order.findUnique({
        where: { id },
        select: { sellerId: true, buyerId: true, status: true },
      });

      if (!existing) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (existing.sellerId !== req.userId) {
        res.status(403).json({ error: 'Only the seller can confirm this order' });
        return;
      }
      if (existing.status !== 'PENDING_CONFIRMATION') {
        res.status(409).json({
          error: `Cannot confirm an order in ${existing.status} state`,
        });
        return;
      }

      // Atomic guard against concurrent cancel/confirm.
      const { count } = await prisma.order.updateMany({
        where: { id, status: 'PENDING_CONFIRMATION', sellerId: req.userId },
        data: { status: 'CONFIRMED' },
      });
      if (count === 0) {
        res.status(409).json({
          error: 'Order status changed; please refresh and try again',
        });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id },
        select: ORDER_SUMMARY_SELECT,
      });
      if (updated) {
        void createNotification({
          recipientId: updated.buyer.id,
          type: 'ORDER_CONFIRMED',
          title: 'Order confirmed',
          body: `${updated.seller.username} confirmed your order for "${updated.listing.title}"`,
          actorId: updated.seller.id,
          orderId: updated.id,
          listingId: updated.listing.id,
        });
      }
      res.json({ order: updated });
    } catch (err) {
      console.error('Confirm order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/orders/:id/cancel — buyer or seller cancels a pending/confirmed order
// Restores the listing to ACTIVE only if it's still ON_HOLD (guards against a
// race where the listing has moved to SOLD via a concurrent /complete, or to
// REMOVED via a seller cleanup).
// ---------------------------------------------------------------------------
router.put(
  '/:id/cancel',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const existing = await prisma.order.findUnique({
        where: { id },
        select: {
          buyerId: true,
          sellerId: true,
          status: true,
          listingId: true,
          paymentSessionState: true,
        },
      });

      if (!existing) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (existing.buyerId !== req.userId && existing.sellerId !== req.userId) {
        res.status(403).json({ error: 'You cannot cancel this order' });
        return;
      }
      if (existing.status !== 'PENDING_CONFIRMATION' && existing.status !== 'CONFIRMED') {
        res.status(409).json({
          error: `Cannot cancel an order in ${existing.status} state`,
        });
        return;
      }

      // Refuse cancel during an active online payment. Without this, the
      // seller could cancel between the buyer's Stripe approval and the
      // webhook arrival — the provider captures the charge, our order shows
      // CANCELLED, and money is stranded at the provider with no UI path to
      // reconciliation.
      if (existing.paymentSessionState === 'PENDING') {
        res.status(409).json({
          error:
            'Payment is in progress. Please wait a few minutes for it to finish, or contact support if it has been longer than 30 minutes.',
        });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: {
            id,
            status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
            // Re-check inside the tx to catch the race where /pay flipped
            // us to PENDING between the pre-read and here.
            paymentSessionState: { not: 'PENDING' },
          },
          data: { status: 'CANCELLED' },
        });
        if (count === 0) return { ok: false as const };

        await tx.listing.updateMany({
          where: { id: existing.listingId, status: 'ON_HOLD' },
          data: { status: 'ACTIVE' },
        });

        return { ok: true as const };
      });

      if (!result.ok) {
        res.status(409).json({
          error: 'Order status changed; please refresh and try again',
        });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id },
        select: ORDER_SUMMARY_SELECT,
      });
      if (updated) {
        // Notify the other party — the canceller already knows.
        const cancelledByBuyer = existing.buyerId === req.userId;
        const recipientId = cancelledByBuyer ? updated.seller.id : updated.buyer.id;
        const cancellerName = cancelledByBuyer
          ? updated.buyer.username
          : updated.seller.username;
        void createNotification({
          recipientId,
          type: 'ORDER_CANCELLED',
          title: 'Order cancelled',
          body: `${cancellerName} cancelled the order for "${updated.listing.title}"`,
          actorId: req.userId,
          orderId: updated.id,
          listingId: updated.listing.id,
        });
      }
      res.json({ order: updated });
    } catch (err) {
      console.error('Cancel order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/orders/:id/complete — seller marks a confirmed order as completed
// Day 16(a): CASH and BANK_TRANSFER only. Online payment methods (Stripe/
// Square/PayPal) are added in Day 16(b) once sandbox accounts are set up.
// Listing moves ON_HOLD → SOLD atomically.
// ---------------------------------------------------------------------------
router.put(
  '/:id/complete',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const parsed = completeOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }
      const { paymentMethod } = parsed.data;

      const existing = await prisma.order.findUnique({
        where: { id },
        select: {
          sellerId: true,
          status: true,
          listingId: true,
          paymentSessionState: true,
        },
      });

      if (!existing) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (existing.sellerId !== req.userId) {
        res.status(403).json({ error: 'Only the seller can complete this order' });
        return;
      }
      if (existing.status !== 'CONFIRMED') {
        res.status(409).json({
          error: 'Order must be confirmed before it can be completed',
        });
        return;
      }

      // Symmetric to the /cancel guard: refuse manual CASH / BANK_TRANSFER
      // mark-paid while a buyer's online payment session is live. Without
      // this, seller can flip PAID while Stripe is still capturing and the
      // buyer ends up paying both CASH and the provider (the webhook's
      // already_completed no-op hides the double-charge).
      if (existing.paymentSessionState === 'PENDING') {
        res.status(409).json({
          error:
            'Payment is in progress. Please wait a few minutes for it to finish, or contact support if it has been longer than 30 minutes.',
        });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: {
            id,
            status: 'CONFIRMED',
            sellerId: req.userId,
            // Defence-in-depth: if /pay races in between the pre-read above
            // and this updateMany, count goes to 0 and we return 409.
            paymentSessionState: 'NONE',
          },
          data: {
            // Manual mark-paid (CASH / BANK_TRANSFER) — same lifecycle as
            // online: PAID first, then SHIPPED, then COMPLETED.
            status: 'PAID',
            paymentMethod,
            paymentSessionState: 'COMPLETED',
          },
        });
        if (count === 0) return { ok: false as const };

        await tx.listing.updateMany({
          where: { id: existing.listingId, status: 'ON_HOLD' },
          data: { status: 'SOLD' },
        });

        return { ok: true as const };
      });

      if (!result.ok) {
        res.status(409).json({
          error: 'Order status changed; please refresh and try again',
        });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id },
        select: ORDER_SUMMARY_SELECT,
      });
      if (updated) {
        void createNotification({
          recipientId: updated.buyer.id,
          type: 'ORDER_COMPLETED',
          title: 'Order completed',
          body: `${updated.seller.username} marked your order for "${updated.listing.title}" as paid.`,
          actorId: updated.seller.id,
          orderId: updated.id,
          listingId: updated.listing.id,
        });
      }
      res.json({ order: updated });
    } catch (err) {
      console.error('Complete order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:id/ship — seller marks the order as shipped
// PAID → SHIPPED. Optional tracking number (any free-form string up to 100
// chars; we don't validate carrier-specific formats since sellers may use
// Australia Post, courier networks, in-person handover refs, etc).
// ---------------------------------------------------------------------------
router.post(
  '/:id/ship',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const parsed = shipSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }
      const { trackingNumber } = parsed.data;

      const existing = await prisma.order.findUnique({
        where: { id },
        select: { id: true, sellerId: true, status: true, listingId: true },
      });

      if (!existing) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (existing.sellerId !== req.userId) {
        res.status(403).json({ error: 'Only the seller can mark this order as shipped' });
        return;
      }
      if (existing.status !== 'PAID') {
        res.status(409).json({
          error: 'Order must be paid before it can be marked shipped',
        });
        return;
      }

      const { count } = await prisma.order.updateMany({
        where: { id, status: 'PAID', sellerId: req.userId },
        data: {
          status: 'SHIPPED',
          shippedAt: new Date(),
          trackingNumber: trackingNumber ?? null,
        },
      });
      if (count === 0) {
        res.status(409).json({
          error: 'Order status changed; please refresh and try again',
        });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id },
        select: ORDER_SUMMARY_SELECT,
      });
      if (updated) {
        void createNotification({
          recipientId: updated.buyer.id,
          type: 'ORDER_SHIPPED',
          title: 'Item shipped',
          body: trackingNumber
            ? `${updated.seller.username} shipped "${updated.listing.title}" — tracking: ${trackingNumber}`
            : `${updated.seller.username} marked "${updated.listing.title}" as shipped.`,
          actorId: updated.seller.id,
          orderId: updated.id,
          listingId: updated.listing.id,
        });
      }
      res.json({ order: updated });
    } catch (err) {
      console.error('Ship order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:id/receive — buyer confirms they got the item
// SHIPPED → COMPLETED. Closes out the deal; review can now be left.
// ---------------------------------------------------------------------------
router.post(
  '/:id/receive',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const existing = await prisma.order.findUnique({
        where: { id },
        select: { id: true, buyerId: true, status: true },
      });

      if (!existing) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (existing.buyerId !== req.userId) {
        res.status(403).json({ error: 'Only the buyer can confirm receipt' });
        return;
      }
      if (existing.status !== 'SHIPPED') {
        res.status(409).json({
          error: 'Order must be shipped before it can be marked received',
        });
        return;
      }

      const { count } = await prisma.order.updateMany({
        where: { id, status: 'SHIPPED', buyerId: req.userId },
        data: {
          status: 'COMPLETED',
          deliveredAt: new Date(),
        },
      });
      if (count === 0) {
        res.status(409).json({
          error: 'Order status changed; please refresh and try again',
        });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id },
        select: ORDER_SUMMARY_SELECT,
      });
      if (updated) {
        void createNotification({
          recipientId: updated.seller.id,
          type: 'ORDER_COMPLETED',
          title: 'Item received',
          body: `${updated.buyer.username} confirmed receipt of "${updated.listing.title}".`,
          actorId: updated.buyer.id,
          orderId: updated.id,
          listingId: updated.listing.id,
        });
      }
      res.json({ order: updated });
    } catch (err) {
      console.error('Receive order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:id/pay — buyer initiates online payment
// - PERSONAL sellers: PAYPAL only
// - BUSINESS sellers: STRIPE, SQUARE, or PAYPAL
// Creates a session with the provider and returns the redirect URL.
// Stripe completes via webhook; Square + PayPal complete via capture endpoints.
// Order is not moved to COMPLETED here — it stays CONFIRMED until the provider
// confirms payment.
// ---------------------------------------------------------------------------
router.post(
  '/:id/pay',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const parsed = paySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }
      const { paymentMethod } = parsed.data;

      const order = await prisma.order.findUnique({
        where: { id },
        select: {
          id: true,
          amount: true,
          status: true,
          buyerId: true,
          sellerId: true,
          listing: { select: { title: true } },
          seller: { select: { sellerType: true } },
        },
      });

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.buyerId !== req.userId) {
        res.status(403).json({ error: 'Only the buyer can pay for this order' });
        return;
      }
      if (order.status !== 'CONFIRMED') {
        res.status(409).json({
          error: 'Order must be confirmed by the seller before payment',
        });
        return;
      }

      // Seller-type gate
      if (order.seller.sellerType === 'PERSONAL' && paymentMethod !== 'PAYPAL') {
        res.status(400).json({
          error: 'This seller only accepts PayPal for online payment',
        });
        return;
      }

      const amountAud = Number(order.amount);
      const amountCents = Math.round(amountAud * 100);
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const successUrl = `${clientUrl}/dashboard?tab=purchases&payment=success&order=${order.id}`;
      const cancelUrl = `${clientUrl}/dashboard?tab=purchases&payment=cancelled&order=${order.id}`;

      // Mark the order as in-flight BEFORE calling the provider. Two jobs:
      //  (a) Block seller cancel / manual-complete during the window where
      //      the provider session exists but the buyer hasn't completed yet —
      //      without this, a cancel that wins the race strands the buyer's
      //      charge at the provider.
      //  (b) Block a concurrent second /pay call. Without the NONE guard the
      //      second call's updateMany would count=1 (PENDING→PENDING no-op);
      //      if its provider call then failed, revertSessionPending would
      //      clear the first call's in-flight marker and re-open the cancel
      //      door for a live session.
      //
      // Returns an error descriptor on failure so the caller can surface
      // "already in progress" vs "status changed" with distinct 409 bodies.
      const orderId = order.id;
      type PendingFailure = { status: number; error: string };
      async function markSessionPending(): Promise<PendingFailure | null> {
        const { count } = await prisma.order.updateMany({
          where: {
            id: orderId,
            status: 'CONFIRMED',
            paymentSessionState: 'NONE',
          },
          data: { paymentSessionState: 'PENDING' },
        });
        if (count > 0) return null;
        // Distinguish "concurrent payment already running" from "order state
        // changed under us" so the UI can message accordingly.
        const current = await prisma.order.findUnique({
          where: { id: orderId },
          select: { paymentSessionState: true, status: true },
        });
        if (current?.paymentSessionState === 'PENDING') {
          return { status: 409, error: 'A payment is already in progress for this order' };
        }
        if (current?.paymentSessionState === 'COMPLETED') {
          return { status: 409, error: 'This order is already paid' };
        }
        return { status: 409, error: 'Order status changed; please refresh and try again' };
      }
      // Best-effort revert if the provider call fails — otherwise the order is
      // stuck in PENDING with no actual session at the provider. Safe to call
      // even when no PENDING flip landed (the where clause is a no-op then).
      async function revertSessionPending(): Promise<void> {
        try {
          await prisma.order.updateMany({
            where: { id: orderId, paymentSessionState: 'PENDING', status: 'CONFIRMED' },
            data: { paymentSessionState: 'NONE' },
          });
        } catch (err) {
          console.error('[pay] revertSessionPending failed:', err);
        }
      }

      if (paymentMethod === 'STRIPE') {
        if (!isStripeConfigured()) {
          res.status(503).json({ error: 'Stripe is not configured on this server' });
          return;
        }
        {
          const failure = await markSessionPending();
          if (failure) {
            res.status(failure.status).json({ error: failure.error });
            return;
          }
        }
        try {
          const session = await getStripeClient().checkout.sessions.create({
            mode: 'payment',
            line_items: [
              {
                price_data: {
                  currency: 'aud',
                  product_data: { name: order.listing.title },
                  unit_amount: amountCents,
                },
                quantity: 1,
              },
            ],
            client_reference_id: order.id,
            metadata: { orderId: order.id },
            success_url: successUrl,
            cancel_url: cancelUrl,
          });
          res.json({ provider: 'STRIPE', url: session.url, sessionId: session.id });
        } catch (err) {
          await revertSessionPending();
          throw err;
        }
        return;
      }

      if (paymentMethod === 'SQUARE') {
        if (!isSquareConfigured()) {
          res.status(503).json({ error: 'Square is not configured on this server' });
          return;
        }
        {
          const failure = await markSessionPending();
          if (failure) {
            res.status(failure.status).json({ error: failure.error });
            return;
          }
        }
        try {
          // Use the `order` shape (not quickPay) so we can pass referenceId;
          // referenceId becomes our correlation key on the payment webhook.
          const resp = await getSquareClient().checkout.paymentLinks.create({
            idempotencyKey: randomUUID(),
            order: {
              locationId: getSquareLocationId(),
              referenceId: order.id,
              lineItems: [
                {
                  name: order.listing.title,
                  quantity: '1',
                  basePriceMoney: { amount: BigInt(amountCents), currency: 'AUD' },
                },
              ],
            },
            checkoutOptions: { redirectUrl: successUrl },
          });
          const paymentLink = resp.paymentLink;
          if (!paymentLink?.url) {
            await revertSessionPending();
            res.status(502).json({ error: 'Square did not return a payment URL' });
            return;
          }
          res.json({
            provider: 'SQUARE',
            url: paymentLink.url,
            paymentLinkId: paymentLink.id,
          });
        } catch (err) {
          await revertSessionPending();
          throw err;
        }
        return;
      }

      if (paymentMethod === 'PAYPAL') {
        if (!isPaypalConfigured()) {
          res.status(503).json({ error: 'PayPal is not configured on this server' });
          return;
        }
        {
          const failure = await markSessionPending();
          if (failure) {
            res.status(failure.status).json({ error: failure.error });
            return;
          }
        }
        try {
          const ordersController = new OrdersController(getPaypalClient());
          const paypalResp = await ordersController.createOrder({
            body: {
              intent: CheckoutPaymentIntent.Capture,
              purchaseUnits: [
                {
                  amount: { currencyCode: 'AUD', value: amountAud.toFixed(2) },
                  customId: order.id,
                  description: order.listing.title.slice(0, 127),
                },
              ],
              applicationContext: {
                returnUrl: successUrl,
                cancelUrl: cancelUrl,
              },
            },
            prefer: 'return=representation',
          });
          const paypalOrder = paypalResp.result;
          const approveLink = paypalOrder.links?.find((l) => l.rel === 'approve');
          if (!paypalOrder.id || !approveLink?.href) {
            await revertSessionPending();
            res.status(502).json({ error: 'PayPal did not return an approval URL' });
            return;
          }
          res.json({
            provider: 'PAYPAL',
            url: approveLink.href,
            paypalOrderId: paypalOrder.id,
          });
        } catch (err) {
          await revertSessionPending();
          throw err;
        }
        return;
      }

      // Exhaustiveness check — unreachable given Zod enum
      res.status(400).json({ error: 'Unsupported payment method' });
    } catch (err) {
      console.error('Pay error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:id/pay/abandon — buyer releases the PENDING payment lock
// without completing. Fires automatically from the client when the user
// clicks Cancel in the provider's UI (Stripe / Square / PayPal cancel URL)
// — at that point no capture will happen — and also via an explicit
// "Release lock" button for the tab-close case.
//
// Safety: we flip PENDING→NONE with a conditional updateMany guarded by
// buyerId + status=CONFIRMED + paymentSessionState=PENDING. If any of those
// changed (webhook captured, admin intervened, different user) count=0 and
// we return 409 without touching state.
//
// Residual risk: a user who approved at the provider then hits Cancel on
// the provider's UI instead of waiting could theoretically create a window
// where capture is mid-flight. Providers document that cancel means
// "don't capture" so this is provider-side safety, not ours — and the
// markOrderPaid amount guard + 30-min admin reconciliation remain as
// belt-and-braces.
// ---------------------------------------------------------------------------
router.post(
  '/:id/pay/abandon',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const { count } = await prisma.order.updateMany({
        where: {
          id,
          buyerId: req.userId!,
          status: 'CONFIRMED',
          paymentSessionState: 'PENDING',
        },
        data: { paymentSessionState: 'NONE' },
      });

      if (count === 0) {
        // Re-read to distinguish "not your order / nonexistent" (→ 404, hide
        // existence) from "already off-PENDING" (→ 409, friendly message).
        const existing = await prisma.order.findUnique({
          where: { id },
          select: { buyerId: true, paymentSessionState: true, status: true },
        });
        if (!existing || existing.buyerId !== req.userId) {
          res.status(404).json({ error: 'Order not found' });
          return;
        }
        if (existing.paymentSessionState === 'COMPLETED') {
          res.status(409).json({
            error: 'Payment has already completed — no lock to release.',
          });
          return;
        }
        res.status(409).json({
          error: 'No active payment lock to release.',
        });
        return;
      }

      res.json({ message: 'Payment lock released.' });
    } catch (err) {
      console.error('Abandon payment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:id/pay/paypal/capture — called by the client after the
// buyer returns from PayPal with an approved order. Captures the payment via
// PayPal and flips our order to COMPLETED.
// ---------------------------------------------------------------------------
router.post(
  '/:id/pay/paypal/capture',
  authenticate,
  orderMutationLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const parsed = paypalCaptureSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }
      const { paypalOrderId } = parsed.data;

      const order = await prisma.order.findUnique({
        where: { id },
        select: { buyerId: true, status: true },
      });
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.buyerId !== req.userId) {
        res.status(403).json({ error: 'Only the buyer can capture this payment' });
        return;
      }

      if (!isPaypalConfigured()) {
        res.status(503).json({ error: 'PayPal is not configured on this server' });
        return;
      }

      const ordersController = new OrdersController(getPaypalClient());

      // Inspect PayPal's current view of the order before capturing. If it is
      // already COMPLETED (a prior capture — e.g., the buyer double-submitted,
      // or the client re-fired after a refresh), skip captureOrder so PayPal
      // doesn't respond with ORDER_ALREADY_CAPTURED (which would bubble up as
      // a 500 here). markOrderPaid downstream is idempotent.
      const existing = await ordersController.getOrder({ id: paypalOrderId });
      const existingOrder = existing.result;

      let captured;
      if (existingOrder.status === 'COMPLETED') {
        captured = existingOrder;
      } else if (existingOrder.status === 'APPROVED') {
        const capture = await ordersController.captureOrder({ id: paypalOrderId });
        captured = capture.result;
      } else {
        res.status(409).json({
          error: `PayPal order is in ${existingOrder.status ?? 'unknown'} state and cannot be captured`,
        });
        return;
      }

      // Verify the PayPal order's custom_id matches OUR order — prevents a
      // malicious client from capturing someone else's approved order against
      // our record.
      const customId = captured.purchaseUnits?.[0]?.payments?.captures?.[0]?.customId
        ?? captured.purchaseUnits?.[0]?.customId;
      if (customId !== id) {
        // Do NOT log raw purchaseUnits — they contain payer email + address + name.
        console.error('PayPal customId mismatch:', {
          ourOrderId: id,
          capturedCustomId: customId,
          paypalOrderId,
          paypalStatus: captured.status,
        });
        res.status(400).json({ error: 'PayPal order does not belong to this order' });
        return;
      }

      if (captured.status !== 'COMPLETED') {
        res.status(409).json({
          error: `PayPal capture did not complete (status: ${captured.status})`,
        });
        return;
      }

      // Extract what PayPal says was actually captured, so we can cross-check
      // against order.amount. Buyer could have altered the approval URL.
      const captureDetail = captured.purchaseUnits?.[0]?.payments?.captures?.[0];
      const captureAmount = captureDetail?.amount;
      if (!captureAmount?.value || !captureAmount?.currencyCode) {
        console.error('[paypal capture] missing amount/currency on capture:', {
          ourOrderId: id,
          paypalOrderId,
        });
        res.status(502).json({ error: 'PayPal capture missing amount/currency' });
        return;
      }
      const reportedCents = new Prisma.Decimal(captureAmount.value).mul(100).toFixed(0);

      const result = await markOrderPaid(id, 'PAYPAL', {
        amountCents: reportedCents,
        currency: captureAmount.currencyCode,
      });
      if (result.status === 'not_found') {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (result.status === 'not_confirmed') {
        // Could happen if the order was cancelled between approval and capture.
        res.status(409).json({
          error: 'Order is no longer in a confirmable state',
        });
        return;
      }
      if (result.status === 'amount_mismatch') {
        console.error('[paypal capture] amount mismatch — NOT marking paid', {
          ourOrderId: id,
          paypalOrderId,
          expected: result.expected,
          reported: result.reported,
        });
        res.status(409).json({
          error: 'Payment amount does not match order amount',
        });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id },
        select: ORDER_SUMMARY_SELECT,
      });
      res.json({ order: updated, idempotent: result.status === 'already_completed' });
    } catch (err) {
      console.error('PayPal capture error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/orders/:id — single order detail. Placed last because `/:id` would
// otherwise swallow `/sales`, `/purchases`, and `/:id/messages`.
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  authenticate,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid order ID' });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id },
        select: ORDER_SUMMARY_SELECT,
      });

      if (!order || (order.buyer.id !== req.userId && order.seller.id !== req.userId)) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      res.json({ order });
    } catch (err) {
      console.error('Get order error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
