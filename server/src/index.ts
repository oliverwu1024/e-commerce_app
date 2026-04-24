import 'dotenv/config';
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
import { validateSquareWebhookConfig } from './config/square.js';
import { verifySmtpAtStartup } from './config/email.js';
import { csrfOriginGuard } from './middleware/csrf.js';
import { requestLogger } from './middleware/requestLogger.js';
import { logger } from './utils/logger.js';
import { startOrderSweep, stopOrderSweep } from './services/orderSweep.js';

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
validateSquareWebhookConfig();
verifySmtpAtStartup();

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
// only — the Next client handles its own CSP.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' },
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
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

// Health is a plain GET from load balancers / uptime monitors — exempt from
// both requestLogger (handled inside it) and csrfOriginGuard (GET is safe).
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
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

const server = app.listen(PORT, () => {
  logger.info('server.start', { port: Number(PORT) });
});

// Background sweeps — kicked off after the server is listening so a crash on
// the first run doesn't prevent the process from being debuggable.
startOrderSweep();

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
      await prisma.$disconnect();
    } catch (err) {
      logger.error('server.shutdown.prisma_disconnect_failed', { err: String(err) });
    }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
