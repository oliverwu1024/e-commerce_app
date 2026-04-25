'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import type { SellerPaymentsSummary } from '@/types/sellerPayments';

type Step = {
  id: 'verifyEmail' | 'profile' | 'payments' | 'firstListing';
  title: string;
  body: string;
  href: string;
  cta: string;
  done: boolean;
};

// Self-contained "Get started" card for new sellers. Renders nothing when:
//   - user isn't loaded
//   - all four steps are complete
//   - the user has explicitly dismissed it for this session (localStorage)
//
// State derives entirely from existing API responses — no schema change.
export default function OnboardingChecklist() {
  const user = useAuthStore((s) => s.user);
  const [payments, setPayments] = useState<SellerPaymentsSummary | null>(null);
  const [listingCount, setListingCount] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Honour a previous dismissal (per browser, per user) so the card doesn't
  // pop back the next time they load the dashboard.
  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;
    const flag = window.localStorage.getItem(`em-onboarding-dismissed-${user.id}`);
    if (flag === '1') setDismissed(true);
  }, [user]);

  useEffect(() => {
    if (!user || dismissed) return;
    let cancelled = false;
    Promise.all([
      api<SellerPaymentsSummary>('/api/seller/payments').catch(() => null),
      api<{ pagination: { total: number } }>('/api/listings/my?limit=1').catch(() => null),
    ]).then(([p, l]) => {
      if (cancelled) return;
      setPayments(p);
      setListingCount(l ? l.pagination.total : 0);
    });
    return () => {
      cancelled = true;
    };
  }, [user, dismissed]);

  if (!user || dismissed) return null;
  if (payments === null || listingCount === null) return null;

  // Step status derives from data we already have:
  //   - verifyEmail: user.emailVerified
  //   - profile: location set (the simplest "you've actually filled this in" signal)
  //   - payments: any ACTIVE/chargesEnabled provider
  //   - firstListing: at least one listing exists (any status)
  const profileFilled = Boolean(user.location && user.location.trim());
  const paymentsConnected =
    payments?.accounts?.some((a) => a.status === 'ACTIVE' && a.chargesEnabled) ?? false;
  const hasListing = listingCount > 0;

  const steps: Step[] = [
    {
      id: 'verifyEmail',
      title: 'Verify your email',
      body: 'We sent you a verification link. You can’t list items until your email is verified.',
      href: '/verify-email',
      cta: 'Resend link',
      done: user.emailVerified,
    },
    {
      id: 'profile',
      title: 'Add your location to your profile',
      body: 'Buyers like to see where you’re shipping from. Takes 30 seconds.',
      href: '/account/settings',
      cta: 'Edit profile',
      done: profileFilled,
    },
    {
      id: 'payments',
      title: 'Connect Stripe (or Square)',
      body: 'Money from your sales goes straight to your bank. Without this, buyers can only arrange cash or bank transfer.',
      href: '/account/payments',
      cta: 'Connect now',
      done: paymentsConnected,
    },
    {
      id: 'firstListing',
      title: 'Create your first listing',
      body: 'Three good photos, an honest description, and a fair price.',
      href: '/listings/new',
      cta: 'Post a listing',
      done: hasListing,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  function dismiss() {
    if (!user) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`em-onboarding-dismissed-${user.id}`, '1');
    }
    setDismissed(true);
  }

  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <section
      aria-label="Get started checklist"
      data-tour="onboarding-checklist"
      className="mt-6 rounded-lg border border-[var(--neon-cyan)]/40 bg-[var(--bg-panel)] p-5 shadow-[0_0_24px_-12px_color-mix(in_oklab,var(--neon-cyan)_55%,transparent)]"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--neon-cyan)]">
            Get started
          </p>
          <h2 className="mt-1 text-lg font-bold text-[var(--text-primary)]">
            Finish setting up your seller account
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {doneCount} of {steps.length} done · {pct}%
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Dismiss checklist"
        >
          Dismiss
        </button>
      </header>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-panel-hi)]">
        <div
          className="h-full bg-[var(--neon-cyan)] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="mt-5 space-y-2.5">
        {steps.map((step, idx) => (
          <ChecklistRow key={step.id} step={step} index={idx + 1} />
        ))}
      </ol>

      <p className="mt-4 text-xs text-[var(--text-dim)]">
        New here? Read the full{' '}
        <Link href="/help/sell" className="text-[var(--neon-cyan)] hover:underline">
          how-to-sell guide
        </Link>
        .
      </p>
    </section>
  );
}

function ChecklistRow({ step, index }: { step: Step; index: number }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)]/40 p-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
          step.done
            ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
            : 'border-[var(--border-hi)] text-[var(--text-muted)]'
        }`}
      >
        {step.done ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-semibold ${
            step.done
              ? 'text-[var(--text-muted)] line-through decoration-[var(--text-dim)]'
              : 'text-[var(--text-primary)]'
          }`}
        >
          {step.title}
        </p>
        {!step.done && (
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{step.body}</p>
        )}
      </div>
      {!step.done && (
        <Link
          href={step.href}
          className="ml-2 flex-shrink-0 self-center rounded-md border border-[var(--neon-cyan)] px-3 py-1.5 text-xs font-semibold text-[var(--neon-cyan)] hover:bg-[var(--tint-cyan)]"
        >
          {step.cta}
        </Link>
      )}
    </li>
  );
}
