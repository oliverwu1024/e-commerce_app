'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

type ContactStatus = 'NEW' | 'REPLIED' | 'CLOSED';

type ContactReply = {
  id: string;
  body: string;
  sentAt: string;
  direction: 'OUTBOUND' | 'INBOUND';
  // Null when the reply came from the customer via the inbound webhook.
  admin: { id: string; username: string } | null;
};

type ContactSubmission = {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  message: string;
  status: ContactStatus;
  createdAt: string;
  closedAt: string | null;
  closedBy: { id: string; username: string } | null;
  replies: ContactReply[];
};

const STATUS_FILTERS: { value: ContactStatus; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'REPLIED', label: 'Replied' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function AdminContactPage() {
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
      </div>
    );
  }
  return <Loaded />;
}

function Loaded() {
  const [filter, setFilter] = useState<ContactStatus>('NEW');
  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ submissions: ContactSubmission[] }>(
        `/api/admin/contact?status=${filter}`,
      );
      setSubmissions(res.submissions);
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
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Support inbox</h1>
        <Link href="/admin" className="text-sm text-[var(--text-muted)] hover:text-[var(--neon-cyan)]">
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
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {loading && <div className="h-32 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]" />}
        {!loading && submissions.length === 0 && (
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 text-sm text-[var(--text-muted)]">
            No {filter.toLowerCase()} submissions.
          </p>
        )}
        {submissions.map((s) => (
          <SubmissionCard key={s.id} submission={s} onAction={load} />
        ))}
      </div>
    </div>
  );
}

function SubmissionCard({
  submission,
  onAction,
}: {
  submission: ContactSubmission;
  onAction: () => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendReply() {
    if (!replyBody.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/contact/${submission.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      setReplyOpen(false);
      setReplyBody('');
      onAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!confirm('Close this submission? It will be hidden from the New / Replied lists.')) return;
    setBusy(true);
    try {
      await api(`/api/admin/contact/${submission.id}/close`, { method: 'POST' });
      onAction();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{submission.subject}</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            From <strong>{submission.fromName}</strong> &lt;{submission.fromEmail}&gt; · {new Date(submission.createdAt).toLocaleString()}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            submission.status === 'NEW'
              ? 'border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] text-[var(--neon-amber)]'
              : submission.status === 'REPLIED'
                ? 'border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
          }`}
        >
          {submission.status}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap rounded bg-[var(--bg-panel-hi)] p-3 text-xs text-[var(--text-primary)]">
        {submission.message}
      </p>

      {submission.replies.map((r) => {
        const inbound = r.direction === 'INBOUND';
        return (
          <div
            key={r.id}
            className={`mt-3 rounded border-l-2 p-3 text-xs ${
              inbound
                ? 'border-[var(--neon-amber)] bg-[var(--tint-amber)]/30'
                : 'border-[var(--neon-cyan)] bg-[var(--bg-panel-hi)]'
            }`}
          >
            <p className="text-[var(--text-muted)]">
              <strong className="text-[var(--text-primary)]">
                {inbound
                  ? `${submission.fromName} (customer)`
                  : (r.admin?.username ?? 'admin')}
              </strong>{' '}
              · {new Date(r.sentAt).toLocaleString()}
              {inbound && (
                <span className="ml-2 rounded-full border border-[var(--neon-amber)]/40 bg-[var(--tint-amber)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--neon-amber)]">
                  inbound
                </span>
              )}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[var(--text-primary)]">{r.body}</p>
          </div>
        );
      })}

      {submission.status !== 'CLOSED' && (
        <div className="mt-4">
          {!replyOpen ? (
            <div className="flex gap-2">
              <button
                onClick={() => setReplyOpen(true)}
                className="rounded-lg bg-[var(--neon-cyan)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)]"
              >
                Reply
              </button>
              <button
                onClick={close}
                disabled={busy}
                className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-muted)]"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={5}
                maxLength={5000}
                placeholder={`Reply to ${submission.fromName}…`}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-2 text-sm text-[var(--text-primary)]"
              />
              {error && <p className="text-xs text-[var(--neon-danger)]">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={sendReply}
                  disabled={busy || !replyBody.trim()}
                  className="rounded-lg bg-[var(--neon-cyan)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send reply'}
                </button>
                <button
                  onClick={() => {
                    setReplyOpen(false);
                    setReplyBody('');
                    setError('');
                  }}
                  disabled={busy}
                  className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-muted)]"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-dim)]">
                Reply sent from the platform&apos;s noreply address; customer&apos;s replies route
                back to your admin inbox via Reply-To.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
