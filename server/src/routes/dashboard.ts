import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/dashboard/tab-counts
//
// Single round-trip count for every non-Past tab on the dashboard. Past tabs
// (Past Sales, Past Purchases) intentionally omitted — they grow unbounded
// and a count there is noise rather than signal.
//
// Active dispute = OPEN | RESOLVED_BY_SELLER (matches the order list filter
// in routes/orders.ts). An order with one of those statuses is pulled OUT of
// In Progress / Past and into the In Dispute tab; counts mirror that.
// ---------------------------------------------------------------------------
router.get('/tab-counts', authenticate, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const ACTIVE_DISPUTE_STATUSES = ['OPEN', 'RESOLVED_BY_SELLER'] as const;

  try {
    const [
      activeListings,
      inSales,
      actionableSales,
      disputedSales,
      saved,
      inPurchases,
      disputedPurchases,
      // Aggregate over the buyer's unpaid CARD orders (CONFIRMED + CARD =
      // pay-ready). Powers the dashboard's "X orders awaiting payment ($Y)"
      // banner + tab pill — sums in cents to avoid Decimal-from-aggregate
      // gotchas and so the client can format on its own.
      unpaidCardAgg,
    ] = await Promise.all([
      // Selling — Active Listings (includes HIDDEN since the dashboard's
      // Active tab is "stuff I own and could un-hide", not just public ones).
      prisma.listing.count({
        where: { sellerId: userId, status: { in: ['ACTIVE', 'HIDDEN'] } },
      }),
      // Selling — In Progress (no active dispute)
      prisma.order.count({
        where: {
          sellerId: userId,
          status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'PAID', 'SHIPPED'] },
          dispute: { is: null },
        },
      }),
      // Selling — Actionable subset (seller has something to do RIGHT NOW):
      //   PENDING_CONFIRMATION → confirm or decline
      //   PAID                 → ship the item
      // CONFIRMED (waiting on buyer to pay) and SHIPPED (waiting on buyer
      // to receive) are the buyer's move and don't count here. Drives the
      // dashboard banner copy "X orders need your action".
      prisma.order.count({
        where: {
          sellerId: userId,
          status: { in: ['PENDING_CONFIRMATION', 'PAID'] },
          dispute: { is: null },
        },
      }),
      // Selling — In Dispute
      prisma.order.count({
        where: {
          sellerId: userId,
          dispute: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
        },
      }),
      // Buying — Saved
      prisma.savedListing.count({
        where: { userId },
      }),
      // Buying — In Progress (no active dispute, excluding unpaid CARD which
      // live in their own Awaiting Payment tab so the badge matches what the
      // tab actually renders).
      prisma.order.count({
        where: {
          buyerId: userId,
          status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'PAID', 'SHIPPED'] },
          dispute: { is: null },
          NOT: [{ status: 'CONFIRMED', paymentFlow: 'CARD' }],
        },
      }),
      // Buying — In Dispute
      prisma.order.count({
        where: {
          buyerId: userId,
          dispute: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
        },
      }),
      // Unpaid CARD aggregate.
      prisma.order.aggregate({
        where: {
          buyerId: userId,
          status: 'CONFIRMED',
          paymentFlow: 'CARD',
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const unpaidCardCount = unpaidCardAgg._count._all;
    const unpaidCardTotalCents = unpaidCardAgg._sum.amount
      ? Math.round(Number(unpaidCardAgg._sum.amount) * 100)
      : 0;

    res.json({
      selling: {
        active: activeListings,
        in_progress: inSales,
        // Subset of in_progress that requires the seller's action — drives
        // the dashboard banner copy "X orders need your action".
        actionable: actionableSales,
        disputed: disputedSales,
      },
      buying: {
        saved,
        in_progress: inPurchases,
        disputed: disputedPurchases,
      },
      unpaidCard: {
        count: unpaidCardCount,
        totalCents: unpaidCardTotalCents,
      },
    });
  } catch (err) {
    logger.error('dashboard.tab_counts.failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
