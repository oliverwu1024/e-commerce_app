export type PaymentProvider = 'STRIPE' | 'SQUARE';

export type SellerAccountStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'RESTRICTED'
  | 'DISCONNECTED';

export type SellerPaymentAccount = {
  provider: PaymentProvider;
  status: SellerAccountStatus;
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  locationId: string | null;
  onboardedAt: string | null;
  lastSyncedAt: string | null;
};

export type SellerPaymentsSummary = {
  accounts: SellerPaymentAccount[];
  canAcceptOnline: boolean;
};
