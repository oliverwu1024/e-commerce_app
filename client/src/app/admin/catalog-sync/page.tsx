'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

type AdminHealthResponse = {
  sellers: Array<{
    id: string;
    username: string;
    squareCatalogSyncEnabledAt: string | null;
    _count: { squareSyncEvents: number };
  }>;
  outcomesLast24h: Array<{
    outcome: 'STARTED' | 'SUCCESS' | 'FAILURE' | 'CONFLICT' | 'SKIPPED';
    _count: { _all: number };
  }>;
  failuresLast24h: Array<{
    id: string;
    sellerId: string;
    listingId: string | null;
    kind: string;
    action: string;
    message: string | null;
    errorCode: string | null;
    createdAt: string;
  }>;
  metrics: {
    counters: Record<string, number>;
    latencies: Record<string, { count: number; avgMs: number; maxMs: number }>;
  };
};

export default function AdminCatalogSyncPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<AdminHealthResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminHealthResponse>('/api/square-catalog/admin/health'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;
  if (user.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Access denied</h1>
        <Link href="/" className="mt-2 text-[var(--neon-cyan)] hover:underline">
          Go home
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm text-[var(--neon-danger)]">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="h-32 animate-pulse rounded bg-[var(--bg-panel)]" />
      </div>
    );
  }

  async function rebuildFeatured() {
    setBusy('rebuild');
    setBanner(null);
    try {
      const r = await api<{ upserted: number; removed: number; errors?: string[] }>(
        '/api/square-catalog/admin/featured/rebuild',
        { method: 'POST' },
      );
      if (r.errors && r.errors.length > 0) {
        setBanner({ kind: 'error', message: `Rebuild had errors: ${r.errors.join('; ')}` });
      } else {
        setBanner({
          kind: 'success',
          message: `Rebuild done: ${r.upserted} upserted, ${r.removed} removed`,
        });
      }
    } catch (err) {
      setBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Rebuild failed',
      });
    } finally {
      setBusy(null);
    }
  }

  async function forceResync(sellerId: string) {
    setBusy(`resync-${sellerId}`);
    setBanner(null);
    try {
      const r = await api<{ enqueued: number }>(
        `/api/square-catalog/admin/sellers/${sellerId}/resync`,
        { method: 'POST' },
      );
      setBanner({
        kind: 'success',
        message: `Enqueued ${r.enqueued} listings for resync.`,
      });
      await load();
    } catch (err) {
      setBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Resync failed',
      });
    } finally {
      setBusy(null);
    }
  }

  // Pivot the outcomes array into a lookup so each card is one line.
  const counts: Record<string, number> = {};
  for (const o of data.outcomesLast24h) counts[o.outcome] = o._count._all;
  const totals = (counts.SUCCESS ?? 0) + (counts.FAILURE ?? 0) + (counts.CONFLICT ?? 0) + (counts.SKIPPED ?? 0);
  const successRate =
    totals === 0
      ? 1
      : ((counts.SUCCESS ?? 0) + (counts.SKIPPED ?? 0)) / totals;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Square Catalog sync</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Per-seller mirror health + manual force-resync + Featured rail rebuild.
          </p>
        </div>
        <button
          type="button"
          onClick={rebuildFeatured}
          disabled={busy === 'rebuild'}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--neon-cyan)] disabled:opacity-50"
        >
          {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild Featured rail'}
        </button>
      </header>

      {banner && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            banner.kind === 'success'
              ? 'border-[var(--neon-success)]/40 bg-[var(--tint-success)] text-[var(--neon-success)]'
              : 'border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] text-[var(--neon-danger)]'
          }`}
        >
          {banner.message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Sellers enabled" value={data.sellers.length} />
        <Stat label="Successes 24h" value={counts.SUCCESS ?? 0} tone="success" />
        <Stat label="Failures 24h" value={counts.FAILURE ?? 0} tone="danger" />
        <Stat label="Conflicts 24h" value={counts.CONFLICT ?? 0} tone="warn" />
        <Stat label="Success rate" value={`${Math.round(successRate * 100)}%`} />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Sellers with sync enabled
      </h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase text-[var(--text-muted)]">
              <th className="px-4 py-2">Seller</th>
              <th className="px-4 py-2">Enabled at</th>
              <th className="px-4 py-2">Events lifetime</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.sellers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                  No sellers have enabled catalog sync.
                </td>
              </tr>
            ) : (
              data.sellers.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                  <td className="px-4 py-2">
                    <Link href={`/sellers/${s.username}`} className="text-[var(--neon-cyan)] hover:underline">
                      @{s.username}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--text-muted)]">
                    {s.squareCatalogSyncEnabledAt
                      ? new Date(s.squareCatalogSyncEnabledAt).toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-4 py-2">{s._count.squareSyncEvents}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => forceResync(s.id)}
                      disabled={busy === `resync-${s.id}`}
                      className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs hover:border-[var(--neon-cyan)] disabled:opacity-50"
                    >
                      {busy === `resync-${s.id}` ? 'Queueing…' : 'Force resync'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Failures in the last 24h
      </h2>
      {data.failuresLast24h.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-center text-sm text-[var(--text-muted)]">
          Nothing failed. Nice.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
          {data.failuresLast24h.map((f) => (
            <li key={f.id} className="px-4 py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[var(--neon-danger)]">
                  {f.kind}/{f.action}
                  {f.errorCode ? ` · ${f.errorCode}` : ''}
                </span>
                <span className="text-[var(--text-muted)]">
                  {new Date(f.createdAt).toLocaleTimeString()}
                </span>
              </div>
              {f.message && <p className="mt-1 text-[var(--text-muted)]">{f.message}</p>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        In-process metrics
      </h2>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
          <p className="mb-2 text-xs font-semibold uppercase text-[var(--text-muted)]">Counters</p>
          <pre className="overflow-x-auto text-xs">
            {JSON.stringify(data.metrics.counters, null, 2)}
          </pre>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
          <p className="mb-2 text-xs font-semibold uppercase text-[var(--text-muted)]">Latency (ms)</p>
          <pre className="overflow-x-auto text-xs">
            {JSON.stringify(data.metrics.latencies, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'success' | 'danger' | 'warn';
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          tone === 'success'
            ? 'text-[var(--neon-success)]'
            : tone === 'danger'
              ? 'text-[var(--neon-danger)]'
              : tone === 'warn'
                ? 'text-[var(--neon-warn)]'
                : 'text-[var(--text-primary)]'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
