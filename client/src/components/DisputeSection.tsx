'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  type Order,
  type DisputeDetail,
  type DisputeMessage,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
} from '@/types/orders';
import Avatar from '@/components/Avatar';

type Props = {
  order: Order;
  currentUserId: string;
  role: 'buyer' | 'seller';
  onChange: () => void;
};

const STATUS_BADGE_STYLES: Record<DisputeDetail['status'], string> = {
  OPEN: 'bg-[var(--tint-amber)] text-[var(--neon-amber)] border border-[var(--neon-amber)]/40',
  RESOLVED_BY_SELLER:
    'bg-[var(--tint-cyan)] text-[var(--neon-cyan)] border border-[var(--neon-cyan)]/40',
  RESOLVED_REFUND:
    'bg-[var(--tint-green)] text-[var(--neon-green)] border border-[var(--neon-green)]/40',
  RESOLVED_NO_REFUND:
    'bg-[var(--bg-panel-hi)] text-[var(--text-dim)] border border-[var(--border-subtle)]',
  WITHDRAWN:
    'bg-[var(--bg-panel-hi)] text-[var(--text-dim)] border border-[var(--border-subtle)]',
};

export default function DisputeSection({ order, currentUserId, role, onChange }: Props) {
  const [dispute, setDispute] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);

  const fetchDispute = useCallback(async () => {
    setError('');
    try {
      const data = await api<{ dispute: DisputeDetail }>(
        `/api/orders/${order.id}/disputes`,
      );
      setDispute(data.dispute);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dispute');
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    fetchDispute();
  }, [fetchDispute]);

  async function handlePostMessage() {
    const content = messageInput.trim();
    if (!content) return;
    setPosting(true);
    setError('');
    try {
      const { message } = await api<{ message: DisputeMessage }>(
        `/api/orders/${order.id}/disputes/messages`,
        { method: 'POST', body: JSON.stringify({ content }) },
      );
      setDispute((curr) =>
        curr ? { ...curr, messages: [...curr.messages, message] } : curr,
      );
      setMessageInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post message');
    } finally {
      setPosting(false);
    }
  }

  async function handleAction(
    path: string,
    body?: Record<string, unknown>,
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setActioning(true);
    setError('');
    try {
      await api(`/api/orders/${order.id}/disputes/${path}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      await fetchDispute();
      onChange();
      setShowResolveForm(false);
      setResolutionNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 text-xs text-[var(--text-muted)]">
        Loading dispute…
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="rounded-lg border border-[var(--neon-danger)]/30 bg-[var(--tint-danger)] p-3 text-xs text-[var(--neon-danger)]">
        {error || 'Dispute not available'}
      </div>
    );
  }

  const isOpen = dispute.status === 'OPEN';
  const isSellerResolved = dispute.status === 'RESOLVED_BY_SELLER';
  const isFinal =
    dispute.status === 'RESOLVED_REFUND' ||
    dispute.status === 'RESOLVED_NO_REFUND' ||
    dispute.status === 'WITHDRAWN';
  const canPost = isOpen || isSellerResolved;

  return (
    <div className="rounded-lg border border-[var(--neon-amber)]/30 bg-[var(--tint-amber)]/30 p-4 space-y-3">
      {/* Header — reason, status badge */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--neon-amber)]">
            Dispute
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            · {DISPUTE_REASON_LABELS[dispute.reason]}
          </span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            STATUS_BADGE_STYLES[dispute.status]
          }`}
        >
          {DISPUTE_STATUS_LABELS[dispute.status]}
        </span>
      </div>

      {/* Buyer's original description — always visible */}
      <div className="rounded bg-[var(--bg-panel)] p-3 text-xs">
        <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
          Filed by {dispute.buyer.username} on{' '}
          {new Date(dispute.createdAt).toLocaleDateString()}
          {dispute.reopenedAt && (
            <span className="ml-2 text-[var(--neon-amber)]">
              · reopened {new Date(dispute.reopenedAt).toLocaleDateString()}
            </span>
          )}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-[var(--text-primary)]">
          {dispute.description}
        </p>
      </div>

      {/* Resolution note (when present) */}
      {dispute.resolutionNote && (
        <div className="rounded border-l-2 border-[var(--neon-cyan)] bg-[var(--bg-panel)] p-3 text-xs">
          <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
            Resolution {dispute.resolvedAt
              ? `· ${new Date(dispute.resolvedAt).toLocaleString()}`
              : ''}
            {dispute.resolvedBy && ` · by ${dispute.resolvedBy.username}`}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[var(--text-primary)]">
            {dispute.resolutionNote}
          </p>
        </div>
      )}

      {/* Message thread */}
      {dispute.messages.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
            Conversation
          </p>
          <div className="space-y-2">
            {dispute.messages.map((m) => {
              const mine = m.fromUser.id === currentUserId;
              return (
                <div
                  key={m.id}
                  className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}
                >
                  <Avatar
                    src={m.fromUser.avatarUrl}
                    username={m.fromUser.username}
                    size="sm"
                  />
                  <div
                    className={`max-w-[80%] rounded-lg p-2 text-xs ${
                      mine
                        ? 'bg-[var(--tint-cyan)] text-[var(--text-primary)]'
                        : 'bg-[var(--bg-panel)] text-[var(--text-primary)]'
                    }`}
                  >
                    <p className="text-[10px] text-[var(--text-dim)]">
                      {m.fromUser.username} ·{' '}
                      {new Date(m.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Post box */}
      {canPost && (
        <div className="space-y-2">
          <textarea
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder="Add to the conversation…"
            rows={2}
            maxLength={2000}
            disabled={posting}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2 text-xs text-[var(--text-primary)]"
          />
          <div className="flex justify-end">
            <button
              onClick={handlePostMessage}
              disabled={posting || !messageInput.trim()}
              className="btn-cyber-primary text-xs disabled:opacity-50"
            >
              {posting ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-[var(--neon-danger)]">{error}</p>
      )}

      {/* Actions — role + status dependent */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
        {role === 'buyer' && isOpen && (
          <button
            onClick={() =>
              handleAction('withdraw', undefined, 'Withdraw this dispute?')
            }
            disabled={actioning}
            className="btn-cyber-outline text-xs disabled:opacity-50"
          >
            Withdraw
          </button>
        )}
        {role === 'buyer' && isSellerResolved && !dispute.reopenedAt && (
          <button
            onClick={() =>
              handleAction(
                'reopen',
                undefined,
                'Reopen this dispute? You can only do this once.',
              )
            }
            disabled={actioning}
            className="btn-cyber-primary text-xs disabled:opacity-50"
          >
            Reopen dispute
          </button>
        )}
        {role === 'seller' && isOpen && !showResolveForm && (
          <button
            onClick={() => setShowResolveForm(true)}
            disabled={actioning}
            className="btn-cyber-primary text-xs disabled:opacity-50"
          >
            Mark resolved
          </button>
        )}
        {!isFinal && (
          <Link
            href={`/contact?subject=${encodeURIComponent(`Dispute on order ${order.id.slice(0, 8)}`)}`}
            className="btn-cyber-outline text-xs"
          >
            Contact admin
          </Link>
        )}
      </div>

      {/* Seller resolve form */}
      {role === 'seller' && isOpen && showResolveForm && (
        <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
          <p className="text-xs font-medium text-[var(--text-primary)]">
            Close this dispute
          </p>
          <textarea
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            placeholder="How did you resolve it? (optional but helpful for the buyer)"
            rows={3}
            maxLength={2000}
            disabled={actioning}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-2 text-xs text-[var(--text-primary)]"
          />
          <p className="text-[10px] text-[var(--text-dim)]">
            The buyer can reopen once if they disagree.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                handleAction(
                  'resolve-by-seller',
                  resolutionNote.trim()
                    ? { resolutionNote: resolutionNote.trim() }
                    : {},
                )
              }
              disabled={actioning}
              className="btn-cyber-primary text-xs disabled:opacity-50"
            >
              {actioning ? 'Closing…' : 'Confirm'}
            </button>
            <button
              onClick={() => {
                setShowResolveForm(false);
                setResolutionNote('');
              }}
              disabled={actioning}
              className="btn-cyber-ghost text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
