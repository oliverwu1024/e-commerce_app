import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { uuidSchema } from '../schemas/common.js';
import {
  createInquirySchema,
  inquiryMessageSchema,
  inquiryListQuerySchema,
} from '../schemas/inquiries.js';
import { createNotification } from '../services/notifications.js';
import { PUBLIC_LOCATION_SELECT, projectPublicSeller } from '../services/publicLocation.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Tighter limiter — inquiries are write-heavy (one per question typed) and a
// good thing to throttle to discourage bots.
const inquiryWriteLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many inquiry actions; please try again later' },
});

const INQUIRY_SUMMARY_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      price: true,
      status: true,
      images: {
        orderBy: { displayOrder: 'asc' },
        take: 1,
        select: { id: true, url: true },
      },
    },
  },
  buyer: {
    select: { id: true, username: true, avatarUrl: true, ...PUBLIC_LOCATION_SELECT },
  },
  seller: {
    select: { id: true, username: true, avatarUrl: true, ...PUBLIC_LOCATION_SELECT },
  },
} satisfies Prisma.InquirySelect;

// Apply public-location projection to both parties on an inquiry. Mirrors
// the rule used in listings/orders so we never leak structured address
// fields through the inquiry surface.
function projectInquiryParties<
  T extends {
    buyer: Parameters<typeof projectPublicSeller>[0];
    seller: Parameters<typeof projectPublicSeller>[0];
  },
>(inq: T) {
  return {
    ...inq,
    buyer: projectPublicSeller(inq.buyer),
    seller: projectPublicSeller(inq.seller),
  };
}

const INQUIRY_MESSAGE_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  readAt: true,
  sender: { select: { id: true, username: true, avatarUrl: true } },
} satisfies Prisma.InquiryMessageSelect;

// ---------------------------------------------------------------------------
// POST /api/inquiries — buyer asks a question on a listing
// Idempotent on (listingId, buyerId): subsequent calls reuse the existing
// thread and just append a message, so a buyer can't accidentally fork their
// own conversation by clicking twice.
// ---------------------------------------------------------------------------
router.post(
  '/',
  authenticate,
  inquiryWriteLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = createInquirySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }
      const { listingId, content } = parsed.data;

      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: { id: true, sellerId: true, status: true, title: true },
      });
      if (!listing) {
        res.status(404).json({ error: 'Listing not found' });
        return;
      }
      if (listing.sellerId === req.userId) {
        res
          .status(400)
          .json({ error: 'You cannot send an inquiry on your own listing' });
        return;
      }
      // Block inquiries on listings that are no longer for sale; they're
      // useless and would just confuse the seller. (Buyer can still message
      // post-purchase via the order thread.)
      if (listing.status !== 'ACTIVE' && listing.status !== 'ON_HOLD') {
        res
          .status(409)
          .json({ error: 'This listing is no longer accepting inquiries' });
        return;
      }

      const buyerId = req.userId!;
      const sellerId = listing.sellerId;

      // upsert-or-create the inquiry, then add a message in the same tx so
      // either both land or neither do.
      const inquiry = await prisma.$transaction(async (tx) => {
        const existing = await tx.inquiry.findUnique({
          where: {
            listingId_buyerId: { listingId, buyerId },
          },
          select: { id: true },
        });

        const inq = existing
          ? await tx.inquiry.update({
              where: { id: existing.id },
              data: {
                status: 'OPEN', // re-opens if previously closed
                lastMessageAt: new Date(),
              },
              select: { id: true },
            })
          : await tx.inquiry.create({
              data: {
                listingId,
                buyerId,
                sellerId,
                lastMessageAt: new Date(),
              },
              select: { id: true },
            });

        await tx.inquiryMessage.create({
          data: {
            inquiryId: inq.id,
            senderId: buyerId,
            receiverId: sellerId,
            content,
          },
        });

        return inq;
      });

      // Notify seller (best-effort; don't block the response).
      void createNotification({
        recipientId: sellerId,
        type: 'NEW_INQUIRY',
        title: 'New question on your listing',
        body: `Someone asked about "${listing.title}"`,
        actorId: buyerId,
        listingId,
      });

      const full = await prisma.inquiry.findUnique({
        where: { id: inquiry.id },
        select: INQUIRY_SUMMARY_SELECT,
      });
      res.status(201).json({ inquiry: full ? projectInquiryParties(full) : full });
    } catch (err) {
      logger.error('inquiries.create.failed', { err: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/inquiries — list inquiries the current user is a party to.
// Auto-detects role: returns inquiries where user is either buyer or seller.
// Default filter: OPEN only. Pass ?status=ALL to see closed too.
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = inquiryListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit, status } = parsed.data;
    const skip = (page - 1) * limit;
    const userId = req.userId!;

    const where: Prisma.InquiryWhereInput = {
      OR: [{ buyerId: userId }, { sellerId: userId }],
    };
    if (status !== 'ALL') where.status = status;

    const [inquiries, total, unreadByThread] = await Promise.all([
      prisma.inquiry.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
        select: INQUIRY_SUMMARY_SELECT,
      }),
      prisma.inquiry.count({ where }),
      prisma.inquiryMessage.groupBy({
        by: ['inquiryId'],
        where: { receiverId: userId, readAt: null },
        _count: { _all: true },
      }),
    ]);

    const unreadMap = new Map(
      unreadByThread.map((row) => [row.inquiryId, row._count._all]),
    );

    res.json({
      inquiries: inquiries.map((inq) => ({
        ...projectInquiryParties(inq),
        unreadCount: unreadMap.get(inq.id) ?? 0,
        // Convenience flag so the client doesn't have to compare currentUserId
        // every render to know which side of the conversation it's on.
        viewerRole: inq.buyer.id === userId ? 'buyer' : 'seller',
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('inquiries.list.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/inquiries/:id — full inquiry with messages
// Marks the viewer's unread messages as read in the same call so the inbox
// badge clears immediately.
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  authenticate,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid inquiry ID' });
        return;
      }

      const inquiry = await prisma.inquiry.findUnique({
        where: { id },
        select: { ...INQUIRY_SUMMARY_SELECT, buyerId: true, sellerId: true },
      });

      if (!inquiry) {
        res.status(404).json({ error: 'Inquiry not found' });
        return;
      }
      const userId = req.userId!;
      if (inquiry.buyerId !== userId && inquiry.sellerId !== userId) {
        res.status(403).json({ error: 'You are not a party to this inquiry' });
        return;
      }

      const [messages] = await Promise.all([
        prisma.inquiryMessage.findMany({
          where: { inquiryId: id },
          orderBy: { createdAt: 'asc' },
          select: INQUIRY_MESSAGE_SELECT,
        }),
        prisma.inquiryMessage.updateMany({
          where: { inquiryId: id, receiverId: userId, readAt: null },
          data: { readAt: new Date() },
        }),
      ]);

      // Strip private buyerId/sellerId from response shape.
      const { buyerId: _b, sellerId: _s, ...summary } = inquiry;
      void _b;
      void _s;

      res.json({
        inquiry: {
          ...projectInquiryParties(summary),
          viewerRole: inquiry.buyerId === userId ? 'buyer' : 'seller',
        },
        messages,
      });
    } catch (err) {
      logger.error('inquiries.get.failed', { err: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/inquiries/:id/messages — just the messages for one inquiry
// Mirrors GET /api/orders/:id/messages so the generic MessageThread component
// can hit either endpoint with the same response shape ({ messages: [...] }).
// Marks viewer's unreads as read in the same call so the inbox badge clears.
// ---------------------------------------------------------------------------
router.get(
  '/:id/messages',
  authenticate,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid inquiry ID' });
        return;
      }

      const inquiry = await prisma.inquiry.findUnique({
        where: { id },
        select: { buyerId: true, sellerId: true },
      });
      if (!inquiry) {
        res.status(404).json({ error: 'Inquiry not found' });
        return;
      }
      const userId = req.userId!;
      if (inquiry.buyerId !== userId && inquiry.sellerId !== userId) {
        res.status(403).json({ error: 'You are not a party to this inquiry' });
        return;
      }

      const [messages] = await Promise.all([
        prisma.inquiryMessage.findMany({
          where: { inquiryId: id },
          orderBy: { createdAt: 'asc' },
          select: INQUIRY_MESSAGE_SELECT,
        }),
        prisma.inquiryMessage.updateMany({
          where: { inquiryId: id, receiverId: userId, readAt: null },
          data: { readAt: new Date() },
        }),
      ]);

      res.json({ messages });
    } catch (err) {
      logger.error('inquiries.messages.failed', { err: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/inquiries/:id/messages — reply on an existing inquiry
// Either party can post. Notifies the OTHER party.
// ---------------------------------------------------------------------------
router.post(
  '/:id/messages',
  authenticate,
  inquiryWriteLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid inquiry ID' });
        return;
      }

      const parsed = inquiryMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }
      const { content } = parsed.data;

      const inquiry = await prisma.inquiry.findUnique({
        where: { id },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          status: true,
          listing: { select: { id: true, title: true } },
        },
      });
      if (!inquiry) {
        res.status(404).json({ error: 'Inquiry not found' });
        return;
      }
      const userId = req.userId!;
      if (inquiry.buyerId !== userId && inquiry.sellerId !== userId) {
        res.status(403).json({ error: 'You are not a party to this inquiry' });
        return;
      }

      const receiverId =
        inquiry.buyerId === userId ? inquiry.sellerId : inquiry.buyerId;

      const [message] = await prisma.$transaction([
        prisma.inquiryMessage.create({
          data: {
            inquiryId: id,
            senderId: userId,
            receiverId,
            content,
          },
          select: INQUIRY_MESSAGE_SELECT,
        }),
        prisma.inquiry.update({
          where: { id },
          data: {
            // Replying re-opens a CLOSED inquiry — closing is treated as a
            // soft archive, not a permanent lock.
            status: 'OPEN',
            lastMessageAt: new Date(),
          },
        }),
      ]);

      void createNotification({
        recipientId: receiverId,
        type: 'NEW_INQUIRY_REPLY',
        title: 'New message on inquiry',
        body: `Reply on "${inquiry.listing.title}"`,
        actorId: userId,
        listingId: inquiry.listing.id,
      });

      res.status(201).json({ message });
    } catch (err) {
      logger.error('inquiries.reply.failed', { err: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/inquiries/:id/close — soft-archive an inquiry (either party)
// Closed inquiries are hidden from the default list but readable via ?status=ALL.
// Replying re-opens.
// ---------------------------------------------------------------------------
router.post(
  '/:id/close',
  authenticate,
  inquiryWriteLimiter,
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidSchema.safeParse(id).success) {
        res.status(400).json({ error: 'Invalid inquiry ID' });
        return;
      }

      const inquiry = await prisma.inquiry.findUnique({
        where: { id },
        select: { buyerId: true, sellerId: true },
      });
      if (!inquiry) {
        res.status(404).json({ error: 'Inquiry not found' });
        return;
      }
      const userId = req.userId!;
      if (inquiry.buyerId !== userId && inquiry.sellerId !== userId) {
        res.status(403).json({ error: 'You are not a party to this inquiry' });
        return;
      }

      await prisma.inquiry.update({
        where: { id },
        data: { status: 'CLOSED' },
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error('inquiries.close.failed', { err: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
