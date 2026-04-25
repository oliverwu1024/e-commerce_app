import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { AUTH_CONFIG } from '../config/auth.js';
import { EMAIL_CONFIG } from '../config/email.js';
import { clearTokenCookie } from '../utils/cookies.js';
import { s3, S3_BUCKET, S3_REGION } from '../config/s3.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { uuidSchema } from '../schemas/common.js';
import {
  updateProfileSchema,
  changePasswordSchema,
  changeUsernameSchema,
  changeEmailSchema,
  confirmPhoneVerificationSchema,
  verifyIdSchema,
  verifyAbnSchema,
  deleteAccountSchema,
  updateAvatarSchema,
} from '../schemas/users.js';
import { getSellerStats } from '../services/sellerStats.js';
import {
  generateVerificationToken,
  sendVerificationEmail,
  sendIdSubmittedEmail,
} from '../utils/email.js';
import { firebaseAuth, FIREBASE_ENABLED } from '../config/firebase.js';
import { getStripeClient, isStripeConfigured } from '../config/stripe.js';

const DEV_EMAIL_ENABLED = process.env.ENABLE_DEV_EMAIL === '1';

function buildVerificationUrl(token: string): string {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  return `${clientUrl}/verify-email?token=${token}`;
}

const router = Router();

const profileLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later' },
});

const passwordChangeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many password change attempts, please try again later' },
});

// Phone verify happens via Firebase Phone Auth on the client; server only
// sees the resulting ID token. One limiter is enough — the confirm endpoint
// is the only phone-related write surface now.
const phoneConfirmLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts, please try again later' },
});

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
  avatarUrl: true,
  emailVerified: true,
  pendingEmail: true,
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
// POST /api/users/verify-phone/confirm — finalise phone verification
//
// Phone verification runs through Firebase Phone Auth on the client (Firebase
// handles the SMS send, reCAPTCHA, OTP entry, and code validation). All we
// see is the resulting Firebase ID token, which carries the verified phone
// number in its claims. Our job: verify the token signature + freshness,
// confirm the phone is AU, and flip phoneVerified=true on our user row.
//
// Why Firebase: SMS-toll abuse is Google's problem now. The 6 cost-ceiling
// layers we previously maintained (per-phone cooldown, daily SMS budget,
// per-user rate limit, AU-only schema, email gate, Turnstile on /register)
// are mostly subsumed by Firebase's own throttling + reCAPTCHA. We keep the
// email gate + AU-only check as belt-and-braces.
// ---------------------------------------------------------------------------
router.post('/verify-phone/confirm', authenticate, phoneConfirmLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = confirmPhoneVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { idToken } = parsed.data;

    if (!FIREBASE_ENABLED) {
      console.error('[verify-phone] Firebase not configured — refusing token');
      res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });
      return;
    }

    // Email gate. Belt-and-braces: client should be checking this before
    // initiating Firebase, but verify server-side too in case a request
    // bypasses the UI.
    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { emailVerified: true },
    });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (!current.emailVerified) {
      res.status(403).json({
        error: 'Verify your email address first, then come back to verify your phone.',
      });
      return;
    }

    // Verify the Firebase ID token. checkRevoked=true forces a server-side
    // revocation lookup against Firebase — necessary if you ever revoke a
    // Firebase user. For phone verification this is largely paranoia, but
    // the call is cheap and Google caches the public keys.
    let decoded;
    try {
      decoded = await firebaseAuth().verifyIdToken(idToken, true);
    } catch (err) {
      console.warn('[verify-phone] Firebase token verification failed:', err);
      res.status(400).json({ error: 'Invalid or expired verification token.' });
      return;
    }

    const phone = (decoded.phone_number || '').trim();
    if (!phone) {
      res.status(400).json({ error: 'No verified phone number on this token.' });
      return;
    }

    // AU-only check. Defensive — we restrict the country picker on the
    // client, but Firebase doesn't enforce country-of-origin so we re-check.
    if (!/^\+61[2-478][0-9]{8}$/.test(phone)) {
      res.status(400).json({
        error: 'Only Australian (+61) phone numbers are accepted.',
      });
      return;
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: {
        phone,
        phoneVerified: true,
        // Clear any legacy OTP state from the previous server-driven flow —
        // these columns are dormant under Firebase but worth zeroing out
        // when a user successfully verifies, so the row is tidy.
        phoneVerificationCode: null,
        phoneVerificationExpires: null,
        phoneVerificationAttempts: 0,
      },
    });

    res.json({ message: 'Phone verified successfully', phone });
  } catch (err) {
    console.error('Confirm phone verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/verify-id — submit ID document for admin review
// Both documentUrl (front) and documentBackUrl (back) must be S3 URLs under
// this user's id-documents/ prefix. Each is HEAD-checked before we flip state.
// ---------------------------------------------------------------------------
router.post('/verify-id', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = verifyIdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { documentUrl, documentBackUrl } = parsed.data;

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { sellerType: true, idVerification: true, username: true, email: true },
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

    if (documentUrl === documentBackUrl) {
      res.status(400).json({ error: 'Front and back must be different uploads.' });
      return;
    }

    // Each URL must belong to this user's id-documents prefix on our bucket.
    if (!S3_BUCKET) {
      res.status(503).json({ error: 'ID upload service is not configured.' });
      return;
    }
    const bucketRoot = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/`;
    const expectedPrefix = `${bucketRoot}id-documents/${req.userId}/`;
    if (!documentUrl.startsWith(expectedPrefix)) {
      res.status(400).json({ error: 'Front document URL does not match your upload prefix.' });
      return;
    }
    if (!documentBackUrl.startsWith(expectedPrefix)) {
      res.status(400).json({ error: 'Back document URL does not match your upload prefix.' });
      return;
    }

    // HEAD-check both uploads before flipping state. A syntactically-valid URL
    // under the user's prefix proves nothing — the user could POST the path
    // without having actually uploaded, leaving admins to click and 404.
    for (const [label, url] of [
      ['front', documentUrl],
      ['back', documentBackUrl],
    ] as const) {
      const key = url.slice(bucketRoot.length);
      try {
        await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (status === 404 || status === 403) {
          res.status(400).json({ error: `${label === 'front' ? 'Front' : 'Back'} upload not found. Please try uploading again.` });
          return;
        }
        throw err;
      }
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: {
        idDocumentUrl: documentUrl,
        idDocumentBackUrl: documentBackUrl,
        idVerification: 'PENDING_REVIEW',
        idSubmittedAt: new Date(),
        idRejectionReason: null,
      },
    });

    // Notify admin. Fire-and-log: a broken email pipeline shouldn't block the
    // user from flipping to PENDING_REVIEW — the dashboard is authoritative.
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      sendIdSubmittedEmail(adminEmail, current.username, current.email, req.userId!).catch(
        (err) => {
          console.error('Failed to send ID-submitted admin email:', err);
        },
      );
    }

    res.json({ message: 'ID documents submitted for review.' });
  } catch (err) {
    console.error('Verify ID error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/verify-id/stripe-session — start a Stripe Identity flow
// Creates a `VerificationSession` with type=document (passport, ID, licence)
// + selfie matching, stores the session id on the user, and returns the
// hosted-page URL so the client can redirect. Webhook handler at
// /api/webhooks/stripe/identity flips idVerification to APPROVED/REJECTED
// when the session reaches a terminal state.
//
// Idempotency: if the user already has an active session that hasn't
// resolved, return its existing URL instead of creating a new one. Stripe
// charges per session even when abandoned, so we don't want a button-mash
// to rack up cost.
// ---------------------------------------------------------------------------
router.post(
  '/verify-id/stripe-session',
  authenticate,
  profileLimiter,
  async (req: Request, res: Response) => {
    try {
      if (!isStripeConfigured()) {
        res.status(503).json({ error: 'Stripe is not configured on this server.' });
        return;
      }

      const current = await prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          sellerType: true,
          idVerification: true,
          idVerificationSessionId: true,
          username: true,
          email: true,
        },
      });
      if (!current) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (current.sellerType !== 'PERSONAL') {
        res.status(400).json({
          error: 'ID verification is for personal sellers only. Business sellers verify via ABN.',
        });
        return;
      }
      if (current.idVerification === 'APPROVED') {
        res.status(409).json({ error: 'ID is already approved.' });
        return;
      }

      const stripe = getStripeClient();
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const returnUrl = `${clientUrl}/account/verification?id=stripe`;

      // If we already started a session, see whether it's reusable.
      // requires_input / processing → reuse the same hosted URL so the
      // buyer's reload doesn't burn another paid session. canceled /
      // verified → fall through and create a new one.
      if (current.idVerificationSessionId) {
        try {
          const existing = await stripe.identity.verificationSessions.retrieve(
            current.idVerificationSessionId,
          );
          if (
            existing.status === 'requires_input' ||
            existing.status === 'processing'
          ) {
            res.json({ url: existing.url, sessionId: existing.id, reused: true });
            return;
          }
        } catch (err) {
          // Treat retrieve failure (session expired, key rotated, etc.) as
          // "no existing session" and fall through to create a fresh one.
          console.warn('[verify-id stripe] retrieve existing session failed:', err);
        }
      }

      const session = await stripe.identity.verificationSessions.create({
        type: 'document',
        // Selfie + liveness on top of document verification. Matches the
        // assurance level we previously got from manual review.
        options: {
          document: {
            require_matching_selfie: true,
            require_live_capture: true,
          },
        },
        metadata: {
          userId: req.userId!,
          username: current.username,
        },
        return_url: returnUrl,
      });

      await prisma.user.update({
        where: { id: req.userId },
        data: {
          idVerificationSessionId: session.id,
          idVerification: 'PENDING_REVIEW',
          idSubmittedAt: new Date(),
          idRejectionReason: null,
        },
      });

      res.json({ url: session.url, sessionId: session.id, reused: false });
    } catch (err) {
      console.error('Verify ID (Stripe) error:', err);
      res.status(500).json({ error: 'Failed to start ID verification.' });
    }
  },
);

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
// PUT /api/users/username — change username
// Format matches register. Uniqueness enforced by @unique + P2002 catch.
// No reverify needed — username is a display label, not a credential.
// ---------------------------------------------------------------------------
router.put('/username', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = changeUsernameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const username = parsed.data.username.toLowerCase();

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { username: true },
    });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (current.username === username) {
      res.status(400).json({ error: 'This is already your username.' });
      return;
    }

    try {
      const user = await prisma.user.update({
        where: { id: req.userId },
        data: { username },
        select: PROFILE_SELECT,
      });
      res.json({ user, ...computeCanSell(user) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(409).json({ error: 'Username is already taken.' });
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error('Change username error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/email-change — request an email change
//
// Two-phase: stores the new address in pendingEmail, sends verification to
// the new address, and only swaps email ← pendingEmail after the user clicks
// the link (handled in routes/auth.ts verify-email). Old email stays live
// until then — so a mistyped new address doesn't lock the user out, and a
// stolen session can't swap the email without also controlling the new inbox.
// ---------------------------------------------------------------------------
router.post('/email-change', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = changeEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const newEmail = parsed.data.email.toLowerCase();

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { email: true },
    });
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (current.email === newEmail) {
      res.status(400).json({ error: 'This is already your email.' });
      return;
    }

    // Collision check against other users' active emails. Pending-vs-pending
    // collisions between two different users are OK — first to verify wins;
    // the loser hits P2002 at swap time in the verify-email handler.
    const clash = await prisma.user.findFirst({
      where: { email: newEmail, id: { not: req.userId! } },
      select: { id: true },
    });
    if (clash) {
      res.status(409).json({ error: 'That email is already in use.' });
      return;
    }

    const token = generateVerificationToken();

    try {
      await prisma.user.update({
        where: { id: req.userId },
        data: {
          pendingEmail: newEmail,
          emailVerificationToken: token,
          emailVerificationExpires: new Date(Date.now() + EMAIL_CONFIG.verificationTokenExpires),
        },
      });
    } catch (err) {
      // `emailVerificationToken` is @unique — unlikely but possible collision.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(500).json({ error: 'Internal server error' });
        return;
      }
      throw err;
    }

    let verificationEmailSent = true;
    try {
      await sendVerificationEmail(newEmail, token);
    } catch (err) {
      verificationEmailSent = false;
      console.error('Failed to send email-change verification:', err);
    }

    if (DEV_EMAIL_ENABLED) {
      console.log(
        `[DEV] Email-change verification URL for ${newEmail}: ${buildVerificationUrl(token)}`,
      );
    }

    res.json({
      message: 'Verification email sent to the new address.',
      pendingEmail: newEmail,
      verificationEmailSent,
      devVerificationUrl: DEV_EMAIL_ENABLED ? buildVerificationUrl(token) : undefined,
    });
  } catch (err) {
    console.error('Email change error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/avatar — set or replace the user's profile picture
//
// Accepts an S3 URL returned by the presigned-url endpoint with
// purpose=avatar. Validates that the URL lives under this user's avatar
// prefix so a user can't claim another user's upload. HEADs the object
// before storing (catches "URL posted without upload" / expired presign).
// ---------------------------------------------------------------------------
router.put('/avatar', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = updateAvatarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { avatarUrl } = parsed.data;

    if (!S3_BUCKET) {
      res.status(503).json({ error: 'Avatar uploads are not configured.' });
      return;
    }
    const bucketRoot = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/`;
    // Matches the dev-shortcut prefix in `routes/uploads.ts` (avatars stored
    // under `listings/avatars/<userId>/` for now). Flip to `avatars/<userId>/`
    // when the IAM + bucket policy are widened for prod.
    const expectedPrefix = `${bucketRoot}listings/avatars/${req.userId}/`;
    if (!avatarUrl.startsWith(expectedPrefix)) {
      res.status(400).json({ error: 'Avatar URL does not match your upload prefix.' });
      return;
    }

    const key = avatarUrl.slice(bucketRoot.length);
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

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl },
      select: PROFILE_SELECT,
    });
    res.json({ user, ...computeCanSell(user) });
  } catch (err) {
    console.error('Update avatar error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/avatar — clear the user's profile picture
// We don't delete the S3 object itself — cheap to leave, and it makes undo
// flows (re-use recent uploads) trivial later. A garbage-collection job
// for orphaned avatars is a Day-21+ concern.
// ---------------------------------------------------------------------------
router.delete('/avatar', authenticate, profileLimiter, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: null },
      select: PROFILE_SELECT,
    });
    res.json({ user, ...computeCanSell(user) });
  } catch (err) {
    console.error('Delete avatar error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/me — soft-delete the authenticated user's account
//
// Requires currentPassword + exact confirmation phrase. Refuses when the
// user has in-flight orders (PENDING_CONFIRMATION or CONFIRMED as either
// buyer or seller) — those involve a counterparty who would otherwise be
// stranded. The user must resolve them (confirm / cancel / complete) first.
//
// On success: anonymizes PII (name, email, username, bio, location, phone,
// idDocumentUrl, abn, businessName, emailVerificationToken, etc.), sets
// deletedAt, bumps tokenVersion so any outstanding JWTs fail, flips all
// ACTIVE/ON_HOLD listings to REMOVED, and purges cart + saved items. The
// User row stays in place so FKs from orders / reviews / messages remain
// valid for counterparties. Login, authenticate middleware, and public
// profile lookups all reject users with deletedAt set.
// ---------------------------------------------------------------------------
router.delete('/me', authenticate, passwordChangeLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, password: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Password is incorrect' });
      return;
    }

    // Counterparty-safety check: deletion would leave the other side stuck
    // waiting for confirm / pay / complete. Make the user resolve these
    // first. SOLD / CANCELLED / COMPLETED / REMOVED states are fine — the
    // business is settled.
    const inFlight = await prisma.order.findMany({
      where: {
        OR: [{ buyerId: user.id }, { sellerId: user.id }],
        status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
      },
      select: { id: true, status: true, buyerId: true },
      take: 5,
    });
    if (inFlight.length > 0) {
      res.status(409).json({
        error:
          'Resolve your open orders before deleting your account. Confirm / cancel pending orders as the seller, or pay / cancel confirmed orders as the buyer.',
        inFlightOrderIds: inFlight.map((o) => o.id),
      });
      return;
    }

    // Anonymize + mark deleted in a single transaction so the user row is
    // either fully neutralized or untouched — no half-states where email is
    // scrubbed but deletedAt isn't set (still "live" but PII-less).
    const nowIso = new Date();
    const anonEmail = `deleted-${user.id}@deleted.local`;
    const anonUsername = `deleted_${user.id.replace(/-/g, '').slice(0, 24)}`;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          deletedAt: nowIso,
          // Bump so any outstanding JWT on another device fails auth.
          tokenVersion: { increment: 1 },
          // Anonymize PII. Email + username must stay unique-violation-free
          // so we derive them from the UUID.
          email: anonEmail,
          username: anonUsername,
          name: 'Deleted user',
          location: null,
          bio: null,
          phone: null,
          avatarUrl: null,
          businessName: null,
          abn: null,
          abnVerified: false,
          idDocumentUrl: null,
          idSubmittedAt: null,
          idRejectionReason: null,
          idVerification: 'NOT_SUBMITTED',
          emailVerified: false,
          emailVerificationToken: null,
          emailVerificationExpires: null,
          pendingEmail: null,
          phoneVerified: false,
          phoneVerificationCode: null,
          phoneVerificationExpires: null,
          phoneVerificationAttempts: 0,
        },
      }),
      // Active listings go off the marketplace. SOLD stays SOLD (order
      // history intact for the buyer); ON_HOLD flips too since the seller
      // is gone — but we already blocked in-flight orders above, so any
      // ON_HOLD here must be an orphan from a CANCELLED order that didn't
      // cleanly restore ACTIVE. Belt and braces.
      prisma.listing.updateMany({
        where: { sellerId: user.id, status: { in: ['ACTIVE', 'ON_HOLD'] } },
        data: { status: 'REMOVED' },
      }),
      // Personal-only data — no counterparty depends on these.
      prisma.savedListing.deleteMany({ where: { userId: user.id } }),
      prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } }),
      prisma.cart.deleteMany({ where: { userId: user.id } }),
    ]);

    clearTokenCookie(res);
    res.json({ message: 'Account deleted.' });
  } catch (err) {
    console.error('Delete account error:', err);
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
        avatarUrl: true,
        sellerType: true,
        businessName: true,
        createdAt: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt) {
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

    const { deletedAt: _deletedAt, ...publicUser } = user;
    void _deletedAt;
    res.json({
      user: {
        ...publicUser,
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
