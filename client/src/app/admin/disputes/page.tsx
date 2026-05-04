'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

type DisputeStatus =
  | 'OPEN'
  | 'RESOLVED_BY_SELLER'
  | 'ACCEPTED'
  | 'RESOLVED_REFUND'
  | 'RESOLVED_NO_REFUND'
  | 'WITHDRAWN';
type DisputeReason = 'NOT_RECEIVED' | 'NOT_AS_DESCRIBED' | 'DAMAGED' | 'OTHER';

type AdminDisputeMessage = {
  id: string;
  content: string;
  createdAt: string;
  fromUser: { id: string; username: string; avatarUrl: string | null };
};

type AdminDispute = {
  id: string;
  status: DisputeStatus;
  reason: DisputeReason;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  reopenedAt: string | null;
  resolutionNote: string | null;
  buyer: { id: string; username: string };
  seller: { id: string; username: string };
  order: {
    id: string;
    amount: string;
    status: string;
    paymentMethod: string | null;
    listing: { id: string; title: string };
  };
  messages: AdminDisputeMessage[];
};

const REASON_LABEL: Record<DisputeReason, string> = {
  NOT_RECEIVED: 'Not received',
  NOT_AS_DESCRIBED: 'Not as described',
  DAMAGED: 'Damaged',
  OTHER: 'Other',
};

const STATUS_FILTERS: { value: DisputeStatus; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED_BY_SELLER', label: 'Closed by seller' },
  { value: 'ACCEPTED', label: 'Accepted by buyer' },
  { value: 'RESOLVED_REFUND', label: 'Resolved (refunded)' },
  { value: 'RESOLVED_NO_REFUND', label: 'Resolved (no refund)' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

type Counts = Record<DisputeStatus, number>;

export default function AdminDisputesPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  if (user.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold">Access denied</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          <Link href="/" className="text-[var(--neon-cyan)] hover:underline">Go home</Link>.
        </p>
      </div>
    );
  }
  return <Loaded />;
}

function Loaded() {
  const [filter, setFilter] = useState<DisputeStatus>('OPEN');
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [counts, setCounts] = useState<Counts>({
    OPEN: 0,
    RESOLVED_BY_SELLER: 0,
    ACCEPTED: 0,
    RESOLVED_REFUND: 0,
    RESOLVED_NO_REFUND: 0,
    WITHDRAWN: 0,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ disputes: AdminDispute[]; counts: Counts }>(
        `/api/admin/disputes?status=${filter}`,
      );
      setDisputes(res.disputes);
      setCounts(res.counts);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Disputes</h1>
        <Link
          href="/admin"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--neon-cyan)]"
        >
          ← Admin home
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter(s.value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === s.value
                ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {s.label}
            <span className="ml-1.5 text-[10px] text-[var(--text-dim)]">
              ({counts[s.value] ?? 0})
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {loading && (
          <div className="h-32 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]" />
        )}
        {!loading && disputes.length === 0 && (
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 text-sm text-[var(--text-muted)]">
            No {STATUS_FILTERS.find((s) => s.value === filter)?.label.toLowerCase()} disputes.
          </p>
        )}
        {disputes.map((d) => (
          <DisputeCard key={d.id} dispute={d} onResolved={load} />
        ))}
      </div>
    </div>
  );
}

function DisputeCard({
  dispute,
  onResolved,
}: {
  dispute: AdminDispute;
  onResolved: () => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [error, setError] = useState('');

  async function resolve(outcome: 'RESOLVED_REFUND' | 'RESOLVED_NO_REFUND') {
    if (!note.trim()) {
      setError('Please add a resolution note.');
      return;
    }
    setResolving(true);
    setError('');
    try {
      await api(`/api/admin/disputes/${dispute.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ outcome, resolutionNote: note.trim() }),
      });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {dispute.order.listing.title}
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            A${dispute.order.amount} · {dispute.order.paymentMethod ?? 'unknown method'} · order{' '}
            <Link
              href={`/dashboard?order=${dispute.order.id}`}
              className="text-[var(--neon-cyan)] hover:underline"
            >
              {dispute.order.id.slice(0, 8)}…
            </Link>
          </p>
        </div>
        <span className="rounded-full border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-2 py-0.5 text-[10px] font-medium text-[var(--neon-amber)]">
          {REASON_LABEL[dispute.reason]}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap rounded bg-[var(--bg-panel-hi)] p-3 text-xs text-[var(--text-primary)]">
        {dispute.description}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
        <div>
          <dt>Buyer</dt>
          <dd className="text-[var(--text-primary)]">{dispute.buyer.username}</dd>
        </div>
        <div>
          <dt>Seller</dt>
          <dd className="text-[var(--text-primary)]">{dispute.seller.username}</dd>
        </div>
        <div>
          <dt>Filed</dt>
          <dd className="text-[var(--text-primary)]">
            {new Date(dispute.createdAt).toLocaleString()}
          </dd>
        </div>
        {dispute.reopenedAt && (
          <div>
            <dt>Reopened by buyer</dt>
            <dd className="text-[var(--neon-amber)]">
              {new Date(dispute.reopenedAt).toLocaleString()}
            </dd>
          </div>
        )}
        {dispute.resolvedAt && (
          <div>
            <dt>Resolved</dt>
            <dd className="text-[var(--text-primary)]">
              {new Date(dispute.resolvedAt).toLocaleString()}
            </dd>
          </div>
        )}
      </dl>

      {dispute.resolutionNote && (
        <p className="mt-3 rounded border-l-2 border-[var(--neon-cyan)] bg-[var(--bg-panel-hi)] p-3 text-xs text-[var(--text-muted)]">
          <strong className="text-[var(--text-primary)]">Resolution:</strong>{' '}
          {dispute.resolutionNote}
        </p>
      )}

      {dispute.messages.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
            Conversation between parties (read-only)
          </p>
          <div className="space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-3">
            {dispute.messages.map((m) => (
              <div key={m.id} className="text-xs">
                <span className="font-semibold text-[var(--text-primary)]">
                  {m.fromUser.username}
                </span>
                <span className="ml-2 text-[10px] text-[var(--text-dim)]">
                  {new Date(m.createdAt).toLocaleString()}
                </span>
                <p className="mt-0.5 whitespace-pre-wrap text-[var(--text-muted)]">
                  {m.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {dispute.status === 'OPEN' && (
        <div className="mt-4">
          {!showResolve ? (
            <button
              onClick={() => setShowResolve(true)}
              className="rounded-lg bg-[var(--neon-cyan)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] hover:opacity-90"
            >
              Resolve
            </button>
          ) : (
            <div className="space-y-3">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Resolution note (visible to both parties)"
                rows={3}
                maxLength={2000}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-2 text-sm text-[var(--text-primary)]"
              />
              {error && (
                <p className="text-xs text-[var(--neon-danger)]">{error}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => resolve('RESOLVED_REFUND')}
                  disabled={resolving}
                  className="rounded-lg bg-[var(--neon-cyan)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] disabled:opacity-50"
                >
                  Mark refund expected
                </button>
                <button
                  onClick={() => resolve('RESOLVED_NO_REFUND')}
                  disabled={resolving}
                  className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-muted)] disabled:opacity-50"
                >
                  Close without refund
                </button>
                <button
                  onClick={() => {
                    setShowResolve(false);
                    setNote('');
                    setError('');
                  }}
                  disabled={resolving}
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-dim)]">
                Note: this only records the outcome. The actual refund (if any) is issued
                by the seller via the refund button on their order — not by closing this dispute.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
