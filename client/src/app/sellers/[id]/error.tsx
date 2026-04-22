'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function SellerProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Seller profile error:', error);
  }, [error]);

  return (
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-zinc-900">
          Couldn&rsquo;t load seller profile
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Something went wrong while loading this seller.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Try again
          </button>
          <Link
            href="/browse"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Browse listings
          </Link>
        </div>
      </div>
    </main>
  );
}
