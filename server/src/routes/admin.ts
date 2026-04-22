import { Router, Request, Response } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import prisma from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { uuidSchema } from '../schemas/common.js';
import { s3, S3_BUCKET, S3_REGION } from '../config/s3.js';
import {
  adminReviewSchema,
  pendingVerificationsQuerySchema,
} from '../schemas/users.js';

const router = Router();

// All admin routes require auth + admin role.
router.use(authenticate, requireAdmin);

const ID_DOC_URL_EXPIRY = 5 * 60; // 5 minutes

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
    // state) distinction. The actual state flip is a conditional updateMany
    // guarded by idVerification='PENDING_REVIEW', so two admins racing on the
    // same row can't both win — the loser's count comes up 0.
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { idVerification: true },
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
      res.json({ message: 'ID rejected.' });
    }
  } catch (err) {
    console.error('Review verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
