'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type {
  PaymentProvider,
  SellerPaymentAccount,
  SellerPaymentsSummary,
} from '@/types/sellerPayments';

// Marketing copy for each provider card. Keeping it in one table rather than
// open-coding each card lets us add/remove providers without duplicating
// layout.
const PROVIDER_META: Record<
  PaymentProvider,
  { label: string; blurb: string; note: string }
> = {
  STRIPE: {
    label: 'Stripe',
    blurb:
      'Best for most sellers. Accepts credit cards, Apple Pay, Google Pay. Funds go straight to your bank in 2 business days.',
    note: 'Stripe will ask for ID + bank details. This is ~5–10 minutes.',
  },
  SQUARE: {
    label: 'Square',
    blurb:
      'Useful if you already sell in person with a Square reader. Payouts go to the bank linked to your Square account.',
    note: 'Optional. You can skip this unless you already use Square.',
  },
};

export default function SellerPaymentsPage() {
  return (
    <Suspense fallback={<SellerPaymentsSkeleton />}>
      <SellerPaymentsInner />
    </Suspense>
  );
}

function SellerPaymentsInner() {
  const searchParams = useSearchParams();
  const [summary, setSummary] = useState<SellerPaymentsSummary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [banner, setBanner] = useState<
    | { kind: 'success' | 'error'; message: string }
    | null
  >(null);

  const load = useCallback(async () => {
    try {
      const data = await api<SellerPaymentsSummary>('/api/seller/payments');
      setSummary(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Return-URL side effects. Providers redirect the seller back here with a
  // query string; we translate that into a banner + an immediate sync.
  //   - Stripe: no query param convention, so we just sync and show a banner
  //   - Square: `square=connected|denied|invalid_state|...`
  useEffect(() => {
    const square = searchParams.get('square');

    if (square === 'connected') {
      setBanner({ kind: 'success', message: 'Square connected.' });
      load();
    } else if (square && square !== 'connected') {
      const map: Record<string, string> = {
        denied: 'You declined the Square authorization.',
        invalid_state: 'Authorization state invalid — please try again.',
        exchange_failed: 'Square rejected the authorization code.',
        incomplete_token: 'Square sent an incomplete response — try again.',
        not_configured: 'Square OAuth is not configured on the server.',
        error: 'Unexpected error during Square connection.',
      };
      setBanner({ kind: 'error', message: map[square] ?? 'Square connection failed.' });
    }
  }, [searchParams, load]);

  // On mount for any already-connected Stripe account, pull fresh status
  // once — so the card reflects current chargesEnabled / payoutsEnabled
  // without waiting on webhook delivery.
  useEffect(() => {
    if (!summary) return;
    const stripe = summary.accounts.find((a) => a.provider === 'STRIPE');
    if (stripe && stripe.status !== 'DISCONNECTED') {
      api<{ account: SellerPaymentAccount }>(
        '/api/seller/payments/stripe/sync',
        { method: 'POST' },
      )
        .then((res) => {
          setSummary((s) =>
            s
              ? {
                  ...s,
                  accounts: s.accounts.map((a) =>
                    a.provider === 'STRIPE' ? res.account : a,
                  ),
                  canAcceptOnline: s.accounts
                    .map((a) => (a.provider === 'STRIPE' ? res.account : a))
                    .some((a) => a.status === 'ACTIVE' && a.chargesEnabled),
                }
              : s,
          );
        })
        .catch(() => {
          /* silently fall back to the stored row — sync failure shouldn't
             block the page render */
        });
    }
    // Only run on first summary load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.accounts.length]);

  if (loadError) {
    return (
      <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-4 text-sm text-[var(--neon-danger)]">
        {loadError}
      </div>
    );
  }
  if (!summary) return <SellerPaymentsSkeleton />;

  const accountsByProvider = new Map<PaymentProvider, SellerPaymentAccount>(
    summary.accounts.map((a) => [a.provider, a]),
  );
  const providers: PaymentProvider[] = ['STRIPE', 'SQUARE'];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          Payment accounts
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Connect your own Stripe or Square account so money from your sales
          goes directly into your bank. ElectroMarket never holds your funds.
        </p>
      </header>

      {banner && (
        <div
          className={
            banner.kind === 'success'
              ? 'rounded-lg border border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] p-3 text-sm text-[var(--neon-cyan)]'
              : 'rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]'
          }
        >
          {banner.message}
        </div>
      )}

      {!summary.canAcceptOnline && summary.accounts.length === 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-sm text-[var(--text-muted)]">
          You haven&apos;t connected any online payment providers yet. Until
          you do, buyers can only arrange cash or bank transfer with you
          directly.
        </div>
      )}

      <div className="space-y-4">
        {providers.map((provider) => (
          <ProviderCard
            key={provider}
            provider={provider}
            account={accountsByProvider.get(provider) ?? null}
            onChanged={load}
            onBanner={setBanner}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  account,
  onChanged,
  onBanner,
}: {
  provider: PaymentProvider;
  account: SellerPaymentAccount | null;
  onChanged: () => void;
  onBanner: (b: { kind: 'success' | 'error'; message: string } | null) => void;
}) {
  const meta = PROVIDER_META[provider];
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    onBanner(null);
    try {
      if (provider === 'STRIPE') {
        const res = await api<{ url: string }>(
          '/api/seller/payments/stripe/onboard',
          { method: 'POST' },
        );
        window.location.href = res.url;
        return;
      }
      if (provider === 'SQUARE') {
        // Square uses a GET redirect rather than a POST → JSON. Bounce
        // the browser directly at our authorize endpoint which in turn
        // 302s to Square.
        const apiBase =
          process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
        window.location.href = `${apiBase}/api/seller/payments/square/authorize`;
        return;
      }
    } catch (err) {
      onBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : `Failed to start ${meta.label} connection`,
      });
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${meta.label}? Buyers won't be able to pay you through ${meta.label} until you reconnect.`)) {
      return;
    }
    setBusy(true);
    onBanner(null);
    try {
      await api(`/api/seller/payments/${provider.toLowerCase()}/disconnect`, {
        method: 'POST',
      });
      onBanner({ kind: 'success', message: `${meta.label} disconnected.` });
      onChanged();
    } catch (err) {
      onBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : `Failed to disconnect ${meta.label}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const connected = account && account.status === 'ACTIVE' && account.chargesEnabled;
  const needsAttention =
    account && (account.status === 'PENDING' || account.status === 'RESTRICTED');
  const disconnected = account && account.status === 'DISCONNECTED';

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {meta.label}
            </h3>
            <StatusBadge account={account} />
          </div>
          <p className="text-sm text-[var(--text-muted)]">{meta.blurb}</p>
        </div>
      </div>

      {!account || disconnected ? (
        <>
          <p className="mt-3 text-xs text-[var(--text-muted)]">{meta.note}</p>
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="mt-4 rounded-lg bg-[var(--neon-cyan)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Starting…' : `Connect ${meta.label}`}
          </button>
        </>
      ) : needsAttention ? (
        <>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            {account?.status === 'RESTRICTED'
              ? `${meta.label} has paused payouts for this account. Sign in to ${meta.label} to resolve.`
              : `We're waiting on ${meta.label} to finish verifying you. Click below to continue where you left off.`}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="rounded-lg bg-[var(--neon-cyan)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Loading…' : `Continue ${meta.label} setup`}
            </button>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Disconnect
            </button>
          </div>
        </>
      ) : connected ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Row label="Charges" value={account.chargesEnabled ? 'Enabled' : 'Disabled'} />
            <Row label="Payouts" value={account.payoutsEnabled ? 'Enabled' : 'Disabled'} />
            <Row label="Connected" value={formatDate(account.onboardedAt)} />
            {account.locationId && (
              <Row label="Location" value={account.locationId} />
            )}
          </dl>
          <div className="mt-4">
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StatusBadge({ account }: { account: SellerPaymentAccount | null }) {
  if (!account) {
    return (
      <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
        Not connected
      </span>
    );
  }
  const style: Record<SellerPaymentAccount['status'], string> = {
    ACTIVE:
      'bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border-[var(--neon-cyan)]/40',
    PENDING:
      'bg-[var(--tint-danger)]/30 text-[var(--text-primary)] border-[var(--border-subtle)]',
    RESTRICTED:
      'bg-[var(--tint-danger)] text-[var(--neon-danger)] border-[var(--neon-danger)]/40',
    DISCONNECTED:
      'border-[var(--border-subtle)] text-[var(--text-muted)]',
  };
  const label: Record<SellerPaymentAccount['status'], string> = {
    ACTIVE: account.chargesEnabled ? 'Active' : 'Setup incomplete',
    PENDING: 'Pending',
    RESTRICTED: 'Restricted',
    DISCONNECTED: 'Disconnected',
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${style[account.status]}`}
    >
      {label[account.status]}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function SellerPaymentsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-40 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]"
        />
      ))}
    </div>
  );
}
