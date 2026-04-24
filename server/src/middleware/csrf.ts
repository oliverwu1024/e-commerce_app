import { Request, Response, NextFunction } from 'express';

// CSRF defence via Origin-header check.
//
// SameSite=Lax on the auth cookie already blocks the common CSRF vectors
// (cross-site form POSTs, image/script triggers). This middleware adds
// defence-in-depth by rejecting any state-changing request whose Origin
// isn't in CLIENT_URL. Modern browsers reliably send Origin on POST/PUT/
// PATCH/DELETE — a missing Origin on a mutating request is itself a red
// flag for a non-browser client spoofing a browser session.
//
// Skipped paths (declared in index.ts BEFORE this middleware is mounted):
//   - /api/webhooks/*       — signature-verified, not browser-originated
//   - /api/health           — read-only
//
// GET/HEAD/OPTIONS are never CSRF-able in the meaningful sense (the
// browser's cookie ride-along can leak data via response body, but that's
// addressed by CORS, not CSRF). Only block mutations.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseAllowedOrigins(): string[] {
  return (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  // Explicit null Origin (`Origin: null`) appears on cross-origin redirects
  // and sandboxed iframes. Treat as a CSRF signal.
  if (!origin || origin === 'null') {
    res.status(403).json({ error: 'Origin header required for state-changing requests' });
    return;
  }

  const allowed = parseAllowedOrigins();
  if (!allowed.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  next();
}
