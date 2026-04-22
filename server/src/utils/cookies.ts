import { Response } from 'express';
import { AUTH_CONFIG } from '../config/auth.js';

// Clear the auth cookie. Echo the same attributes used when setting it —
// Chrome/Safari require the Path (and in some edge cases SameSite/Secure)
// attributes to match for the clear to take effect reliably.
export function clearTokenCookie(res: Response): void {
  res.clearCookie(AUTH_CONFIG.cookie.name, {
    httpOnly: AUTH_CONFIG.cookie.httpOnly,
    secure: AUTH_CONFIG.cookie.secure,
    sameSite: AUTH_CONFIG.cookie.sameSite,
    path: '/',
  });
}
