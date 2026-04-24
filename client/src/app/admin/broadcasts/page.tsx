'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

type Audience =
  | 'ALL_VERIFIED'
  | 'ALL_SELLERS'
  | 'BUSINESS_SELLERS'
  | 'PERSONAL_SELLERS'
  | 'SELLERS_NO_PAYMENT'
  | 'CUSTOM_EMAILS';

type Broadcast = {
  id: string;
  subject: string;
  body: string;
  audience: Audience;
  targetEmails: string | null;
  channelEmail: boolean;
  channelInApp: boolean;
  audienceCount: number;
  sentCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  sentBy: { id: string; username: string };
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  ALL_VERIFIED: 'All verified users',
  ALL_SELLERS: 'All sellers',
  BUSINESS_SELLERS: 'Business sellers only',
  PERSONAL_SELLERS: 'Personal sellers (with listings)',
  SELLERS_NO_PAYMENT: 'Sellers without a connected payment account',
  CUSTOM_EMAILS: 'Specific emails',
};

export default function AdminBroadcastsPage() {
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
  const [history, setHistory] = useState<Broadcast[]>([]);

  const loadHistory = useCallback(async () => {
    const res = await api<{ broadcasts: Broadcast[] }>('/api/admin/broadcasts');
    setHistory(res.broadcasts);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Broadcasts</h1>
        <Link href="/admin" className="text-sm text-[var(--text-muted)] hover:text-[var(--neon-cyan)]">
          ← Admin home
        </Link>
      </div>

      <ComposeForm onSent={loadHistory} />

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Recent broadcasts
      </h2>
      <div className="mt-3 space-y-3">
        {history.length === 0 && (
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 text-sm text-[var(--text-muted)]">
            Nothing sent yet.
          </p>
        )}
        {history.map((b) => (
          <HistoryRow key={b.id} broadcast={b} />
        ))}
      </div>
    </div>
  );
}

function ComposeForm({ onSent }: { onSent: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('ALL_SELLERS');
  const [targetEmails, setTargetEmails] = useState('');
  const [channelEmail, setChannelEmail] = useState(true);
  const [channelInApp, setChannelInApp] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ count: number; sample: { email: string; name: string }[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  function payload() {
    return {
      subject: subject.trim(),
      body: body.trim(),
      audience,
      targetEmails: audience === 'CUSTOM_EMAILS' ? targetEmails.trim() : undefined,
      channelEmail,
      channelInApp,
    };
  }

  async function doPreview() {
    setError('');
    setResult(null);
    setPreviewing(true);
    try {
      const res = await api<{ count: number; sample: { email: string; name: string }[] }>(
        '/api/admin/broadcasts/preview',
        { method: 'POST', body: JSON.stringify(payload()) },
      );
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function doSend() {
    if (!preview) {
      setError('Run preview first so you know who this hits.');
      return;
    }
    if (!confirm(`Send to ${preview.count} recipient(s)? This cannot be undone.`)) return;
    setError('');
    setResult(null);
    setSending(true);
    try {
      const res = await api<{
        broadcastId: string;
        audienceCount: number;
        emailsSent: number;
        emailsFailed: number;
        notificationsSent: number;
      }>('/api/admin/broadcasts', {
        method: 'POST',
        body: JSON.stringify(payload()),
      });
      setResult(
        `Sent. ${res.emailsSent} emails delivered, ${res.emailsFailed} failed, ${res.notificationsSent} in-app notifications created.`,
      );
      setSubject('');
      setBody('');
      setTargetEmails('');
      setPreview(null);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">New broadcast</h2>

      <div className="mt-4 space-y-4">
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Audience
          </label>
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as Audience);
              setPreview(null);
            }}
            className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-2 text-sm text-[var(--text-primary)]"
          >
            {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </option>
            ))}
          </select>
        </div>

        {audience === 'CUSTOM_EMAILS' && (
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Emails (comma, semicolon, or newline separated)
            </label>
            <textarea
              value={targetEmails}
              onChange={(e) => {
                setTargetEmails(e.target.value);
                setPreview(null);
              }}
              rows={3}
              maxLength={5000}
              placeholder="alice@example.com, bob@example.com"
              className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-2 text-sm text-[var(--text-primary)] font-mono"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={channelEmail}
              onChange={(e) => setChannelEmail(e.target.checked)}
            />
            Send email
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={channelInApp}
              onChange={(e) => setChannelInApp(e.target.checked)}
            />
            In-app notification
          </label>
        </div>

        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-2 text-sm text-[var(--text-primary)]"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Body (HTML allowed)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            maxLength={20000}
            placeholder="Plain text or simple HTML. Body is wrapped with a 'Hi {name},' salutation and signed by ElectroMarket."
            className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-2 text-sm text-[var(--text-primary)]"
          />
        </div>

        {error && <p className="text-xs text-[var(--neon-danger)]">{error}</p>}
        {result && <p className="text-xs text-[var(--neon-cyan)]">{result}</p>}

        {preview && (
          <div className="rounded border border-[var(--neon-cyan)]/40 bg-[var(--tint-cyan)] p-3 text-xs text-[var(--text-primary)]">
            Will send to <strong>{preview.count}</strong> recipient(s).
            {preview.sample.length > 0 && (
              <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                {preview.sample.map((s) => (
                  <li key={s.email}>{s.email} ({s.name})</li>
                ))}
                {preview.count > preview.sample.length && (
                  <li className="text-[var(--text-dim)]">…and {preview.count - preview.sample.length} more</li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={doPreview}
            disabled={previewing || sending || !subject.trim() || !body.trim()}
            className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            {previewing ? 'Counting…' : 'Preview audience'}
          </button>
          <button
            onClick={doSend}
            disabled={sending || !preview || preview.count === 0}
            className="rounded-lg bg-[var(--neon-cyan)] px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-dim)]">
          Tip: large audiences take a while — Resend is paced at 5/sec to stay under their rate limit.
          Don&apos;t close this tab while sending.
        </p>
      </div>
    </section>
  );
}

function HistoryRow({ broadcast }: { broadcast: Broadcast }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{broadcast.subject}</p>
          <p className="mt-0.5 text-[var(--text-muted)]">
            {AUDIENCE_LABEL[broadcast.audience]} · {broadcast.audienceCount} recipient(s) ·{' '}
            {broadcast.channelEmail && 'email'}
            {broadcast.channelEmail && broadcast.channelInApp && ' + '}
            {broadcast.channelInApp && 'in-app'}
          </p>
          <p className="mt-0.5 text-[var(--text-dim)]">
            by {broadcast.sentBy.username} · {new Date(broadcast.createdAt).toLocaleString()}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            broadcast.status === 'DONE'
              ? 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
              : broadcast.status === 'FAILED'
                ? 'bg-[var(--tint-danger)] text-[var(--neon-danger)]'
                : 'bg-[var(--tint-amber)] text-[var(--neon-amber)]'
          }`}
        >
          {broadcast.status} · {broadcast.sentCount} sent
          {broadcast.failedCount > 0 && ` · ${broadcast.failedCount} failed`}
        </span>
      </div>
    </div>
  );
}
