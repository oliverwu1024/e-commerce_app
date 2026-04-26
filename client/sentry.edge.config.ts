// Next.js edge runtime Sentry init (used by middleware.ts and any edge-
// runtime route handlers). Kept minimal — we don't currently use edge
// runtime, but @sentry/nextjs expects this file to exist.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
  });
}
