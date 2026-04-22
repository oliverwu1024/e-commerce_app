import type { Condition, ListingStatus } from '@/types/listings';

export type OrderStatus =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED';

export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'PAYPAL'
  | 'SQUARE'
  | 'STRIPE';

export type PaymentSessionState = 'NONE' | 'PENDING' | 'COMPLETED';

export const ORDER_STATUS_STYLES: Record<
  OrderStatus,
  { label: string; bg: string }
> = {
  PENDING_CONFIRMATION: {
    label: 'Pending',
    bg: 'bg-amber-100 text-amber-700',
  },
  CONFIRMED: { label: 'Confirmed', bg: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: 'Completed', bg: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Cancelled', bg: 'bg-zinc-100 text-zinc-500' },
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  PAYPAL: 'PayPal',
  SQUARE: 'Square',
  STRIPE: 'Stripe',
};

type OrderParty = {
  id: string;
  username: string;
  location: string | null;
};

type OrderSeller = OrderParty & {
  sellerType: 'PERSONAL' | 'BUSINESS';
};

export type OrderListing = {
  id: string;
  title: string;
  status: ListingStatus;
  images: { id: string; url: string }[];
};

export type Order = {
  id: string;
  amount: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  paymentSessionState: PaymentSessionState;
  createdAt: string;
  updatedAt: string;
  listing: OrderListing;
  buyer: OrderParty;
  seller: OrderSeller;
  review: { id: string; rating: number } | null;
};

export type OrderMessage = {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; username: string };
};

export type OrderListResponse = {
  orders: Order[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

// Lightweight cart item shape returned from GET /api/cart — reuses the listing
// summary fields plus status so the UI can show "no longer available" notices.
export type CartItem = {
  id: string;
  createdAt: string;
  listing: {
    id: string;
    title: string;
    price: string;
    category: string;
    brand: string | null;
    condition: Condition;
    status: ListingStatus;
    seller: OrderParty;
    images: { id: string; url: string }[];
  };
};

export type Cart = {
  items: CartItem[];
  subtotal: string;
  itemCount: number;
  checkoutableCount: number;
};
