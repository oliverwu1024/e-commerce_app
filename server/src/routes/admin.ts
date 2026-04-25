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
import {
  sendAdminContactReply,
  sendIdApprovedEmail,
  sendIdRejectedEmail,
} from '../utils/email.js';
import { createNotification } from '../services/notifications.js';
import { sendBroadcast } from '../services/broadcasts.js';
import { z } from 'zod';

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
          idDocumentBackUrl: true,
          idSubmittedAt: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Swap raw S3 URLs for short-lived presigned GET URLs so admins can view
    // the documents without the bucket being publicly readable. Front + back
    // are signed independently so admins can open either in a new tab.
    const withSignedUrls = await Promise.all(
      users.map(async (u) => ({
        ...u,
        idDocumentUrl: await signIdDocumentUrl(u.idDocumentUrl),
        idDocumentBackUrl: await signIdDocumentUrl(u.idDocumentBackUrl),
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
          // Clear both document URLs so rejected scans aren't left hanging;
          // the user must re-upload both sides to retry.
          idDocumentUrl: null,
          idDocumentBackUrl: null,
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
      newSupportCount,
      openDisputeCount,
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
      // Revenue = sum of amounts on any post-payment order (PAID/SHIPPED/COMPLETED).
      // Money has already moved at PAID; gating on COMPLETED-only would
      // under-report revenue while orders sit in SHIPPED awaiting buyer
      // confirmation.
      prisma.order.aggregate({
        where: { status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] } },
        _sum: { amount: true },
      }),
      prisma.order.count({
        where: {
          paymentSessionState: 'PENDING',
          updatedAt: { lt: stuckSince },
        },
      }),
      // Support backlog: NEW = unread submissions OR threads where the
      // customer just replied. REPLIED + CLOSED don't count.
      prisma.contactSubmission.count({ where: { status: 'NEW' } }),
      // Disputes the admin still owes a decision on.
      prisma.dispute.count({ where: { status: 'OPEN' } }),
    ]);

    const listings = { ACTIVE: 0, ON_HOLD: 0, SOLD: 0, REMOVED: 0 };
    for (const row of listingCounts) listings[row.status] = row._count._all;

    const orders = {
      PENDING_CONFIRMATION: 0,
      CONFIRMED: 0,
      PAID: 0,
      SHIPPED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      REFUNDED: 0,
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
      newSupportSubmissions: newSupportCount,
      openDisputes: openDisputeCount,
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

// ===========================================================================
// USERS — admin browser
// ===========================================================================

router.get('/users', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { username: { contains: q, mode: 'insensitive' as const } },
            { name: { contains: q, mode: 'insensitive' as const } },
            { businessName: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        sellerType: true,
        businessName: true,
        emailVerified: true,
        phoneVerified: true,
        idVerification: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    users,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ===========================================================================
// CONTACT SUBMISSIONS — list + reply + close
// ===========================================================================

router.get('/contact', async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));

  const where: Prisma.ContactSubmissionWhereInput =
    status === 'NEW' || status === 'REPLIED' || status === 'CLOSED'
      ? { status }
      : {};

  const [submissions, total] = await Promise.all([
    prisma.contactSubmission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        replies: {
          orderBy: { sentAt: 'asc' },
          include: { admin: { select: { id: true, username: true } } },
        },
        closedBy: { select: { id: true, username: true } },
      },
    }),
    prisma.contactSubmission.count({ where }),
  ]);
  res.json({
    submissions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

const replyContactSchema = z.object({
  body: z.string().trim().min(1, 'Reply cannot be empty').max(5000),
});

router.post(
  '/contact/:id/reply',
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid submission ID' });
      return;
    }
    const parsed = replyContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const submission = await prisma.contactSubmission.findUnique({
      where: { id },
    });
    if (!submission) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }
    try {
      await sendAdminContactReply(
        submission.id,
        submission.fromEmail,
        submission.fromName,
        submission.subject,
        parsed.data.body,
      );
    } catch (err) {
      console.error('[admin contact reply] send failed:', err);
      res.status(502).json({ error: 'Failed to send reply email' });
      return;
    }
    // Record reply + flip status to REPLIED only after the email actually
    // landed at Resend — otherwise we'd show "replied" in the UI for a
    // message the customer never received.
    const reply = await prisma.contactReply.create({
      data: {
        submissionId: id,
        body: parsed.data.body,
        adminId: req.userId!,
        direction: 'OUTBOUND',
      },
    });
    await prisma.contactSubmission.update({
      where: { id },
      data: {
        status: submission.status === 'CLOSED' ? 'CLOSED' : 'REPLIED',
      },
    });
    res.json({ reply });
  },
);

router.post(
  '/contact/:id/close',
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid submission ID' });
      return;
    }
    const updated = await prisma.contactSubmission.updateMany({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: req.userId!,
      },
    });
    if (updated.count === 0) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }
    res.json({ ok: true });
  },
);

// ===========================================================================
// BROADCASTS — admin announcements (email + in-app notification fan-out)
// ===========================================================================

const audienceEnum = z.enum([
  'ALL_VERIFIED',
  'ALL_SELLERS',
  'BUSINESS_SELLERS',
  'PERSONAL_SELLERS',
  'SELLERS_NO_PAYMENT',
  'CUSTOM_EMAILS',
]);

const broadcastSchema = z
  .object({
    subject: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(20000),
    audience: audienceEnum,
    targetEmails: z
      .string()
      .trim()
      .max(5000)
      .optional(),
    channelEmail: z.boolean().default(true),
    channelInApp: z.boolean().default(true),
  })
  .refine((v) => v.channelEmail || v.channelInApp, {
    message: 'At least one channel (email or in-app) must be enabled',
  })
  .refine(
    (v) => v.audience !== 'CUSTOM_EMAILS' || (v.targetEmails && v.targetEmails.length > 0),
    {
      message: 'targetEmails is required when audience=CUSTOM_EMAILS',
      path: ['targetEmails'],
    },
  );

router.post('/broadcasts', async (req: Request, res: Response) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  try {
    const result = await sendBroadcast({
      sentById: req.userId!,
      subject: parsed.data.subject,
      body: parsed.data.body,
      audience: parsed.data.audience,
      targetEmails: parsed.data.targetEmails ?? null,
      channelEmail: parsed.data.channelEmail,
      channelInApp: parsed.data.channelInApp,
    });
    res.json(result);
  } catch (err) {
    console.error('Broadcast send failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Broadcast failed',
    });
  }
});

router.get('/broadcasts', async (_req: Request, res: Response) => {
  const broadcasts = await prisma.broadcast.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      sentBy: { select: { id: true, username: true } },
    },
  });
  res.json({ broadcasts });
});

// Audience preview — admin asks "how many people would this hit?" before
// hitting send. Reuses the same resolver as the actual send so they can't
// drift.
router.post('/broadcasts/preview', async (req: Request, res: Response) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { resolveAudience } = await import('../services/broadcasts.js');
  const recipients = await resolveAudience(parsed.data.audience, parsed.data.targetEmails ?? null);
  res.json({
    count: recipients.length,
    sample: recipients.slice(0, 10).map((r) => ({ email: r.email, name: r.name })),
  });
});

export default router;
