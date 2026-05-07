'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  // Full set of orderIds in this success-page context, threaded through to
  // /pay/batch so the redirect URL preserves the rest of the buyer's groups
  // after a partial-batch payment.
  contextOrderIds: string[];
};

function groupOrdersBySeller(orders: Order[]): SellerGroup[] {
  const contextOrderIds = orders.map((o) => o.id);
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
        contextOrderIds,
      });
    }
  }
  return Array.from(map.values());
}

function CheckoutSuccess() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids') ?? '';
  const provider = searchParams.get('provider');
  const payment = searchParams.get('payment');
  const orderIds = useMemo(() => idsParam.split(',').filter(Boolean), [idsParam]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  // One-shot guard so the Square auto-confirm doesn't double-fire if the
  // page re-renders (StrictMode in dev double-invokes effects).
  const squareConfirmFired = useRef(false);

  const fetchOrders = useCallback(async () => {
    if (orderIds.length === 0) {
      setLoading(false);
      return [] as Order[];
    }
    const results = await Promise.all(
      orderIds.map((id) =>
        api<{ order: Order }>(`/api/orders/${id}`)
          .then((r) => r.order)
          .catch(() => null),
      ),
    );
    const filtered = results.filter((o): o is Order => o !== null);
    setOrders(filtered);
    return filtered;
  }, [orderIds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetchOrders();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchOrders]);

  // Auto-confirm the Square batch when the buyer is redirected back from
  // Square's hosted checkout. We can't rely on a webhook (per-seller Square
  // OAuth has no automatic platform webhook subscription), so the client
  // pulls. Idempotent — server will return `already_completed` if it ran
  // a tick earlier.
  useEffect(() => {
    if (squareConfirmFired.current) return;
    if (provider !== 'square' || payment !== 'success') return;
    if (loading || orders.length === 0) return;
    // Only confirm orders that are still CONFIRMED — any post-payment ones
    // already settled (likely from a previous tab refresh).
    const cardConfirmable = orders
      .filter((o) => o.paymentFlow === 'CARD' && o.status === 'CONFIRMED')
      .map((o) => o.id);
    if (cardConfirmable.length === 0) return;
    squareConfirmFired.current = true;
    void (async () => {
      try {
        await api(`/api/orders/pay/square/confirm/batch`, {
          method: 'POST',
          body: JSON.stringify({ orderIds: cardConfirmable }),
        });
        // Refresh — the server flipped these to PAID; the UI badges follow.
        await fetchOrders();
      } catch (err) {
        // 202 = "Square hasn't captured yet" — surface a hint and let the
        // user click pay again. Most other errors are also recoverable
        // by re-clicking the pay button on a failed batch.
        console.warn('Square batch confirm pending or failed:', err);
      }
    })();
  }, [provider, payment, loading, orders, fetchOrders]);

  const groups = useMemo(() => groupOrdersBySeller(orders), [orders]);
  const cardGroupCount = groups.filter((g) =>
    g.orders.some((o) => o.paymentFlow === 'CARD'),
  ).length;
  const offlineGroupCount = groups.filter((g) =>
    g.orders.some((o) => o.paymentFlow === 'OFFLINE'),
  ).length;
  const cancelledNotice = payment === 'cancelled';

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {cancelledNotice && (
          <div className="mb-6 rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] p-3 text-sm text-[var(--neon-amber)]">
            Payment was cancelled. You can try again at any time.
          </div>
        )}

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
                Click <span className="font-medium">Pay</span> on each seller to
                complete payment.
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
  // Card orders that still need payment — drive the per-group Pay button.
  // Any CARD order past CONFIRMED has either been paid or hit a refund/cancel
  // path, so we exclude it from the batch.
  const payable = group.orders.filter(
    (o) => o.paymentFlow === 'CARD' && o.status === 'CONFIRMED',
  );
  const groupTotal = group.orders.reduce(
    (sum, o) => sum + parseFloat(o.amount),
    0,
  );

  // Provider availability is shared across the group (same seller, same
  // connected accounts).
  const sellerAccounts =
    group.orders[0]?.seller.paymentAccounts ?? [];
  const stripeAvailable = sellerAccounts.some((a) => a.provider === 'STRIPE');
  const squareAvailable = sellerAccounts.some((a) => a.provider === 'SQUARE');

  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  async function handlePay(paymentMethod: PaymentMethod) {
    if (payable.length === 0) return;
    setPaying(true);
    setError('');
    try {
      const orderIds = payable.map((o) => o.id);
      const res = await api<{ provider: string; url: string }>(
        '/api/orders/pay/batch',
        {
          method: 'POST',
          body: JSON.stringify({
            orderIds,
            paymentMethod,
            // Pass through the full set so the redirect URL preserves any
            // other seller-groups still awaiting payment after this batch
            // completes.
            contextOrderIds: group.contextOrderIds,
          }),
        },
      );
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment');
      setPaying(false);
    }
  }

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
      {payable.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <p className="font-medium text-[var(--text-primary)]">
                {payable.length === 1
                  ? 'Pay this order'
                  : `Pay all ${payable.length} orders from this seller in one redirect`}
              </p>
              <p className="text-[var(--text-muted)]">
                Total: {formatPrice(payable.reduce((s, o) => s + parseFloat(o.amount), 0))}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
          </div>
          {error && (
            <p className="mt-2 text-xs text-[var(--neon-danger)]">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}

function SuccessOrderRow({ order }: { order: Order }) {
  const imageUrl = order.listing.images[0]?.url;
  const ship = parseFloat(order.shippingPrice);
  const isPost = order.fulfillmentMethod === 'POST';
  const isCard = order.paymentFlow === 'CARD';
  const awaitingPayment = isCard && order.status === 'CONFIRMED';
  const paid =
    order.status === 'PAID' ||
    order.status === 'SHIPPED' ||
    order.status === 'COMPLETED';

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
          {paid ? (
            <span className="inline-flex items-center rounded-md bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40 px-2 py-0.5 font-medium">
              Paid
            </span>
          ) : awaitingPayment ? (
            <span className="inline-flex items-center rounded-md bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40 px-2 py-0.5 font-medium">
              Awaiting payment
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
