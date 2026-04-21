export type SellerType = 'PERSONAL' | 'BUSINESS';

export type PublicUser = {
  id: string;
  username: string;
  bio: string | null;
  location: string | null;
  sellerType: SellerType;
  businessName: string | null;
  createdAt: string;
  avgRating: number | null;
  totalReviews: number;
  totalSales: number;
};

export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer: { id: string; username: string };
  seller: { id: string; username: string };
};

export type SellerReviewsResponse = {
  reviews: Review[];
  avgRating: number | null;
  totalReviews: number;
  breakdown: Record<'1' | '2' | '3' | '4' | '5', number>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
