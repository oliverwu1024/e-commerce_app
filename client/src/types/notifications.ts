import type { OrderStatus } from './orders';

export type NotificationType =
  | 'ORDER_PLACED'
  | 'ORDER_CONFIRMED'
  | 'ORDER_CANCELLED'
  | 'ORDER_COMPLETED'
  | 'ORDER_PAID'
  | 'ORDER_SHIPPED'
  | 'ORDER_REFUNDED'
  | 'ORDER_DISPUTED'
  | 'DISPUTE_RESOLVED'
  | 'DISPUTE_MESSAGE'
  | 'DISPUTE_RESOLVED_BY_SELLER'
  | 'DISPUTE_REOPENED'
  | 'NEW_MESSAGE'
  | 'NEW_INQUIRY'
  | 'NEW_INQUIRY_REPLY'
  | 'NEW_REVIEW'
  | 'ID_APPROVED'
  | 'ID_REJECTED';

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  orderId: string | null;
  listingId: string | null;
  actor: { id: string; username: string } | null;
};

export type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type InboxThread = {
  orderId: string;
  role: 'buyer' | 'seller';
  listing: {
    id: string;
    title: string;
    images: { id: string; url: string }[];
  };
  counterparty: { id: string; username: string; avatarUrl: string | null };
  orderStatus: OrderStatus;
  amount: string;
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    fromMe: boolean;
  };
  unreadCount: number;
};

export type InboxThreadsResponse = {
  threads: InboxThread[];
};

export type UnreadCount = {
  notifications: number;
  messages: number;
  // Per-bucket breakdown so the inbox tabs can show their own badge counts.
  // Always present; older clients can ignore.
  orderMessages: number;
  inquiryMessages: number;
};

// Click targets for each notification type — the UI renders the notification
// as a link to the most relevant page.
export function notificationHref(n: Notification): string {
  switch (n.type) {
    case 'ORDER_PLACED':
      return `/dashboard?tab=sales&order=${n.orderId ?? ''}`;
    case 'ORDER_CONFIRMED':
    case 'ORDER_COMPLETED':
      return `/dashboard?tab=purchases&order=${n.orderId ?? ''}`;
    case 'ORDER_PAID':
      return `/dashboard?tab=sales&order=${n.orderId ?? ''}`;
    case 'ORDER_CANCELLED':
      // We don't always know which side cancelled; both roles render the
      // order. Purchases first since most cancels are seller-driven rejects.
      return `/dashboard?tab=purchases&order=${n.orderId ?? ''}`;
    case 'ORDER_SHIPPED':
      return `/dashboard?tab=in_purchases&order=${n.orderId ?? ''}`;
    case 'ORDER_REFUNDED':
      return `/dashboard?tab=purchases&order=${n.orderId ?? ''}`;
    case 'ORDER_DISPUTED':
      // Seller-facing — they need to see the order they're being disputed on.
      return `/dashboard?tab=sales&order=${n.orderId ?? ''}`;
    case 'DISPUTE_RESOLVED':
    case 'DISPUTE_RESOLVED_BY_SELLER':
    case 'DISPUTE_REOPENED':
    case 'DISPUTE_MESSAGE':
      // Both parties hit these; deep-link to the order so they land on the
      // dispute section + thread in context.
      return `/dashboard?order=${n.orderId ?? ''}`;
    case 'NEW_MESSAGE':
      return `/account/messages?order=${n.orderId ?? ''}`;
    case 'NEW_INQUIRY':
    case 'NEW_INQUIRY_REPLY':
      return `/account/messages?tab=inquiries`;
    case 'NEW_REVIEW':
      return n.actor ? `/sellers/${n.actor.id}?tab=reviews` : '/dashboard';
    case 'ID_APPROVED':
    case 'ID_REJECTED':
      return '/account/verification';
    default:
      // Defensive fallback: if the server adds a new notification type before
      // the client knows about it, send users to a sensible default rather
      // than crashing the page with an undefined href.
      return '/dashboard';
  }
}
