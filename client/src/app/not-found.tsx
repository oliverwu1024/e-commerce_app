import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="panel clip-corner w-full max-w-md p-8 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
          Error 404
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          The link may be broken, or the listing has been sold or removed.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="btn-cyber-primary">
            Go home
          </Link>
          <Link href="/browse" className="btn-cyber-outline">
            Browse listings
          </Link>
        </div>
      </div>
    </main>
  );
}
