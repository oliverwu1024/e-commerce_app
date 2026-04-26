// Next.js server-side (Node) Sentry init — runs in API routes and
// `getServerSideProps` paths. The Express server has its own Sentry init
// (server/src/lib/sentry.ts); this file is for the Next.js Node runtime.

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
