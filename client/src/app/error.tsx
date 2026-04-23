'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Render error:', error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="panel clip-corner w-full max-w-md p-8 text-center">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Something went wrong</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          An unexpected error occurred. You can try again or head back home.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="btn-cyber-primary"
          >
            Try again
          </button>
          <Link
            href="/"
            className="btn-cyber-outline"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
