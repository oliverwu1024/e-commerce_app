// Sentry init for the API server. No-op when SENTRY_DSN isn't set so local
// dev / preview environments don't burn quota or report errors that aren't
// real. Production sets SENTRY_DSN on Railway.
//
// What gets captured:
//   - Unhandled exceptions in route handlers (via the Express error handler)
//   - Unhandled promise rejections (Sentry's own integration)
//   - Manual `Sentry.captureException(err)` calls in places we deliberately
//     swallow errors (BullMQ workers, sweep jobs, fire-and-forget notifications)
//
// What we DON'T enable:
//   - Performance / tracing — costly at scale and not relevant for portfolio.
//     Re-enable by setting `tracesSampleRate` if you want spans.
//   - Profiling — same reason.
//
// PII: scrubbing on. We send userId via setUser but never email / IP.

import * as Sentry from '@sentry/node';
import type { Application, ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../utils/logger.js';

let initialised = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('sentry.disabled', { reason: 'SENTRY_DSN not set' });
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Only ship release tag when CI provides one; otherwise leave unset so
    // local-development errors don't pollute production releases.
    release: process.env.SENTRY_RELEASE,
    // Strip request bodies + query strings — they may contain user content.
    sendDefaultPii: false,
    // Sample at 100% on errors (the default). For tracing, set
    // tracesSampleRate>0 — kept off here since this project doesn't pay
    // for the spans budget yet.
    tracesSampleRate: 0,
    integrations: [
      // Default integrations include OnUncaughtException + OnUnhandledRejection.
      // The Http and Express ones add request-tagging without requiring
      // tracesSampleRate > 0.
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
    beforeSend(event) {
      // Drop benign 4xx noise — Sentry's default is to capture only 5xx
      // from the Express handler, but other paths can leak through.
      const status = (event.tags as { status_code?: string | number } | undefined)?.status_code;
      if (typeof status === 'number' && status < 500) return null;
      return event;
    },
  });
  initialised = true;
  logger.info('sentry.initialised', {
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE ?? null,
  });
}

export function isSentryInitialised(): boolean {
  return initialised;
}

/**
 * Mount Sentry's request-handler middleware FIRST (before routes) and the
 * error-handler middleware AFTER routes (before your own error responder).
 * Express requires error middleware to live last in the chain.
 *
 * Idempotent: no-op if Sentry isn't initialised.
 */
export function mountSentryMiddleware(app: Application): {
  errorHandler: ErrorRequestHandler;
  requestHandler: RequestHandler;
} {
  if (!initialised) {
    // Stub no-op middlewares so the caller can still wire the chain
    // unconditionally without branching.
    const noop: RequestHandler = (_req, _res, next) => next();
    const noopErr: ErrorRequestHandler = (err, _req, _res, next) => next(err);
    return { errorHandler: noopErr, requestHandler: noop };
  }
  // setupExpressErrorHandler installs the error capture in one call. The
  // request-tagging is handled automatically by httpIntegration above.
  Sentry.setupExpressErrorHandler(app);
  // Return shells so callers that wanted the handlers explicitly still work.
  const noop: RequestHandler = (_req, _res, next) => next();
  const noopErr: ErrorRequestHandler = (err, _req, _res, next) => next(err);
  return { errorHandler: noopErr, requestHandler: noop };
}

/**
 * Manual capture for places we deliberately swallow errors but still want
 * visibility (BullMQ worker handlers, sweep crons, fire-and-forget emails).
 * No-op when Sentry isn't initialised.
 */
export function captureBackgroundError(
  err: unknown,
  context: { operation: string; [k: string]: unknown },
): void {
  if (!initialised) return;
  Sentry.withScope((scope) => {
    scope.setTag('background_op', context.operation);
    for (const [k, v] of Object.entries(context)) {
      if (k === 'operation') continue;
      scope.setExtra(k, v);
    }
    Sentry.captureException(err);
  });
}

export { Sentry };
