import type { Pagination } from './listings';

export type AdminStats = {
  users: { total: number; emailVerified: number };
  listings: {
    total: number;
    ACTIVE: number;
    ON_HOLD: number;
    SOLD: number;
    REMOVED: number;
  };
  orders: {
    total: number;
    PENDING_CONFIRMATION: number;
    CONFIRMED: number;
    COMPLETED: number;
    CANCELLED: number;
  };
  revenue: { totalAud: string };
  pendingVerifications: number;
  stuckPayments: number;
  newSupportSubmissions: number;
  openDisputes: number;
};

export type StuckOrder = {
  id: string;
  amount: string;
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  paymentSessionState: 'NONE' | 'PENDING' | 'COMPLETED';
  updatedAt: string;
  createdAt: string;
  listing: { id: string; title: string };
  buyer: { id: string; username: string; email: string };
  seller: { id: string; username: string; email: string };
};

export type StuckOrdersResponse = {
  orders: StuckOrder[];
  pagination: Pagination;
};
