import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Prisma } from '../generated/prisma/client.js';
import prisma from '../lib/prisma.js';
import { AUTH_CONFIG } from '../config/auth.js';
import { EMAIL_CONFIG } from '../config/email.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../schemas/auth.js';
import { authenticate, JwtPayload } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { clearTokenCookie } from '../utils/cookies.js';
import {
  generateVerificationToken,
  hashToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../utils/email.js';
import { verifyTurnstile, TURNSTILE_ENABLED } from '../utils/turnstile.js';
import { logger } from '../utils/logger.js';

const router = Router();

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
});

// Dev-only: expose the verification URL in API responses + stdout so a dev
// can exercise the email-verification flow without real SMTP. Explicit
// opt-in via env var, with a hard refusal in production so a misconfigured
// prod deploy can't accidentally leak tokens to API responses + stdout.
// Mirrors ENABLE_DEV_OTP.
const DEV_EMAIL_ENABLED =
  process.env.ENABLE_DEV_EMAIL === '1' && process.env.NODE_ENV !== 'production';

function buildVerificationUrl(token: string): string {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  return `${clientUrl}/verify-email?token=${token}`;
}

// Fixed bcrypt hash used when a login attempt finds no user — ensures the
// response time stays constant regardless of whether the email exists. Prevents
// attackers from enumerating registered emails via timing side-channel.
// This is NOT a real password hash; its plaintext is unknown and unknowable.
const DUMMY_PASSWORD_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

function signToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ userId, tv: tokenVersion } satisfies JwtPayload, AUTH_CONFIG.jwtSecret, {
    expiresIn: AUTH_CONFIG.jwtExpiresIn,
  } as jwt.SignOptions);
}

function setTokenCookie(res: Response, token: string): void {
  res.cookie(AUTH_CONFIG.cookie.name, token, {
    httpOnly: AUTH_CONFIG.cookie.httpOnly,
    secure: AUTH_CONFIG.cookie.secure,
    sameSite: AUTH_CONFIG.cookie.sameSite,
    maxAge: AUTH_CONFIG.cookie.maxAge,
    path: '/',
  });
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { password, name, location, bio, sellerType, businessName, abn, turnstileToken } = parsed.data;
    const email = parsed.data.email.toLowerCase();
    const username = parsed.data.username.toLowerCase();

    // Bot defence — the whole phone-verification cost ceiling depends on this
    // endpoint not being a free way to mint accounts. When Turnstile is
    // disabled (creds unset) verifyTurnstile() returns true, so local dev
    // proceeds unchanged.
    if (TURNSTILE_ENABLED) {
      const ok = await verifyTurnstile(turnstileToken, req.ip);
      if (!ok) {
        res.status(400).json({ error: 'Bot check failed. Please try again.' });
        return;
      }
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      res.status(409).json({ error: 'Email or username already taken' });
      return;
    }

    // ABN is 1:1 with a real Australian business — reject if another account
    // already claimed it. Race-safe version would need a partial unique index
    // (where abn is not null) but Prisma doesn't generate those, so check here.
    // TODO: augment with ABR Lookup to confirm the ABN is currently active and
    // auto-fill businessName from the registered entity name.
    if (sellerType === 'BUSINESS' && abn) {
      const abnClash = await prisma.user.findFirst({
        where: { abn },
        select: { id: true },
      });
      if (abnClash) {
        res.status(409).json({ error: 'This ABN is already registered to another account.' });
        return;
      }
    }

    const hashedPassword = await bcrypt.hash(password, AUTH_CONFIG.bcryptRounds);
    const verificationToken = generateVerificationToken();

    const user = await prisma.user.create({
      data: {
        email, username, password: hashedPassword, name, location, bio,
        sellerType,
        businessName: sellerType === 'BUSINESS' ? businessName : null,
        abn: sellerType === 'BUSINESS' ? abn : null,
        abnVerified: sellerType === 'BUSINESS',
        emailVerificationToken: hashToken(verificationToken),
        emailVerificationExpires: new Date(Date.now() + EMAIL_CONFIG.verificationTokenExpires),
      },
    });

    // Await the email send so we can surface the outcome to the client. On
    // failure, the account is still created — the client can prompt the user
    // to retry via the resend flow.
    let verificationEmailSent = true;
    try {
      await sendVerificationEmail(email, verificationToken);
    } catch (err) {
      verificationEmailSent = false;
      logger.error('auth.register.send_verification_email.failed', { err: String(err) });
    }

    if (DEV_EMAIL_ENABLED) {
      logger.debug('auth.register.dev_verification_url', {
        email,
        url: buildVerificationUrl(verificationToken),
      });
    }

    const token = signToken(user.id, user.tokenVersion);
    setTokenCookie(res, token);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        location: user.location,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        sellerType: user.sellerType,
        businessName: user.businessName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      verificationEmailSent,
      devVerificationUrl: DEV_EMAIL_ENABLED
        ? buildVerificationUrl(verificationToken)
        : undefined,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Email or username already taken' });
      return;
    }
    logger.error('auth.register.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { password } = parsed.data;
    const email = parsed.data.email.toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    // Always run bcrypt.compare — even on a missing user — so response time
    // doesn't reveal whether the email exists.
    const valid = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH);
    // Deleted accounts use the generic "invalid" error so the caller can't
    // probe for which addresses belong to deleted accounts.
    if (!user || !valid || user.deletedAt) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken(user.id, user.tokenVersion);
    setTokenCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        location: user.location,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        sellerType: user.sellerType,
        businessName: user.businessName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    logger.error('auth.login.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        location: true,
        bio: true,
        avatarUrl: true,
        sellerType: true,
        businessName: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (err) {
    logger.error('auth.me.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  clearTokenCookie(res);
  res.json({ message: 'Logged out' });
});

// POST /api/auth/logout-all — "sign out of all devices". Bumps
// tokenVersion so every JWT issued before this moment fails the middleware's
// version check and 401s. Differs from /logout which just clears the cookie
// on this one browser — a JWT copied off the wire could still be replayed
// until its 7-day expiry without this. Rate-limited so a cookie-holder
// can't burn sessions in a tight loop.
router.post('/logout-all', authenticate, authLimiter, async (req: Request, res: Response) => {
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    clearTokenCookie(res);
    res.json({ message: 'Signed out of all devices' });
  } catch (err) {
    logger.error('auth.logout_all.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', authLimiter, async (req: Request<{ token: string }>, res: Response) => {
  try {
    const { token } = req.params;

    const user = await prisma.user.findUnique({
      where: { emailVerificationToken: hashToken(token) },
    });

    if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      res.status(400).json({ error: 'Invalid or expired verification link' });
      return;
    }

    // Two flows converge here:
    //   1. Initial verification — `pendingEmail` is null. We just flip
    //      `emailVerified=true` on the existing address.
    //   2. Email change — `pendingEmail` holds the new address. Swap
    //      `email ← pendingEmail` (catch P2002 in case someone else
    //      registered the address in the meantime) and clear pending.
    try {
      if (user.pendingEmail) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            email: user.pendingEmail,
            pendingEmail: null,
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null,
            // Email change is a takeover-recovery boundary — invalidate any
            // sessions still riding the old email's auth context (including
            // an attacker's, if the change request itself was the takeover).
            tokenVersion: { increment: 1 },
          },
        });
        clearTokenCookie(res);
        res.json({ message: 'Email updated successfully. Please sign in again.' });
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null,
          },
        });
        res.json({ message: 'Email verified successfully' });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Another account grabbed the email between email-change and verify.
        // Clear pendingEmail so the user can try a different address.
        await prisma.user.update({
          where: { id: user.id },
          data: {
            pendingEmail: null,
            emailVerificationToken: null,
            emailVerificationExpires: null,
          },
        });
        res.status(409).json({ error: 'That email is no longer available. Please try a different address.' });
        return;
      }
      throw err;
    }
  } catch (err) {
    logger.error('auth.verify_email.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', authenticate, authLimiter, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ error: 'Email is already verified' });
      return;
    }

    const verificationToken = generateVerificationToken();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: hashToken(verificationToken),
        emailVerificationExpires: new Date(Date.now() + EMAIL_CONFIG.verificationTokenExpires),
      },
    });

    // Same pattern as register: don't hard-fail if SMTP is broken. The token
    // has been rotated regardless, so the stdout log / dev URL still works.
    let verificationEmailSent = true;
    try {
      await sendVerificationEmail(user.email, verificationToken);
    } catch (err) {
      verificationEmailSent = false;
      logger.error('auth.resend_verification.send_email.failed', { err: String(err) });
    }

    if (DEV_EMAIL_ENABLED) {
      logger.debug('auth.resend_verification.dev_verification_url', {
        email: user.email,
        url: buildVerificationUrl(verificationToken),
      });
    }

    res.json({
      message: 'Verification email sent',
      verificationEmailSent,
      devVerificationUrl: DEV_EMAIL_ENABLED
        ? buildVerificationUrl(verificationToken)
        : undefined,
    });
  } catch (err) {
    logger.error('auth.resend_verification.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// Always responds 200 with the same message regardless of whether the email
// exists. Without this the endpoint is a free email-enumeration oracle: an
// attacker pings it and infers "email X has an account here" from a 404 vs
// 200 difference. The rate limiter still caps overall abuse per IP.
// ---------------------------------------------------------------------------
router.post('/forgot-password', authLimiter, async (req: Request, res: Response) => {
  const GENERIC_OK = {
    message:
      "If that email is linked to an account, we've sent a password reset link. Check your inbox.",
  };
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { email } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });

    // Bail silently if the account doesn't exist, is deleted, or hasn't
    // verified its email yet — but return the same 200 body so the caller
    // can't distinguish. Skipping the unverified case blocks an attacker from
    // using an email they don't control to hijack an account that the real
    // owner hasn't set up yet.
    if (!user || user.deletedAt || !user.emailVerified) {
      res.json(GENERIC_OK);
      return;
    }

    const token = generateVerificationToken();
    const oneHour = 60 * 60 * 1000;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashToken(token),
        passwordResetExpires: new Date(Date.now() + oneHour),
      },
    });

    // Fire-and-log: if the email send fails we still respond 200 so we don't
    // leak "this email exists but our mailer is broken" to the caller. The
    // user can retry and admins see the error in logs.
    try {
      await sendPasswordResetEmail(user.email, user.username, token);
    } catch (err) {
      logger.error('auth.forgot_password.send_email.failed', { err: String(err) });
    }

    res.json(GENERIC_OK);
  } catch (err) {
    logger.error('auth.forgot_password.failed', { err: String(err) });
    // Still return the generic OK to avoid leaking stack info via 500.
    res.json(GENERIC_OK);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
// Consumes the one-time token + sets a new password. Bumps tokenVersion so
// any existing JWT (including an attacker's stolen one) stops working the
// moment the reset completes.
// ---------------------------------------------------------------------------
router.post('/reset-password', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { token, password } = parsed.data;

    const passwordHash = await bcrypt.hash(password, AUTH_CONFIG.bcryptRounds);

    // Atomic one-time consumption: the WHERE filter requires the token AND a
    // future expiry AND a non-deleted account. If anything has already
    // consumed the token (count=0), the whole flow rejects without ever
    // touching the password. Prevents a race where two parallel requests
    // both load the user and both reset the password.
    const result = await prisma.user.updateMany({
      where: {
        passwordResetToken: hashToken(token),
        passwordResetExpires: { gt: new Date() },
        deletedAt: null,
      },
      data: {
        password: passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        tokenVersion: { increment: 1 },
      },
    });

    if (result.count === 0) {
      res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      return;
    }

    res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  } catch (err) {
    logger.error('auth.reset_password.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
