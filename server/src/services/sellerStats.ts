import prisma from '../lib/prisma.js';

export type SellerStats = {
  avgRating: number | null;
  totalReviews: number;
  totalSales: number;
  listingsCount: number;
};

/**
 * Aggregates public-facing "is this user a seller, and how good are they"
 * stats. Single source of truth shared by the public user profile endpoint
 * and the listing-detail seller card — prior to extraction these ran the
 * exact same three queries in two places.
 */
export async function getSellerStats(sellerId: string): Promise<SellerStats> {
  const [ratingResult, totalSales, listingsCount] = await Promise.all([
    prisma.review.aggregate({
      where: { sellerId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.order.count({
      where: { sellerId, status: 'COMPLETED' },
    }),
    prisma.listing.count({
      where: { sellerId },
    }),
  ]);

  return {
    avgRating: ratingResult._avg.rating,
    totalReviews: ratingResult._count.rating,
    totalSales,
    listingsCount,
  };
}
