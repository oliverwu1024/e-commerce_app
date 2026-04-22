'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useInboxStore } from '@/stores/inbox';
import MessageThread from '@/components/MessageThread';
import { formatPrice } from '@/types/listings';
import { ORDER_STATUS_STYLES } from '@/types/orders';
import type {
  InboxThread,
  InboxThreadsResponse,
} from '@/types/notifications';

export default function MessagesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const refreshCounts = useInboxStore((s) => s.fetchCounts);

  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<InboxThreadsResponse>('/api/inbox/threads');
      setThreads(data.threads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  function toggleActive(orderId: string) {
    // Opening a thread marks those messages read server-side when the
    // MessageThread component fetches them. Locally we also zero the
    // unread count so the UI is immediate, and refresh the navbar counts.
    setActiveOrderId((curr) => {
      const next = curr === orderId ? null : orderId;
      if (next) {
        setThreads((t) =>
          t.map((x) => (x.orderId === orderId ? { ...x, unreadCount: 0 } : x)),
        );
        // Fire-and-forget nav refresh; MessageThread's GET will trigger
        // the actual mark-read on the server.
        setTimeout(() => refreshCounts(), 300);
      }
      return next;
    });
  }

  if (!currentUser) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Messages</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Conversations with your buyers and sellers, grouped by order.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchThreads}
          disabled={loading}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && threads.length === 0 ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          No conversations yet. Messages appear here once you or a seller starts a thread on an order.
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {threads.map((t) => {
            const open = activeOrderId === t.orderId;
            const statusStyle = ORDER_STATUS_STYLES[t.orderStatus];
            const imageUrl = t.listing.images[0]?.url;
            return (
              <li
                key={t.orderId}
                className={`rounded-xl border bg-white ${
                  t.unreadCount > 0 && !open ? 'border-blue-300' : 'border-zinc-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleActive(t.orderId)}
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-zinc-50 rounded-xl"
                  aria-expanded={open}
                >
                  <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={t.listing.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-900 truncate">
                        {t.counterparty.username}
                      </p>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusStyle.bg}`}>
                        {statusStyle.label}
                      </span>
                      {t.unreadCount > 0 && !open && (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 truncate">
                      {t.listing.title} · {formatPrice(t.amount)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-700 truncate">
                      {t.lastMessage.fromMe && <span className="text-zinc-400">You: </span>}
                      {t.lastMessage.content}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] text-zinc-400">
                      {formatRelative(t.lastMessage.createdAt)}
                    </span>
                    <svg
                      className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-zinc-200 bg-zinc-50 p-4">
                    <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
                      <span>
                        Conversation on{' '}
                        <Link
                          href={
                            t.role === 'buyer'
                              ? `/dashboard?tab=purchases&order=${t.orderId}`
                              : `/dashboard?tab=sales&order=${t.orderId}`
                          }
                          className="text-blue-600 hover:underline"
                        >
                          order {t.orderId.slice(0, 8)}…
                        </Link>
                      </span>
                      <Link
                        href={`/listings/${t.listing.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        View listing →
                      </Link>
                    </div>
                    <MessageThread
                      orderId={t.orderId}
                      currentUserId={currentUser.id}
                      otherPartyName={t.counterparty.username}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(new Date(iso));
}
