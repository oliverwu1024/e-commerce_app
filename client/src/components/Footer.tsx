import Link from 'next/link';

const SUPPORT_EMAIL = 'support@electromarket-app.com';

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-[var(--border-subtle)] bg-[var(--bg-nav)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-display text-[var(--text-primary)]">
            <span>Electro</span>
            <span className="text-[var(--neon-cyan)]">Market</span>
          </span>
          <span className="text-[var(--text-dim)]">© {year}</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Link href="/help" className="hover:text-[var(--neon-cyan)]">
            Help
          </Link>
          <Link href="/help/sell" className="hover:text-[var(--neon-cyan)]">
            How to sell
          </Link>
          <Link href="/terms" className="hover:text-[var(--neon-cyan)]">
            Terms
          </Link>
          <Link href="/contact" className="hover:text-[var(--neon-cyan)]">
            Contact us
          </Link>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="hover:text-[var(--neon-cyan)]"
          >
            {SUPPORT_EMAIL}
          </a>
        </nav>
      </div>
    </footer>
  );
}
