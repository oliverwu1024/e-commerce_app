'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useInboxStore } from '@/stores/inbox';

type NavItem = {
  href: string;
  label: string;
  // Pulls a count off the inbox store for the badge. Omitted = no badge.
  badge?: 'notifications' | 'orderMessages' | 'inquiryMessages';
  // For sidebar items that share a pathname (Messages + Inquiries both live
  // under /account/messages), `matchTab` is the value of `?tab=` that should
  // mark this item active. `null` = the bare pathname (no `?tab=`).
  matchTab?: string | null;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/account/settings', label: 'Settings' },
  { href: '/account/verification', label: 'Verification' },
  { href: '/account/payments', label: 'Payments' },
  { href: '/account/notifications', label: 'Notifications', badge: 'notifications' },
  { href: '/account/messages', label: 'Messages', badge: 'orderMessages', matchTab: null },
  { href: '/account/messages?tab=inquiries', label: 'Inquiries', badge: 'inquiryMessages', matchTab: 'inquiries' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Account</h1>

        <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
          <Suspense fallback={<aside className="lg:pr-4" />}>
            <SidebarNav />
          </Suspense>
          <div>{children}</div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const counts = useInboxStore((s) => s.counts);
  const currentTab = searchParams.get('tab');

  function isActive(item: NavItem): boolean {
    const url = new URL(item.href, 'http://x.invalid');
    if (url.pathname !== pathname) return false;
    // `matchTab` undefined ⇒ this item has no tab semantics, pathname match
    // is enough. Otherwise the current `?tab=` must match.
    if (item.matchTab === undefined) return true;
    return (currentTab ?? null) === item.matchTab;
  }

  return (
    <aside className="lg:pr-4">
      <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const badgeValue = item.badge ? counts[item.badge] ?? 0 : 0;
          return (
            <Link
              key={item.href + (item.matchTab ?? '')}
              href={item.href}
              className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-panel-hi)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{item.label}</span>
              {badgeValue > 0 && (
                <span
                  className="min-w-[1.25rem] rounded-full bg-[var(--neon-cyan)] px-1.5 py-0.5 text-center text-[10px] font-bold text-[var(--btn-primary-text)]"
                  aria-label={`${badgeValue} unread`}
                >
                  {badgeValue > 99 ? '99+' : badgeValue}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
