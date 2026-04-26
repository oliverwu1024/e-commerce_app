import type { MetadataRoute } from 'next';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://electromarket-app.com';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

type ListingSummary = {
  id: string;
  updatedAt?: string;
};

// Re-fetched on every build (and at the cache TTL below in production).
// We deliberately don't 404 if the API is down — return the static routes
// so crawlers can still see the homepage and main entry points.
async function fetchListingIds(): Promise<ListingSummary[]> {
  try {
    const res = await fetch(`${API_URL}/api/listings?limit=5000`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { listings?: ListingSummary[] };
    return data.listings ?? [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/browse`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/help`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const listings = await fetchListingIds();
  const listingRoutes: MetadataRoute.Sitemap = listings.map((l) => ({
    url: `${SITE_URL}/listings/${l.id}`,
    lastModified: l.updatedAt ? new Date(l.updatedAt) : now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [...staticRoutes, ...listingRoutes];
}
