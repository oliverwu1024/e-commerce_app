'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function LoginError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Login error:', error);
  }, [error]);

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">
          Couldn&rsquo;t load the sign-in page
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Something went wrong. Please try again.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={reset} className="btn-cyber-primary">
            Try again
          </button>
          <Link href="/" className="btn-cyber-outline">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
