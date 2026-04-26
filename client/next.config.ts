import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const S3_HOST =
  process.env.S3_IMAGE_HOST ||
  'electromarket-images-ol.s3.ap-southeast-2.amazonaws.com';

// CSP now lives in src/middleware.ts so we can stamp a per-request nonce
// onto Next.js's inline hydration scripts and drop 'unsafe-inline'.
// Other security headers stay here because their values are static.

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
  // Static security headers. CSP is set per-request in middleware.ts so we
  // can apply a unique nonce; everything below is constant and applies to
  // every response.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
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
