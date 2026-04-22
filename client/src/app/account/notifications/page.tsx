'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useInboxStore } from '@/stores/inbox';
import {
  type Notification,
  type NotificationsResponse,
  notificationHref,
} from '@/types/notifications';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const refreshCounts = useInboxStore((s) => s.fetchCounts);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<NotificationsResponse>(
        `/api/notifications?page=${p}&limit=20`,
      );
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(page);
  }, [page, fetchPage]);

  async function handleMarkAll() {
    setMarkingAll(true);
    try {
      await api('/api/notifications/mark-read', {
        method: 'PUT',
        body: JSON.stringify({ all: true }),
      });
      await fetchPage(page);
      refreshCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark all read');
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleClickNotification(n: Notification) {
    if (n.readAt) return;
    // Optimistic: flip it locally so the UI doesn't lag while the request
    // runs. Navigate via the Link href in the parent.
    setNotifications((curr) =>
      curr.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api('/api/notifications/mark-read', {
        method: 'PUT',
        body: JSON.stringify({ ids: [n.id] }),
      });
      refreshCounts();
    } catch {
      // If the mark-read fails, the count will reconcile on the next poll.
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Notifications</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : 'All caught up.'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleMarkAll}
          disabled={markingAll || unreadCount === 0}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {markingAll ? 'Marking...' : 'Mark all as read'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && notifications.length === 0 ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-zinc-100 animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          No notifications yet. Activity on your orders, messages, and reviews will appear here.
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {notifications.map((n) => {
            const href = notificationHref(n);
            const isUnread = !n.readAt;
            return (
              <li key={n.id}>
                <Link
                  href={href}
                  onClick={() => handleClickNotification(n)}
                  className={`block rounded-lg border p-3 transition-colors ${
                    isUnread
                      ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
                      : 'border-zinc-200 bg-white hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900">
                        {isUnread && (
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-600 align-middle"
                            aria-hidden="true"
                          />
                        )}
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-700 break-words">{n.body}</p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-zinc-400">
                      {formatRelative(n.createdAt)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}
