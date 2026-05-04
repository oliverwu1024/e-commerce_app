import 'dotenv/config';
// Sentry MUST init before any route or handler import — its instrumentation
// works by patching modules at require time. If we initSentry() after the
// route imports, those modules are already loaded without the patches and
// errors thrown inside them won't be captured.
import { initSentry, mountSentryMiddleware } from './lib/sentry.js';
initSentry();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import prisma from './lib/prisma.js';
import authRoutes from './routes/auth.js';
import listingRoutes from './routes/listings.js';
import uploadRoutes from './routes/uploads.js';
import savedRoutes from './routes/saved.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import reviewRoutes from './routes/reviews.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import inboxRoutes from './routes/inbox.js';
import inquiryRoutes from './routes/inquiries.js';
import webhookRoutes from './routes/webhooks.js';
import contactRoutes from './routes/contact.js';
import dashboardRoutes from './routes/dashboard.js';
import sellerPaymentRoutes from './routes/sellerPayments.js';
import disputeRoutes from './routes/disputes.js';
import squareCatalogRoutes from './routes/squareCatalog.js';
import { verifySmtpAtStartup } from './config/email.js';
import { verifyFirebaseAtStartup } from './config/firebase.js';
import { csrfOriginGuard } from './middleware/csrf.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { logger } from './utils/logger.js';
import { startOrderSweep, stopOrderSweep } from './services/orderSweep.js';
import {
  startSquareCatalogSync,
  stopSquareCatalogSync,
} from './services/squareCatalog/index.js';
import { getRedisConnection, isQueueConfigured } from './queue/connection.js';

// Fail fast at boot on missing required env — the alternative is a service
// that reports "ok" and 500s on the first real request. JWT_SECRET is already
// guarded in config/auth.ts; this adds the rest of the critical ones.
function validateEnv(): void {
  const required = ['DATABASE_URL', 'CLIENT_URL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Required environment variables missing: ${missing.join(', ')}. ` +
        'Set them in .env (dev) or the container environment (prod).',
    );
  }
}
validateEnv();
verifySmtpAtStartup();
verifyFirebaseAtStartup();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust exactly one proxy hop (nginx / ALB). Without this, req.ip is the
// proxy's loopback address and every user shares one rate-limit bucket; also
// the `secure: true` cookie flag (which reads X-Forwarded-Proto) is ignored.
// express-rate-limit v8 warns loudly if this is unset when X-Forwarded-For
// is present, so setting it locally too costs nothing and prevents noise.
app.set('trust proxy', 1);

// Helmet defaults plus a stricter frame-ancestors to block clickjacking of
// the API. `contentSecurityPolicy: false` because this process serves JSON
// only — the Next client handles its own CSP. HSTS preload-eligible (1y +
// includeSubDomains + preload) so the first-visit downgrade window is gone
// once the parent domain is listed at hstspreload.org.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

// CLIENT_URL may be a comma-separated list for preview-deploy topologies.
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  credentials: true,
}));

// Request logger — mounted before webhooks so webhook calls are logged too.
app.use(requestLogger);

// Webhook routes get the raw body (Stripe/Square signatures are computed
// over the exact bytes sent). Mount BEFORE express.json() so they aren't
// parsed into objects that lose the original bytes. Webhooks are NOT
// browser-originated and are signature-verified — exempt from csrfOriginGuard.
//
// Rate-limit the entire namespace by IP (no userId here — webhooks are
// unauthenticated by HTTP standards; they prove themselves via signature).
// 120/min covers normal Stripe + Square retries with comfortable headroom
// while bounding unauth-spam volume — relevant for the inbound-email and
// catalog routes that do DB work even on bad-secret rejections.
const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many webhook requests' },
});
app.use(
  '/api/webhooks',
  express.raw({ type: 'application/json' }),
  webhookLimiter,
  webhookRoutes,
);

app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

// Health is a plain GET from load balancers / uptime monitors — exempt from
// both requestLogger (handled inside it) and csrfOriginGuard (GET is safe).
app.get('/api/health', async (_req, res) => {
  const checks: Record<string, 'connected' | 'disconnected' | 'disabled'> = {
    database: 'disconnected',
    redis: 'disabled',
  };
  let dbOk = false;
  let redisOk = true; // disabled counts as ok — Redis is optional for the marketplace itself
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'connected';
    dbOk = true;
  } catch {
    // dbOk stays false
  }
  if (isQueueConfigured()) {
    redisOk = false;
    try {
      const ping = await Promise.race([
        getRedisConnection().ping(),
        new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), 1000)),
      ]);
      if (ping === 'PONG') {
        checks.redis = 'connected';
        redisOk = true;
      }
    } catch {
      // redisOk stays false
    }
  }
  const status = dbOk && redisOk ? 'ok' : 'error';
  res.status(status === 'ok' ? 200 : 500).json({ status, ...checks });
});

// Prometheus exposition. Token-gated via METRICS_AUTH_TOKEN — any value works
// as long as the same value is configured in the scraper's bearer auth.
// Returns 503 if the token isn't configured (fail-closed; no point exposing
// metrics to the open internet).
app.get('/metrics', async (req, res) => {
  const expected = process.env.METRICS_AUTH_TOKEN;
  if (!expected) {
    res.status(503).type('text/plain').send('metrics endpoint disabled (METRICS_AUTH_TOKEN not set)');
    return;
  }
  const auth = req.headers.authorization ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (provided !== expected) {
    res.status(401).type('text/plain').send('unauthorized');
    return;
  }
  // Lazy require so index.ts doesn't pay the prom-client init cost until
  // the first scrape (cheap, but it's not worth eagerly importing).
  const { registry } = await import('./lib/metrics.js');
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

// CSRF defence: browser-originated mutations must declare an Origin in the
// CORS allowlist. Covers every /api route below. Webhooks + health are above
// this line so they bypass.
app.use('/api', csrfOriginGuard);

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/saved', savedRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/inquiries', inquiryRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/seller/payments', sellerPaymentRoutes);
app.use('/api/square-catalog', squareCatalogRoutes);
// disputes mounts its own /orders/:id/disputes and /admin/disputes paths
app.use('/api', disputeRoutes);

// Sentry error capture — must come AFTER all routes so it sees thrown
// errors. Idempotent no-op when SENTRY_DSN is unset.
mountSentryMiddleware(app);

// Final JSON error handler. Without this, an uncaught throw escapes to
// Express's default handler which renders an HTML stack trace whenever
// NODE_ENV !== 'production' (preview, staging, self-hosted forks). Always
// return JSON + a generic message — stack traces go to logger / Sentry.
// 4-arg signature is required for Express to recognise this as an error
// handler vs a regular middleware.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('server.unhandled_error', { err: String(err) });
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  logger.info('server.start', { port: Number(PORT) });
});

// Background sweeps — kicked off after the server is listening so a crash on
// the first run doesn't prevent the process from being debuggable.
startOrderSweep();
// Square Catalog sync (BullMQ worker + reconciler + daily summary). No-op
// if REDIS_URL isn't set — the marketplace itself keeps working.
startSquareCatalogSync();

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then close the Prisma pool. Without this, SIGTERM (docker stop,
// k8s evict) kills mid-transaction writes. The 15-second cap is the same
// grace window Kubernetes defaults to — matching it avoids surprise SIGKILLs.
function shutdown(signal: string): void {
  logger.info('server.shutdown.start', { signal });
  stopOrderSweep();
  const timeout = setTimeout(() => {
    logger.error('server.shutdown.timeout');
    process.exit(1);
  }, 15000);
  server.close(async () => {
    clearTimeout(timeout);
    try {
      await stopSquareCatalogSync();
    } catch (err) {
      logger.error('server.shutdown.square_catalog_stop_failed', {
        err: String(err),
      });
    }
    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.error('server.shutdown.prisma_disconnect_failed', { err: String(err) });
    }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
