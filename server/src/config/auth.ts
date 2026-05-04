// Require JWT_SECRET everywhere except the test suite. Staging / preview /
// self-hosted deployments don't reliably set NODE_ENV=production, so the
// previous production-only gate let a shared default secret ship wherever
// NODE_ENV was unset — a free forgery vector.
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is required. Tests must set it explicitly.',
  );
}

// In production the client is deployed to a different eTLD+1 from the
// server (e.g. vercel.app vs railway.app), so the auth cookie must be
// SameSite=None to ride along on cross-site fetch requests. SameSite=None
// requires Secure, which is also true in production. CSRF protection comes
// from the Origin-header guard (middleware/csrf.ts), not SameSite=Lax.
// In dev (localhost both sides), SameSite=Lax is fine and slightly tighter.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const AUTH_CONFIG = {
  jwtSecret: process.env.JWT_SECRET as string,
  jwtAlgorithm: 'HS256' as const,
  jwtExpiresIn: '7d',
  // 12 is the 2026 baseline for bcrypt — ~300ms per hash on modern hardware,
  // four orders of magnitude more offline-crack cost than 10. Existing hashes
  // stored at 10 stay valid because bcrypt encodes the cost in the hash.
  bcryptRounds: 12,
  cookie: {
    name: 'token',
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: (IS_PRODUCTION ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};
