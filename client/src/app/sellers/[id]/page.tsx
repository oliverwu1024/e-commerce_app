'use client';

import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import Stars from '@/components/Stars';
import ListingCard from '@/components/ListingCard';
import ListingCardSkeleton from '@/components/ListingCardSkeleton';
import type { ListingSummary, Pagination } from '@/types/listings';
import type { PublicUser, SellerReviewsResponse } from '@/types/users';

type Tab = 'listings' | 'reviews';
const VALID_TABS: Tab[] = ['listings', 'reviews'];

export default function SellerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <SellerProfile id={id} />
    </Suspense>
  );
}

function SellerProfile({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: Tab =
    tabParam && (VALID_TABS as string[]).includes(tabParam) ? (tabParam as Tab) : 'listings';

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = searchParams.get('tab');
    setActiveTab(t && (VALID_TABS as string[]).includes(t) ? (t as Tab) : 'listings');
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    async function fetchUser() {
      setLoading(true);
      setError('');
      try {
        const data = await api<{ user: PublicUser }>(`/api/users/${id}`);
        if (!cancelled) setUser(data.user);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Seller not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchUser();
    return () => { cancelled = true; };
  }, [id]);

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== 'listings') params.set('tab', tab);
    router.replace(`/sellers/${id}${params.size > 0 ? `?${params.toString()}` : ''}`);
  }

  function handleTabsKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const currentIdx = VALID_TABS.indexOf(activeTab);
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = VALID_TABS[(currentIdx + delta + VALID_TABS.length) % VALID_TABS.length];
    selectTab(next);
    document.getElementById(`seller-tab-${next}`)?.focus();
  }

  if (loading) return <ProfileSkeleton />;

  if (error || !user) {
    return (
      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto max-w-5xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Seller not found</h1>
          <p className="text-zinc-500 mb-6">{error || 'This seller may no longer exist.'}</p>
          <Link
            href="/browse"
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Browse listings
          </Link>
        </div>
      </main>
    );
  }

  const memberSince = new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(user.createdAt));

  return (
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xl font-bold text-blue-600">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-zinc-900">{user.username}</h1>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    user.sellerType === 'BUSINESS'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {user.sellerType === 'BUSINESS' ? 'Business Seller' : 'Personal Seller'}
                </span>
              </div>
              {user.businessName && user.sellerType === 'BUSINESS' && (
                <p className="mt-1 text-sm text-zinc-600">{user.businessName}</p>
              )}
              {user.location && (
                <p className="mt-1 text-sm text-zinc-500">{user.location}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {user.avgRating !== null ? (
                  <div className="flex items-center gap-1.5">
                    <Stars rating={user.avgRating} />
                    <span className="font-medium text-zinc-700">
                      {user.avgRating.toFixed(1)}
                    </span>
                    <span className="text-zinc-500">
                      ({user.totalReviews} {user.totalReviews === 1 ? 'review' : 'reviews'})
                    </span>
                  </div>
                ) : (
                  <span className="text-zinc-400 text-xs">No reviews yet</span>
                )}
                <span className="text-zinc-300" aria-hidden="true">|</span>
                <span className="text-zinc-500">
                  {user.totalSales} {user.totalSales === 1 ? 'sale' : 'sales'}
                </span>
                <span className="text-zinc-300" aria-hidden="true">|</span>
                <span className="text-zinc-500">Member since {memberSince}</span>
              </div>
              {user.bio && (
                <p className="mt-3 text-sm text-zinc-600 whitespace-pre-line">{user.bio}</p>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 border-b border-zinc-200">
          <div
            role="tablist"
            aria-label="Seller profile tabs"
            onKeyDown={handleTabsKeyDown}
            className="flex gap-6"
          >
            {(
              [
                { key: 'listings', label: 'Active Listings' },
                { key: 'reviews', label: `Reviews${user.totalReviews > 0 ? ` (${user.totalReviews})` : ''}` },
              ] as { key: Tab; label: string }[]
            ).map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  id={`seller-tab-${tab.key}`}
                  aria-selected={selected}
                  aria-controls={`seller-panel-${tab.key}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab.key)}
                  className={`pb-3 text-sm font-medium transition-colors ${
                    selected
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          role="tabpanel"
          id={`seller-panel-${activeTab}`}
          aria-labelledby={`seller-tab-${activeTab}`}
          className="mt-6"
        >
          {activeTab === 'listings' && <SellerListingsTab sellerId={id} />}
          {activeTab === 'reviews' && <SellerReviewsTab sellerId={id} />}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Listings tab
// ---------------------------------------------------------------------------

function SellerListingsTab({ sellerId }: { sellerId: string }) {
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const fetchListings = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ listings: ListingSummary[]; pagination: Pagination }>(
        `/api/listings?sellerId=${sellerId}&page=${p}&limit=12`,
      );
      setListings(data.listings);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, [sellerId]);

  useEffect(() => {
    fetchListings(page);
  }, [page, fetchListings]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ListingCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center">
        <p className="text-sm text-zinc-500">
          This seller has no active listings right now.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Paginator
          page={page}
          totalPages={pagination.totalPages}
          onChange={setPage}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews tab
// ---------------------------------------------------------------------------

function SellerReviewsTab({ sellerId }: { sellerId: string }) {
  const [data, setData] = useState<SellerReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const fetchReviews = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api<SellerReviewsResponse>(
        `/api/reviews/seller/${sellerId}?page=${p}&limit=10`,
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [sellerId]);

  useEffect(() => {
    fetchReviews(page);
  }, [page, fetchReviews]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4 animate-pulse">
            <div className="h-4 w-1/4 rounded bg-zinc-200" />
            <div className="mt-2 h-3 w-3/4 rounded bg-zinc-200" />
            <div className="mt-1 h-3 w-1/2 rounded bg-zinc-200" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (!data || data.reviews.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center">
        <p className="text-sm text-zinc-500">
          No reviews yet. Reviews from completed purchases will show up here.
        </p>
      </div>
    );
  }

  const total = data.totalReviews || 1;

  return (
    <div>
      {/* Aggregate panel */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="sm:w-40 text-center">
            <div className="text-4xl font-bold text-zinc-900">
              {data.avgRating !== null ? data.avgRating.toFixed(1) : '–'}
            </div>
            <div className="mt-1 flex justify-center">
              <Stars rating={data.avgRating ?? 0} />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {data.totalReviews} {data.totalReviews === 1 ? 'review' : 'reviews'}
            </p>
          </div>

          <div className="flex-1 space-y-1">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const count = data.breakdown[String(star) as '1' | '2' | '3' | '4' | '5'];
              const pct = (count / total) * 100;
              return (
                <div key={star} className="flex items-center gap-3 text-xs">
                  <span className="w-4 text-zinc-500">{star}</span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className="h-full bg-amber-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-zinc-500">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Review list */}
      <div className="space-y-3">
        {data.reviews.map((review) => {
          const date = new Intl.DateTimeFormat('en-AU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }).format(new Date(review.createdAt));
          return (
            <div
              key={review.id}
              className="rounded-xl border border-zinc-200 bg-white p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Stars rating={review.rating} size="sm" />
                  <span className="text-sm font-medium text-zinc-700">
                    {review.reviewer.username}
                  </span>
                </div>
                <span className="text-xs text-zinc-400">{date}</span>
              </div>
              {review.comment && (
                <p className="mt-2 text-sm text-zinc-600 whitespace-pre-wrap">
                  {review.comment}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {data.pagination.totalPages > 1 && (
        <Paginator
          page={page}
          totalPages={data.pagination.totalPages}
          onChange={setPage}
        />
      )}
    </div>
  );
}

function Paginator({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Previous
      </button>
      <span className="text-sm text-zinc-500">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="flex gap-4 animate-pulse">
            <div className="h-16 w-16 rounded-full bg-zinc-200" />
            <div className="flex-1 space-y-2">
              <div className="h-6 w-1/3 rounded bg-zinc-200" />
              <div className="h-4 w-1/4 rounded bg-zinc-200" />
              <div className="h-4 w-1/2 rounded bg-zinc-200" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
