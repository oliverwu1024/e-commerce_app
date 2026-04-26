// Next.js calls `register()` once at server start (Node runtime) and
// once per edge worker boot. Sentry's nextjs SDK reads this hook to
// decide which sentry.*.config.ts to wire.
//
// The runtime check below routes initialisation correctly without
// pulling in code that's incompatible with the other runtime (the edge
// SDK can't run Node-only code, and vice versa).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Exposes thrown request errors to Sentry from the App Router.
// `Sentry.captureRequestError` is the official re-export.
export { captureRequestError as onRequestError } from '@sentry/nextjs';
