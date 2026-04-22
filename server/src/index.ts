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
import webhookRoutes from './routes/webhooks.js';
import { validateSquareWebhookConfig } from './config/square.js';

// Startup config checks — fail fast rather than silently-400 every webhook.
validateSquareWebhookConfig();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));

// Webhook routes get the raw body (Stripe/Square signatures are computed
// over the exact bytes sent). Mount BEFORE express.json() so they aren't
// parsed into objects that lose the original bytes.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/saved', savedRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
