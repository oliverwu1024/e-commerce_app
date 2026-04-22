import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import ListingDetailClient from './ListingDetailClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

type ListingMeta = {
  id: string;
  title: string;
  description: string;
  price: string | number;
  condition: string;
  status: string;
  images: { url: string }[];
  seller: { username: string; location: string | null };
};

// Server-side fetch for metadata. Wrapped in React `cache` so the page
// component and generateMetadata — which run in the same request — share the
// single upstream call instead of each hitting the API.
// Not HTTP-cached — listings change (title, price, images, status) and a
// stale OG preview is worse than the missed CDN optimization.
const fetchListingMeta = cache(async (id: string): Promise<ListingMeta | null> => {
  try {
    // encodeURIComponent locks the upstream path to a single segment — Next
    // decodes route params before handing them over, so a crafted URL like
    // /listings/%2E%2E%2Fusers would otherwise reach the backend as /../users
    // and rely on the backend's uuid check to 400. Keep the invariant local.
    const res = await fetch(`${API_URL}/api/listings/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.listing ?? null;
  } catch (err) {
    console.error('listing detail SSR fetch failed', id, err);
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await fetchListingMeta(id);

  if (!listing) {
    return {
      title: 'Listing not found',
      description: 'This listing may have been removed or never existed.',
    };
  }

  // Collapse description whitespace and trim for the social-card length.
  const description = listing.description
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  const imageUrl = listing.images[0]?.url;

  const priceNum =
    typeof listing.price === 'string' ? parseFloat(listing.price) : listing.price;
  const priceDisplay = Number.isFinite(priceNum)
    ? new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: 'AUD',
        maximumFractionDigits: 2,
      }).format(priceNum)
    : '';
  const title = priceDisplay
    ? `${listing.title} — ${priceDisplay}`
    : listing.title;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
    twitter: {
      card: imageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await fetchListingMeta(id);
  // Deduped against generateMetadata via React cache — the second call here
  // is free. If the listing doesn't exist, serve a proper HTTP 404 rather
  // than mounting the client component and letting it render its own 404.
  if (!listing) notFound();
  return <ListingDetailClient />;
}
