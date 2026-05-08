'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import ListingForm from '@/components/ListingForm';
import { api } from '@/lib/api';
import type { ProfileResponse } from '@/types/users';

export default function CreateListingPage() {
  return (
    <ProtectedRoute>
      <CreateListingGate />
    </ProtectedRoute>
  );
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'blocked'; missing: string[] }
  | { kind: 'ready' };

function CreateListingGate() {
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    api<ProfileResponse>('/api/users/profile')
      .then((res) => {
        if (cancelled) return;
        setState(
          res.canSell
            ? { kind: 'ready' }
            : { kind: 'blocked', missing: res.missing },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to check seller eligibility',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  if (state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="h-8 w-48 rounded bg-[var(--bg-panel-hi)] animate-pulse" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-xl border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-6">
          <h1 className="text-xl font-bold text-[var(--neon-danger)]">Couldn&apos;t verify your eligibility</h1>
          <p className="mt-1 text-sm text-[var(--neon-danger)]">{state.message}</p>
          <button
            type="button"
            onClick={() => setRetryToken((t) => t + 1)}
            className="mt-5 inline-block rounded-lg bg-[var(--neon-danger)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'blocked') {
    return <VerificationRequired missing={state.missing} />;
  }

  return <ListingForm />;
}

function VerificationRequired({ missing }: { missing: string[] }) {
  const labelMap: Record<string, string> = {
    email: 'Verify your email address',
    phone: 'Add and verify your phone number',
    id: 'Upload a government ID for review',
    abn: 'Verify your ABN',
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="rounded-xl border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] p-6">
        <h1 className="text-xl font-bold text-[var(--neon-amber)]">Finish verification to sell</h1>
        <p className="mt-1 text-sm text-[var(--neon-amber)]">
          Before you can post a listing, we need to verify a few things.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-[var(--neon-amber)]">
          {missing.map((step) => (
            <li key={step} className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5">•</span>
              <span>{labelMap[step] ?? step}</span>
            </li>
          ))}
        </ul>
        <Link
          href="/account/verification"
          className="mt-5 inline-block rounded-lg bg-[var(--neon-amber)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          Go to verification
        </Link>
      </div>
    </div>
  );
}
