import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { uuidSchema } from '../schemas/common.js';
import {
  createDisputeSchema,
  disputeMessageSchema,
  resolveBySellerSchema,
  resolveDisputeSchema,
} from '../schemas/disputes.js';
import { createNotification } from '../services/notifications.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Buyers can dispute a COMPLETED order within this window of delivery. After
// the window the order is final — eBay uses 30, Stripe chargebacks run 60-180.
// 30 days strikes a balance: long enough to discover hidden defects ("battery
// dies after first charge"), short enough that sellers can close their books.
const DISPUTE_WINDOW_DAYS = 30;
const DISPUTE_WINDOW_MS = DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
          deliveredAt: true,
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
      // Window check on COMPLETED orders. Pre-completion (PAID/SHIPPED) has
      // no time bound — those buyers haven't said they're satisfied yet.
      if (order.status === 'COMPLETED' && order.deliveredAt) {
        const elapsed = Date.now() - order.deliveredAt.getTime();
        if (elapsed > DISPUTE_WINDOW_MS) {
          res.status(409).json({
            error: `Disputes must be opened within ${DISPUTE_WINDOW_DAYS} days of the order being marked complete`,
          });
          return;
        }
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
      logger.error('disputes.create.failed', { err: String(err) });
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
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            fromUser: { select: { id: true, username: true, avatarUrl: true } },
          },
        },
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

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/disputes/messages — post a message on the dispute
// thread. Buyer or seller (no admin posting; admin reads only). Allowed in
// any non-final state (OPEN or RESOLVED_BY_SELLER) so a buyer who reopens
// has a place to explain why.
// ---------------------------------------------------------------------------
router.post(
  '/orders/:orderId/disputes/messages',
  authenticate,
  disputeLimiter,
  async (req: Request<{ orderId: string }>, res: Response) => {
    const { orderId } = req.params;
    if (!uuidSchema.safeParse(orderId).success) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }
    const parsed = disputeMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { content } = parsed.data;
    const dispute = await prisma.dispute.findUnique({
      where: { orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        order: { select: { listing: { select: { id: true, title: true } } } },
      },
    });
    if (!dispute) {
      res.status(404).json({ error: 'No dispute on this order' });
      return;
    }
    const isBuyer = dispute.buyerId === req.userId;
    const isSeller = dispute.sellerId === req.userId;
    if (!isBuyer && !isSeller) {
      res.status(403).json({ error: 'Only the buyer or seller can post here' });
      return;
    }
    // Final-state disputes are read-only — no point in continuing the
    // conversation once admin has decided. Buyer wants to dispute again →
    // they can file a fresh dispute via the standard create route once we
    // support it (out of scope here).
    if (
      dispute.status === 'RESOLVED_REFUND' ||
      dispute.status === 'RESOLVED_NO_REFUND' ||
      dispute.status === 'WITHDRAWN'
    ) {
      res
        .status(409)
        .json({ error: 'This dispute is closed and no longer accepts messages' });
      return;
    }

    const message = await prisma.disputeMessage.create({
      data: {
        disputeId: dispute.id,
        fromUserId: req.userId!,
        content,
      },
      include: {
        fromUser: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    const otherPartyId = isBuyer ? dispute.sellerId : dispute.buyerId;
    void createNotification({
      recipientId: otherPartyId,
      type: 'DISPUTE_MESSAGE',
      title: 'New dispute message',
      body: `New message on the dispute for "${dispute.order.listing.title}"`,
      actorId: req.userId!,
      orderId,
      listingId: dispute.order.listing.id,
    });

    res.status(201).json({ message });
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/disputes/resolve-by-seller — seller closes the
// dispute on their own. Typically after refunding, but we don't enforce that
// link here (refunds are their own audit trail). Buyer can reopen within the
// dispute window.
// ---------------------------------------------------------------------------
router.post(
  '/orders/:orderId/disputes/resolve-by-seller',
  authenticate,
  disputeLimiter,
  async (req: Request<{ orderId: string }>, res: Response) => {
    const { orderId } = req.params;
    if (!uuidSchema.safeParse(orderId).success) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }
    const parsed = resolveBySellerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { resolutionNote } = parsed.data;

    const dispute = await prisma.dispute.findUnique({
      where: { orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        order: { select: { listing: { select: { id: true, title: true } } } },
      },
    });
    if (!dispute) {
      res.status(404).json({ error: 'No dispute on this order' });
      return;
    }
    if (dispute.sellerId !== req.userId) {
      res.status(403).json({ error: 'Only the seller can close their own dispute' });
      return;
    }
    if (dispute.status !== 'OPEN') {
      res.status(409).json({ error: 'Only an open dispute can be closed' });
      return;
    }

    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: 'RESOLVED_BY_SELLER',
        resolvedAt: new Date(),
        resolvedById: req.userId!,
        resolutionNote: resolutionNote ?? null,
      },
    });

    void createNotification({
      recipientId: dispute.buyerId,
      type: 'DISPUTE_RESOLVED_BY_SELLER',
      title: 'Seller closed the dispute',
      body: `Seller closed your dispute on "${dispute.order.listing.title}". Reopen if it's not actually resolved.`,
      actorId: req.userId!,
      orderId,
      listingId: dispute.order.listing.id,
    });

    res.json({ dispute: updated });
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/disputes/reopen — buyer reopens a previously
// seller-closed dispute. One reopen per dispute — after that the buyer must
// either let it stand or escalate via the contact form.
// ---------------------------------------------------------------------------
router.post(
  '/orders/:orderId/disputes/reopen',
  authenticate,
  disputeLimiter,
  async (req: Request<{ orderId: string }>, res: Response) => {
    const { orderId } = req.params;
    if (!uuidSchema.safeParse(orderId).success) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }
    const dispute = await prisma.dispute.findUnique({
      where: { orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        reopenedAt: true,
        order: { select: { listing: { select: { id: true, title: true } } } },
      },
    });
    if (!dispute) {
      res.status(404).json({ error: 'No dispute on this order' });
      return;
    }
    if (dispute.buyerId !== req.userId) {
      res.status(403).json({ error: 'Only the buyer can reopen a dispute' });
      return;
    }
    if (dispute.status !== 'RESOLVED_BY_SELLER') {
      res
        .status(409)
        .json({ error: 'Only a seller-closed dispute can be reopened' });
      return;
    }
    if (dispute.reopenedAt) {
      res
        .status(409)
        .json({ error: 'This dispute has already been reopened once. Contact admin via the support form.' });
      return;
    }

    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: 'OPEN',
        // Clear seller's resolution markers but keep resolutionNote in
        // history — the message thread is the audit log going forward.
        resolvedAt: null,
        resolvedById: null,
        reopenedAt: new Date(),
      },
    });

    void createNotification({
      recipientId: dispute.sellerId,
      type: 'DISPUTE_REOPENED',
      title: 'Dispute reopened',
      body: `Buyer reopened the dispute on "${dispute.order.listing.title}".`,
      actorId: req.userId!,
      orderId,
      listingId: dispute.order.listing.id,
    });

    res.json({ dispute: updated });
  },
);

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/disputes/accept — buyer accepts the seller's
// resolution as final. After this, no more actions are possible (no reopen,
// no withdraw). Equivalent to the buyer saying "OK, we're done here".
// ---------------------------------------------------------------------------
router.post(
  '/orders/:orderId/disputes/accept',
  authenticate,
  disputeLimiter,
  async (req: Request<{ orderId: string }>, res: Response) => {
    const { orderId } = req.params;
    if (!uuidSchema.safeParse(orderId).success) {
      res.status(400).json({ error: 'Invalid order ID' });
      return;
    }
    const dispute = await prisma.dispute.findUnique({
      where: { orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        order: { select: { listing: { select: { id: true, title: true } } } },
      },
    });
    if (!dispute) {
      res.status(404).json({ error: 'No dispute on this order' });
      return;
    }
    if (dispute.buyerId !== req.userId) {
      res.status(403).json({ error: 'Only the buyer can accept a resolution' });
      return;
    }
    if (dispute.status !== 'RESOLVED_BY_SELLER') {
      res
        .status(409)
        .json({ error: 'Only a seller-closed dispute can be accepted' });
      return;
    }

    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: 'ACCEPTED',
        resolvedAt: new Date(),
        // Buyer is the resolver here — overrides the seller's resolvedById
        // so the audit trail reflects who finalised it.
        resolvedById: req.userId!,
      },
    });

    void createNotification({
      recipientId: dispute.sellerId,
      type: 'DISPUTE_ACCEPTED',
      title: 'Buyer accepted your resolution',
      body: `Buyer accepted the resolution on the dispute for "${dispute.order.listing.title}".`,
      actorId: req.userId!,
      orderId,
      listingId: dispute.order.listing.id,
    });

    res.json({ dispute: updated });
  },
);

// ===========================================================================
// ADMIN — dispute queue + resolution
// ===========================================================================

// GET /api/admin/disputes?status=OPEN — admin queue. Returns counts for every
// status alongside the filtered list so the UI can render tab badges without
// extra round-trips.
router.get(
  '/admin/disputes',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    type DisputeStatusFilter =
      | 'OPEN'
      | 'RESOLVED_BY_SELLER'
      | 'ACCEPTED'
      | 'RESOLVED_REFUND'
      | 'RESOLVED_NO_REFUND'
      | 'WITHDRAWN';
    const VALID_STATUSES: readonly DisputeStatusFilter[] = [
      'OPEN',
      'RESOLVED_BY_SELLER',
      'ACCEPTED',
      'RESOLVED_REFUND',
      'RESOLVED_NO_REFUND',
      'WITHDRAWN',
    ];
    const raw = typeof req.query.status === 'string' ? req.query.status : 'OPEN';
    const where = VALID_STATUSES.includes(raw as DisputeStatusFilter)
      ? { status: raw as DisputeStatusFilter }
      : {};

    const [disputes, grouped] = await Promise.all([
      prisma.dispute.findMany({
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
          messages: {
            orderBy: { createdAt: 'asc' },
            include: {
              fromUser: { select: { id: true, username: true, avatarUrl: true } },
            },
          },
        },
      }),
      prisma.dispute.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const counts = Object.fromEntries(
      VALID_STATUSES.map((s) => [s, 0]),
    ) as Record<DisputeStatusFilter, number>;
    for (const row of grouped) {
      counts[row.status as DisputeStatusFilter] = row._count._all;
    }

    res.json({ disputes, counts });
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
      logger.error('disputes.resolve.failed', { err: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
