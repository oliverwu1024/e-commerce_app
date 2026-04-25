'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import {
  type FulfillmentMethod,
  formatPrice,
  getConditionStyle,
} from '@/types/listings';
import type {
  CartItem,
  Order,
  OrderFulfillmentMethod,
  ShippingAddress,
} from '@/types/orders';

export default function CartPage() {
  return (
    <ProtectedRoute>
      <Cart />
    </ProtectedRoute>
  );
}

// Pick a sensible default fulfillment based on what the listing offers.
// PICKUP_ONLY / POST_ONLY are forced; BOTH defaults to PICKUP (no shipping
// charge unless the buyer opts in).
function defaultChoice(method: FulfillmentMethod): OrderFulfillmentMethod {
  if (method === 'POST_ONLY') return 'POST';
  return 'PICKUP';
}

const EMPTY_ADDRESS: ShippingAddress = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postcode: '',
  country: 'Australia',
};

function Cart() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { cart, loaded, loading, error, fetchCart, remove } = useCartStore();
  const [checkoutError, setCheckoutError] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);

  // Buyer's per-item fulfillment choice, keyed by listing id. Seeded from
  // each listing's offering so PICKUP_ONLY / POST_ONLY items don't need a
  // selector at all.
  const [choices, setChoices] = useState<Record<string, OrderFulfillmentMethod>>({});
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [addressErrors, setAddressErrors] = useState<Partial<Record<keyof ShippingAddress, string>>>({});

  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  // Re-seed choices whenever the cart contents change (item added/removed/
  // listing status updated). Preserves an existing choice for a listing
  // already in the map; backfills new entries with the default.
  useEffect(() => {
    setChoices((prev) => {
      const next: Record<string, OrderFulfillmentMethod> = {};
      for (const item of cart.items) {
        if (item.listing.status !== 'ACTIVE') continue;
        next[item.listing.id] =
          prev[item.listing.id] ?? defaultChoice(item.listing.fulfillmentMethod);
      }
      return next;
    });
  }, [cart.items]);

  const checkoutable = cart.items.filter((i) => i.listing.status === 'ACTIVE');
  const hasUnavailable = cart.items.some((i) => i.listing.status !== 'ACTIVE');
  const emailUnverified = !!user && !user.emailVerified;

  // Per-row chosen + computed shipping; itemTotal is what the buyer pays.
  const breakdown = useMemo(() => {
    const rows = checkoutable.map((item) => {
      const chosen = choices[item.listing.id] ?? defaultChoice(item.listing.fulfillmentMethod);
      const itemPrice = parseFloat(item.listing.price);
      const ship =
        chosen === 'POST' && item.listing.shippingPrice != null
          ? parseFloat(item.listing.shippingPrice)
          : 0;
      return { item, chosen, itemPrice, ship, total: itemPrice + ship };
    });
    const itemSubtotal = rows.reduce((s, r) => s + r.itemPrice, 0);
    const shippingSubtotal = rows.reduce((s, r) => s + r.ship, 0);
    const grandTotal = itemSubtotal + shippingSubtotal;
    const anyPost = rows.some((r) => r.chosen === 'POST');
    return { rows, itemSubtotal, shippingSubtotal, grandTotal, anyPost };
  }, [checkoutable, choices]);

  function validateAddress(): boolean {
    const errs: Partial<Record<keyof ShippingAddress, string>> = {};
    if (!address.name.trim()) errs.name = 'Recipient name is required';
    if (!address.line1.trim()) errs.line1 = 'Address is required';
    if (!address.city.trim()) errs.city = 'City / suburb is required';
    if (!address.region.trim()) errs.region = 'State / region is required';
    if (!address.postcode.trim()) errs.postcode = 'Postcode is required';
    if (!address.country.trim()) errs.country = 'Country is required';
    setAddressErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const canCheckout =
    checkoutable.length > 0 && !hasUnavailable && !emailUnverified;

  async function handleCheckout() {
    setCheckoutError('');
    if (breakdown.anyPost && !validateAddress()) return;

    setCheckingOut(true);
    try {
      const items = checkoutable.map((item) => ({
        listingId: item.listing.id,
        fulfillmentMethod:
          choices[item.listing.id] ?? defaultChoice(item.listing.fulfillmentMethod),
      }));
      const payload: {
        items: typeof items;
        shippingAddress?: ShippingAddress;
      } = { items };
      if (breakdown.anyPost) {
        payload.shippingAddress = {
          name: address.name.trim(),
          line1: address.line1.trim(),
          line2: address.line2?.trim() || null,
          city: address.city.trim(),
          region: address.region.trim(),
          postcode: address.postcode.trim(),
          country: address.country.trim(),
        };
      }
      const res = await api<{ orders: Order[] }>('/api/orders/checkout', {
        method: 'POST',
        body: JSON.stringify(payload),
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
                <CartRow
                  key={item.id}
                  item={item}
                  choice={choices[item.listing.id] ?? defaultChoice(item.listing.fulfillmentMethod)}
                  onChooseFulfillment={(value) =>
                    setChoices((prev) => ({ ...prev, [item.listing.id]: value }))
                  }
                  onRemove={remove}
                />
              ))}

              {breakdown.anyPost && (
                <ShippingAddressForm
                  value={address}
                  errors={addressErrors}
                  onChange={(field, value) => {
                    setAddress((prev) => ({ ...prev, [field]: value }));
                    if (addressErrors[field]) {
                      setAddressErrors((prev) => ({ ...prev, [field]: undefined }));
                    }
                  }}
                />
              )}
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
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Items</dt>
                  <dd className="text-[var(--text-primary)]">
                    {formatPrice(breakdown.itemSubtotal)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Shipping</dt>
                  <dd className="text-[var(--text-primary)]">
                    {breakdown.shippingSubtotal > 0
                      ? formatPrice(breakdown.shippingSubtotal)
                      : 'Pickup / Free'}
                  </dd>
                </div>
                <div className="border-t border-[var(--border-subtle)] pt-3 flex justify-between text-base font-semibold">
                  <dt className="text-[var(--text-primary)]">Total</dt>
                  <dd className="text-[var(--text-primary)]">
                    {formatPrice(breakdown.grandTotal)}
                  </dd>
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
  choice,
  onChooseFulfillment,
  onRemove,
}: {
  item: CartItem;
  choice: OrderFulfillmentMethod;
  onChooseFulfillment: (value: OrderFulfillmentMethod) => void;
  onRemove: (listingId: string) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const { listing } = item;
  const condition = getConditionStyle(listing.condition);
  const imageUrl = listing.images[0]?.url;
  const unavailable = listing.status !== 'ACTIVE';
  const allowsPickup = listing.fulfillmentMethod !== 'POST_ONLY';
  const allowsPost = listing.fulfillmentMethod !== 'PICKUP_ONLY';
  const shipPrice = listing.shippingPrice != null ? parseFloat(listing.shippingPrice) : null;

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

        {/* Fulfillment selector. BOTH listings get a radio; the others
            show a static badge so the buyer sees the only option. */}
        {!unavailable && (
          <div className="mt-3">
            {listing.fulfillmentMethod === 'BOTH' ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)]">Delivery:</span>
                <FulfillmentRadio
                  name={`fulfill-${listing.id}`}
                  value="PICKUP"
                  current={choice}
                  onChange={onChooseFulfillment}
                  label="Pickup"
                  hint="Free"
                />
                <FulfillmentRadio
                  name={`fulfill-${listing.id}`}
                  value="POST"
                  current={choice}
                  onChange={onChooseFulfillment}
                  label="Post"
                  hint={shipPrice === 0 ? 'Free' : `+ ${formatPrice(shipPrice ?? 0)}`}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>Delivery:</span>
                <span className="rounded-md border border-[var(--border-hi)] bg-[var(--bg-panel-hi)] px-2 py-0.5 text-[var(--text-primary)]">
                  {allowsPost && !allowsPickup
                    ? `Post (${shipPrice === 0 ? 'free' : formatPrice(shipPrice ?? 0)})`
                    : 'Pickup only'}
                </span>
              </div>
            )}
          </div>
        )}

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

function FulfillmentRadio({
  name,
  value,
  current,
  onChange,
  label,
  hint,
}: {
  name: string;
  value: OrderFulfillmentMethod;
  current: OrderFulfillmentMethod;
  onChange: (v: OrderFulfillmentMethod) => void;
  label: string;
  hint: string;
}) {
  const selected = current === value;
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 transition-colors ${
        selected
          ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-muted)] hover:border-[var(--border-hi)]'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onChange(value)}
        className="h-3 w-3"
      />
      <span className="font-medium">{label}</span>
      <span className="text-[var(--text-dim)]">·</span>
      <span>{hint}</span>
    </label>
  );
}

function ShippingAddressForm({
  value,
  errors,
  onChange,
}: {
  value: ShippingAddress;
  errors: Partial<Record<keyof ShippingAddress, string>>;
  onChange: (field: keyof ShippingAddress, value: string) => void;
}) {
  return (
    <div className="panel clip-corner p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Shipping address</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Where the seller(s) should post your item(s). Used for every item you chose to deliver.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="Recipient name"
          required
          value={value.name}
          error={errors.name}
          onChange={(v) => onChange('name', v)}
          autoComplete="name"
        />
        <Field
          label="Country"
          required
          value={value.country}
          error={errors.country}
          onChange={(v) => onChange('country', v)}
          autoComplete="country-name"
        />
        <div className="sm:col-span-2">
          <Field
            label="Address line 1"
            required
            value={value.line1}
            error={errors.line1}
            onChange={(v) => onChange('line1', v)}
            autoComplete="address-line1"
          />
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Address line 2 (optional)"
            value={value.line2 ?? ''}
            onChange={(v) => onChange('line2', v)}
            autoComplete="address-line2"
          />
        </div>
        <Field
          label="City / Suburb"
          required
          value={value.city}
          error={errors.city}
          onChange={(v) => onChange('city', v)}
          autoComplete="address-level2"
        />
        <Field
          label="State / Region"
          required
          value={value.region}
          error={errors.region}
          onChange={(v) => onChange('region', v)}
          autoComplete="address-level1"
        />
        <Field
          label="Postcode"
          required
          value={value.postcode}
          error={errors.postcode}
          onChange={(v) => onChange('postcode', v)}
          autoComplete="postal-code"
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  error,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-primary)]">
        {label}
        {required && <span className="text-[var(--neon-danger)]"> *</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
          error
            ? 'border-[var(--neon-danger)]/60 bg-[var(--bg-input)] text-[var(--text-primary)] focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
            : 'input-cyber'
        }`}
      />
      {error && <p className="mt-1 text-xs text-[var(--neon-danger)]">{error}</p>}
    </div>
  );
}
