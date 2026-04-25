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
  avatarUrl: string | null;
  emailVerified: boolean;
  // Set when the user has submitted an email change but hasn't clicked the
  // verification link sent to the new address yet. While non-null, `email`
  // is still the live login / notification address.
  pendingEmail: string | null;
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
  // Server-driven feature flags. Only `idVerificationEnabled` for now.
  // When `idVerificationEnabled` is false, the verification UI hides the
  // ID step and shows a "Coming soon" notice; sellers can post on email
  // + phone alone.
  features?: { idVerificationEnabled: boolean };
};

export type PendingVerification = {
  id: string;
  username: string;
  name: string;
  email: string;
  sellerType: SellerType;
  idDocumentUrl: string | null;
  idDocumentBackUrl: string | null;
  idSubmittedAt: string | null;
  createdAt: string;
};


export type PublicUser = {
  id: string;
  username: string;
  bio: string | null;
  location: string | null;
  avatarUrl: string | null;
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
  reviewer: { id: string; username: string; avatarUrl: string | null };
  seller: { id: string; username: string; avatarUrl: string | null };
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
