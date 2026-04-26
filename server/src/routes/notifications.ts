import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { notificationQuerySchema, markReadSchema } from '../schemas/notifications.js';
import { logger } from '../utils/logger.js';

const router = Router();

const notifLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300, // polling-friendly — bell refetches every ~60s on the client
  message: { error: 'Too many notification requests' },
});

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  orderId: true,
  listingId: true,
  actor: { select: { id: true, username: true } },
} satisfies Prisma.NotificationSelect;

// ---------------------------------------------------------------------------
// GET /api/notifications — list with optional unread filter + pagination
// ---------------------------------------------------------------------------
router.get('/', authenticate, notifLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = notificationQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit, unread } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      recipientId: req.userId!,
      ...(unread ? { readAt: null } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: NOTIFICATION_SELECT,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { recipientId: req.userId!, readAt: null },
      }),
    ]);

    res.json({
      notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('notifications.list.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/notifications/mark-read — mark specified ids or all as read
// ---------------------------------------------------------------------------
router.put('/mark-read', authenticate, notifLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const where: Prisma.NotificationWhereInput = {
      recipientId: req.userId!,
      readAt: null,
    };
    if (!parsed.data.all && parsed.data.ids) {
      where.id = { in: parsed.data.ids };
    }

    const { count } = await prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });

    res.json({ markedCount: count });
  } catch (err) {
    logger.error('notifications.mark_read.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
