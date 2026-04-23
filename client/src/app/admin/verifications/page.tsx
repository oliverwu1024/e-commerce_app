'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';
import type { PendingVerification } from '@/types/users';
import type { Pagination } from '@/types/listings';

type ListResponse = {
  users: PendingVerification[];
  pagination: Pagination;
};

export default function AdminVerificationsPage() {
  return (
    <ProtectedRoute>
      <AdminVerifications />
    </ProtectedRoute>
  );
}

function AdminVerifications() {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;
  if (user.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Access denied</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          You need admin privileges to view this page.{' '}
          <Link href="/" className="text-[var(--neon-cyan)] hover:underline">
            Go home
          </Link>
          .
        </p>
      </div>
    );
  }

  return <AdminVerificationsInner />;
}

function AdminVerificationsInner() {
  const [users, setUsers] = useState<PendingVerification[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingVerification | null>(null);

  const fetchList = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<ListResponse>(`/api/admin/verifications?page=${p}&limit=20`);
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load verifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList(page);
  }, [page, fetchList]);

  async function handleApprove(userId: string) {
    setActioningId(userId);
    setError('');
    try {
      await api<{ message: string }>(`/api/admin/verifications/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'APPROVE' }),
      });
      await fetchList(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setActioningId(null);
    }
  }

  async function handleReject(userId: string, reason: string) {
    setActioningId(userId);
    setError('');
    try {
      await api<{ message: string }>(`/api/admin/verifications/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'REJECT', reason }),
      });
      setRejectTarget(null);
      await fetchList(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setActioningId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">Pending ID Verifications</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Review submitted IDs for personal sellers. Approve to unlock listing creation.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-[var(--bg-panel-hi)] animate-pulse" />
          ))}
        </div>
      )}

      {!loading && users.length === 0 && (
        <div className="panel clip-corner mt-6 px-6 py-12 text-center">
          <p className="text-sm text-[var(--text-muted)]">No pending verifications.</p>
        </div>
      )}

      {!loading && users.length > 0 && (
        <div className="mt-6 space-y-3">
          {users.map((u) => (
            <article
              key={u.id}
              className="panel clip-corner flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {u.username}{' '}
                  <span className="font-normal text-[var(--text-muted)]">— {u.name}</span>
                </p>
                <p className="text-xs text-[var(--text-muted)]">{u.email}</p>
                <p className="mt-1 text-xs text-[var(--text-dim)]">
                  Submitted{' '}
                  {new Intl.DateTimeFormat('en-AU', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(u.idSubmittedAt ?? u.createdAt))}
                </p>
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                {u.idDocumentUrl ? (
                  <a
                    href={u.idDocumentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-cyber-outline text-xs"
                  >
                    View document
                  </a>
                ) : (
                  <span className="text-xs text-[var(--text-dim)]">No document</span>
                )}
                <button
                  type="button"
                  onClick={() => handleApprove(u.id)}
                  disabled={actioningId === u.id}
                  className="rounded-lg bg-[var(--neon-green)] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
                >
                  {actioningId === u.id ? '...' : 'Approve'}
                </button>
                <button
                  type="button"
                  onClick={() => setRejectTarget(u)}
                  disabled={actioningId === u.id}
                  className="rounded-lg border border-[var(--neon-danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--neon-danger)] hover:bg-[var(--tint-danger)] disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-cyber-outline disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            Page {page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="btn-cyber-outline disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {rejectTarget && (
        <RejectDialog
          target={rejectTarget}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => handleReject(rejectTarget.id, reason)}
          busy={actioningId === rejectTarget.id}
        />
      )}
    </div>
  );
}

function RejectDialog({
  target,
  onCancel,
  onConfirm,
  busy,
}: {
  target: PendingVerification;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="reject-title"
        className="panel clip-corner w-full max-w-md p-6"
      >
        <h3 id="reject-title" className="text-lg font-semibold text-[var(--text-primary)]">
          Reject ID for {target.username}
        </h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          The user will see this reason and can re-submit.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. Document is blurry, name doesn't match, expired"
          className="input-cyber mt-4 block w-full px-3 py-2 text-sm"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-cyber-outline"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || reason.trim().length === 0}
            className="rounded-lg bg-[var(--neon-danger)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
