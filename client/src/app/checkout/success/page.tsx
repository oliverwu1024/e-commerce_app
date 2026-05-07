'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api } from '@/lib/api';
import { formatPrice } from '@/types/listings';
import type { Order, PaymentMethod } from '@/types/orders';

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

type SellerGroup = {
  sellerId: string;
  sellerUsername: string;
  orders: Order[];
};

function groupOrdersBySeller(orders: Order[]): SellerGroup[] {
  const map = new Map<string, SellerGroup>();
  for (const order of orders) {
    const existing = map.get(order.seller.id);
    if (existing) {
      existing.orders.push(order);
    } else {
      map.set(order.seller.id, {
        sellerId: order.seller.id,
        sellerUsername: order.seller.username,
        orders: [order],
      });
    }
  }
  return Array.from(map.values());
}

function CheckoutSuccess() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids') ?? '';
  const orderIds = useMemo(() => idsParam.split(',').filter(Boolean), [idsParam]);

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
            api<{ order: Order }>(`/api/orders/${id}`)
              .then((r) => r.order)
              .catch(() => null),
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
  }, [orderIds]);

  const groups = useMemo(() => groupOrdersBySeller(orders), [orders]);
  const cardGroupCount = groups.filter((g) =>
    g.orders.some((o) => o.paymentFlow === 'CARD'),
  ).length;
  const offlineGroupCount = groups.filter((g) =>
    g.orders.some((o) => o.paymentFlow === 'OFFLINE'),
  ).length;

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
            {cardGroupCount > 0 && offlineGroupCount === 0
              ? 'Almost there — pay to finish'
              : cardGroupCount === 0 && offlineGroupCount > 0
                ? 'Your request has been sent'
                : 'Checkout received'}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {orders.length === 0 && loading && 'Loading your orders...'}
            {cardGroupCount > 0 && offlineGroupCount === 0 && (
              <>
                Click <span className="font-medium">Pay now</span> on each order
                below to complete payment.
              </>
            )}
            {cardGroupCount === 0 && offlineGroupCount > 0 && (
              <>
                We&apos;ve notified {offlineGroupCount}{' '}
                {offlineGroupCount === 1 ? 'seller' : 'sellers'} about your purchase.
                You&apos;ll arrange cash / bank transfer once they confirm.
              </>
            )}
            {cardGroupCount > 0 && offlineGroupCount > 0 && (
              <>
                {cardGroupCount} card payment{cardGroupCount === 1 ? '' : 's'} ready
                to complete; {offlineGroupCount}{' '}
                {offlineGroupCount === 1 ? 'seller' : 'sellers'} will confirm
                separately.
              </>
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
        ) : groups.length > 0 ? (
          <div className="mt-8 space-y-6">
            {groups.map((g) => (
              <SellerGroupSection key={g.sellerId} group={g} />
            ))}
          </div>
        ) : null}

        {/* Actions */}
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/dashboard?tab=purchases" className="btn-cyber-primary">
            View My Purchases
          </Link>
          <Link href="/browse" className="btn-cyber-outline">
            Continue Browsing
          </Link>
        </div>

        {/* Next steps */}
        <div className="panel clip-corner mt-10 p-6 text-sm text-[var(--text-muted)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            What happens next?
          </h3>
          <ol className="space-y-2 list-decimal list-inside">
            <li>
              <span className="font-medium text-[var(--text-primary)]">Card orders</span>:
              you&apos;ll be redirected to the seller&apos;s payment provider. After
              paying, the seller has 24h to decline (auto-refund) before they&apos;re
              committed to ship.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">Cash / bank orders</span>:
              the seller reviews your request and confirms the sale. You&apos;ll
              arrange payment with them through the order&apos;s message thread.
            </li>
            <li>You can always track and message sellers from your purchases.</li>
          </ol>
        </div>
      </div>
    </main>
  );
}

function SellerGroupSection({ group }: { group: SellerGroup }) {
  const groupTotal = group.orders.reduce(
    (sum, o) => sum + parseFloat(o.amount),
    0,
  );
  return (
    <section className="panel clip-corner overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-4 py-2.5">
        <div className="text-xs">
          <span className="text-[var(--text-muted)]">Sold by </span>
          <Link
            href={`/sellers/${group.sellerId}`}
            className="font-medium text-[var(--text-primary)] hover:text-[var(--neon-cyan)]"
          >
            {group.sellerUsername}
          </Link>
        </div>
        <div className="text-xs font-semibold text-[var(--text-primary)]">
          {formatPrice(groupTotal)}
        </div>
      </header>
      <div className="space-y-3 p-4">
        {group.orders.map((order) => (
          <SuccessOrderRow key={order.id} order={order} />
        ))}
      </div>
    </section>
  );
}

function SuccessOrderRow({ order }: { order: Order }) {
  const imageUrl = order.listing.images[0]?.url;
  const ship = parseFloat(order.shippingPrice);
  const isPost = order.fulfillmentMethod === 'POST';
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  const isCard = order.paymentFlow === 'CARD';
  const canPayNow = isCard && order.status === 'CONFIRMED';
  const stripeAvailable = order.seller.paymentAccounts.some(
    (a) => a.provider === 'STRIPE',
  );
  const squareAvailable = order.seller.paymentAccounts.some(
    (a) => a.provider === 'SQUARE',
  );

  async function handlePay(paymentMethod: PaymentMethod) {
    setPaying(true);
    setError('');
    try {
      const res = await api<{ provider: string; url: string }>(
        `/api/orders/${order.id}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({ paymentMethod }),
        },
      );
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment');
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link
        href={`/listings/${order.listing.id}`}
        className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--bg-panel-hi)]"
      >
        {imageUrl ? (
          <img src={imageUrl} alt={order.listing.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
            <svg
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
          {order.listing.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {canPayNow ? (
            <span className="inline-flex items-center rounded-md bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40 px-2 py-0.5 font-medium">
              Awaiting payment
            </span>
          ) : isCard && order.status !== 'CONFIRMED' ? (
            <span className="inline-flex items-center rounded-md bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40 px-2 py-0.5 font-medium">
              {order.status === 'PAID' || order.status === 'SHIPPED' || order.status === 'COMPLETED'
                ? 'Paid'
                : order.status}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-[var(--tint-amber)] text-[var(--neon-amber)] border border-[var(--neon-amber)]/40 px-2 py-0.5 font-medium">
              Awaiting seller confirmation
            </span>
          )}
          <span className="rounded-md border border-[var(--border-hi)] bg-[var(--bg-panel-hi)] px-2 py-0.5 text-[var(--text-muted)]">
            {isPost ? 'Post' : 'Pickup'}
            {isPost && ship > 0 && ` · + ${formatPrice(ship)}`}
          </span>
          <span className="font-bold text-[var(--text-primary)]">
            {formatPrice(order.amount)}
          </span>
        </div>
        {error && (
          <p className="mt-1.5 text-xs text-[var(--neon-danger)]">{error}</p>
        )}
      </div>

      {canPayNow && (
        <div className="flex flex-shrink-0 flex-wrap gap-2 sm:justify-end">
          {stripeAvailable && (
            <button
              onClick={() => handlePay('STRIPE')}
              disabled={paying}
              className="btn-cyber-primary text-xs"
            >
              {paying ? 'Redirecting…' : 'Pay with Stripe'}
            </button>
          )}
          {squareAvailable && (
            <button
              onClick={() => handlePay('SQUARE')}
              disabled={paying}
              className="btn-cyber-outline text-xs"
            >
              {paying ? 'Redirecting…' : 'Pay with Square'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
