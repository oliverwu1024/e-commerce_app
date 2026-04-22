import { Router, Request, Response } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { uuidSchema } from '../schemas/common.js';
import { s3, S3_BUCKET, S3_REGION } from '../config/s3.js';
import {
  adminReviewSchema,
  pendingVerificationsQuerySchema,
} from '../schemas/users.js';
import { sendIdApprovedEmail, sendIdRejectedEmail } from '../utils/email.js';
import { createNotification } from '../services/notifications.js';

const router = Router();

// All admin routes require auth + admin role.
router.use(authenticate, requireAdmin);

const ID_DOC_URL_EXPIRY = 5 * 60; // 5 minutes
const STUCK_PAYMENT_MIN_AGE_MS = 30 * 60 * 1000; // 30 minutes

async function signIdDocumentUrl(url: string | null): Promise<string | null> {
  if (!url || !S3_BUCKET) return null;
  const expectedPrefix = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/`;
  if (!url.startsWith(expectedPrefix)) return null;
  const key = url.slice(expectedPrefix.length);
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), {
      expiresIn: ID_DOC_URL_EXPIRY,
    });
  } catch (err) {
    console.error('Failed to sign id document url:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/verifications — list users with pending ID verifications
// ---------------------------------------------------------------------------
router.get('/verifications', async (req: Request, res: Response) => {
  try {
    const parsed = pendingVerificationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = { idVerification: 'PENDING_REVIEW' as const };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        // Order by idSubmittedAt — updatedAt is bumped by any unrelated write
        // (bio edits, phone verify), so using it here would let users reshuffle
        // their queue position by making unrelated profile changes. Nulls-last
        // because idSubmittedAt is only populated going forward; legacy pending
        // rows without it fall to the end.
        orderBy: [
          { idSubmittedAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          sellerType: true,
          idDocumentUrl: true,
          idSubmittedAt: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Swap the raw S3 URL for a short-lived presigned GET URL so admins can
    // view the document without the bucket being publicly readable.
    const withSignedUrls = await Promise.all(
      users.map(async (u) => ({
        ...u,
        idDocumentUrl: await signIdDocumentUrl(u.idDocumentUrl),
      })),
    );

    res.json({
      users: withSignedUrls,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('List verifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/verifications/:userId — approve or reject an ID submission
// ---------------------------------------------------------------------------
router.put('/verifications/:userId', async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    if (!uuidSchema.safeParse(userId).success) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const parsed = adminReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    // Pre-read gives us a specific 404 (user doesn't exist) vs 409 (wrong
    // state) distinction. Pull email + username too so we can notify the
    // user after the state flip without a second round trip.
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { idVerification: true, email: true, username: true },
    });
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.idVerification !== 'PENDING_REVIEW') {
      res.status(409).json({
        error: `User's ID is not pending review (current: ${target.idVerification}).`,
      });
      return;
    }

    const guard = { id: userId, idVerification: 'PENDING_REVIEW' as const };

    if (parsed.data.action === 'APPROVE') {
      const { count } = await prisma.user.updateMany({
        where: guard,
        data: {
          idVerification: 'APPROVED',
          idRejectionReason: null,
        },
      });
      if (count === 0) {
        res.status(409).json({ error: 'Another admin just updated this review.' });
        return;
      }
      // Fire-and-log: a broken SMTP shouldn't block the approval from
      // returning 200. The user can also see their status in the account
      // verification page regardless.
      sendIdApprovedEmail(target.email, target.username).catch((err) => {
        console.error('Failed to send ID-approved email:', err);
      });
      void createNotification({
        recipientId: userId,
        type: 'ID_APPROVED',
        title: 'ID verified',
        body: 'Your ID has been approved. You can now create listings.',
      });
      res.json({ message: 'ID approved.' });
    } else {
      const { count } = await prisma.user.updateMany({
        where: guard,
        data: {
          idVerification: 'REJECTED',
          idRejectionReason: parsed.data.reason,
          // Clear the document URL so the rejected scan isn't left hanging;
          // the user must re-upload to retry.
          idDocumentUrl: null,
          // Clear the submission timestamp so re-submission gets a fresh slot
          // at the back of the queue on sort time, not the original position.
          idSubmittedAt: null,
        },
      });
      if (count === 0) {
        res.status(409).json({ error: 'Another admin just updated this review.' });
        return;
      }
      sendIdRejectedEmail(target.email, target.username, parsed.data.reason).catch((err) => {
        console.error('Failed to send ID-rejected email:', err);
      });
      void createNotification({
        recipientId: userId,
        type: 'ID_REJECTED',
        title: 'ID rejected',
        body: `Your ID was rejected: ${parsed.data.reason}`,
      });
      res.json({ message: 'ID rejected.' });
    }
  } catch (err) {
    console.error('Review verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/stats — platform overview numbers for the admin dashboard
// ---------------------------------------------------------------------------
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stuckSince = new Date(Date.now() - STUCK_PAYMENT_MIN_AGE_MS);

    const [
      userCount,
      verifiedUserCount,
      pendingVerificationCount,
      listingCounts,
      orderCounts,
      revenueAgg,
      stuckPaymentCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { emailVerified: true } }),
      prisma.user.count({ where: { idVerification: 'PENDING_REVIEW' } }),
      prisma.listing.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      // Revenue = sum of amounts on COMPLETED orders.
      prisma.order.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.order.count({
        where: {
          paymentSessionState: 'PENDING',
          updatedAt: { lt: stuckSince },
        },
      }),
    ]);

    const listings = { ACTIVE: 0, ON_HOLD: 0, SOLD: 0, REMOVED: 0 };
    for (const row of listingCounts) listings[row.status] = row._count._all;

    const orders = {
      PENDING_CONFIRMATION: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    for (const row of orderCounts) orders[row.status] = row._count._all;

    res.json({
      users: { total: userCount, emailVerified: verifiedUserCount },
      listings: {
        total: Object.values(listings).reduce((a, b) => a + b, 0),
        ...listings,
      },
      orders: {
        total: Object.values(orders).reduce((a, b) => a + b, 0),
        ...orders,
      },
      revenue: {
        // Decimal → string to keep precision through JSON.
        totalAud: revenueAgg._sum.amount?.toString() ?? '0',
      },
      pendingVerifications: pendingVerificationCount,
      stuckPayments: stuckPaymentCount,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/orders/stuck — paginated list of PENDING payment sessions
// older than STUCK_PAYMENT_MIN_AGE_MS. Oldest first so the most-likely-
// problematic cases surface on page 1.
// ---------------------------------------------------------------------------
router.get('/orders/stuck', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10) || 20));
    const skip = (page - 1) * limit;

    const stuckSince = new Date(Date.now() - STUCK_PAYMENT_MIN_AGE_MS);

    const where: Prisma.OrderWhereInput = {
      paymentSessionState: 'PENDING',
      updatedAt: { lt: stuckSince },
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          status: true,
          paymentSessionState: true,
          updatedAt: true,
          createdAt: true,
          listing: { select: { id: true, title: true } },
          buyer: { select: { id: true, username: true, email: true } },
          seller: { select: { id: true, username: true, email: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Admin stuck orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
