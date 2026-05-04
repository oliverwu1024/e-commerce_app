'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { useInboxStore } from '@/stores/inbox';
import Avatar from '@/components/Avatar';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);
  const cartCount = useCartStore((s) => s.cart.itemCount);
  const unreadNotif = useInboxStore((s) => s.counts.notifications);
  const unreadMsg = useInboxStore((s) => s.counts.messages);

  // Logo click: on any other page, let Next.js Link navigate to "/". On the
  // home page itself a Link is a no-op, so manually scroll to top and ask
  // the App Router to re-fetch the page's server data.
  function handleLogoClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (pathname === '/') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-nav)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-7">
          <Link
            href="/"
            onClick={handleLogoClick}
            className="font-display flex items-center gap-2 text-xl font-bold tracking-[0.02em] transition-opacity hover:opacity-90"
          >
            <Logo size={28} />
            <span className="flex items-baseline">
              <span className="text-[var(--text-primary)]">Electro</span>
              <span className="text-[var(--neon-cyan)]">Market</span>
            </span>
          </Link>
          <Link
            href="/browse"
            data-tour="nav-browse"
            className="text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Browse
          </Link>
          <Link
            href="/help"
            data-tour="nav-help"
            className="text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Help
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />

          {loading ? (
            <div
              className="h-8 w-40 animate-pulse rounded bg-[var(--bg-panel-hi)]"
              aria-hidden="true"
            />
          ) : user ? (
            <>
              <Link
                href="/account/notifications"
                aria-label={`Notifications${unreadNotif > 0 ? ` (${unreadNotif} unread)` : ''}`}
                className="relative rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel-hi)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadNotif > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--neon-danger)] px-1 text-[10px] font-bold text-white">
                    {unreadNotif > 99 ? '99+' : unreadNotif}
                  </span>
                )}
              </Link>

              <Link
                href="/account/messages"
                data-tour="nav-messages"
                aria-label={`Messages${unreadMsg > 0 ? ` (${unreadMsg} unread)` : ''}`}
                className="relative rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel-hi)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {unreadMsg > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--neon-danger)] px-1 text-[10px] font-bold text-white">
                    {unreadMsg > 99 ? '99+' : unreadMsg}
                  </span>
                )}
              </Link>

              <Link
                href="/cart"
                aria-label={`Cart${cartCount > 0 ? ` (${cartCount} item${cartCount === 1 ? '' : 's'})` : ''}`}
                className="relative rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel-hi)]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.5 3h13M9 20a1 1 0 102 0 1 1 0 00-2 0zm8 0a1 1 0 102 0 1 1 0 00-2 0z" />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--neon-cyan)] px-1 text-[10px] font-bold text-[var(--btn-primary-text)]">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </Link>

              <div className="mx-1 h-6 w-px bg-[var(--border-subtle)]" />

              <Link
                href="/dashboard"
                data-tour="nav-dashboard"
                className="text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/account/settings"
                className="text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Account
              </Link>

              {user.role === 'ADMIN' && (
                <Link
                  href="/admin"
                  className="text-sm font-bold text-[var(--neon-amber)] hover:brightness-110 transition-all"
                >
                  Admin
                </Link>
              )}

              <Link
                href="/listings/new"
                data-tour="nav-sell"
                className="btn-cyber-primary"
              >
                + Sell Item
              </Link>

              <span className="ml-2 flex items-center gap-2.5">
                <Avatar src={user.avatarUrl} username={user.username} size="sm" />
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {user.name}
                  </span>
                  {user.sellerType === 'BUSINESS' && (
                    <span className="rounded bg-[var(--tint-cyan)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/30">
                      Business
                    </span>
                  )}
                </span>
              </span>

              <button onClick={logout} className="btn-cyber-ghost">
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-cyber-ghost">
                Sign in
              </Link>
              <Link href="/register" className="btn-cyber-primary">
                Register
              </Link>
            </>
          )}
        </div>
      </div>

      {user && !user.emailVerified && (
        <div className="border-t border-[var(--neon-amber)]/30 bg-[var(--tint-amber)] px-4 py-2 text-center text-sm text-[var(--neon-amber)]">
          Please verify your email.{' '}
          <Link
            href="/verify-email"
            className="font-semibold underline underline-offset-2 hover:text-[var(--text-primary)] transition-colors"
          >
            Resend verification email
          </Link>
        </div>
      )}
    </header>
  );
}
