import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const S3_HOST =
  process.env.S3_IMAGE_HOST ||
  'electromarket-images-ol.s3.ap-southeast-2.amazonaws.com';

// Backend API host; surfaced in CSP connect-src so the browser can fetch
// against it. Falls back to localhost so dev still works.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

// Build the Content-Security-Policy header value.
//
// Why this is here (and not in middleware.ts):
//   Static `headers()` ships the CSP on every response without a per-request
//   nonce — simpler, but requires `'unsafe-inline'` for scripts/styles
//   because Next.js + Tailwind emit some inline artefacts. The cleaner
//   long-term path is per-request nonces via middleware; that's a bigger
//   refactor and overkill for the threat model here (no XSS sinks in user
//   content; all listing text is rendered as plain strings, never
//   dangerouslySetInnerHTML).
//
// Allow-list reasoning:
//   - script/frame for Cloudflare Turnstile (challenges.cloudflare.com)
//     used on /register
//   - script/frame for Firebase Phone Auth + invisible reCAPTCHA
//     (gstatic.com, recaptcha.net, google.com, *.firebaseapp.com)
//   - connect for the Firebase Auth REST APIs the client SDK calls
//   - connect for our own backend API (NEXT_PUBLIC_API_URL)
//   - img from S3 (listings, avatars) and `data:` for the initial-letter
//     SVG avatar fallback
//   - frame-ancestors 'none' blocks clickjacking — your /admin pages
//     should never be embedded
//
// Tightening later: drop 'unsafe-inline' on script-src by adopting Next's
// nonce middleware pattern. Drop 'unsafe-eval' if no library demands it
// (it's needed by some bundlers in dev; production typically doesn't need
// it but Next 16 + Turbopack have produced eval'd code in the past).
function buildCsp(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",       // Next.js hydration markers + inline runtime
      "'unsafe-eval'",         // some Next runtime helpers; tighten when verified safe
      'https://challenges.cloudflare.com',
      'https://www.gstatic.com',
      'https://www.google.com',
      'https://www.recaptcha.net',
      'https://apis.google.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"], // Tailwind + Next inline styles
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      `https://${S3_HOST}`,
      'https://www.gstatic.com', // Firebase reCAPTCHA badge
    ],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      API_URL,
      // Firebase Auth REST endpoints called by the client SDK
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://www.googleapis.com',
      // Cloudflare Turnstile callback
      'https://challenges.cloudflare.com',
    ],
    'frame-src': [
      "'self'",
      'https://challenges.cloudflare.com',
      'https://www.google.com',
      'https://www.recaptcha.net',
      'https://recaptcha.google.com',
      // Firebase auth domain (set as NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN; allow-listed below)
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

const nextConfig: NextConfig = {
  // Emit a minimal self-contained server under .next/standalone so the
  // production Docker image doesn't need to ship node_modules.
  output: 'standalone',
  // Pin Turbopack's workspace root to this client directory. Without this,
  // Next 16 walks up looking for a lockfile and picks the orphaned
  // package-lock.json one level above, which has no node_modules — module
  // resolution then fails for tailwindcss/etc.
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: S3_HOST,
      },
    ],
  },
  // Security headers applied to every response. Pairs with the API
  // server's helmet() defaults — these cover the Next-rendered HTML.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: buildCsp() },
          // Defence in depth alongside CSP frame-ancestors 'none'.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Lock down powerful browser APIs we don't use.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

// Wrap with Sentry's Next.js plugin so source maps upload at build time
// (auth via SENTRY_AUTH_TOKEN at build time, optional). When neither org
// nor project is set, the plugin no-ops — useful for local dev where you
// don't want to talk to Sentry.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Silent in CI when auth token isn't present so builds don't fail.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Delete source maps after upload so they aren't served publicly. Stack
  // traces in Sentry still resolve via the uploaded maps.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
  // Tunnel events through a Next.js route to bypass ad-blocker false
  // positives. Can be removed if you don't care.
  tunnelRoute: '/monitoring',
});
