'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import ListingCard from '@/components/ListingCard';
import ListingCardSkeleton from '@/components/ListingCardSkeleton';
import CategoryIcon from '@/components/CategoryIcon';
import { type ListingSummary, type ListingsResponse, CATEGORIES } from '@/types/listings';

export default function Home() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [recentListings, setRecentListings] = useState<ListingSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchRecent() {
      try {
        const data = await api<ListingsResponse>('/api/listings?limit=8&sort=newest');
        if (!cancelled) setRecentListings(data.listings);
      } catch {
        // Listings may not be available yet — show empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRecent();
    return () => { cancelled = true; };
  }, []);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/browse?search=${encodeURIComponent(q)}` : '/browse');
  }

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Buy &amp; Sell Used Electronics
          </h1>
          <p className="mt-4 text-lg text-blue-100 max-w-2xl mx-auto">
            Find great deals on phones, laptops, consoles, cameras, and more
            from trusted sellers across Australia.
          </p>

          <form onSubmit={handleSearch} className="mt-8 mx-auto max-w-xl">
            <div className="flex rounded-xl bg-white shadow-lg overflow-hidden">
              <div className="relative flex-1">
                <svg
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for phones, laptops, cameras..."
                  className="w-full py-4 pl-12 pr-4 text-zinc-900 placeholder-zinc-400 focus:outline-none"
                  aria-label="Search listings"
                />
              </div>
              <button
                type="submit"
                className="px-6 bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 transition-colors border-l border-blue-500"
              >
                Search
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className="bg-zinc-50">
        {/* Categories */}
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-10">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Browse by Category
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat}
                href={`/browse?category=${encodeURIComponent(cat)}`}
                className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group"
              >
                <div className="text-zinc-500 group-hover:text-blue-600 transition-colors">
                  <CategoryIcon category={cat} className="h-8 w-8" />
                </div>
                <span className="text-xs font-medium text-zinc-700 group-hover:text-blue-600 transition-colors text-center leading-tight">
                  {cat}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Recent Listings */}
        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-zinc-900">
              Recent Listings
            </h2>
            <Link
              href="/browse"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              View all &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {loading
              ? Array.from({ length: 8 }, (_, i) => (
                  <ListingCardSkeleton key={i} />
                ))
              : recentListings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
          </div>

          {!loading && recentListings.length === 0 && (
            <div className="text-center py-16">
              <p className="text-zinc-500">No listings yet. Be the first to post!</p>
              <Link
                href="/listings/new"
                className="mt-4 inline-block rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                + Sell an Item
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
