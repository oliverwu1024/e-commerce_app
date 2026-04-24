import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { uuidSchema } from '../schemas/common.js';
import {
  createDisputeSchema,
  resolveDisputeSchema,
} from '../schemas/disputes.js';
import { createNotification } from '../services/notifications.js';

const router = Router();

// Disputes are infrequent + high-stakes, so the rate limit can be tight.
// 10 per 15 min per IP is plenty for a real human and stops a script that
// tries to spray complaints across orders.
const disputeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many dispute actions, please try again shortly' },
});

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/disputes — buyer opens a dispute on a paid order
// ---------------------------------------------------------------------------
router.post(
  '/orders/:orderId/disputes',
  authenticate,
  disputeLimiter,
  async (req: Request<{ orderId: string }>, res: Response) => {
    const { orderId } = req.params;
    if (!uuidSchema.safeParse(orderId).success) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }
    const parsed = createDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { reason, description } = parsed.data;

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          status: true,
          listing: { select: { id: true, title: true } },
          buyer: { select: { username: true } },
        },
      });
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.buyerId !== req.userId) {
        res.status(403).json({ error: 'Only the buyer can open a dispute' });
        return;
      }
      // Disputes only make sense on orders that have actually had a payment
      // — there's nothing to dispute if the seller never confirmed or never
      // got paid. REFUNDED is excluded too (already resolved out-of-band).
      if (
        order.status !== 'PAID' &&
        order.status !== 'SHIPPED' &&
        order.status !== 'COMPLETED'
      ) {
        res.status(409).json({
          error:
            'Disputes can only be opened on paid, shipped or completed orders',
        });
        return;
      }

      const dispute = await prisma.dispute.create({
        data: {
          orderId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          reason,
          description,
        },
      });

      // Notify the seller; admin oversight happens via the admin disputes
      // queue (no per-admin notification flood).
      void createNotification({
        recipientId: order.sellerId,
        type: 'ORDER_DISPUTED',
        title: 'Dispute opened',
        body: `${order.buyer.username} opened a dispute on "${order.listing.title}".`,
        actorId: order.buyerId,
        orderId,
        listingId: order.listing.id,
      });

      res.status(201).json({ dispute });
    } catch (err) {
      // Unique-violation: one dispute per order (orderId is unique).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        res.status(409).json({ error: 'A dispute already exists for this order' });
        return;
      }
      console.error('Create dispute error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/orders/:orderId/disputes — read the dispute on this order
// (visible to buyer, seller, or admin only).
// ---------------------------------------------------------------------------
router.get(
  '/orders/:orderId/disputes',
  authenticate,
  async (req: Request<{ orderId: string }>, res: Response) => {
    const { orderId } = req.params;
    if (!uuidSchema.safeParse(orderId).success) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }
    const dispute = await prisma.dispute.findUnique({
      where: { orderId },
      include: {
        buyer: { select: { id: true, username: true, avatarUrl: true } },
        seller: { select: { id: true, username: true, avatarUrl: true } },
        resolvedBy: { select: { id: true, username: true } },
      },
    });
    if (!dispute) {
      res.status(404).json({ error: 'No dispute on this order' });
      return;
    }
    const isParty =
      dispute.buyerId === req.userId || dispute.sellerId === req.userId;
    if (!isParty && req.userRole !== 'ADMIN') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json({ dispute });
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/disputes/withdraw — buyer withdraws their own
// dispute (resolved between parties, no admin needed).
// ---------------------------------------------------------------------------
router.post(
  '/orders/:orderId/disputes/withdraw',
  authenticate,
  disputeLimiter,
  async (req: Request<{ orderId: string }>, res: Response) => {
    const { orderId } = req.params;
    if (!uuidSchema.safeParse(orderId).success) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }
    const { count } = await prisma.dispute.updateMany({
      where: {
        orderId,
        buyerId: req.userId!,
        status: 'OPEN',
      },
      data: {
        status: 'WITHDRAWN',
        resolvedAt: new Date(),
      },
    });
    if (count === 0) {
      res.status(409).json({ error: 'No open dispute to withdraw' });
      return;
    }
    res.json({ ok: true });
  },
);

// ===========================================================================
// ADMIN — dispute queue + resolution
// ===========================================================================

// GET /api/admin/disputes?status=OPEN — admin queue
router.get(
  '/admin/disputes',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'OPEN';
    const where = ['OPEN', 'RESOLVED_REFUND', 'RESOLVED_NO_REFUND', 'WITHDRAWN'].includes(status)
      ? { status: status as 'OPEN' | 'RESOLVED_REFUND' | 'RESOLVED_NO_REFUND' | 'WITHDRAWN' }
      : {};
    const disputes = await prisma.dispute.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        buyer: { select: { id: true, username: true } },
        seller: { select: { id: true, username: true } },
        order: {
          select: {
            id: true,
            amount: true,
            status: true,
            paymentMethod: true,
            listing: { select: { id: true, title: true } },
          },
        },
      },
    });
    res.json({ disputes });
  },
);

// POST /api/admin/disputes/:disputeId/resolve — admin closes a dispute.
// Outcome (RESOLVED_REFUND vs RESOLVED_NO_REFUND) is informational — actual
// refund still happens via POST /api/orders/:id/refund and is the seller's
// action. Kept separate so the audit trail is clean: dispute records what
// admin decided; refund record proves the money moved.
router.post(
  '/admin/disputes/:disputeId/resolve',
  authenticate,
  requireAdmin,
  disputeLimiter,
  async (req: Request<{ disputeId: string }>, res: Response) => {
    const { disputeId } = req.params;
    if (!uuidSchema.safeParse(disputeId).success) {
      res.status(400).json({ error: 'Invalid dispute ID' });
      return;
    }
    const parsed = resolveDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { outcome, resolutionNote } = parsed.data;

    try {
      const updated = await prisma.dispute.update({
        where: { id: disputeId },
        data: {
          status: outcome,
          resolutionNote,
          resolvedAt: new Date(),
          resolvedById: req.userId!,
        },
        include: {
          order: { select: { id: true, listing: { select: { id: true, title: true } } } },
        },
      });

      // Notify both parties.
      const title = outcome === 'RESOLVED_REFUND'
        ? 'Dispute resolved — refund expected'
        : 'Dispute resolved';
      const body = `Admin closed your dispute on "${updated.order.listing.title}". ${resolutionNote}`;
      void createNotification({
        recipientId: updated.buyerId,
        type: 'DISPUTE_RESOLVED',
        title,
        body,
        actorId: req.userId!,
        orderId: updated.orderId,
        listingId: updated.order.listing.id,
      });
      void createNotification({
        recipientId: updated.sellerId,
        type: 'DISPUTE_RESOLVED',
        title,
        body,
        actorId: req.userId!,
        orderId: updated.orderId,
        listingId: updated.order.listing.id,
      });

      res.json({ dispute: updated });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        res.status(404).json({ error: 'Dispute not found' });
        return;
      }
      console.error('Resolve dispute error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
