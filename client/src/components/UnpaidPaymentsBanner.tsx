'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

// Site-wide top strip surfacing "you have unpaid orders" without forcing the
// user onto the dashboard. Lives above the navbar in the root layout.
//
// Behaviour:
//   - Hidden until auth is resolved + user is signed in.
//   - Hidden when no unpaid CARD orders exist.
//   - Dismissable per browser session via sessionStorage; reappears on the
//     next session if the user still owes payment.
//   - Re-fetches the count on route change so paying via /pay/batch and
//     coming back drops the banner without a hard refresh.
type UnpaidSummary = { count: number; totalCents: number };

const SESSION_DISMISS_KEY = 'unpaidPaymentsBannerDismissed';

export default function UnpaidPaymentsBanner() {
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const pathname = usePathname();
  const [summary, setSummary] = useState<UnpaidSummary | null>(null);
  // Honour a session dismissal so the banner doesn't shout on every page
  // navigation after the user explicitly closed it. Lazy-init from
  // sessionStorage so the first render already reflects the right state.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
  });

  // Fetch (or refetch) whenever auth changes or the user navigates to a new
  // route — covers paying-and-returning, where the count drops.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    api<{ unpaidCard?: UnpaidSummary }>('/api/dashboard/tab-counts')
      .then((data) => {
        if (cancelled) return;
        setSummary(data.unpaidCard ?? null);
      })
      .catch(() => {
        // Silent — the banner is a hint, not load-bearing. Failure leaves
        // the user without the cue but doesn't break anything.
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, pathname]);

  // Render-time gate covers both "no user" and "summary is stale from a
  // previous session" without an extra effect that would imperatively clear
  // state. When the user logs out, `user` becomes null and we short-circuit
  // before reading `summary`.
  if (!user || authLoading) return null;
  if (!summary || summary.count === 0) return null;
  if (dismissed) return null;

  // Don't double up with the dashboard's own banners — the dashboard already
  // surfaces the same information in higher fidelity (per-seller breakdown).
  if (pathname?.startsWith('/dashboard')) return null;

  const totalDollars = (summary.totalCents / 100).toFixed(2);

  return (
    <div className="border-b border-[var(--neon-amber)]/40 bg-[var(--tint-amber)]">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-sm">
        <Link
          href="/dashboard?tab=in_purchases"
          className="flex-1 text-[var(--neon-amber)] hover:brightness-110"
        >
          <span className="font-semibold">
            {summary.count} {summary.count === 1 ? 'item' : 'items'} awaiting
            your payment
          </span>{' '}
          <span className="text-[var(--text-muted)]">
            · ${totalDollars} total · click to review
          </span>
        </Link>
        <button
          type="button"
          aria-label="Dismiss for this session"
          onClick={() => {
            sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
            setDismissed(true);
          }}
          className="text-[var(--neon-amber)] hover:opacity-70"
        >
          ×
        </button>
      </div>
    </div>
  );
}
