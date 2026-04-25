'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import type { EventHandler, Step } from 'react-joyride';

// react-joyride measures DOM nodes synchronously, which doesn't work under
// SSR. Dynamic import + ssr:false keeps it strictly client-side and dodges
// hydration mismatches. The library exports `Joyride` as a named export.
const Joyride = dynamic(
  () => import('react-joyride').then((mod) => mod.Joyride),
  { ssr: false },
);

type TourKind = 'buyer' | 'seller';

const PENDING_KEY = 'em-tour-pending';
const doneKey = (kind: TourKind, userId: string) =>
  `em-tour-${kind}-done-${userId}`;

// Public helper: pages call this immediately after registration to flag
// which tour should fire next. Stored in localStorage so it survives the
// router.push() that follows.
export function queuePostRegistrationTour(kind: TourKind) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PENDING_KEY, kind);
}

// Public helper: any page can offer a "Take the tour" button that calls
// this. Treats the request as a one-shot run regardless of done flag.
export function startTourManually(kind: TourKind) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PENDING_KEY, kind);
  // Bump a custom event so the listener inside OnboardingTour re-evaluates
  // even when the value didn't change between reads.
  window.dispatchEvent(new Event('em-tour-request'));
}

const BUYER_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome to ElectroMarket',
    content:
      'A 20-second tour to show you around. You can skip it anytime — it won’t come back.',
  },
  {
    target: '[data-tour="search"]',
    title: 'Find what you’re after',
    content:
      'Search by model — “iPhone 13 Pro 256GB”, “M2 MacBook Air” — or browse by category below.',
  },
  {
    target: '[data-tour="nav-browse"]',
    title: 'Browse the marketplace',
    content:
      'Filter by condition, price, location and more. Tap the heart icon on any listing to save it for later.',
  },
  {
    target: '[data-tour="nav-messages"]',
    title: 'Messages from sellers',
    content:
      'When you contact a seller or place an order, replies show up here.',
  },
  {
    target: '[data-tour="nav-dashboard"]',
    title: 'Your dashboard',
    content:
      'Saved listings, in-progress purchases, and past orders all live here.',
  },
  {
    target: '[data-tour="nav-help"]',
    title: 'Need a hand?',
    content:
      'The Help centre walks through buying, paying, and what to do if a seller goes silent.',
  },
];

const SELLER_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome — let’s get you selling',
    content:
      'Quick tour of the seller dashboard. You can skip anytime — it won’t come back.',
  },
  {
    target: '[data-tour="role-switcher"]',
    title: 'Selling and buying live in one place',
    content:
      'Toggle between your selling and buying activity with this switcher.',
  },
  {
    target: '[data-tour="onboarding-checklist"]',
    title: 'Your get-started checklist',
    content:
      'Four steps to go from sign-up to your first payout: verify email, fill in profile, connect Stripe, post a listing.',
  },
  {
    target: '[data-tour="dashboard-tabs"]',
    title: 'Track your sales here',
    content:
      'Active Listings shows what’s live; In Progress shows orders that need your attention; Past Sales is your history.',
  },
  {
    target: '[data-tour="nav-sell"]',
    title: 'Post your first listing',
    content:
      'Three good photos, an honest condition rating, a fair price. The Help centre has the full checklist.',
  },
  {
    target: '[data-tour="nav-help"]',
    title: 'Full guide in the Help centre',
    content:
      'Stripe / Square setup, fees, refunds, disputes — all covered in /help/sell.',
  },
];

// Pages a tour may legitimately fire on. If we're on a different page when
// the pending flag is read, we wait — the user will hit the right page
// eventually (Personal → /; Business → /dashboard via register redirect).
const TOUR_PATH: Record<TourKind, string> = {
  buyer: '/',
  seller: '/dashboard',
};

export default function OnboardingTour() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const [pending, setPending] = useState<TourKind | null>(null);
  const [running, setRunning] = useState(false);

  // Read the pending flag whenever user/path changes (or the manual-start
  // helper fires a custom event). storage events handle cross-tab sync.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function readFlag() {
      const raw = window.localStorage.getItem(PENDING_KEY);
      if (raw === 'buyer' || raw === 'seller') setPending(raw);
      else setPending(null);
    }
    readFlag();
    const onCustom = () => readFlag();
    window.addEventListener('em-tour-request', onCustom);
    window.addEventListener('storage', onCustom);
    return () => {
      window.removeEventListener('em-tour-request', onCustom);
      window.removeEventListener('storage', onCustom);
    };
  }, [user?.id, pathname]);

  // Decide whether to actually run the tour right now. Conditions:
  //   - we know which tour is pending
  //   - user is loaded (so we have an id to scope the done flag)
  //   - they haven't already completed/skipped this tour before
  //   - they're on the page the tour expects targets to exist on
  useEffect(() => {
    if (!pending || !user) {
      setRunning(false);
      return;
    }
    if (typeof window === 'undefined') return;
    const alreadyDone = window.localStorage.getItem(doneKey(pending, user.id));
    if (alreadyDone === '1') {
      // Stale flag from a previous session. Clear it so we don't keep
      // re-evaluating.
      window.localStorage.removeItem(PENDING_KEY);
      setRunning(false);
      return;
    }
    if (pathname !== TOUR_PATH[pending]) {
      setRunning(false);
      return;
    }
    // Wait one tick for the targeted DOM to mount before kicking off.
    const t = window.setTimeout(() => setRunning(true), 400);
    return () => window.clearTimeout(t);
  }, [pending, user, pathname]);

  const steps = useMemo(
    () => (pending === 'buyer' ? BUYER_STEPS : pending === 'seller' ? SELLER_STEPS : []),
    [pending],
  );

  const handleEvent: EventHandler = (data) => {
    // 'finished' = user clicked Done on the last step
    // 'skipped'  = user clicked Skip
    if (data.status === 'finished' || data.status === 'skipped') {
      if (user && pending) {
        window.localStorage.setItem(doneKey(pending, user.id), '1');
      }
      window.localStorage.removeItem(PENDING_KEY);
      setPending(null);
      setRunning(false);
    }
  };

  if (!running || steps.length === 0) return null;

  return (
    <Joyride
      steps={steps}
      run={running}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Done',
        next: 'Next',
        skip: 'Skip tour',
      }}
      options={{
        // Match the neon-cyan accent. react-joyride writes these into
        // inline styles, so CSS vars don't work — hard-code to the same
        // hex used by --neon-cyan in globals.css.
        primaryColor: '#00d4ff',
        zIndex: 10000,
        backgroundColor: '#0b1530',
        arrowColor: '#0b1530',
        textColor: '#e2eaff',
        overlayColor: 'rgba(2, 8, 23, 0.55)',
        showProgress: true,
        // Don't dismiss the tour by clicking the dim overlay — only the
        // explicit Skip button ends it. Fewer accidental exits.
        overlayClickAction: false,
      }}
    />
  );
}
