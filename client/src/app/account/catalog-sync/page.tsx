'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type {
  CatalogLink,
  CatalogLinkStatus,
  CatalogSyncEvent,
  CatalogSyncStatusResponse,
} from '@/types/squareCatalog';

// Per-listing-status badge styling. Same colour vocabulary the rest of the
// app uses (cyan = good, danger = bad, muted = idle).
const STATUS_STYLE: Record<CatalogLinkStatus, { label: string; cls: string }> = {
  SYNCED: {
    label: 'Synced',
    cls: 'border-[var(--neon-success)]/40 bg-[var(--tint-success)] text-[var(--neon-success)]',
  },
  PENDING: {
    label: 'Pending',
    cls: 'border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] text-[var(--neon-cyan)]',
  },
  SYNCING: {
    label: 'Syncing…',
    cls: 'border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] text-[var(--neon-cyan)]',
  },
  ERROR: {
    label: 'Error',
    cls: 'border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] text-[var(--neon-danger)]',
  },
};

export default function CatalogSyncPage() {
  const [data, setData] = useState<CatalogSyncStatusResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<CatalogSyncStatusResponse>('/api/square-catalog/sync');
      setData(res);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 8s while there are pending/syncing rows so the badges
    // tick from PENDING → SYNCED without a manual refresh.
    const id = setInterval(() => {
      void load();
    }, 8_000);
    return () => clearInterval(id);
  }, [load]);

  async function toggleSync(enabled: boolean) {
    setBusy('toggle');
    setBanner(null);
    try {
      await api('/api/square-catalog/sync/toggle', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      setBanner({
        kind: 'success',
        message: enabled
          ? 'Square Catalog sync enabled. Existing listings are queuing now.'
          : 'Square Catalog sync paused.',
      });
      await load();
    } catch (err) {
      setBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to update',
      });
    } finally {
      setBusy(null);
    }
  }

  async function resyncAll() {
    if (!data?.links.length) return;
    setBusy('resync-all');
    setBanner(null);
    try {
      // Re-toggle ON to trigger the bulk backfill path. Cheap UX shortcut
      // — the same code path runs on first-enable, so we don't duplicate
      // logic on the server.
      await api('/api/square-catalog/sync/toggle', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true }),
      });
      setBanner({ kind: 'success', message: 'Re-syncing all listings.' });
      await load();
    } catch (err) {
      setBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to re-sync',
      });
    } finally {
      setBusy(null);
    }
  }

  async function resyncOne(listingId: string) {
    setBusy(`resync-${listingId}`);
    setBanner(null);
    try {
      await api(`/api/square-catalog/sync/listings/${listingId}/resync`, {
        method: 'POST',
      });
      setBanner({ kind: 'success', message: 'Listing queued for re-sync.' });
      await load();
    } catch (err) {
      setBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to enqueue',
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Skeleton />;
  if (error) {
    return (
      <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-4 text-sm text-[var(--neon-danger)]">
        {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Square Catalog sync</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          When enabled, every listing you create or edit is mirrored to your Square Catalog,
          and inventory changes flow both ways. Useful if you also sell in-person via Square POS.
        </p>
      </header>

      {banner && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            banner.kind === 'success'
              ? 'border-[var(--neon-success)]/40 bg-[var(--tint-success)] text-[var(--neon-success)]'
              : 'border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] text-[var(--neon-danger)]'
          }`}
        >
          {banner.message}
        </div>
      )}

      <PrerequisitePanel data={data} />

      <ToggleSection
        data={data}
        busy={busy === 'toggle'}
        onToggle={toggleSync}
        onResyncAll={resyncAll}
        resyncBusy={busy === 'resync-all'}
      />

      {data.enabled && (
        <>
          <SummarySection data={data} />
          <LinksTable
            links={data.links}
            busyId={busy}
            onResync={resyncOne}
          />
          <RecentEvents events={data.recentEvents} />
        </>
      )}
    </div>
  );
}

function PrerequisitePanel({ data }: { data: CatalogSyncStatusResponse }) {
  if (data.squareConnected) return null;
  return (
    <div className="rounded-lg border border-[var(--neon-warn)]/40 bg-[var(--tint-warn)] p-4 text-sm text-[var(--neon-warn)]">
      <p className="font-medium">Connect Square first</p>
      <p className="mt-1">
        You need an active Square account to enable Catalog sync. {' '}
        <Link href="/account/payments" className="underline">
          Go to Payments to connect Square
        </Link>
        .
      </p>
    </div>
  );
}

function ToggleSection({
  data,
  busy,
  onToggle,
  onResyncAll,
  resyncBusy,
}: {
  data: CatalogSyncStatusResponse;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onResyncAll: () => void;
  resyncBusy: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Sync listings to Square Catalog
          </p>
          {data.enabled ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Active{data.enabledAt ? ` since ${formatDate(data.enabledAt)}` : ''}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Off — your listings are not mirrored to Square.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {data.enabled && (
            <button
              type="button"
              onClick={onResyncAll}
              disabled={resyncBusy}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--neon-cyan)] disabled:opacity-50"
            >
              {resyncBusy ? 'Re-syncing…' : 'Re-sync all'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggle(!data.enabled)}
            disabled={busy || (!data.enabled && !data.squareConnected)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              data.enabled
                ? 'bg-[var(--tint-danger)] text-[var(--neon-danger)] hover:bg-[var(--neon-danger)] hover:text-white'
                : 'bg-[var(--neon-cyan)] text-[var(--btn-primary-text)] hover:opacity-90'
            }`}
          >
            {busy ? 'Saving…' : data.enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummarySection({ data }: { data: CatalogSyncStatusResponse }) {
  const stats = [
    { label: 'Total tracked', value: data.summary.total, tone: 'muted' },
    { label: 'Synced', value: data.summary.synced, tone: 'success' },
    { label: 'In progress', value: data.summary.pending, tone: 'cyan' },
    { label: 'Errors', value: data.summary.error, tone: 'danger' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4"
        >
          <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
          <p
            className={`mt-1 text-2xl font-bold ${
              s.tone === 'success'
                ? 'text-[var(--neon-success)]'
                : s.tone === 'danger'
                  ? 'text-[var(--neon-danger)]'
                  : s.tone === 'cyan'
                    ? 'text-[var(--neon-cyan)]'
                    : 'text-[var(--text-primary)]'
            }`}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function LinksTable({
  links,
  busyId,
  onResync,
}: {
  links: CatalogLink[];
  busyId: string | null;
  onResync: (listingId: string) => void;
}) {
  if (links.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-center text-sm text-[var(--text-muted)]">
        No listings tracked yet. Create or edit a listing to start syncing.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="px-4 py-2">Listing</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Last synced</th>
            <th className="px-4 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {links.map((l) => {
            const style = STATUS_STYLE[l.status];
            return (
              <tr
                key={l.listingId}
                className="border-b border-[var(--border-subtle)] last:border-b-0"
              >
                <td className="px-4 py-3 align-top">
                  <Link
                    href={`/listings/${l.listingId}`}
                    className="text-sm text-[var(--neon-cyan)] hover:underline"
                  >
                    {l.listingId.slice(0, 8)}…
                  </Link>
                  {l.lastError && (
                    <p className="mt-1 max-w-md text-xs text-[var(--neon-danger)]">
                      {l.lastError}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${style.cls}`}
                  >
                    {style.label}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-xs text-[var(--text-muted)]">
                  {l.lastSyncedAt ? formatRelative(l.lastSyncedAt) : '—'}
                </td>
                <td className="px-4 py-3 align-top">
                  <button
                    type="button"
                    onClick={() => onResync(l.listingId)}
                    disabled={busyId === `resync-${l.listingId}`}
                    className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs hover:border-[var(--neon-cyan)] disabled:opacity-50"
                  >
                    {busyId === `resync-${l.listingId}` ? 'Queueing…' : 'Re-sync'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentEvents({ events }: { events: CatalogSyncEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
        Recent sync events
      </h3>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
        <ul className="divide-y divide-[var(--border-subtle)]">
          {events.map((e) => (
            <li key={e.id} className="px-4 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span className={outcomeClass(e.outcome)}>
                  {e.outcome} · {e.kind} · {e.action}
                </span>
                <span className="text-[var(--text-muted)]">
                  {formatRelative(e.createdAt)}
                </span>
              </div>
              {e.message && (
                <p className="mt-1 text-[var(--text-muted)]">{e.message}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function outcomeClass(outcome: CatalogSyncEvent['outcome']): string {
  if (outcome === 'SUCCESS') return 'font-mono text-[var(--neon-success)]';
  if (outcome === 'FAILURE') return 'font-mono text-[var(--neon-danger)]';
  if (outcome === 'CONFLICT') return 'font-mono text-[var(--neon-warn)]';
  return 'font-mono text-[var(--text-muted)]';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString();
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-1/3 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--bg-panel)]" />
      <div className="h-48 animate-pulse rounded-lg bg-[var(--bg-panel)]" />
    </div>
  );
}
