'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';
import { formatPrice } from '@/types/listings';
import type {
  AdminStats,
  StuckOrder,
  StuckOrdersResponse,
} from '@/types/admin';

export default function AdminDashboardPage() {
  return (
    <ProtectedRoute>
      <AdminDashboard />
    </ProtectedRoute>
  );
}

function AdminDashboard() {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;
  if (user.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold text-zinc-900">Access denied</h1>
        <p className="mt-2 text-sm text-zinc-600">
          You need admin privileges to view this page.{' '}
          <Link href="/" className="text-blue-600 hover:underline">
            Go home
          </Link>
          .
        </p>
      </div>
    );
  }

  return <AdminDashboardInner />;
}

function AdminDashboardInner() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [stuckOrders, setStuckOrders] = useState<StuckOrder[]>([]);
  const [stuckTotal, setStuckTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsData, stuckData] = await Promise.all([
        api<AdminStats>('/api/admin/stats'),
        api<StuckOrdersResponse>('/api/admin/orders/stuck?limit=10'),
      ]);
      setStats(statsData);
      setStuckOrders(stuckData.orders);
      setStuckTotal(stuckData.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Platform overview and moderation tools.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchAll}
          disabled={loading}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !stats ? (
        <StatsSkeleton />
      ) : stats ? (
        <StatsSection stats={stats} />
      ) : null}

      <StuckOrdersSection
        orders={stuckOrders}
        total={stuckTotal}
        loading={loading}
      />

      <QuickLinks pendingVerifications={stats?.pendingVerifications ?? 0} />
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-24 rounded-xl border border-zinc-200 bg-zinc-100 animate-pulse"
        />
      ))}
    </div>
  );
}

function StatsSection({ stats }: { stats: AdminStats }) {
  const revenueDisplay = formatPrice(stats.revenue.totalAud);

  return (
    <div className="mt-6 space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">
          Overview
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Users"
            value={stats.users.total}
            sub={`${stats.users.emailVerified} verified`}
          />
          <StatCard
            label="Listings"
            value={stats.listings.total}
            sub={`${stats.listings.ACTIVE} active`}
          />
          <StatCard
            label="Orders"
            value={stats.orders.total}
            sub={`${stats.orders.COMPLETED} completed`}
            color="text-emerald-700"
          />
          <StatCard
            label="Revenue (AUD)"
            value={revenueDisplay}
            sub="Completed orders"
            color="text-blue-700"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">
          Orders
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Pending confirmation"
            value={stats.orders.PENDING_CONFIRMATION}
            color="text-amber-700"
          />
          <StatCard
            label="Confirmed"
            value={stats.orders.CONFIRMED}
            color="text-blue-700"
          />
          <StatCard
            label="Completed"
            value={stats.orders.COMPLETED}
            color="text-emerald-700"
          />
          <StatCard
            label="Cancelled"
            value={stats.orders.CANCELLED}
            color="text-zinc-500"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">
          Moderation
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard
            label="Pending ID verifications"
            value={stats.pendingVerifications}
            color={stats.pendingVerifications > 0 ? 'text-amber-700' : undefined}
          />
          <StatCard
            label="Stuck payments (>30m)"
            value={stats.stuckPayments}
            color={stats.stuckPayments > 0 ? 'text-red-700' : undefined}
          />
          <StatCard
            label="Listings removed"
            value={stats.listings.REMOVED}
            color="text-zinc-500"
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
}) {
  // Locale-format numeric values so counts in the thousands don't read as
  // "1234". String values (e.g. pre-formatted revenue like "$11,040.00") are
  // passed through verbatim.
  const display =
    typeof value === 'number' ? value.toLocaleString('en-AU') : value;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ?? 'text-zinc-900'}`}>
        {display}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function StuckOrdersSection({
  orders,
  total,
  loading,
}: {
  orders: StuckOrder[];
  total: number;
  loading: boolean;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">
          Stuck Payments
        </h2>
        <span className="text-xs text-zinc-500">
          {total} total with active session &gt; 30 min old
        </span>
      </div>

      {loading && orders.length === 0 ? (
        <div className="mt-2 h-24 rounded-xl border border-zinc-200 bg-zinc-100 animate-pulse" />
      ) : orders.length === 0 ? (
        <div className="mt-2 rounded-xl border border-zinc-200 bg-white px-6 py-8 text-center text-sm text-zinc-600">
          No stuck payments. Online payment sessions that have been in flight
          for more than 30 minutes appear here.
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Order
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Buyer
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Seller
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Pending since
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/listings/${o.listing.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {o.listing.title}
                    </Link>
                    <p className="text-xs text-zinc-400">{o.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-2">
                    <p className="text-zinc-900">{o.buyer.username}</p>
                    <p className="text-xs text-zinc-500">{o.buyer.email}</p>
                  </td>
                  <td className="px-4 py-2">
                    <p className="text-zinc-900">{o.seller.username}</p>
                    <p className="text-xs text-zinc-500">{o.seller.email}</p>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatPrice(o.amount)}
                  </td>
                  <td className="px-4 py-2 text-zinc-600">
                    {formatRelative(o.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function QuickLinks({ pendingVerifications }: { pendingVerifications: number }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-wider">
        Tools
      </h2>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/verifications"
          className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition"
        >
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              Pending ID verifications
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Review submitted IDs for personal sellers.
            </p>
          </div>
          <span
            className={`ml-3 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-2 text-xs font-bold ${
              pendingVerifications > 0
                ? 'bg-amber-100 text-amber-800'
                : 'bg-zinc-100 text-zinc-500'
            }`}
          >
            {pendingVerifications}
          </span>
        </Link>
      </div>
    </section>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}
