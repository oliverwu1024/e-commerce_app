import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma.js';
import { AUTH_CONFIG } from '../config/auth.js';
import { registerSchema, loginSchema } from '../schemas/auth.js';
import { authenticate, JwtPayload } from '../middleware/auth.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

function signToken(userId: string): string {
  return jwt.sign({ userId } satisfies JwtPayload, AUTH_CONFIG.jwtSecret, {
    expiresIn: AUTH_CONFIG.jwtExpiresIn,
  });
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
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { email, username, password, name, location, bio } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    const field = existing.email === email ? 'Email' : 'Username';
    res.status(409).json({ error: `${field} already taken` });
    return;
  }

  const hashedPassword = await bcrypt.hash(password, AUTH_CONFIG.bcryptRounds);

  const user = await prisma.user.create({
    data: { email, username, password: hashedPassword, name, location, bio },
  });

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
    },
  });
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
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
    },
  });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      location: true,
      bio: true,
      createdAt: true,
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user });
});

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(AUTH_CONFIG.cookie.name);
  res.json({ message: 'Logged out' });
});

export default router;
