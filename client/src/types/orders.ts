import type { Condition, FulfillmentMethod, ListingStatus } from '@/types/listings';

export type OrderFulfillmentMethod = 'POST' | 'PICKUP';

export type ShippingAddress = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postcode: string;
  country: string;
};

export type OrderStatus =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PAID'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

// In-progress = anything not yet finalised. Used by the dashboard filter.
export const IN_PROGRESS_STATUSES: OrderStatus[] = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PAID',
  'SHIPPED',
];

export const PAST_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'REFUNDED'];

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
    label: 'Awaiting confirmation',
    bg: 'bg-[var(--tint-amber)] text-[var(--neon-amber)] border border-[var(--neon-amber)]/40',
  },
  CONFIRMED: {
    label: 'Awaiting payment',
    bg: 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40',
  },
  PAID: {
    label: 'Awaiting shipment',
    bg: 'bg-[var(--tint-magenta)] text-[var(--neon-magenta)] border border-[var(--neon-magenta)]/40',
  },
  SHIPPED: {
    label: 'In transit',
    bg: 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40',
  },
  COMPLETED: {
    label: 'Completed',
    bg: 'bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40',
  },
  CANCELLED: {
    label: 'Cancelled',
    bg: 'bg-[var(--bg-panel-hi)] text-[var(--text-dim)] border border-[var(--border-subtle)]',
  },
  REFUNDED: {
    label: 'Refunded',
    bg: 'bg-[var(--tint-amber)] text-[var(--neon-amber)] border border-[var(--neon-amber)]/40',
  },
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
  avatarUrl: string | null;
};

type OrderSeller = OrderParty & {
  sellerType: 'PERSONAL' | 'BUSINESS';
  // Online providers the seller is currently set up to accept. Server filters
  // to only ACTIVE + chargesEnabled rows, so presence here is a green light
  // to show the corresponding payment button.
  paymentAccounts: { provider: 'STRIPE' | 'SQUARE' }[];
};

export type OrderListing = {
  id: string;
  title: string;
  status: ListingStatus;
  images: { id: string; url: string }[];
};

export type DisputeStatus =
  | 'OPEN'
  | 'RESOLVED_BY_SELLER'
  | 'RESOLVED_REFUND'
  | 'RESOLVED_NO_REFUND'
  | 'WITHDRAWN';

export type DisputeReason =
  | 'NOT_RECEIVED'
  | 'NOT_AS_DESCRIBED'
  | 'DAMAGED'
  | 'OTHER';

// Inline summary on the order. Full thread (messages) lives behind a
// separate fetch (GET /api/orders/:id/disputes) so list queries stay light.
export type OrderDisputeSummary = {
  id: string;
  status: DisputeStatus;
  reason: DisputeReason;
  description: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  reopenedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Order = {
  id: string;
  amount: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  paymentSessionState: PaymentSessionState;
  fulfillmentMethod: OrderFulfillmentMethod;
  shippingPrice: string;
  shippingAddress: ShippingAddress | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  // Cumulative refunded amount in cents. 0 = no refund yet. When the
  // sum of refunds equals amount*100, status flips to REFUNDED; before
  // that, partial refunds keep the prior status (PAID/SHIPPED/COMPLETED)
  // and the UI surfaces a "Refunded $X of $Y" badge.
  totalRefundedCents: number;
  refundedAt: string | null;
  refundReason: string | null;
  createdAt: string;
  updatedAt: string;
  listing: OrderListing;
  buyer: OrderParty;
  seller: OrderSeller;
  review: { id: string; rating: number } | null;
  dispute: OrderDisputeSummary | null;
};

export type OrderMessage = {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; username: string; avatarUrl: string | null };
};

export type DisputeMessage = {
  id: string;
  content: string;
  createdAt: string;
  fromUser: { id: string; username: string; avatarUrl: string | null };
};

// Full dispute returned by GET /api/orders/:orderId/disputes — includes
// thread, parties, and resolver. Used by the dispute section UI.
export type DisputeDetail = OrderDisputeSummary & {
  buyerId: string;
  sellerId: string;
  buyer: { id: string; username: string; avatarUrl: string | null };
  seller: { id: string; username: string; avatarUrl: string | null };
  resolvedBy: { id: string; username: string } | null;
  messages: DisputeMessage[];
};

export type DisputeReasonLabel = Record<DisputeReason, string>;

export const DISPUTE_REASON_LABELS: DisputeReasonLabel = {
  NOT_RECEIVED: 'Never received',
  NOT_AS_DESCRIBED: 'Not as described',
  DAMAGED: 'Arrived damaged',
  OTHER: 'Other',
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: 'Open',
  RESOLVED_BY_SELLER: 'Resolved by seller',
  RESOLVED_REFUND: 'Closed — refund',
  RESOLVED_NO_REFUND: 'Closed — no refund',
  WITHDRAWN: 'Withdrawn',
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
    fulfillmentMethod: FulfillmentMethod;
    shippingPrice: string | null;
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
