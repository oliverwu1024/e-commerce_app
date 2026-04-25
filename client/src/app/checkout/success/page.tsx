'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api } from '@/lib/api';
import { formatPrice } from '@/types/listings';
import type { Order } from '@/types/orders';

export default function CheckoutSuccessPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={<Loading />}>
        <CheckoutSuccess />
      </Suspense>
    </ProtectedRoute>
  );
}

function Loading() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="h-20 w-20 mx-auto rounded-full bg-[var(--bg-panel-hi)] animate-pulse" />
        <div className="mt-6 h-8 w-2/3 mx-auto rounded bg-[var(--bg-panel-hi)] animate-pulse" />
        <div className="mt-3 h-4 w-1/2 mx-auto rounded bg-[var(--bg-panel-hi)] animate-pulse" />
      </div>
    </main>
  );
}

function CheckoutSuccess() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids') ?? '';
  const orderIds = idsParam.split(',').filter(Boolean);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchOrders() {
      if (orderIds.length === 0) {
        setLoading(false);
        return;
      }
      try {
        const results = await Promise.all(
          orderIds.map((id) =>
            api<{ order: Order }>(`/api/orders/${id}`).then((r) => r.order).catch(() => null),
          ),
        );
        if (!cancelled) {
          setOrders(results.filter((o): o is Order => o !== null));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchOrders();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsParam]);

  const sellers = new Set(orders.map((o) => o.seller.username));
  const sellerCount = sellers.size;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Hero */}
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--tint-green)]">
            <svg
              className="h-8 w-8 text-[var(--neon-green)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-[var(--text-primary)]">
            Your request has been sent
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {orders.length > 0 ? (
              <>
                We&apos;ve notified {sellerCount}{' '}
                {sellerCount === 1 ? 'seller' : 'sellers'} about your purchase.
                You&apos;ll be able to pay once they confirm.
              </>
            ) : orderIds.length > 0 && loading ? (
              'Loading your orders...'
            ) : (
              'Your checkout was processed.'
            )}
          </p>
        </div>

        {/* Orders list */}
        {loading ? (
          <div className="mt-8 space-y-3">
            {Array.from({ length: Math.max(1, orderIds.length) }).map((_, i) => (
              <div
                key={i}
                className="panel clip-corner flex gap-4 p-4 animate-pulse"
              >
                <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-[var(--bg-panel-hi)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-[var(--bg-panel-hi)]" />
                  <div className="h-4 w-1/3 rounded bg-[var(--bg-panel-hi)]" />
                </div>
              </div>
            ))}
          </div>
        ) : orders.length > 0 ? (
          <div className="mt-8 space-y-3">
            {orders.map((order) => (
              <OrderSummaryRow key={order.id} order={order} />
            ))}
          </div>
        ) : null}

        {/* Actions */}
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/dashboard?tab=purchases"
            className="btn-cyber-primary"
          >
            View My Purchases
          </Link>
          <Link
            href="/browse"
            className="btn-cyber-outline"
          >
            Continue Browsing
          </Link>
        </div>

        {/* Next steps */}
        <div className="panel clip-corner mt-10 p-6 text-sm text-[var(--text-muted)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">What happens next?</h3>
          <ol className="space-y-2 list-decimal list-inside">
            <li>The seller reviews your request and confirms the sale.</li>
            <li>
              Once confirmed, you can pay online (Stripe or Square, depending
              on what the seller has connected) or arrange cash / bank transfer
              directly with the seller.
            </li>
            <li>Message the seller through the order page if you need to coordinate.</li>
          </ol>
        </div>
      </div>
    </main>
  );
}

function OrderSummaryRow({ order }: { order: Order }) {
  const imageUrl = order.listing.images[0]?.url;
  const ship = parseFloat(order.shippingPrice);
  const isPost = order.fulfillmentMethod === 'POST';
  return (
    <div className="panel clip-corner flex gap-4 p-4">
      <Link
        href={`/listings/${order.listing.id}`}
        className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--bg-panel-hi)]"
      >
        {imageUrl ? (
          <img src={imageUrl} alt={order.listing.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
          {order.listing.title}
        </p>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">
          Sold by {order.seller.username}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center rounded-md bg-[var(--tint-amber)] text-[var(--neon-amber)] border border-[var(--neon-amber)]/40 px-2 py-0.5 font-medium">
            Awaiting seller confirmation
          </span>
          <span className="rounded-md border border-[var(--border-hi)] bg-[var(--bg-panel-hi)] px-2 py-0.5 text-[var(--text-muted)]">
            {isPost ? 'Post' : 'Pickup'}
            {isPost && ship > 0 && ` · + ${formatPrice(ship)}`}
          </span>
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-sm font-bold text-[var(--text-primary)]">
          {formatPrice(order.amount)}
        </p>
      </div>
    </div>
  );
}
