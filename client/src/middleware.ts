import { NextRequest, NextResponse } from 'next/server';

// Per-request CSP nonce. Lets us drop 'unsafe-inline' from script-src while
// still allowing Next.js's inline hydration markers — Next reads the
// `x-nonce` request header we set below and stamps the matching nonce onto
// every inline <script> it emits server-side.
//
// Why CSP lives here instead of next.config.ts: nonces must be unique per
// request, which static `headers()` in next.config can't provide. Everything
// else security-header-wise (X-Frame-Options, Permissions-Policy, etc.) still
// lives in next.config because those values don't change per request.

const S3_HOST =
  process.env.S3_IMAGE_HOST ||
  'electromarket-images-ol.s3.ap-southeast-2.amazonaws.com';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      // 'unsafe-eval' is still required by some Next 16 / Turbopack runtime
      // helpers in dev. Production builds don't need it; tighten there.
      ...(IS_PRODUCTION ? [] : ["'unsafe-eval'"]),
      'https://challenges.cloudflare.com',
      'https://www.gstatic.com',
      'https://www.google.com',
      'https://www.recaptcha.net',
      'https://apis.google.com',
    ],
    // Tailwind + Next still emit inline <style>; nonce-style needs more
    // upstream support before it works reliably, so keep 'unsafe-inline'
    // on style-src for now. The XSS exposure on a CSS-only inline is
    // limited to UI redress, not script execution.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      `https://${S3_HOST}`,
      'https://www.gstatic.com',
    ],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      API_URL,
      // S3 needs to be in connect-src (not just img-src) because uploads PUT
      // directly to a presigned URL — CSP blocks that fetch otherwise.
      `https://${S3_HOST}`,
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://www.googleapis.com',
      'https://challenges.cloudflare.com',
    ],
    'frame-src': [
      "'self'",
      'https://challenges.cloudflare.com',
      'https://www.google.com',
      'https://www.recaptcha.net',
      'https://recaptcha.google.com',
      'https://*.firebaseapp.com',
    ],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length === 0 ? k : `${k} ${v.join(' ')}`))
    .join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  // Web Crypto in the edge runtime — randomUUID is fast and high-entropy.
  // Strip dashes so the value works as a CSP token without quoting.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Setting CSP on the request lets Next see it and skip emitting its own.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Skip CSP on _next/static (immutable bundles), images, favicon, and
    // sentry tunnel — none of which serve HTML and all of which would
    // either ignore or break under a strict CSP.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|monitoring).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
