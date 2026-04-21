import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { Prisma } from '../generated/prisma/client.js';
import prisma from '../lib/prisma.js';
import { AUTH_CONFIG } from '../config/auth.js';
import { EMAIL_CONFIG } from '../config/email.js';
import { registerSchema, loginSchema } from '../schemas/auth.js';
import { authenticate, JwtPayload } from '../middleware/auth.js';
import { generateVerificationToken, sendVerificationEmail } from '../utils/email.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Fixed bcrypt hash used when a login attempt finds no user — ensures the
// response time stays constant regardless of whether the email exists. Prevents
// attackers from enumerating registered emails via timing side-channel.
// This is NOT a real password hash; its plaintext is unknown and unknowable.
const DUMMY_PASSWORD_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

function signToken(userId: string): string {
  return jwt.sign({ userId } satisfies JwtPayload, AUTH_CONFIG.jwtSecret, {
    expiresIn: AUTH_CONFIG.jwtExpiresIn,
  } as jwt.SignOptions);
}

function setTokenCookie(res: Response, token: string): void {
  res.cookie(AUTH_CONFIG.cookie.name, token, {
    httpOnly: AUTH_CONFIG.cookie.httpOnly,
    secure: AUTH_CONFIG.cookie.secure,
    sameSite: AUTH_CONFIG.cookie.sameSite,
    maxAge: AUTH_CONFIG.cookie.maxAge,
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

    const { password, name, location, bio, sellerType, businessName } = parsed.data;
    const email = parsed.data.email.toLowerCase();
    const username = parsed.data.username.toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      res.status(409).json({ error: 'Email or username already taken' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, AUTH_CONFIG.bcryptRounds);
    const verificationToken = generateVerificationToken();

    const user = await prisma.user.create({
      data: {
        email, username, password: hashedPassword, name, location, bio,
        sellerType,
        businessName: sellerType === 'BUSINESS' ? businessName : null,
        emailVerificationToken: verificationToken,
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
      console.error('Failed to send verification email:', err);
    }

    const token = signToken(user.id);
    setTokenCookie(res, token);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        location: user.location,
        bio: user.bio,
        sellerType: user.sellerType,
        businessName: user.businessName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      verificationEmailSent,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Email or username already taken' });
      return;
    }
    console.error('Register error:', err);
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
    if (!user || !valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken(user.id);
    setTokenCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        location: user.location,
        bio: user.bio,
        sellerType: user.sellerType,
        businessName: user.businessName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
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
    console.error('Fetch user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(AUTH_CONFIG.cookie.name);
  res.json({ message: 'Logged out' });
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', authLimiter, async (req: Request<{ token: string }>, res: Response) => {
  try {
    const { token } = req.params;

    const user = await prisma.user.findUnique({
      where: { emailVerificationToken: token },
    });

    if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      res.status(400).json({ error: 'Invalid or expired verification link' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error('Email verification error:', err);
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
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + EMAIL_CONFIG.verificationTokenExpires),
      },
    });

    await sendVerificationEmail(user.email, verificationToken);

    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
