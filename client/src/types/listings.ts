export type ListingStatus = 'ACTIVE' | 'HIDDEN' | 'ON_HOLD' | 'SOLD' | 'REMOVED';

export type FulfillmentMethod = 'POST_ONLY' | 'PICKUP_ONLY' | 'BOTH';

export const FULFILLMENT_LABELS: Record<FulfillmentMethod, string> = {
  POST_ONLY: 'Post only',
  PICKUP_ONLY: 'Pickup only',
  BOTH: 'Pickup or post',
};

export type ListingSummary = {
  id: string;
  title: string;
  price: string;
  fulfillmentMethod: FulfillmentMethod;
  shippingPrice: string | null;
  category: string;
  brand: string | null;
  condition: Condition;
  status: ListingStatus;
  createdAt: string;
  updatedAt?: string;
  seller: {
    id: string;
    username: string;
    location: string | null;
    avatarUrl: string | null;
  };
  images: {
    id: string;
    url: string;
  }[];
};

export const STATUS_STYLES: Record<ListingStatus, { label: string; bg: string }> = {
  ACTIVE: { label: 'Active', bg: 'bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40' },
  HIDDEN: { label: 'Hidden', bg: 'bg-[var(--bg-panel-hi)] text-[var(--text-dim)] border border-[var(--border-subtle)]' },
  SOLD: { label: 'Sold', bg: 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40' },
  ON_HOLD: { label: 'On Hold', bg: 'bg-[var(--tint-magenta)] text-[var(--neon-magenta)] border border-[var(--neon-magenta)]/40' },
  REMOVED: { label: 'Removed', bg: 'bg-[var(--bg-panel-hi)] text-[var(--text-dim)] border border-[var(--border-subtle)]' },
};

export type ListingDetail = {
  id: string;
  title: string;
  description: string;
  price: string;
  fulfillmentMethod: FulfillmentMethod;
  shippingPrice: string | null;
  category: string;
  subcategory: string | null;
  platform: string | null;
  brand: string | null;
  condition: Condition;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  seller: {
    id: string;
    username: string;
    location: string | null;
    avatarUrl: string | null;
    createdAt: string;
    avgRating: number | null;
    totalReviews: number;
    totalSales: number;
  };
  images: {
    id: string;
    url: string;
    displayOrder: number;
  }[];
  videos: {
    id: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    displayOrder: number;
  }[];
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ListingsResponse = {
  listings: ListingSummary[];
  pagination: Pagination;
};

// Keep in sync with server/src/schemas/listings.ts CATEGORIES
export const CATEGORIES = [
  'Phones',
  'Laptops',
  'Desktops',
  'Tablets',
  'Consoles',
  'Cameras',
  'Audio',
  'Computer Accessories',
  'Mobile Accessories',
  'PC Parts',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Condition = 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';

export const CONDITIONS: { value: Condition; label: string; bg: string }[] = [
  {
    value: 'LIKE_NEW',
    label: 'Like New',
    bg: 'bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40',
  },
  {
    value: 'GOOD',
    label: 'Good',
    bg: 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40',
  },
  {
    value: 'FAIR',
    label: 'Fair',
    bg: 'bg-[var(--tint-amber)] text-[var(--neon-amber)] border border-[var(--neon-amber)]/40',
  },
  {
    value: 'POOR',
    label: 'Poor',
    bg: 'bg-[var(--tint-danger)] text-[var(--neon-danger)] border border-[var(--neon-danger)]/40',
  },
];

export function getConditionStyle(condition: string) {
  return (
    CONDITIONS.find((c) => c.value === condition) ?? {
      value: condition,
      label: condition,
      bg: 'bg-[var(--bg-panel-hi)] text-[var(--text-muted)] border border-[var(--border-hi)]',
    }
  );
}

export function formatPrice(price: string | number): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}
