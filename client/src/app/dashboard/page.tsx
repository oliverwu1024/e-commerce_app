'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api } from '@/lib/api';
import {
  type ListingSummary,
  type Pagination,
  formatPrice,
  getConditionStyle,
  STATUS_STYLES,
} from '@/types/listings';

type Tab = 'listings' | 'purchases' | 'sales';

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  );
}

function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('listings');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'listings', label: 'My Listings' },
    { key: 'purchases', label: 'My Purchases' },
    { key: 'sales', label: 'My Sales' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>

      {/* Tabs */}
      <div className="mt-6 border-b border-zinc-200">
        <nav className="flex gap-6" aria-label="Dashboard tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {activeTab === 'listings' && <MyListingsTab />}
        {activeTab === 'purchases' && <PlaceholderTab name="Purchases" />}
        {activeTab === 'sales' && <PlaceholderTab name="Sales" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Listings tab
// ---------------------------------------------------------------------------

function MyListingsTab() {
  const router = useRouter();
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  // Remove dialog state
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const fetchListings = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ listings: ListingSummary[]; pagination: Pagination }>(
        `/api/listings/my?page=${p}&limit=12`,
      );
      setListings(data.listings);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListings(page);
  }, [page, fetchListings]);

  async function handleRemove() {
    if (!removeId) return;
    setRemoving(true);
    try {
      await api(`/api/listings/${removeId}`, { method: 'DELETE' });
      setRemoveId(null);
      fetchListings(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove listing');
    } finally {
      setRemoving(false);
    }
  }

  // Compute stats
  const totalActive = listings.filter((l) => l.status === 'ACTIVE').length;
  const totalSold = listings.filter((l) => l.status === 'SOLD').length;

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <StatCard label="Total Listings" value={pagination?.total ?? 0} />
        <StatCard label="Active" value={totalActive} color="text-emerald-600" />
        <StatCard label="Sold" value={totalSold} color="text-blue-600" />
        <Link
          href="/listings/new"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-4 text-sm font-medium text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors"
        >
          <svg className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Listing
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
          <button onClick={() => setError('')} className="float-right font-medium hover:text-red-800">
            &times;
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 animate-pulse">
              <div className="h-20 w-20 flex-shrink-0 rounded-lg bg-zinc-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-zinc-200" />
                <div className="h-4 w-1/4 rounded bg-zinc-200" />
                <div className="h-3 w-1/3 rounded bg-zinc-200" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && listings.length === 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center">
          <svg className="mx-auto h-12 w-12 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3 className="mt-3 text-sm font-medium text-zinc-900">No listings yet</h3>
          <p className="mt-1 text-sm text-zinc-500">Get started by creating your first listing.</p>
          <Link
            href="/listings/new"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Sell an Item
          </Link>
        </div>
      )}

      {/* Listing rows */}
      {!loading && listings.length > 0 && (
        <div className="space-y-3">
          {listings.map((listing) => {
            const imageUrl = listing.images[0]?.url;
            const condition = getConditionStyle(listing.condition);
            const statusStyle = STATUS_STYLES[listing.status] ?? {
              label: listing.status,
              bg: 'bg-zinc-100 text-zinc-600',
            };
            const date = new Intl.DateTimeFormat('en-AU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }).format(new Date(listing.createdAt));

            return (
              <div
                key={listing.id}
                className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 hover:shadow-sm transition-shadow"
              >
                {/* Thumbnail */}
                <Link
                  href={`/listings/${listing.id}`}
                  className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-100"
                >
                  {imageUrl ? (
                    <img src={imageUrl} alt={listing.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-zinc-300">
                      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </Link>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Link href={`/listings/${listing.id}`} className="block">
                    <h3 className="text-sm font-medium text-zinc-900 truncate hover:text-blue-600 transition-colors">
                      {listing.title}
                    </h3>
                  </Link>
                  <p className="mt-0.5 text-sm font-bold text-zinc-900">{formatPrice(listing.price)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-md px-2 py-0.5 font-medium ${statusStyle.bg}`}>
                      {statusStyle.label}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 font-medium ${condition.bg}`}>
                      {condition.label}
                    </span>
                    <span className="text-zinc-400">{date}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-shrink-0 gap-2">
                  {listing.status === 'ACTIVE' && (
                    <>
                      <button
                        onClick={() => router.push(`/listings/${listing.id}/edit`)}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setRemoveId(listing.id)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* Remove confirmation dialog */}
      {removeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="alertdialog"
            aria-labelledby="remove-title"
            className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
          >
            <h3 id="remove-title" className="text-lg font-semibold text-zinc-900">
              Remove listing?
            </h3>
            <p className="mt-2 text-sm text-zinc-600">
              This listing will be marked as removed and will no longer appear in search results. This action cannot be undone.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setRemoveId(null)}
                disabled={removing}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ?? 'text-zinc-900'}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder tab
// ---------------------------------------------------------------------------

function PlaceholderTab({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center">
      <svg className="mx-auto h-12 w-12 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h3 className="mt-3 text-sm font-medium text-zinc-900">My {name}</h3>
      <p className="mt-1 text-sm text-zinc-500">This section will be available soon.</p>
    </div>
  );
}
