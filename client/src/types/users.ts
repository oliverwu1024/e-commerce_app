export type SellerType = 'PERSONAL' | 'BUSINESS';

export type IdVerificationStatus =
  | 'NOT_SUBMITTED'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export type SelfProfile = {
  id: string;
  email: string;
  username: string;
  name: string;
  role: 'USER' | 'ADMIN';
  location: string | null;
  bio: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  sellerType: SellerType;
  businessName: string | null;
  abn: string | null;
  abnVerified: boolean;
  idVerification: IdVerificationStatus;
  idRejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfileResponse = {
  user: SelfProfile;
  canSell: boolean;
  missing: string[];
};

export type PendingVerification = {
  id: string;
  username: string;
  name: string;
  email: string;
  sellerType: SellerType;
  idDocumentUrl: string | null;
  idSubmittedAt: string | null;
  createdAt: string;
};


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
