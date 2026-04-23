'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import type {
  InquirySummary,
  InquiryListResponse,
} from '@/types/inquiries';

type InboxTab = 'orders' | 'inquiries';

const VALID_TABS: InboxTab[] = ['orders', 'inquiries'];

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesContent />
    </Suspense>
  );
}

function MessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: InboxTab =
    tabParam === 'inquiries' ? 'inquiries' : 'orders';

  const [activeTab, setActiveTab] = useState<InboxTab>(initialTab);

  useEffect(() => {
    const t = searchParams.get('tab');
    setActiveTab(t === 'inquiries' ? 'inquiries' : 'orders');
  }, [searchParams]);

  function selectTab(t: InboxTab) {
    setActiveTab(t);
    const params = new URLSearchParams();
    if (t !== 'orders') params.set('tab', t);
    router.replace(`/account/messages${params.size > 0 ? `?${params.toString()}` : ''}`);
  }

  const counts = useInboxStore((s) => s.counts);

  const tabs: { key: InboxTab; label: string; badge: number }[] = [
    { key: 'orders', label: 'Order messages', badge: counts.orderMessages ?? 0 },
    { key: 'inquiries', label: 'Inquiries', badge: counts.inquiryMessages ?? 0 },
  ];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Messages</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Conversations with your buyers and sellers — order chats and pre-purchase inquiries.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 border-b border-[var(--border-subtle)]">
        <div role="tablist" className="flex gap-6">
          {tabs.map((t) => {
            const selected = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectTab(t.key)}
                className={`flex items-center gap-2 pb-3 text-sm font-medium transition-colors ${
                  selected
                    ? 'border-b-2 border-[var(--neon-cyan)] text-[var(--neon-cyan)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{t.label}</span>
                {t.badge > 0 && (
                  <span className="rounded-full bg-[var(--neon-cyan)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--btn-primary-text)]">
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        {activeTab === 'orders' ? <OrdersInbox /> : <InquiriesInbox />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order-message inbox
// ---------------------------------------------------------------------------

function OrdersInbox() {
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
    setActiveOrderId((curr) => {
      const next = curr === orderId ? null : orderId;
      if (next) {
        setThreads((t) =>
          t.map((x) => (x.orderId === orderId ? { ...x, unreadCount: 0 } : x)),
        );
        setTimeout(() => refreshCounts(), 300);
      }
      return next;
    });
  }

  if (!currentUser) return null;

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
        {error}
      </div>
    );
  }

  if (loading && threads.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-[var(--bg-panel-hi)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="panel clip-corner p-8 text-center text-sm text-[var(--text-muted)]">
        No order conversations yet. Once you place or receive an order, the conversation thread
        appears here.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {threads.map((t) => {
        const open = activeOrderId === t.orderId;
        const statusStyle = ORDER_STATUS_STYLES[t.orderStatus];
        const imageUrl = t.listing.images[0]?.url;
        return (
          <li
            key={t.orderId}
            className={`rounded-xl border bg-[var(--bg-panel)] ${
              t.unreadCount > 0 && !open ? 'border-[var(--neon-cyan)]' : 'border-[var(--border-subtle)]'
            }`}
          >
            <button
              type="button"
              onClick={() => toggleActive(t.orderId)}
              className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-[var(--bg-panel-hi)]"
              aria-expanded={open}
            >
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--bg-panel-hi)]">
                {imageUrl ? (
                  <img src={imageUrl} alt={t.listing.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {t.counterparty.username}
                  </p>
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusStyle.bg}`}>
                    {statusStyle.label}
                  </span>
                  {t.unreadCount > 0 && !open && (
                    <span className="rounded-full bg-[var(--neon-cyan)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--btn-primary-text)]">
                      {t.unreadCount}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {t.listing.title} · {formatPrice(t.amount)}
                </p>
                <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                  {t.lastMessage.fromMe && <span className="text-[var(--text-dim)]">You: </span>}
                  {t.lastMessage.content}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] text-[var(--text-dim)]">
                  {formatRelative(t.lastMessage.createdAt)}
                </span>
                <svg
                  className={`h-4 w-4 text-[var(--text-dim)] transition-transform ${open ? 'rotate-180' : ''}`}
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
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4">
                <div className="mb-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>
                    Conversation on{' '}
                    <Link
                      href={
                        t.role === 'buyer'
                          ? `/dashboard?tab=in_purchases&order=${t.orderId}`
                          : `/dashboard?tab=in_sales&order=${t.orderId}`
                      }
                      className="text-[var(--neon-cyan)] hover:underline"
                    >
                      order {t.orderId.slice(0, 8)}…
                    </Link>
                  </span>
                  <Link
                    href={`/listings/${t.listing.id}`}
                    className="text-[var(--neon-cyan)] hover:underline"
                  >
                    View listing →
                  </Link>
                </div>
                <MessageThread
                  endpoint={`/api/orders/${t.orderId}/messages`}
                  currentUserId={currentUser.id}
                  otherPartyName={t.counterparty.username}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Inquiry inbox — pre-purchase Q&A threads
// ---------------------------------------------------------------------------

function InquiriesInbox() {
  const currentUser = useAuthStore((s) => s.user);
  const refreshCounts = useInboxStore((s) => s.fetchCounts);

  const [inquiries, setInquiries] = useState<InquirySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<InquiryListResponse>('/api/inquiries?limit=50');
      setInquiries(data.inquiries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inquiries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  function toggleActive(id: string) {
    setActiveId((curr) => {
      const next = curr === id ? null : id;
      if (next) {
        setInquiries((rows) =>
          rows.map((x) => (x.id === id ? { ...x, unreadCount: 0 } : x)),
        );
        setTimeout(() => refreshCounts(), 300);
      }
      return next;
    });
  }

  if (!currentUser) return null;

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
        {error}
      </div>
    );
  }

  if (loading && inquiries.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-[var(--bg-panel-hi)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (inquiries.length === 0) {
    return (
      <div className="panel clip-corner p-8 text-center text-sm text-[var(--text-muted)]">
        No inquiries yet. When a buyer asks about one of your listings — or you ask about one of
        theirs — the conversation appears here.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {inquiries.map((inq) => {
        const open = activeId === inq.id;
        const counterparty = inq.viewerRole === 'buyer' ? inq.seller : inq.buyer;
        const imageUrl = inq.listing.images[0]?.url;
        const unread = inq.unreadCount ?? 0;
        return (
          <li
            key={inq.id}
            className={`rounded-xl border bg-[var(--bg-panel)] ${
              unread > 0 && !open ? 'border-[var(--neon-cyan)]' : 'border-[var(--border-subtle)]'
            }`}
          >
            <button
              type="button"
              onClick={() => toggleActive(inq.id)}
              className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-[var(--bg-panel-hi)]"
              aria-expanded={open}
            >
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--bg-panel-hi)]">
                {imageUrl ? (
                  <img src={imageUrl} alt={inq.listing.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {counterparty.username}
                  </p>
                  <span className="rounded-md border border-[var(--neon-magenta)]/40 bg-[var(--tint-magenta)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--neon-magenta)]">
                    Inquiry
                  </span>
                  {inq.viewerRole === 'buyer' && (
                    <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                      You asked
                    </span>
                  )}
                  {unread > 0 && !open && (
                    <span className="rounded-full bg-[var(--neon-cyan)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--btn-primary-text)]">
                      {unread}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  About: {inq.listing.title} · {formatPrice(inq.listing.price)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] text-[var(--text-dim)]">
                  {formatRelative(inq.lastMessageAt)}
                </span>
                <svg
                  className={`h-4 w-4 text-[var(--text-dim)] transition-transform ${open ? 'rotate-180' : ''}`}
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
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] p-4">
                <div className="mb-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>Pre-purchase question</span>
                  <Link
                    href={`/listings/${inq.listing.id}`}
                    className="text-[var(--neon-cyan)] hover:underline"
                  >
                    View listing →
                  </Link>
                </div>
                <MessageThread
                  endpoint={`/api/inquiries/${inq.id}/messages`}
                  currentUserId={currentUser.id}
                  otherPartyName={counterparty.username}
                  onSent={() => setTimeout(() => refreshCounts(), 300)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
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
