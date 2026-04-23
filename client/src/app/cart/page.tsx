'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { formatPrice, getConditionStyle } from '@/types/listings';
import type { CartItem, Order } from '@/types/orders';

export default function CartPage() {
  return (
    <ProtectedRoute>
      <Cart />
    </ProtectedRoute>
  );
}

function Cart() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { cart, loaded, loading, error, fetchCart, remove } = useCartStore();
  const [checkoutError, setCheckoutError] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);

  // Always re-fetch on mount for fresh listing statuses (dedup'd in store).
  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  const hasUnavailable = cart.items.some((i) => i.listing.status !== 'ACTIVE');
  const emailUnverified = !!user && !user.emailVerified;
  const canCheckout =
    cart.checkoutableCount > 0 && !hasUnavailable && !emailUnverified;

  async function handleCheckout() {
    setCheckoutError('');
    setCheckingOut(true);
    try {
      const res = await api<{ orders: Order[] }>('/api/orders/checkout', {
        method: 'POST',
      });
      await fetchCart();
      const ids = res.orders.map((o) => o.id).join(',');
      router.push(`/checkout/success?ids=${ids}`);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed');
      await fetchCart();
    } finally {
      setCheckingOut(false);
    }
  }

  if (loading && !loaded) {
    return (
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="h-8 w-40 rounded bg-[var(--bg-panel-hi)] animate-pulse mb-6" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="panel clip-corner flex gap-4 p-4 animate-pulse">
                  <div className="h-20 w-20 flex-shrink-0 rounded-lg bg-[var(--bg-panel-hi)]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-2/3 rounded bg-[var(--bg-panel-hi)]" />
                    <div className="h-4 w-1/4 rounded bg-[var(--bg-panel-hi)]" />
                  </div>
                </div>
              ))}
            </div>
            <div className="panel clip-corner p-6 h-48 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Your Cart</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'}
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
            {error}
          </div>
        )}

        {cart.items.length === 0 ? (
          <EmptyCart />
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Items */}
            <div className="lg:col-span-2 space-y-3">
              {cart.items.map((item) => (
                <CartRow key={item.id} item={item} onRemove={remove} />
              ))}
            </div>

            {/* Summary */}
            <aside className="panel clip-corner p-6 h-fit lg:sticky lg:top-4">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Order Summary</h2>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Items in cart</dt>
                  <dd className="text-[var(--text-primary)]">{cart.itemCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Ready to checkout</dt>
                  <dd className="text-[var(--text-primary)]">{cart.checkoutableCount}</dd>
                </div>
                <div className="border-t border-[var(--border-subtle)] pt-3 flex justify-between text-base font-semibold">
                  <dt className="text-[var(--text-primary)]">Subtotal</dt>
                  <dd className="text-[var(--text-primary)]">{formatPrice(cart.subtotal)}</dd>
                </div>
              </dl>

              {hasUnavailable && (
                <div className="mt-4 rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] p-3 text-xs text-[var(--neon-amber)]">
                  Some items are no longer available. Remove them before checking out.
                </div>
              )}

              {emailUnverified && (
                <div className="mt-4 rounded-lg border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] p-3 text-xs text-[var(--neon-amber)]">
                  Please verify your email before checking out.{' '}
                  <Link
                    href="/verify-email"
                    className="font-medium underline hover:brightness-110"
                  >
                    Verify now
                  </Link>
                </div>
              )}

              {checkoutError && (
                <div className="mt-4 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-xs text-[var(--neon-danger)]">
                  {checkoutError}
                </div>
              )}

              <button
                onClick={handleCheckout}
                disabled={!canCheckout || checkingOut}
                className="btn-cyber-primary mt-5 w-full"
              >
                {checkingOut ? 'Sending requests...' : 'Checkout'}
              </button>
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                Checkout sends a purchase request to each seller. Payment is arranged after the seller confirms.
              </p>

              <Link
                href="/browse"
                className="mt-4 block text-center text-sm font-medium text-[var(--neon-cyan)] hover:text-[var(--accent-soft)]"
              >
                Continue browsing
              </Link>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyCart() {
  return (
    <div className="panel clip-corner mt-8 px-6 py-16 text-center">
      <svg
        className="mx-auto h-14 w-14 text-[var(--text-dim)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.5 3h13M9 20a1 1 0 102 0 1 1 0 00-2 0zm8 0a1 1 0 102 0 1 1 0 00-2 0z"
        />
      </svg>
      <h3 className="mt-3 text-sm font-medium text-[var(--text-primary)]">Your cart is empty</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Browse listings and add items you want to buy.
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

function CartRow({
  item,
  onRemove,
}: {
  item: CartItem;
  onRemove: (listingId: string) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const { listing } = item;
  const condition = getConditionStyle(listing.condition);
  const imageUrl = listing.images[0]?.url;
  const unavailable = listing.status !== 'ACTIVE';

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove(listing.id);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div
      className={`panel clip-corner flex gap-4 p-4 transition-colors ${
        unavailable ? 'border-[var(--neon-amber)]/40' : ''
      }`}
    >
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

      <div className="flex-1 min-w-0">
        <Link
          href={`/listings/${listing.id}`}
          className="block text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--neon-cyan)] transition-colors"
        >
          {listing.title}
        </Link>
        <p className="mt-0.5 text-base font-bold text-[var(--text-primary)]">
          {formatPrice(listing.price)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-md px-2 py-0.5 font-medium ${condition.bg}`}>
            {condition.label}
          </span>
          <span className="text-[var(--text-dim)]">Sold by {listing.seller.username}</span>
        </div>
        {unavailable && (
          <p className="mt-2 rounded-md bg-[var(--tint-amber)] px-2 py-1 text-xs text-[var(--neon-amber)]">
            {listing.status === 'SOLD'
              ? 'This item has already been sold.'
              : listing.status === 'ON_HOLD'
              ? 'This item is on hold for another buyer.'
              : 'This item is no longer available.'}
          </p>
        )}
      </div>

      <div className="flex-shrink-0">
        <button
          onClick={handleRemove}
          disabled={removing}
          className="btn-cyber-outline text-xs"
        >
          {removing ? 'Removing...' : 'Remove'}
        </button>
      </div>
    </div>
  );
}
