// Require JWT_SECRET everywhere except the test suite. Staging / preview /
// self-hosted deployments don't reliably set NODE_ENV=production, so the
// previous production-only gate let a shared default secret ship wherever
// NODE_ENV was unset — a free forgery vector.
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'test') {
  throw new Error(
    'JWT_SECRET environment variable is required. Set NODE_ENV=test only when running tests.',
  );
}

export const AUTH_CONFIG = {
  jwtSecret: process.env.JWT_SECRET || 'test-only-jwt-secret-do-not-use',
  jwtExpiresIn: '7d',
  // 12 is the 2026 baseline for bcrypt — ~300ms per hash on modern hardware,
  // four orders of magnitude more offline-crack cost than 10. Existing hashes
  // stored at 10 stay valid because bcrypt encodes the cost in the hash.
  bcryptRounds: 12,
  cookie: {
    name: 'token',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};
