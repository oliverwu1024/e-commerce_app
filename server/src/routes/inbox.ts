import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const inboxLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300, // polled from the navbar
  message: { error: 'Too many inbox requests' },
});

// ---------------------------------------------------------------------------
// GET /api/inbox/unread-count — powers the Navbar bell + envelope badges.
// Cheap: two count queries, each hits a narrow index.
// ---------------------------------------------------------------------------
router.get('/unread-count', authenticate, inboxLimiter, async (req: Request, res: Response) => {
  try {
    const [notifications, orderMessages, inquiryMessages] = await Promise.all([
      prisma.notification.count({
        where: { recipientId: req.userId!, readAt: null },
      }),
      prisma.message.count({
        where: { receiverId: req.userId!, readAt: null },
      }),
      prisma.inquiryMessage.count({
        where: { receiverId: req.userId!, readAt: null },
      }),
    ]);
    // `messages` exposed here is the SUM of order-thread + inquiry-thread
    // unread counts — the navbar envelope shows a single badge regardless of
    // which kind of conversation drove it. The inbox page splits them across
    // tabs at render time using the per-bucket fields below.
    res.json({
      notifications,
      messages: orderMessages + inquiryMessages,
      orderMessages,
      inquiryMessages,
    });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/inbox/threads — one entry per order the user has messaged on,
// ordered by most-recent message. Each entry carries the counterparty
// identity, the last message preview, and the user's unread count on that
// thread. The UI uses this to build a proper "inbox" page without expanding
// every order thread individually.
// ---------------------------------------------------------------------------
router.get('/threads', authenticate, inboxLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // Find orders where the user has at least one message (sent or received).
    // We derive the thread list from Message rather than Order to avoid
    // surfacing orders that never had any conversation.
    const orderRows = await prisma.message.groupBy({
      by: ['orderId'],
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: 50,
    });

    if (orderRows.length === 0) {
      res.json({ threads: [] });
      return;
    }

    const orderIds = orderRows.map((r) => r.orderId);

    // One round trip for order + counterparty info, one for last-message
    // content (since groupBy can't carry non-aggregated content).
    const [orders, lastMessages, unreadCounts] = await Promise.all([
      prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          status: true,
          amount: true,
          buyer: { select: { id: true, username: true, avatarUrl: true } },
          seller: { select: { id: true, username: true, avatarUrl: true } },
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
        },
      }),
      // Fetch the last message per order. Cheaper than an N+1: take the last
      // 50 messages total and dedupe by orderId, since we capped orderRows
      // at 50 and each thread's latest is guaranteed to be one of the rows.
      prisma.message.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderId: true,
          content: true,
          createdAt: true,
          senderId: true,
        },
      }),
      prisma.message.groupBy({
        by: ['orderId'],
        where: {
          orderId: { in: orderIds },
          receiverId: userId,
          readAt: null,
        },
        _count: { _all: true },
      }),
    ]);

    const latestByOrder = new Map<string, (typeof lastMessages)[number]>();
    for (const m of lastMessages) {
      if (!latestByOrder.has(m.orderId)) latestByOrder.set(m.orderId, m);
    }
    const unreadByOrder = new Map(
      unreadCounts.map((u) => [u.orderId, u._count._all]),
    );
    const orderById = new Map(orders.map((o) => [o.id, o]));

    // Emit in the groupBy order so the client gets most-recent-first.
    const threads = orderRows
      .map((r) => {
        const order = orderById.get(r.orderId);
        const last = latestByOrder.get(r.orderId);
        if (!order || !last) return null;
        const counterparty = order.buyer.id === userId ? order.seller : order.buyer;
        const role = order.buyer.id === userId ? 'buyer' : 'seller';
        return {
          orderId: order.id,
          role,
          listing: order.listing,
          counterparty,
          orderStatus: order.status,
          amount: order.amount.toString(),
          lastMessage: {
            id: last.id,
            content: last.content,
            createdAt: last.createdAt,
            fromMe: last.senderId === userId,
          },
          unreadCount: unreadByOrder.get(order.id) ?? 0,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    res.json({ threads });
  } catch (err) {
    console.error('Inbox threads error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
