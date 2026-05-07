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
import OnboardingChecklist from '@/components/OnboardingChecklist';
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
  | 'active'             // Selling / Active listings
  | 'in_sales'           // Selling / In progress sales
  | 'disputed_sales'     // Selling / Orders with an active dispute
  | 'past_sales'         // Selling / Past sales
  | 'saved'              // Buying / Saved
  | 'in_purchases'       // Buying / In progress purchases
  | 'disputed_purchases' // Buying / Purchases with an active dispute
  | 'past_purchases';    // Buying / Past purchases

const VALID_TABS: Tab[] = [
  'active',
  'in_sales',
  'disputed_sales',
  'past_sales',
  'saved',
  'in_purchases',
  'disputed_purchases',
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

const SELLING_TABS: Tab[] = [
  'active',
  'in_sales',
  'disputed_sales',
  'past_sales',
];
const BUYING_TABS: Tab[] = [
  'saved',
  'in_purchases',
  'disputed_purchases',
  'past_purchases',
];

function tabRole(tab: Tab): Role {
  return SELLING_TABS.includes(tab) ? 'selling' : 'buying';
}

function defaultTabFor(role: Role): Tab {
  return role === 'selling' ? 'active' : 'saved';
}

const TAB_LABELS: Record<Tab, string> = {
  active: 'Active Listings',
  in_sales: 'In Progress',
  disputed_sales: 'In Dispute',
  past_sales: 'Past Sales',
  saved: 'Saved',
  in_purchases: 'In Progress',
  disputed_purchases: 'In Dispute',
  past_purchases: 'Past Purchases',
};

// Past tabs grow unbounded; a count there is noise rather than signal so we
// skip the badge for them.
const COUNTLESS_TABS: ReadonlySet<Tab> = new Set([
  'past_sales',
  'past_purchases',
]);

type TabCounts = {
  selling: { active: number; in_progress: number; disputed: number };
  buying: { saved: number; in_progress: number; disputed: number };
  // Aggregate over the buyer's unpaid CARD orders. Drives the dashboard
  // banner + the "N to pay" pill on the In Progress tab so the cue is
  // visible without clicking into the tab.
  unpaidCard: { count: number; totalCents: number };
};

function tabCountFor(tab: Tab, counts: TabCounts | null): number | null {
  if (!counts) return null;
  switch (tab) {
    case 'active':
      return counts.selling.active;
    case 'in_sales':
      return counts.selling.in_progress;
    case 'disputed_sales':
      return counts.selling.disputed;
    case 'saved':
      return counts.buying.saved;
    case 'in_purchases':
      return counts.buying.in_progress;
    case 'disputed_purchases':
      return counts.buying.disputed;
    default:
      return null;
  }
}

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

  // Payment return banner + Square confirm handler
  const paymentStatus = searchParams.get('payment');
  const paymentOrderId = searchParams.get('order');
  const [paymentBanner, setPaymentBanner] = useState<
    { type: 'success' | 'error' | 'info'; message: string } | null
  >(null);
  // Bumped whenever a server-side order state change completes (e.g., Square
  // confirm). PurchasesTab subscribes to this via a prop and re-fetches.
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  const [tabCounts, setTabCounts] = useState<TabCounts | null>(null);

  // Tab counts — re-fetched whenever order state changes so badges stay
  // current after a buyer files a dispute / accepts / etc.
  useEffect(() => {
    let cancelled = false;
    api<TabCounts>('/api/dashboard/tab-counts')
      .then((data) => {
        if (!cancelled) setTabCounts(data);
      })
      .catch(() => {
        // Silently fall back to no-count rendering — the counts are a polish,
        // not load-bearing for any of the actual workflows.
      });
    return () => {
      cancelled = true;
    };
  }, [ordersRefreshKey]);
  // Prevents a double-confirm in React StrictMode (dev) or a user refreshing
  // mid-return. markOrderPaid is idempotent but the extra round-trip is
  // wasteful.
  const captureFiredRef = useRef(false);

  useEffect(() => {
    if (!paymentStatus) return;

    if (paymentStatus === 'cancelled') {
      // Release the server-side PENDING lock so Pay Now works again — the
      // provider (Stripe / Square cancel URL) has told us the user
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

    // Square flow: connected-account Square doesn't give us auto webhooks,
    // so after the buyer returns we poll /pay/square/confirm which queries
    // the seller's Square orders API with their OAuth token. Server may
    // respond with 202 {pending: true} if Square hasn't surfaced the
    // payment yet — retry once with a short delay.
    const provider = searchParams.get('provider');
    if (paymentStatus === 'success' && paymentOrderId && provider === 'square') {
      if (captureFiredRef.current) return;
      captureFiredRef.current = true;

      async function confirmSquare() {
        const doConfirm = async () => {
          const resp = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000'}/api/orders/${paymentOrderId}/pay/square/confirm`,
            { method: 'POST', credentials: 'include' },
          );
          // Parse the body up front. 202 still has Response.ok=true so the
          // shape `{ pending: true }` is the only signal that the server
          // hasn't actually marked the order paid yet.
          const text = await resp.text();
          const body = text ? (JSON.parse(text) as { pending?: boolean; error?: string }) : {};
          return { resp, body };
        };
        try {
          let { resp, body } = await doConfirm();
          // Retry once with a short delay if Square hasn't surfaced the
          // order yet — Square Sandbox in particular is slow.
          if (resp.status === 202 || body.pending) {
            await new Promise((r) => setTimeout(r, 1500));
            ({ resp, body } = await doConfirm());
          }
          if (!resp.ok) {
            throw new Error(body.error || 'Square confirmation failed');
          }
          if (body.pending) {
            // Server still says pending after retry — surface honestly so the
            // buyer doesn't think their order is paid when it isn't.
            setPaymentBanner({
              type: 'info',
              message:
                'Square is still confirming your payment. Refresh in a moment, or use Release lock if it does not clear.',
            });
          } else {
            setPaymentBanner({
              type: 'success',
              message: 'Payment completed successfully.',
            });
          }
          setOrdersRefreshKey((k) => k + 1);
        } catch (err) {
          setPaymentBanner({
            type: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Square confirmation failed. Please contact support.',
          });
        } finally {
          router.replace('/dashboard?tab=purchases');
        }
      }
      confirmSquare();
      return;
    }

    if (paymentStatus === 'success') {
      setPaymentBanner({
        type: 'success',
        message:
          'Payment submitted. It may take a moment to reflect below.',
      });
      // Stripe lands here — webhook has already flipped the order (or will
      // any second). Refresh so the UI picks up the new state.
      setOrdersRefreshKey((k) => k + 1);
      router.replace('/dashboard?tab=purchases');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentStatus, paymentOrderId]);

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
      {paymentBanner && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm flex items-center justify-between ${
            paymentBanner.type === 'success'
              ? 'border-[var(--neon-green)]/40 bg-[var(--tint-green)] text-[var(--neon-green)]'
              : paymentBanner.type === 'error'
              ? 'border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] text-[var(--neon-danger)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] text-[var(--text-muted)]'
          }`}
        >
          <span>{paymentBanner.message}</span>
          <button
            onClick={() => setPaymentBanner(null)}
            className="font-medium hover:opacity-70"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* Action banners — surface "you have X waiting on you" cues without
          forcing the user to click into a tab. Stack 0–2 banners depending
          on whether the user is acting as buyer, seller, or both. */}
      <DashboardActionBanners
        counts={tabCounts}
        onNavigate={selectTab}
      />

      {/* Onboarding checklist — only relevant to sellers; auto-hides when
          all four steps are complete or the user dismisses it. */}
      {role === 'selling' && <OnboardingChecklist />}

      {/* Top-level role switcher */}
      <div
        data-tour="role-switcher"
        className="mt-6 inline-flex rounded-lg border border-[var(--border-hi)] bg-[var(--bg-panel)] p-1"
      >
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
      <div
        className="mt-4 -mx-4 overflow-x-auto border-b border-[var(--border-subtle)] px-4 sm:mx-0 sm:px-0"
        data-tour="dashboard-tabs"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div
          role="tablist"
          aria-label={`${role === 'selling' ? 'Selling' : 'Buying'} tabs`}
          onKeyDown={handleTabsKeyDown}
          className="flex gap-4 sm:gap-6"
        >
          {visibleTabs.map((tab) => {
            const selected = activeTab === tab;
            const showCount = !COUNTLESS_TABS.has(tab);
            const count = showCount ? tabCountFor(tab, tabCounts) : null;
            // Coloured "N to pay" pill on the buyer's In Progress tab —
            // immediate visual cue when payment is due. Only renders when
            // unpaidCard.count > 0 so it stays out of the way otherwise.
            const showUnpaidPill =
              tab === 'in_purchases' &&
              tabCounts !== null &&
              tabCounts.unpaidCard.count > 0;
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
                className={`shrink-0 whitespace-nowrap pb-3 text-sm font-medium transition-colors ${
                  selected
                    ? 'border-b-2 border-[var(--neon-cyan)] text-[var(--neon-cyan)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {TAB_LABELS[tab]}
                {showCount && count !== null && (
                  <span className="ml-1.5 text-[11px] text-[var(--text-dim)]">
                    ({count})
                  </span>
                )}
                {showUnpaidPill && (
                  <span
                    className="ml-1.5 inline-flex items-center rounded-full border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--neon-amber)]"
                    aria-label={`${tabCounts!.unpaidCard.count} orders awaiting payment`}
                  >
                    {tabCounts!.unpaidCard.count} to pay
                  </span>
                )}
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
        {activeTab === 'active' && <MyListingsTab statusFilter="ACTIVE,HIDDEN" />}
        {activeTab === 'saved' && <SavedListingsTab />}
        {activeTab === 'in_purchases' && (
          <OrdersTab role="buyer" bucket="in_progress" refreshKey={ordersRefreshKey} />
        )}
        {activeTab === 'disputed_purchases' && (
          <OrdersTab role="buyer" bucket="disputed" refreshKey={ordersRefreshKey} />
        )}
        {activeTab === 'past_purchases' && (
          <OrdersTab role="buyer" bucket="past" refreshKey={ordersRefreshKey} />
        )}
        {activeTab === 'in_sales' && (
          <>
            <SellerEarningsCard />
            <OrdersTab role="seller" bucket="in_progress" />
          </>
        )}
        {activeTab === 'disputed_sales' && (
          <OrdersTab role="seller" bucket="disputed" />
        )}
        {activeTab === 'past_sales' && (
          <>
            <SellerEarningsCard />
            <OrdersTab role="seller" bucket="past" />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action banners — surface unpaid-CARD purchases + in-progress sales.
//
// Stack 0–2 banners so users who play both roles (most active sellers also
// buy) see what's waiting on them in either capacity without clicking into
// each tab.
// ---------------------------------------------------------------------------
function DashboardActionBanners({
  counts,
  onNavigate,
}: {
  counts: TabCounts | null;
  onNavigate: (tab: Tab) => void;
}) {
  if (!counts) return null;
  const unpaid = counts.unpaidCard;
  const inSales = counts.selling.in_progress;
  const showBuyer = unpaid.count > 0;
  const showSeller = inSales > 0;
  if (!showBuyer && !showSeller) return null;
  const unpaidTotal = (unpaid.totalCents / 100).toFixed(2);
  return (
    <div className="mt-4 space-y-2">
      {showBuyer && (
        <button
          type="button"
          onClick={() => onNavigate('in_purchases')}
          className="w-full rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] p-3 text-left text-sm text-[var(--neon-amber)] hover:brightness-110 transition-colors"
        >
          <span className="font-semibold">
            {unpaid.count} {unpaid.count === 1 ? 'order' : 'orders'} awaiting your
            payment
          </span>{' '}
          <span className="text-[var(--text-muted)]">
            · ${unpaidTotal} total · click to review
          </span>
        </button>
      )}
      {showSeller && (
        <button
          type="button"
          onClick={() => onNavigate('in_sales')}
          className="w-full rounded-lg border border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] p-3 text-left text-sm text-[var(--neon-cyan)] hover:brightness-110 transition-colors"
        >
          <span className="font-semibold">
            {inSales} {inSales === 1 ? 'sale' : 'sales'} in progress
          </span>{' '}
          <span className="text-[var(--text-muted)]">
            · click to review
          </span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Listings tab
// ---------------------------------------------------------------------------

// `statusFilter` accepts a single status (`"ACTIVE"`) or a comma-separated
// list (`"ACTIVE,HIDDEN"`) — passed through to the server, which understands
// both forms.
function MyListingsTab({ statusFilter }: { statusFilter?: string }) {
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
  // Tracks the id of a listing currently mid-toggle (Hide / Unhide). Used
  // to disable the button so a double-click can't fire a second request
  // before the first resolves.
  const [togglingVisibilityId, setTogglingVisibilityId] = useState<string | null>(null);

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

  async function toggleVisibility(listingId: string, currentStatus: ListingStatus) {
    const action = currentStatus === 'HIDDEN' ? 'unhide' : 'hide';
    setTogglingVisibilityId(listingId);
    setError('');
    try {
      await api(`/api/listings/${listingId}/${action}`, { method: 'POST' });
      fetchListings(page);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${action} listing`,
      );
    } finally {
      setTogglingVisibilityId(null);
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
                  {(listing.status === 'ACTIVE' || listing.status === 'HIDDEN') && (
                    <>
                      <button
                        onClick={() => router.push(`/listings/${listing.id}/edit`)}
                        className="btn-cyber-outline text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleVisibility(listing.id, listing.status)}
                        disabled={togglingVisibilityId === listing.id}
                        className="btn-cyber-outline text-xs disabled:opacity-50"
                      >
                        {togglingVisibilityId === listing.id
                          ? '…'
                          : listing.status === 'HIDDEN'
                            ? 'Unhide'
                            : 'Hide'}
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
// Seller earnings rollup — sits above the sales orders list. Shows gross /
// net / platform-fee totals plus a per-method breakdown so the seller can
// see what came from Stripe vs Square vs cash. Fee figure is approximate
// (uses current PLATFORM_FEE_BPS, not the historical rate per order).
// ---------------------------------------------------------------------------
type SellerEarnings = {
  gross: string;
  fee: string;
  net: string;
  byMethod: Array<{
    method: 'STRIPE' | 'SQUARE' | 'CASH' | 'BANK_TRANSFER' | 'PAYPAL' | 'UNKNOWN';
    count: number;
    gross: string;
    fee: string;
  }>;
  feeBasisPoints: number;
};

function SellerEarningsCard() {
  const [data, setData] = useState<SellerEarnings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<SellerEarnings>('/api/seller/payments/earnings')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        // Silent: a failed earnings fetch shouldn't block the orders list.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mb-6 h-32 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]" />
    );
  }
  if (!data || Number(data.gross) === 0) return null;

  // Fee-free marketplace by default. When the operator opts in to a
  // non-zero PLATFORM_FEE_BPS, the gross/fee/net breakdown re-appears.
  const hasFee = data.feeBasisPoints > 0;
  const feePct = (data.feeBasisPoints / 100).toFixed(data.feeBasisPoints % 100 === 0 ? 0 : 2);

  return (
    <section className="mb-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Earnings
        </h3>
        <span className="text-xs text-[var(--text-dim)]">Lifetime · paid orders</span>
      </div>
      {hasFee ? (
        <dl className="mt-3 grid grid-cols-3 gap-4">
          <Stat label="Gross" value={`A$${data.gross}`} />
          <Stat label={`Platform fee (${feePct}%)`} value={`−A$${data.fee}`} muted />
          <Stat label="Net to you" value={`A$${data.net}`} highlight />
        </dl>
      ) : (
        <dl className="mt-3">
          <Stat label="Total received" value={`A$${data.gross}`} highlight />
        </dl>
      )}
      {data.byMethod.length > 1 && (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            By payment method
          </p>
          <ul className="space-y-1 text-xs text-[var(--text-muted)]">
            {data.byMethod.map((m) => (
              <li key={m.method} className="flex items-center justify-between">
                <span>
                  {METHOD_LABEL[m.method]} · {m.count} order{m.count === 1 ? '' : 's'}
                </span>
                <span className="font-mono text-[var(--text-primary)]">
                  A${m.gross}
                  {hasFee && Number(m.fee) > 0 && (
                    <span className="ml-1 text-[var(--text-dim)]">(fee A${m.fee})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasFee ? (
        <p className="mt-3 text-[11px] text-[var(--text-dim)]">
          Platform fee is approximate — it&apos;s computed at the current {feePct}% rate, not
          the historical rate at each charge. Cash and bank transfer are fee-free.
        </p>
      ) : (
        <p className="mt-3 text-[11px] text-[var(--text-dim)]">
          ElectroMarket is fee-free — you receive 100% of every sale, settled
          direct to your Stripe / Square / cash arrangement.
        </p>
      )}
    </section>
  );
}

const METHOD_LABEL: Record<SellerEarnings['byMethod'][number]['method'], string> = {
  STRIPE: 'Stripe',
  SQUARE: 'Square',
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  PAYPAL: 'PayPal (legacy)',
  UNKNOWN: 'Unknown',
};

function Stat({
  label,
  value,
  muted,
  highlight,
}: {
  label: string;
  value: string;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd
        className={`mt-1 text-lg font-semibold ${
          highlight
            ? 'text-[var(--neon-cyan)]'
            : muted
              ? 'text-[var(--text-muted)]'
              : 'text-[var(--text-primary)]'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared orders tab (purchases + sales) with in-progress / past bucket split
// ---------------------------------------------------------------------------

type OrderBucket = 'in_progress' | 'past' | 'disputed';

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
      if (bucket === 'in_progress') {
        return {
          title: 'No purchases in progress',
          body: 'Items you buy will appear here while they are being confirmed, paid, shipped, and delivered.',
          cta: { href: '/browse', label: 'Browse Listings' },
        };
      }
      if (bucket === 'disputed') {
        return {
          title: 'No active disputes',
          body: 'Disputes you file will live here until they are fully resolved.',
          cta: { href: '/browse', label: 'Browse Listings' },
        };
      }
      return {
        title: 'No past purchases',
        body: 'Completed and cancelled purchases will appear here.',
        cta: { href: '/browse', label: 'Browse Listings' },
      };
    }
    if (bucket === 'in_progress') {
      return {
        title: 'No sales in progress',
        body: 'When buyers request your listings, they’ll appear here to confirm, ship, and complete.',
        cta: { href: '/listings/new', label: 'Post a Listing' },
      };
    }
    if (bucket === 'disputed') {
      return {
        title: 'No active disputes',
        body: 'Orders a buyer is disputing will live here until the dispute is fully resolved.',
        cta: { href: '/listings/new', label: 'Post a Listing' },
      };
    }
    return {
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

      {/* Awaiting payment — buyer + in_progress only. Lives above the flat
          chronological list so the most actionable rows are surfaced first.
          Fetched separately from the paginated list so unpaid orders not on
          page 1 still show up here. */}
      {role === 'buyer' && bucket === 'in_progress' && !loading && (
        <AwaitingPaymentSection
          refreshKey={refreshKey}
          onChange={refresh}
        />
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


// ---------------------------------------------------------------------------
// Awaiting-payment section — surfaces the buyer's unpaid CARD orders at the
// top of In Progress, grouped by seller. One batch Pay button per seller calls
// /pay/batch with contextOrderIds set to ALL unpaid orderIds, so paying one
// seller's batch doesn't strand the rest of the buyer's groups.
// ---------------------------------------------------------------------------
function AwaitingPaymentSection({
  refreshKey,
  onChange,
}: {
  refreshKey: number;
  onChange: () => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchUnpaid = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        bucket: 'in_progress',
        status: 'CONFIRMED',
        paymentFlow: 'CARD',
        limit: '50',
      });
      const data = await api<OrderListResponse>(
        `/api/orders/purchases?${params.toString()}`,
      );
      setOrders(data.orders);
    } catch {
      // Silent — section only enhances the existing list. Failure leaves
      // the chronological list as the recovery path.
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnpaid();
  }, [fetchUnpaid, refreshKey]);

  if (loading || orders.length === 0) return null;

  // Group by seller. Same-seller orders share a single Pay button.
  const groups = new Map<
    string,
    { sellerId: string; sellerUsername: string; orders: Order[] }
  >();
  for (const order of orders) {
    const g = groups.get(order.seller.id);
    if (g) g.orders.push(order);
    else
      groups.set(order.seller.id, {
        sellerId: order.seller.id,
        sellerUsername: order.seller.username,
        orders: [order],
      });
  }
  const groupList = Array.from(groups.values());
  const allOrderIds = orders.map((o) => o.id);

  async function handlePay(
    group: { sellerId: string; orders: Order[] },
    paymentMethod: 'STRIPE' | 'SQUARE',
  ) {
    setPaying(group.sellerId);
    setError('');
    try {
      const orderIds = group.orders.map((o) => o.id);
      const res = await api<{ provider: string; url: string }>(
        '/api/orders/pay/batch',
        {
          method: 'POST',
          body: JSON.stringify({
            orderIds,
            paymentMethod,
            // Pass every unpaid CARD orderId so a partial-batch redirect
            // back to the success page preserves the rest.
            contextOrderIds: allOrderIds,
          }),
        },
      );
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment');
      setPaying(null);
    }
  }

  return (
    <section
      className="mb-6 rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)]/30 p-4"
      aria-label="Orders awaiting payment"
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Awaiting your payment
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          {orders.length} {orders.length === 1 ? 'order' : 'orders'} across{' '}
          {groupList.length}{' '}
          {groupList.length === 1 ? 'seller' : 'sellers'} — pay each seller in
          one redirect.
        </p>
      </div>
      <div className="space-y-3">
        {groupList.map((g) => {
          const stripeAvailable = g.orders[0]?.seller.paymentAccounts.some(
            (a) => a.provider === 'STRIPE',
          );
          const squareAvailable = g.orders[0]?.seller.paymentAccounts.some(
            (a) => a.provider === 'SQUARE',
          );
          const groupTotal = g.orders.reduce(
            (s, o) => s + parseFloat(o.amount),
            0,
          );
          return (
            <div
              key={g.sellerId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {g.sellerUsername}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {g.orders.length}{' '}
                  {g.orders.length === 1 ? 'order' : 'orders'} ·{' '}
                  {formatPrice(groupTotal)}
                </p>
                <p className="mt-1 text-[11px] text-[var(--text-dim)] truncate">
                  {g.orders.map((o) => o.listing.title).join(' · ')}
                </p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-2">
                {stripeAvailable && (
                  <button
                    onClick={() => handlePay(g, 'STRIPE')}
                    disabled={paying !== null}
                    className="btn-cyber-primary text-xs"
                  >
                    {paying === g.sellerId
                      ? 'Redirecting…'
                      : 'Pay with Stripe'}
                  </button>
                )}
                {squareAvailable && (
                  <button
                    onClick={() => handlePay(g, 'SQUARE')}
                    disabled={paying !== null}
                    className="btn-cyber-outline text-xs"
                  >
                    {paying === g.sellerId
                      ? 'Redirecting…'
                      : 'Pay with Square'}
                  </button>
                )}
                {!stripeAvailable && !squareAvailable && (
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Seller hasn&apos;t connected a card provider — coordinate via
                    messages.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-xs text-[var(--neon-danger)]">{error}</p>
      )}
      {/* Suppress unused-warning for onChange — reserved for future
          decline/cancel from this section. */}
      <span className="hidden" aria-hidden onClick={onChange} />
    </section>
  );
}
