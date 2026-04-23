'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api } from '@/lib/api';
import { useSavedStore } from '@/stores/saved';
import { useAuthStore } from '@/stores/auth';
import ListingCard from '@/components/ListingCard';
import OrderRow from '@/components/OrderRow';
import {
  type ListingSummary,
  type ListingStatus,
  type Pagination,
  formatPrice,
  getConditionStyle,
  STATUS_STYLES,
} from '@/types/listings';
import {
  type Order,
  type OrderListResponse,
} from '@/types/orders';

type StatusCounts = Record<ListingStatus, number>;

type Tab =
  | 'active'          // Selling / Active listings
  | 'in_sales'        // Selling / In progress sales
  | 'past_sales'      // Selling / Past sales
  | 'saved'           // Buying / Saved
  | 'in_purchases'    // Buying / In progress purchases
  | 'past_purchases'; // Buying / Past purchases

const VALID_TABS: Tab[] = [
  'active',
  'in_sales',
  'past_sales',
  'saved',
  'in_purchases',
  'past_purchases',
];

// Back-compat for old URL params (?tab=listings|sales|purchases) — map them
// to the closest new tab so existing redirects (e.g. payment-success URLs that
// hardcode ?tab=purchases) still land in the right place.
const TAB_ALIASES: Record<string, Tab> = {
  listings: 'active',
  sales: 'in_sales',
  purchases: 'in_purchases',
};

type Role = 'selling' | 'buying';

const SELLING_TABS: Tab[] = ['active', 'in_sales', 'past_sales'];
const BUYING_TABS: Tab[] = ['saved', 'in_purchases', 'past_purchases'];

function tabRole(tab: Tab): Role {
  return SELLING_TABS.includes(tab) ? 'selling' : 'buying';
}

function defaultTabFor(role: Role): Tab {
  return role === 'selling' ? 'active' : 'saved';
}

const TAB_LABELS: Record<Tab, string> = {
  active: 'Active Listings',
  in_sales: 'In Progress',
  past_sales: 'Past Sales',
  saved: 'Saved',
  in_purchases: 'In Progress',
  past_purchases: 'Past Purchases',
};

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<DashboardFallback />}>
        <Dashboard />
      </Suspense>
    </ProtectedRoute>
  );
}

function DashboardFallback() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="h-8 w-32 rounded bg-[var(--bg-panel-hi)] animate-pulse" />
    </div>
  );
}

function resolveTab(raw: string | null): Tab {
  if (!raw) return 'active';
  if ((VALID_TABS as string[]).includes(raw)) return raw as Tab;
  return TAB_ALIASES[raw] ?? 'active';
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab: Tab = resolveTab(searchParams.get('tab'));

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Keep active tab in sync with URL — handles back/forward and redirects.
  useEffect(() => {
    setActiveTab(resolveTab(searchParams.get('tab')));
  }, [searchParams]);

  // Payment return banner + PayPal capture handler
  const paymentStatus = searchParams.get('payment');
  const paymentOrderId = searchParams.get('order');
  const paypalToken = searchParams.get('token');
  const [paymentBanner, setPaymentBanner] = useState<
    { type: 'success' | 'error' | 'info'; message: string } | null
  >(null);
  const [capturingPayPal, setCapturingPayPal] = useState(false);
  // Bumped whenever a server-side order state change completes (e.g., PayPal
  // capture). PurchasesTab subscribes to this via a prop and re-fetches.
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  // Prevents a double-capture in React StrictMode (dev) or a user refreshing
  // mid-return. PayPal's `captureOrder` is not idempotent at the API level,
  // so a second call after a successful one returns ORDER_ALREADY_CAPTURED.
  const captureFiredRef = useRef(false);

  useEffect(() => {
    if (!paymentStatus) return;

    if (paymentStatus === 'cancelled') {
      // Release the server-side PENDING lock so Pay Now works again — the
      // provider (Stripe / Square / PayPal cancel URL) has told us the user
      // explicitly backed out, which means no capture is coming. Best-effort
      // only: if it 409s we've hit a race (webhook already won) and the
      // order is in the right state regardless.
      if (paymentOrderId) {
        api(`/api/orders/${paymentOrderId}/pay/abandon`, { method: 'POST' })
          .catch((err) => {
            console.warn('Payment abandon failed:', err);
          })
          .finally(() => {
            setOrdersRefreshKey((k) => k + 1);
          });
      }
      setPaymentBanner({
        type: 'info',
        message: 'Payment was cancelled. You can try again at any time.',
      });
      router.replace('/dashboard?tab=purchases');
      return;
    }

    if (paymentStatus === 'success' && paymentOrderId && paypalToken) {
      if (captureFiredRef.current) return;
      captureFiredRef.current = true;
      setCapturingPayPal(true);
      api<{ order: Order }>(
        `/api/orders/${paymentOrderId}/pay/paypal/capture`,
        {
          method: 'POST',
          body: JSON.stringify({ paypalOrderId: paypalToken }),
        },
      )
        .then(() => {
          setPaymentBanner({
            type: 'success',
            message: 'Payment completed successfully.',
          });
          setOrdersRefreshKey((k) => k + 1);
        })
        .catch((err) => {
          setPaymentBanner({
            type: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Payment capture failed. Please contact support.',
          });
        })
        .finally(() => {
          setCapturingPayPal(false);
          router.replace('/dashboard?tab=purchases');
        });
      return;
    }

    if (paymentStatus === 'success') {
      setPaymentBanner({
        type: 'success',
        message:
          'Payment submitted. It may take a moment to reflect below.',
      });
      // Stripe / Square land here. The webhook may have already flipped the
      // order; refresh so the UI picks up the new state.
      setOrdersRefreshKey((k) => k + 1);
      router.replace('/dashboard?tab=purchases');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentStatus, paymentOrderId, paypalToken]);

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== 'active') params.set('tab', tab);
    router.replace(`/dashboard${params.size > 0 ? `?${params.toString()}` : ''}`);
  }

  function selectRole(role: Role) {
    selectTab(defaultTabFor(role));
  }

  const role = tabRole(activeTab);
  const visibleTabs = role === 'selling' ? SELLING_TABS : BUYING_TABS;

  // Arrow-key navigation between sub-tabs.
  function handleTabsKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const idx = visibleTabs.indexOf(activeTab);
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = visibleTabs[(idx + delta + visibleTabs.length) % visibleTabs.length];
    selectTab(next);
    document.getElementById(`dashboard-tab-${next}`)?.focus();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">Dashboard</h1>

      {/* Payment banner */}
      {(paymentBanner || capturingPayPal) && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm flex items-center justify-between ${
            capturingPayPal
              ? 'border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
              : paymentBanner?.type === 'success'
              ? 'border-[var(--neon-green)]/40 bg-[var(--tint-green)] text-[var(--neon-green)]'
              : paymentBanner?.type === 'error'
              ? 'border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] text-[var(--neon-danger)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] text-[var(--text-muted)]'
          }`}
        >
          <span>
            {capturingPayPal
              ? 'Finalising your PayPal payment...'
              : paymentBanner?.message}
          </span>
          {paymentBanner && !capturingPayPal && (
            <button
              onClick={() => setPaymentBanner(null)}
              className="font-medium hover:opacity-70"
              aria-label="Dismiss"
            >
              &times;
            </button>
          )}
        </div>
      )}

      {/* Top-level role switcher */}
      <div className="mt-6 inline-flex rounded-lg border border-[var(--border-hi)] bg-[var(--bg-panel)] p-1">
        {(['selling', 'buying'] as const).map((r) => {
          const selected = role === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => selectRole(r)}
              aria-pressed={selected}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-all ${
                selected
                  ? 'bg-[var(--neon-cyan)] text-[var(--btn-primary-text)] shadow-[0_0_14px_-4px_color-mix(in_oklab,var(--neon-cyan)_55%,transparent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {r === 'selling' ? 'Selling' : 'Buying'}
            </button>
          );
        })}
      </div>

      {/* Sub-tabs */}
      <div className="mt-4 border-b border-[var(--border-subtle)]">
        <div
          role="tablist"
          aria-label={`${role === 'selling' ? 'Selling' : 'Buying'} tabs`}
          onKeyDown={handleTabsKeyDown}
          className="flex gap-6"
        >
          {visibleTabs.map((tab) => {
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`dashboard-tab-${tab}`}
                aria-selected={selected}
                aria-controls={`dashboard-panel-${tab}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(tab)}
                className={`pb-3 text-sm font-medium transition-colors ${
                  selected
                    ? 'border-b-2 border-[var(--neon-cyan)] text-[var(--neon-cyan)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        id={`dashboard-panel-${activeTab}`}
        aria-labelledby={`dashboard-tab-${activeTab}`}
        className="mt-6"
      >
        {activeTab === 'active' && <MyListingsTab statusFilter="ACTIVE" />}
        {activeTab === 'saved' && <SavedListingsTab />}
        {activeTab === 'in_purchases' && (
          <OrdersTab role="buyer" bucket="in_progress" refreshKey={ordersRefreshKey} />
        )}
        {activeTab === 'past_purchases' && (
          <OrdersTab role="buyer" bucket="past" refreshKey={ordersRefreshKey} />
        )}
        {activeTab === 'in_sales' && <OrdersTab role="seller" bucket="in_progress" />}
        {activeTab === 'past_sales' && <OrdersTab role="seller" bucket="past" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Listings tab
// ---------------------------------------------------------------------------

function MyListingsTab({ statusFilter }: { statusFilter?: ListingStatus }) {
  const router = useRouter();
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  // Remove dialog state
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const fetchListings = useCallback(
    async (p: number) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(p), limit: '12' });
        if (statusFilter) params.set('status', statusFilter);
        const data = await api<{
          listings: ListingSummary[];
          pagination: Pagination;
          counts: StatusCounts;
        }>(`/api/listings/my?${params.toString()}`);
        setListings(data.listings);
        setPagination(data.pagination);
        setCounts(data.counts);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load listings');
      } finally {
        setLoading(false);
      }
    },
    [statusFilter],
  );

  // Reset to page 1 whenever the status filter switches so the user doesn't
  // land on a now-impossible page (e.g. page 5 of "all" → switch to "active").
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

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

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <StatCard label="Total Listings" value={pagination?.total ?? 0} />
        <StatCard label="Active" value={counts?.ACTIVE ?? 0} color="text-[var(--neon-green)]" />
        <StatCard label="Sold" value={counts?.SOLD ?? 0} color="text-[var(--neon-cyan)]" />
        <Link
          href="/listings/new"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-hi)] p-4 text-sm font-medium text-[var(--neon-cyan)] hover:border-[var(--neon-cyan)] hover:bg-[var(--tint-cyan)] transition-colors"
        >
          <svg className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Listing
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          {error}
          <button onClick={() => setError('')} className="float-right font-medium hover:brightness-110">
            &times;
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel clip-corner flex gap-4 p-4 animate-pulse">
              <div className="h-20 w-20 flex-shrink-0 rounded-lg bg-[var(--bg-panel-hi)]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-[var(--bg-panel-hi)]" />
                <div className="h-4 w-1/4 rounded bg-[var(--bg-panel-hi)]" />
                <div className="h-3 w-1/3 rounded bg-[var(--bg-panel-hi)]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && listings.length === 0 && (
        <div className="panel clip-corner px-6 py-12 text-center">
          <svg className="mx-auto h-12 w-12 text-[var(--text-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3 className="mt-3 text-sm font-medium text-[var(--text-primary)]">No listings yet</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Get started by creating your first listing.</p>
          <Link
            href="/listings/new"
            className="btn-cyber-primary mt-4"
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
            const statusStyle = STATUS_STYLES[listing.status];
            const date = new Intl.DateTimeFormat('en-AU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }).format(new Date(listing.createdAt));

            return (
              <div
                key={listing.id}
                className="panel clip-corner flex items-center gap-4 p-4 hover:shadow-sm transition-shadow"
              >
                {/* Thumbnail */}
                <Link
                  href={`/listings/${listing.id}`}
                  className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--bg-panel-hi)]"
                >
                  {imageUrl ? (
                    <img src={imageUrl} alt={listing.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
                      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </Link>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Link href={`/listings/${listing.id}`} className="block">
                    <h3 className="text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--neon-cyan)] transition-colors">
                      {listing.title}
                    </h3>
                  </Link>
                  <p className="mt-0.5 text-sm font-bold text-[var(--text-primary)]">{formatPrice(listing.price)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-md px-2 py-0.5 font-medium ${statusStyle.bg}`}>
                      {statusStyle.label}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 font-medium ${condition.bg}`}>
                      {condition.label}
                    </span>
                    <span className="text-[var(--text-dim)]">{date}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-shrink-0 gap-2">
                  {listing.status === 'ACTIVE' && (
                    <>
                      <button
                        onClick={() => router.push(`/listings/${listing.id}/edit`)}
                        className="btn-cyber-outline text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setRemoveId(listing.id)}
                        className="rounded-lg border border-[var(--neon-danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--neon-danger)] hover:bg-[var(--tint-danger)] transition-colors"
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
            className="btn-cyber-outline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            Page {page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="btn-cyber-outline disabled:opacity-40 disabled:cursor-not-allowed"
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
            className="panel clip-corner mx-4 w-full max-w-sm p-6"
          >
            <h3 id="remove-title" className="text-lg font-semibold text-[var(--text-primary)]">
              Remove listing?
            </h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              This listing will be marked as removed and will no longer appear in search results. This action cannot be undone.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setRemoveId(null)}
                disabled={removing}
                className="btn-cyber-outline"
              >
                Cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="rounded-lg bg-[var(--neon-danger)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
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
    <div className="panel clip-corner p-4">
      <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ?? 'text-[var(--text-primary)]'}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved Listings tab
// ---------------------------------------------------------------------------

function SavedListingsTab() {
  const [allListings, setAllListings] = useState<ListingSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const savedIds = useSavedStore((s) => s.ids);

  const fetchSaved = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await api<{ listings: ListingSummary[]; pagination: Pagination }>(
        `/api/saved?page=${p}&limit=12`,
      );
      setAllListings(data.listings);
      setPagination(data.pagination);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSaved(page);
  }, [page, fetchSaved]);

  // Client-side filter lets optimistic unsaves disappear without refetching.
  const listings = allListings.filter((l) => savedIds.has(l.id));

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel clip-corner overflow-hidden animate-pulse">
            <div className="aspect-[4/3] bg-[var(--bg-panel-hi)]" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-3/4 rounded bg-[var(--bg-panel-hi)]" />
              <div className="h-5 w-1/3 rounded bg-[var(--bg-panel-hi)]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="panel clip-corner px-6 py-12 text-center">
        <svg className="mx-auto h-12 w-12 text-[var(--text-dim)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
        <h3 className="mt-3 text-sm font-medium text-[var(--text-primary)]">No saved listings</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Browse listings and tap the heart icon to save items you like.
        </p>
        <Link
          href="/browse"
          className="btn-cyber-primary mt-4"
        >
          Browse Listings
        </Link>
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
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-cyber-outline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            Page {page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="btn-cyber-outline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared orders tab (purchases + sales) with in-progress / past bucket split
// ---------------------------------------------------------------------------

type OrderBucket = 'in_progress' | 'past';

function OrdersTab({
  role,
  bucket,
  refreshKey = 0,
}: {
  role: 'buyer' | 'seller';
  bucket: OrderBucket;
  refreshKey?: number;
}) {
  const currentUser = useAuthStore((s) => s.user);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const endpoint = role === 'buyer' ? 'purchases' : 'sales';
  const emptyCopy = (() => {
    if (role === 'buyer') {
      return bucket === 'in_progress'
        ? {
            title: 'No purchases in progress',
            body: 'Items you buy will appear here while they are being confirmed, paid, shipped, and delivered.',
            cta: { href: '/browse', label: 'Browse Listings' },
          }
        : {
            title: 'No past purchases',
            body: 'Completed and cancelled purchases will appear here.',
            cta: { href: '/browse', label: 'Browse Listings' },
          };
    }
    return bucket === 'in_progress'
      ? {
          title: 'No sales in progress',
          body: 'When buyers request your listings, they’ll appear here to confirm, ship, and complete.',
          cta: { href: '/listings/new', label: 'Post a Listing' },
        }
      : {
          title: 'No past sales',
          body: 'Completed and cancelled sales will appear here.',
          cta: { href: '/listings/new', label: 'Post a Listing' },
        };
  })();

  const fetchOrders = useCallback(
    async (p: number) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: '10',
          bucket,
        });
        const data = await api<OrderListResponse>(
          `/api/orders/${endpoint}?${params.toString()}`,
        );
        setOrders(data.orders);
        setPagination(data.pagination);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      } finally {
        setLoading(false);
      }
    },
    [endpoint, bucket],
  );

  // Reset to page 1 when the bucket switches (e.g. user clicks Past Sales
  // while sitting on page 3 of In Progress).
  useEffect(() => {
    setPage(1);
  }, [bucket]);

  useEffect(() => {
    fetchOrders(page);
  }, [page, refreshKey, fetchOrders]);

  function refresh() {
    fetchOrders(page);
  }

  if (!currentUser) return null;

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="panel clip-corner flex gap-4 p-4 animate-pulse"
            >
              <div className="h-20 w-20 flex-shrink-0 rounded-lg bg-[var(--bg-panel-hi)]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-[var(--bg-panel-hi)]" />
                <div className="h-4 w-1/3 rounded bg-[var(--bg-panel-hi)]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="panel clip-corner px-6 py-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-[var(--text-dim)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <h3 className="mt-3 text-sm font-medium text-[var(--text-primary)]">{emptyCopy.title}</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{emptyCopy.body}</p>
          <Link
            href={emptyCopy.cta.href}
            className="btn-cyber-primary mt-4"
          >
            {emptyCopy.cta.label}
          </Link>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="space-y-3">
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              role={role}
              currentUserId={currentUser.id}
              onChange={refresh}
            />
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-cyber-outline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            Page {page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="btn-cyber-outline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

