'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import type { ListingStatus } from '@/types/listings';

type Variant = 'icon' | 'full';

type Props = {
  listingId: string;
  sellerId: string;
  status?: ListingStatus;
  variant?: Variant;
  onError?: (error: string) => void;
};

export default function AddToCartButton({
  listingId,
  sellerId,
  status = 'ACTIVE',
  variant = 'full',
  onError,
}: Props) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const inCart = useCartStore((s) => s.isInCart(listingId));
  const add = useCartStore((s) => s.add);
  const [busy, setBusy] = useState(false);

  if (user && user.id === sellerId) return null;

  const available = status === 'ACTIVE';

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      router.push('/login');
      return;
    }
    if (inCart) {
      router.push('/cart');
      return;
    }
    if (!available || busy) return;

    setBusy(true);
    const result = await add(listingId);
    setBusy(false);
    if (!result.ok) onError?.(result.error);
  }

  if (variant === 'icon') {
    const baseClass = 'rounded-md backdrop-blur-sm p-1.5 transition-all';
    const stateClass = !available
      ? 'border border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-dim)] cursor-not-allowed'
      : inCart
      ? 'border border-[var(--neon-green)]/50 bg-[var(--tint-green)] text-[var(--neon-green)]'
      : 'border border-[var(--border-hi)] bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-[var(--neon-cyan)] hover:border-[var(--neon-cyan)]/60';

    return (
      <button
        onClick={handleClick}
        disabled={!available || busy}
        aria-label={
          !available
            ? 'Unavailable'
            : inCart
            ? 'View in cart'
            : 'Add to cart'
        }
        className={`${baseClass} ${stateClass}`}
      >
        {inCart ? (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.5 3h13M9 20a1 1 0 102 0 1 1 0 00-2 0zm8 0a1 1 0 102 0 1 1 0 00-2 0z"
            />
          </svg>
        )}
      </button>
    );
  }

  // Full variant
  const baseClass =
    'flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2';
  const stateClass = !available
    ? 'bg-[var(--bg-panel-hi)] text-[var(--text-dim)] cursor-not-allowed'
    : inCart
    ? 'bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40'
    : 'bg-[var(--neon-cyan)] text-[var(--btn-primary-text)] border border-[var(--neon-cyan)] hover:brightness-110 disabled:opacity-60';

  return (
    <button
      onClick={handleClick}
      disabled={!available || busy}
      className={`${baseClass} ${stateClass}`}
    >
      {!available ? (
        'Unavailable'
      ) : inCart ? (
        <>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          In Cart
        </>
      ) : busy ? (
        'Adding...'
      ) : (
        'Add to Cart'
      )}
    </button>
  );
}
