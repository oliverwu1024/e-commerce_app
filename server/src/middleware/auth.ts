import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AUTH_CONFIG } from '../config/auth.js';
import { clearTokenCookie } from '../utils/cookies.js';
import prisma from '../lib/prisma.js';

export interface JwtPayload {
  userId: string;
  tv: number; // tokenVersion
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: 'USER' | 'ADMIN';
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[AUTH_CONFIG.cookie.name];

  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, AUTH_CONFIG.jwtSecret) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // tokenVersion check: if the user has bumped their tokenVersion (via password
  // change or explicit logout-everywhere), JWTs issued before the bump are
  // invalid. Fetch role in the same query to save a round-trip on admin routes.
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { tokenVersion: true, role: true },
  });
  if (!user || user.tokenVersion !== decoded.tv) {
    clearTokenCookie(res);
    res.status(401).json({ error: 'Session has been revoked. Please sign in again.' });
    return;
  }

  req.userId = decoded.userId;
  req.userRole = user.role;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
