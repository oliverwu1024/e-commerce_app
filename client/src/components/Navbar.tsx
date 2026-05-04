'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore, type User } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { useInboxStore } from '@/stores/inbox';
import Avatar from '@/components/Avatar';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';

export default function Navbar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);
  const cartCount = useCartStore((s) => s.cart.itemCount);
  const unreadNotif = useInboxStore((s) => s.counts.notifications);
  const unreadMsg = useInboxStore((s) => s.counts.messages);

  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer whenever the route changes — covers browser
  // back/forward and programmatic navigation that bypass the drawer's link
  // onClick handlers. The single extra render is harmless and beats leaving
  // the drawer hovering over the new page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuOpen(false);
  }, [pathname]);

  // Lock background scroll while the drawer is open so the page doesn't
  // scroll behind it on iOS, and bind Escape to close.
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Logo click: on any other page, let Next.js Link navigate to "/". On the
  // home page itself a Link is a no-op — and the page is a Client Component
  // that fetches inside useEffect, so router.refresh() (which only re-runs
  // Server Component data) wouldn't show anything new. Hard-reload instead.
  function handleLogoClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (pathname === '/') {
      e.preventDefault();
      window.location.reload();
    }
  }

  const totalUnread = unreadNotif + unreadMsg;

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-nav)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:py-3.5">
        {/* ---------- Brand + desktop primary links ---------- */}
        <div className="flex min-w-0 items-center gap-5 md:gap-7">
          <Link
            href="/"
            onClick={handleLogoClick}
            className="font-display flex shrink-0 items-center gap-2 text-lg font-bold tracking-[0.02em] transition-opacity hover:opacity-90 sm:text-xl"
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
            className="hidden text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] md:inline"
          >
            Browse
          </Link>
          <Link
            href="/help"
            data-tour="nav-help"
            className="hidden text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] md:inline"
          >
            Help
          </Link>
        </div>

        {/* ---------- Desktop right cluster ---------- */}
        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />

          {loading ? (
            <div
              className="h-8 w-40 animate-pulse rounded bg-[var(--bg-panel-hi)]"
              aria-hidden="true"
            />
          ) : user ? (
            <>
              <IconLink
                href="/account/notifications"
                label={`Notifications${unreadNotif > 0 ? ` (${unreadNotif} unread)` : ''}`}
                badge={unreadNotif}
                badgeTone="danger"
              >
                <BellIcon />
              </IconLink>

              <IconLink
                href="/account/messages"
                dataTour="nav-messages"
                label={`Messages${unreadMsg > 0 ? ` (${unreadMsg} unread)` : ''}`}
                badge={unreadMsg}
                badgeTone="danger"
              >
                <MailIcon />
              </IconLink>

              <IconLink
                href="/cart"
                label={`Cart${cartCount > 0 ? ` (${cartCount} item${cartCount === 1 ? '' : 's'})` : ''}`}
                badge={cartCount}
                badgeTone="cyan"
              >
                <CartIcon />
              </IconLink>

              <div className="mx-1 h-6 w-px bg-[var(--border-subtle)]" />

              <Link
                href="/dashboard"
                data-tour="nav-dashboard"
                className="text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                Dashboard
              </Link>
              <Link
                href="/account/settings"
                className="text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                Account
              </Link>

              {user.role === 'ADMIN' && (
                <Link
                  href="/admin"
                  className="text-sm font-bold text-[var(--neon-amber)] transition-all hover:brightness-110"
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
                  <span className="max-w-[10rem] truncate text-sm font-semibold text-[var(--text-primary)]">
                    {user.name}
                  </span>
                  {user.sellerType === 'BUSINESS' && (
                    <span className="rounded border border-[var(--neon-cyan)]/30 bg-[var(--tint-cyan)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--neon-cyan)]">
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

        {/* ---------- Mobile right cluster ---------- */}
        <div className="flex items-center gap-2 md:hidden">
          {!loading && user && (
            <Link
              href="/cart"
              aria-label={`Cart${cartCount > 0 ? ` (${cartCount} item${cartCount === 1 ? '' : 's'})` : ''}`}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border-hi)] bg-[var(--bg-panel)] text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-panel-hi)] active:bg-[var(--bg-panel-hi)]"
            >
              <CartIcon />
              {cartCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--neon-cyan)] px-1 text-[10px] font-bold text-[var(--btn-primary-text)]">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Link>
          )}

          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border-hi)] bg-[var(--bg-panel)] text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-panel-hi)] active:bg-[var(--bg-panel-hi)]"
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
            {!menuOpen && !loading && user && totalUnread > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--neon-danger)] ring-2 ring-[var(--bg-nav)]"
              />
            )}
          </button>
        </div>
      </div>

      {user && !user.emailVerified && (
        <div className="border-t border-[var(--neon-amber)]/30 bg-[var(--tint-amber)] px-4 py-2 text-center text-xs text-[var(--neon-amber)] sm:text-sm">
          Please verify your email.{' '}
          <Link
            href="/verify-email"
            className="font-semibold underline underline-offset-2 transition-colors hover:text-[var(--text-primary)]"
          >
            Resend verification email
          </Link>
        </div>
      )}
    </header>

    {/* ---------- Mobile drawer ----------
        Rendered as a sibling of <header> so its position:fixed children
        sit in the document's root stacking context instead of the
        header's z-40 context — otherwise page content bleeds through
        the drawer panel on mobile. */}
    <MobileDrawer
      open={menuOpen}
      onClose={() => setMenuOpen(false)}
      loading={loading}
      user={user}
      unreadNotif={unreadNotif}
      unreadMsg={unreadMsg}
      cartCount={cartCount}
      logout={logout}
    />
    </>
  );
}

/* =============================================================
   Mobile drawer
   ============================================================= */

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  user: User | null;
  unreadNotif: number;
  unreadMsg: number;
  cartCount: number;
  logout: () => Promise<void>;
};

function MobileDrawer({
  open,
  onClose,
  loading,
  user,
  unreadNotif,
  unreadMsg,
  cartCount,
  logout,
}: DrawerProps) {
  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm transition-opacity duration-200 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        aria-hidden={!open}
        // Inline `background` defends against any CSS-variable cascade
        // issue — the drawer must read as a fully opaque panel against the
        // page or the text inside looks like it's "mixed with the page".
        style={{ background: 'var(--bg-panel)' }}
        className={`fixed inset-y-0 right-0 z-[70] flex w-[88%] max-w-sm flex-col border-l border-[var(--border-subtle)] shadow-2xl transition-transform duration-200 ease-out md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
          <span className="font-display text-base font-bold tracking-[0.02em]">
            <span className="text-[var(--text-primary)]">Electro</span>
            <span className="text-[var(--neon-cyan)]">Market</span>
          </span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              aria-label="Close menu"
              onClick={onClose}
              className="rounded-md p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-panel-hi)] hover:text-[var(--text-primary)]"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {loading ? (
            <div className="space-y-2 px-2">
              <div className="h-9 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
              <div className="h-9 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
              <div className="h-9 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
            </div>
          ) : user ? (
            <>
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-3 py-2.5">
                <Avatar src={user.avatarUrl} username={user.username} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    @{user.username}
                  </p>
                </div>
                {user.sellerType === 'BUSINESS' && (
                  <span className="shrink-0 rounded border border-[var(--neon-cyan)]/30 bg-[var(--tint-cyan)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--neon-cyan)]">
                    Business
                  </span>
                )}
              </div>

              <Link
                href="/listings/new"
                onClick={onClose}
                className="btn-cyber-primary mb-4 w-full justify-center"
              >
                + Sell an item
              </Link>

              <NavSection title="Browse">
                <DrawerLink href="/browse" onClick={onClose}>Browse listings</DrawerLink>
                <DrawerLink href="/help" onClick={onClose}>Help &amp; FAQs</DrawerLink>
              </NavSection>

              <NavSection title="Inbox">
                <DrawerLink
                  href="/cart"
                  onClick={onClose}
                  badge={cartCount}
                  badgeTone="cyan"
                  icon={<CartIcon />}
                >
                  Cart
                </DrawerLink>
                <DrawerLink
                  href="/account/messages"
                  onClick={onClose}
                  badge={unreadMsg}
                  badgeTone="danger"
                  icon={<MailIcon />}
                >
                  Messages
                </DrawerLink>
                <DrawerLink
                  href="/account/notifications"
                  onClick={onClose}
                  badge={unreadNotif}
                  badgeTone="danger"
                  icon={<BellIcon />}
                >
                  Notifications
                </DrawerLink>
              </NavSection>

              <NavSection title="Account">
                <DrawerLink href="/dashboard" onClick={onClose}>Dashboard</DrawerLink>
                <DrawerLink href="/account/settings" onClick={onClose}>Settings</DrawerLink>
                <DrawerLink href="/account/payments" onClick={onClose}>Payments</DrawerLink>
                <DrawerLink href="/account/verification" onClick={onClose}>Verification</DrawerLink>
                {user.role === 'ADMIN' && (
                  <DrawerLink href="/admin" onClick={onClose} accent>Admin</DrawerLink>
                )}
              </NavSection>
            </>
          ) : (
            <>
              <NavSection title="Browse">
                <DrawerLink href="/browse" onClick={onClose}>Browse listings</DrawerLink>
                <DrawerLink href="/help" onClick={onClose}>Help &amp; FAQs</DrawerLink>
              </NavSection>

              <div className="mt-4 grid grid-cols-2 gap-2 px-1">
                <Link
                  href="/login"
                  onClick={onClose}
                  className="btn-cyber-outline w-full justify-center"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  onClick={onClose}
                  className="btn-cyber-primary w-full justify-center"
                >
                  Register
                </Link>
              </div>
            </>
          )}
        </div>

        {user && (
          <div className="flex items-center justify-end gap-3 border-t border-[var(--border-subtle)] px-5 py-3">
            <button
              onClick={() => {
                onClose();
                logout();
              }}
              className="btn-cyber-ghost"
            >
              Logout
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

/* =============================================================
   Small building blocks
   ============================================================= */

type IconLinkProps = {
  href: string;
  label: string;
  badge?: number;
  badgeTone?: 'cyan' | 'danger';
  dataTour?: string;
  children: React.ReactNode;
};

function IconLink({ href, label, badge = 0, badgeTone = 'danger', dataTour, children }: IconLinkProps) {
  const tone =
    badgeTone === 'cyan'
      ? 'bg-[var(--neon-cyan)] text-[var(--btn-primary-text)]'
      : 'bg-[var(--neon-danger)] text-white';
  return (
    <Link
      href={href}
      aria-label={label}
      data-tour={dataTour}
      className="relative rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-panel-hi)] hover:text-[var(--text-primary)]"
    >
      {children}
      {badge > 0 && (
        <span
          className={`absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tone}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

type DrawerLinkProps = {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
  badge?: number;
  badgeTone?: 'cyan' | 'danger';
  icon?: React.ReactNode;
  accent?: boolean;
};

function DrawerLink({
  href,
  onClick,
  children,
  badge = 0,
  badgeTone = 'danger',
  icon,
  accent = false,
}: DrawerLinkProps) {
  const tone =
    badgeTone === 'cyan'
      ? 'bg-[var(--neon-cyan)] text-[var(--btn-primary-text)]'
      : 'bg-[var(--neon-danger)] text-white';

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${
        accent
          ? 'text-[var(--neon-amber)] hover:bg-[var(--tint-amber)]'
          : 'text-[var(--text-primary)] hover:bg-[var(--bg-panel-hi)]'
      }`}
    >
      {icon && (
        <span className="text-[var(--text-muted)]" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      {badge > 0 && (
        <span
          className={`flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${tone}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

/* =============================================================
   Inline icons (kept inline so the navbar has zero new files)
   ============================================================= */

function BellIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.5 3h13M9 20a1 1 0 102 0 1 1 0 00-2 0zm8 0a1 1 0 102 0 1 1 0 00-2 0z"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
    </svg>
  );
}
