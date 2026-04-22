import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../lib/prisma.js';
import { AUTH_CONFIG } from '../config/auth.js';
import { clearTokenCookie } from '../utils/cookies.js';
import { s3, S3_BUCKET, S3_REGION } from '../config/s3.js';
import { authenticate } from '../middleware/auth.js';
import { uuidSchema } from '../schemas/common.js';
import {
  updateProfileSchema,
  changePasswordSchema,
  startPhoneVerificationSchema,
  confirmPhoneVerificationSchema,
  verifyIdSchema,
  verifyAbnSchema,
} from '../schemas/users.js';
import { getSellerStats } from '../services/sellerStats.js';

const router = Router();

const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many password change attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Split the phone limiters so a streak of failed confirms doesn't also block
// the user from requesting a fresh code on a different bucket.
const phoneStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: { error: 'Too many code requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const phoneConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many confirmation attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const PHONE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PHONE_CODE_MAX_ATTEMPTS = 5;
// Dev-only: expose OTP in responses + stdout. Must be an explicit opt-in —
// negating NODE_ENV=production leaks codes wherever NODE_ENV is unset.
const DEV_OTP_ENABLED = process.env.ENABLE_DEV_OTP === '1';

// Private-profile projection — safe to return to the user themselves. Note:
// we still never return `password`, `emailVerificationToken`,
// `phoneVerificationCode`, `tokenVersion`, `idDocumentUrl` (raw S3 URL isn't
// viewable anyway — the prefix is private — and shipping it just widens the
// leak surface in logs/analytics).
const PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  name: true,
  role: true,
  location: true,
  bio: true,
  phone: true,
  emailVerified: true,
  phoneVerified: true,
  sellerType: true,
  businessName: true,
  abn: true,
  abnVerified: true,
  idVerification: true,
  idRejectionReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

type UserProfile = {
  sellerType: 'PERSONAL' | 'BUSINESS';
  emailVerified: boolean;
  phoneVerified: boolean;
  abnVerified: boolean;
  idVerification: 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
};

function computeCanSell(u: UserProfile): { canSell: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!u.emailVerified) missing.push('email');
  if (!u.phoneVerified) missing.push('phone');
  if (u.sellerType === 'PERSONAL') {
    if (u.idVerification !== 'APPROVED') missing.push('id');
  } else {
    if (!u.abnVerified) missing.push('abn');
  }
  return { canSell: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// GET /api/users/profile — current user's full profile
// ---------------------------------------------------------------------------
router.get('/profile', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: PROFILE_SELECT,
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user, ...computeCanSell(user) });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/profile — update name, bio, location, businessName
// Phone changes go through /verify-phone; username and email are immutable.
// ---------------------------------------------------------------------------
router.put('/profile', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { sellerType: true },
    });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.bio !== undefined) data.bio = parsed.data.bio;
    if (parsed.data.location !== undefined) data.location = parsed.data.location;
    // businessName only applies to BUSINESS sellers; silently ignored otherwise.
    if (parsed.data.businessName !== undefined && current.sellerType === 'BUSINESS') {
      data.businessName = parsed.data.businessName;
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data,
      select: PROFILE_SELECT,
    });

    res.json({ user, ...computeCanSell(user) });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/password — change password
// Verifies current password, hashes new one, bumps tokenVersion so other
// sessions (anywhere the old JWT is held) are immediately invalidated.
// ---------------------------------------------------------------------------
router.put('/password', authenticate, passwordChangeLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, password: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      res.status(400).json({ error: 'New password must differ from current password' });
      return;
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, AUTH_CONFIG.bcryptRounds);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: newHash,
        tokenVersion: { increment: 1 },
      },
    });

    // Clear cookie — the caller's JWT is now invalid. Client must log in again.
    clearTokenCookie(res);
    res.json({ message: 'Password changed. Please sign in with your new password.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/verify-phone — start phone verification
// Stores the phone + a hashed 6-digit code + 10-minute expiry. In dev we log
// the code to stdout (Twilio integration stubbed). Replaces any prior pending
// code — and marks phoneVerified=false if the phone changed.
// ---------------------------------------------------------------------------
router.post('/verify-phone', authenticate, phoneStartLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = startPhoneVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { phone } = parsed.data;

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { phone: true, phoneVerified: true },
    });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, AUTH_CONFIG.bcryptRounds);

    const phoneChanged = current.phone !== phone;

    await prisma.user.update({
      where: { id: req.userId },
      data: {
        phone,
        phoneVerificationCode: codeHash,
        phoneVerificationExpires: new Date(Date.now() + PHONE_CODE_TTL_MS),
        phoneVerificationAttempts: 0,
        // If the phone number changed, clear verified state — they must re-verify.
        ...(phoneChanged && { phoneVerified: false }),
      },
    });

    // In production, integrate Twilio:
    //   twilioClient.messages.create({ to: phone, from: TWILIO_FROM, body: ... })
    // Dev-only: log + return the code, but ONLY when explicitly opted-in via
    // ENABLE_DEV_OTP=1. Negating NODE_ENV=production leaks codes wherever
    // NODE_ENV is unset (staging, preview, self-hosted).
    if (DEV_OTP_ENABLED) {
      console.log(`[DEV] Phone verification code for user ${req.userId} (${phone}): ${code}`);
    }

    res.json({
      message: 'Verification code sent.',
      devCode: DEV_OTP_ENABLED ? code : undefined,
    });
  } catch (err) {
    console.error('Start phone verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/verify-phone/confirm — finish phone verification
// Attempt cap is enforced via a conditional updateMany that increments ONLY
// when attempts < MAX. The increment happens BEFORE bcrypt.compare so N
// parallel requests can't each see attempts=0 and burn extra guesses — only
// the first MAX increments succeed, the rest short-circuit to 429.
// ---------------------------------------------------------------------------
router.post('/verify-phone/confirm', authenticate, phoneConfirmLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = confirmPhoneVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { code } = parsed.data;
    const now = new Date();

    // Claim one of the remaining attempt slots atomically. If count===0 the
    // user has no pending code, it expired, or they're out of attempts —
    // figure out which for a specific error.
    const claim = await prisma.user.updateMany({
      where: {
        id: req.userId!,
        phoneVerificationCode: { not: null },
        phoneVerificationExpires: { gt: now },
        phoneVerificationAttempts: { lt: PHONE_CODE_MAX_ATTEMPTS },
      },
      data: { phoneVerificationAttempts: { increment: 1 } },
    });

    if (claim.count === 0) {
      const row = await prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          phoneVerificationCode: true,
          phoneVerificationExpires: true,
        },
      });
      if (!row) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (!row.phoneVerificationCode) {
        res.status(400).json({ error: 'No verification in progress. Request a new code.' });
        return;
      }
      if (!row.phoneVerificationExpires || row.phoneVerificationExpires < now) {
        res.status(400).json({ error: 'Code has expired. Request a new code.' });
        return;
      }
      res.status(429).json({ error: 'Too many attempts. Request a new code.' });
      return;
    }

    // Slot claimed. Read the hash (a separate row could be null if another
    // request raced us to success — treat as "no verification in progress").
    const row = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { phoneVerificationCode: true },
    });
    if (!row?.phoneVerificationCode) {
      res.status(400).json({ error: 'No verification in progress. Request a new code.' });
      return;
    }

    const valid = await bcrypt.compare(code, row.phoneVerificationCode);
    if (!valid) {
      res.status(400).json({ error: 'Incorrect code.' });
      return;
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: {
        phoneVerified: true,
        phoneVerificationCode: null,
        phoneVerificationExpires: null,
        phoneVerificationAttempts: 0,
      },
    });

    res.json({ message: 'Phone verified successfully' });
  } catch (err) {
    console.error('Confirm phone verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/verify-id — submit ID document for admin review
// documentUrl must be an S3 URL under this user's id-documents/ prefix.
// ---------------------------------------------------------------------------
router.post('/verify-id', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = verifyIdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { documentUrl } = parsed.data;

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { sellerType: true, idVerification: true },
    });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (current.sellerType !== 'PERSONAL') {
      res.status(400).json({ error: 'ID verification is for personal sellers only. Business sellers verify via ABN.' });
      return;
    }

    if (current.idVerification === 'PENDING_REVIEW' || current.idVerification === 'APPROVED') {
      res.status(409).json({ error: `ID is already ${current.idVerification.toLowerCase().replace('_', ' ')}.` });
      return;
    }

    // URL must belong to this user's id-documents prefix on our bucket.
    if (!S3_BUCKET) {
      res.status(503).json({ error: 'ID upload service is not configured.' });
      return;
    }
    const bucketRoot = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/`;
    const expectedPrefix = `${bucketRoot}id-documents/${req.userId}/`;
    if (!documentUrl.startsWith(expectedPrefix)) {
      res.status(400).json({ error: 'Document URL does not match your upload prefix.' });
      return;
    }

    // Verify the object actually exists before flipping to PENDING_REVIEW.
    // A syntactically-valid URL under the user's prefix proves nothing — the
    // user could POST the path without having uploaded, leaving admins to
    // click View document and 404. HEAD is cheap and catches this.
    const key = documentUrl.slice(bucketRoot.length);
    try {
      await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404 || status === 403) {
        res.status(400).json({ error: 'Upload not found. Please try uploading again.' });
        return;
      }
      throw err;
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: {
        idDocumentUrl: documentUrl,
        idVerification: 'PENDING_REVIEW',
        idSubmittedAt: new Date(),
        idRejectionReason: null,
      },
    });

    res.json({ message: 'ID document submitted for review.' });
  } catch (err) {
    console.error('Verify ID error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Australian ABN checksum (ATO algorithm).
// https://abr.business.gov.au/Help/AbnFormat
function validateAbnChecksum(abn: string): boolean {
  if (!/^[0-9]{11}$/.test(abn)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const digits = abn.split('').map(Number);
  // Step 1: subtract 1 from the leftmost digit.
  digits[0] -= 1;
  // Step 2: weighted sum.
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  // Step 3: valid iff sum is divisible by 89.
  return sum % 89 === 0;
}

// ---------------------------------------------------------------------------
// POST /api/users/verify-abn — validate ABN and mark verified
// Uses the ATO checksum algorithm (no external API call for demo). Only for
// BUSINESS sellers. Returns 400 on invalid checksum.
// ---------------------------------------------------------------------------
router.post('/verify-abn', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = verifyAbnSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { abn } = parsed.data;

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { sellerType: true },
    });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (current.sellerType !== 'BUSINESS') {
      res.status(400).json({ error: 'ABN verification is for business sellers only.' });
      return;
    }

    if (!validateAbnChecksum(abn)) {
      res.status(400).json({ error: 'Invalid ABN. Check the number and try again.' });
      return;
    }

    // An ABN is 1:1 with a real Australian business. Reject if another user has
    // already verified this number. This is defence-in-depth — a partial-unique
    // index (where abn is not null) would be the race-safe version, but Prisma
    // doesn't generate those from the schema file, so we check in-handler.
    const clash = await prisma.user.findFirst({
      where: { abn, id: { not: req.userId! } },
      select: { id: true },
    });
    if (clash) {
      res.status(409).json({ error: 'This ABN is already registered to another account.' });
      return;
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: { abn, abnVerified: true },
    });

    res.json({ message: 'ABN verified.' });
  } catch (err) {
    console.error('Verify ABN error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/users/:id — public seller profile
// Returns only fields safe for public display. Email, phone, role,
// verification status, idDocumentUrl, etc. are deliberately excluded.
// MUST stay last — /:id would otherwise swallow /profile, /verify-phone, etc.
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    if (!uuidSchema.safeParse(id).success) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        bio: true,
        location: true,
        sellerType: true,
        businessName: true,
        createdAt: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const stats = await getSellerStats(id);

    // Public profile is "seller-shaped" — hide pure-buyer accounts behind 404
    // so /sellers/<any-uuid> can't surface an empty profile via URL scraping.
    // Anyone who has ever listed, sold, or been reviewed shows up.
    if (stats.listingsCount === 0 && stats.totalSales === 0 && stats.totalReviews === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: {
        ...user,
        avgRating: stats.avgRating,
        totalReviews: stats.totalReviews,
        totalSales: stats.totalSales,
      },
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
