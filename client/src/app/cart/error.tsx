'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function CartError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Cart error:', error);
  }, [error]);

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">
          Couldn&rsquo;t load your cart
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Your cart items are saved — we just couldn&rsquo;t show them right now.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="btn-cyber-primary"
          >
            Try again
          </button>
          <Link
            href="/browse"
            className="btn-cyber-outline"
          >
            Keep browsing
          </Link>
        </div>
      </div>
    </main>
  );
}
