// Browser-side Sentry init. Loaded by @sentry/nextjs from the project root
// (alongside sentry.server.config.ts). No-op when NEXT_PUBLIC_SENTRY_DSN is
// absent so dev / preview environments don't send events.
//
// What gets captured:
//   - Unhandled exceptions in any client component
//   - Unhandled promise rejections
//   - React render errors (Next.js wires error.tsx into Sentry automatically)
//
// What's deliberately turned off:
//   - Performance / tracing (tracesSampleRate=0)
//   - Replay (sessionSampleRate=0). Replay adds ~50KB and a real
//     bandwidth cost; not needed for a portfolio piece.

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Suppress noisy errors that come from browser extensions or third-
    // party scripts the user has injected. These can dominate the
    // dashboard and aren't actionable.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
      // Common Chrome extension noise
      /^extension\//,
      /chrome-extension:\/\//,
    ],
    beforeSend(event) {
      // Drop events that originated outside our own bundle (browser
      // extensions, ad blockers, third-party tag managers).
      const stack = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
      const ourFrame = stack.find((f) =>
        typeof f.filename === 'string' &&
        (f.filename.includes('/_next/') || f.filename.includes(self?.location?.host ?? '')),
      );
      if (!ourFrame && stack.length > 0) return null;
      return event;
    },
  });
}
