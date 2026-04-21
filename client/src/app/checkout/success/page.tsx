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
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="h-20 w-20 mx-auto rounded-full bg-zinc-200 animate-pulse" />
        <div className="mt-6 h-8 w-2/3 mx-auto rounded bg-zinc-200 animate-pulse" />
        <div className="mt-3 h-4 w-1/2 mx-auto rounded bg-zinc-200 animate-pulse" />
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
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Hero */}
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg
              className="h-8 w-8 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-zinc-900">
            Your request has been sent
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
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
                className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4 animate-pulse"
              >
                <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-zinc-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-zinc-200" />
                  <div className="h-4 w-1/3 rounded bg-zinc-200" />
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
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            View My Purchases
          </Link>
          <Link
            href="/browse"
            className="rounded-lg border border-zinc-300 px-5 py-2.5 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Continue Browsing
          </Link>
        </div>

        {/* Next steps */}
        <div className="mt-10 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          <h3 className="text-sm font-semibold text-zinc-900 mb-2">What happens next?</h3>
          <ol className="space-y-2 list-decimal list-inside">
            <li>The seller reviews your request and confirms the sale.</li>
            <li>
              Once confirmed, you can pay online (PayPal, Stripe or Square for business
              sellers) or arrange cash / bank transfer directly with the seller.
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
  return (
    <div className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4">
      <Link
        href={`/listings/${order.listing.id}`}
        className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-100"
      >
        {imageUrl ? (
          <img src={imageUrl} alt={order.listing.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-300">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 truncate">
          {order.listing.title}
        </p>
        <p className="mt-0.5 text-sm text-zinc-500">
          Sold by {order.seller.username}
        </p>
        <p className="mt-1 inline-flex items-center rounded-md bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
          Awaiting seller confirmation
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-sm font-bold text-zinc-900">
          {formatPrice(order.amount)}
        </p>
      </div>
    </div>
  );
}
