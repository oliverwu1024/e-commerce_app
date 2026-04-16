export type ListingSummary = {
  id: string;
  title: string;
  price: string;
  category: string;
  brand: string | null;
  condition: Condition;
  status: string;
  createdAt: string;
  updatedAt?: string;
  seller: {
    id: string;
    username: string;
    location: string | null;
  };
  images: {
    id: string;
    url: string;
  }[];
};

export const STATUS_STYLES: Record<string, { label: string; bg: string }> = {
  ACTIVE: { label: 'Active', bg: 'bg-emerald-100 text-emerald-700' },
  SOLD: { label: 'Sold', bg: 'bg-blue-100 text-blue-700' },
  ON_HOLD: { label: 'On Hold', bg: 'bg-purple-100 text-purple-700' },
  REMOVED: { label: 'Removed', bg: 'bg-zinc-100 text-zinc-500' },
};

export type ListingDetail = {
  id: string;
  title: string;
  description: string;
  price: string;
  category: string;
  subcategory: string | null;
  platform: string | null;
  brand: string | null;
  condition: Condition;
  status: string;
  createdAt: string;
  updatedAt: string;
  seller: {
    id: string;
    username: string;
    location: string | null;
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
  'Accessories',
  'PC Parts',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Condition = 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';

export const CONDITIONS: { value: Condition; label: string; bg: string }[] = [
  { value: 'LIKE_NEW', label: 'Like New', bg: 'bg-emerald-100 text-emerald-700' },
  { value: 'GOOD', label: 'Good', bg: 'bg-blue-100 text-blue-700' },
  { value: 'FAIR', label: 'Fair', bg: 'bg-amber-100 text-amber-700' },
  { value: 'POOR', label: 'Poor', bg: 'bg-red-100 text-red-700' },
];

export function getConditionStyle(condition: string) {
  return (
    CONDITIONS.find((c) => c.value === condition) ?? {
      value: condition,
      label: condition,
      bg: 'bg-zinc-100 text-zinc-700',
    }
  );
}

export function formatPrice(price: string | number): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return '$0';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}
