import prisma from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { getPlatformFeeBasisPoints } from '../config/platformConnect.js';

// Earnings rollup for the seller dashboard. Computed at request time rather
// than denormalized — sales volume is too low to justify a snapshot table,
// and PR-time math is easier to reason about than triggers.
//
// Definitions:
//  - gross  = sum of order.amount for orders the seller has been paid for
//             (PAID/SHIPPED/COMPLETED). Excludes pending and cancelled.
//  - fee    = platform fee taken on online orders only. Cash/bank transfer
//             pays no fee. We compute fee using the CURRENT bps — the
//             actual fee at payment time may differ if the rate changed,
//             but tracking the exact historical rate per order would mean
//             snapshotting it on every charge. Acceptable approximation
//             for now; flag in the UI as "approximate" if/when we tweak bps.
//  - net    = gross − fee.
export type SellerEarnings = {
  gross: string;          // decimal string in AUD
  fee: string;            // approximate platform fee
  net: string;            // gross - fee
  byMethod: Array<{
    method: 'STRIPE' | 'SQUARE' | 'CASH' | 'BANK_TRANSFER' | 'PAYPAL' | 'UNKNOWN';
    count: number;
    gross: string;
    fee: string;
  }>;
  feeBasisPoints: number;
};

const ONLINE_METHODS = new Set(['STRIPE', 'SQUARE']);

export async function getSellerEarnings(sellerId: string): Promise<SellerEarnings> {
  const orders = await prisma.order.findMany({
    where: {
      sellerId,
      status: { in: ['PAID', 'SHIPPED', 'COMPLETED'] },
    },
    select: { amount: true, paymentMethod: true },
  });

  const bps = getPlatformFeeBasisPoints();
  const buckets = new Map<string, { count: number; gross: Prisma.Decimal; fee: Prisma.Decimal }>();
  let totalGross = new Prisma.Decimal(0);
  let totalFee = new Prisma.Decimal(0);

  for (const o of orders) {
    const method = o.paymentMethod ?? 'UNKNOWN';
    const amt = new Prisma.Decimal(o.amount);
    // floor on the cent boundary so seller-displayed total never claims a
    // higher fee than was actually deducted.
    const feeForOrder = ONLINE_METHODS.has(method)
      ? new Prisma.Decimal(amt.mul(bps).div(10000).toFixed(2, Prisma.Decimal.ROUND_DOWN))
      : new Prisma.Decimal(0);
    totalGross = totalGross.plus(amt);
    totalFee = totalFee.plus(feeForOrder);

    const cur = buckets.get(method) ?? {
      count: 0,
      gross: new Prisma.Decimal(0),
      fee: new Prisma.Decimal(0),
    };
    cur.count += 1;
    cur.gross = cur.gross.plus(amt);
    cur.fee = cur.fee.plus(feeForOrder);
    buckets.set(method, cur);
  }

  const byMethod = Array.from(buckets.entries())
    .map(([method, v]) => ({
      method: method as SellerEarnings['byMethod'][number]['method'],
      count: v.count,
      gross: v.gross.toFixed(2),
      fee: v.fee.toFixed(2),
    }))
    .sort((a, b) => Number(b.gross) - Number(a.gross));

  return {
    gross: totalGross.toFixed(2),
    fee: totalFee.toFixed(2),
    net: totalGross.minus(totalFee).toFixed(2),
    byMethod,
    feeBasisPoints: bps,
  };
}
