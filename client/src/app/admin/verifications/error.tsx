'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AdminVerificationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin verifications error:', error);
  }, [error]);

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">
          Couldn&rsquo;t load the verification queue
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Something went wrong. The record you were viewing may have changed
          state — refreshing the list usually resolves it.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={reset} className="btn-cyber-primary">
            Try again
          </button>
          <Link href="/admin" className="btn-cyber-outline">
            Admin dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
