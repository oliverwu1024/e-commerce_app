'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { OrderMessage } from '@/types/orders';

type Props = {
  orderId: string;
  currentUserId: string;
  otherPartyName: string;
};

export default function MessageThread({
  orderId,
  currentUserId,
  otherPartyName,
}: Props) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the user is already at (or near) the bottom, so
  // reading older messages isn't interrupted by incoming ones. Starts `true`
  // so the initial load scrolls to the latest message.
  const shouldStickRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchMessages() {
      setLoading(true);
      try {
        const data = await api<{ messages: OrderMessage[] }>(
          `/api/orders/${orderId}/messages`,
        );
        if (!cancelled) {
          setMessages(data.messages);
          setError('');
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchMessages();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (shouldStickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // 40px threshold — small fudge so near-bottom still counts.
    shouldStickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError('');
    try {
      const res = await api<{ message: OrderMessage }>(
        `/api/orders/${orderId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: trimmed }),
        },
      );
      // Always pin to bottom after the user sends — even if they had scrolled
      // up to read history.
      shouldStickRef.current = true;
      setMessages((prev) => [...prev, res.message]);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-64 overflow-y-auto p-3 space-y-2"
        aria-label={`Messages with ${otherPartyName}`}
      >
        {loading ? (
          <p className="text-center text-xs text-zinc-400 py-4">Loading messages...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-zinc-500 py-4">
            No messages yet. Say hi to {otherPartyName} to coordinate the sale.
          </p>
        ) : (
          messages.map((msg) => {
            const mine = msg.sender.id === currentUserId;
            const time = new Intl.DateTimeFormat('en-AU', {
              hour: 'numeric',
              minute: '2-digit',
              month: 'short',
              day: 'numeric',
            }).format(new Date(msg.createdAt));
            return (
              <div
                key={msg.id}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${
                    mine
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-zinc-200 text-zinc-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  <p
                    className={`mt-0.5 text-[10px] ${
                      mine ? 'text-blue-100' : 'text-zinc-400'
                    }`}
                  >
                    {mine ? 'You' : msg.sender.username} · {time}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p className="px-3 pt-2 text-xs text-red-600">{error}</p>
      )}

      <form
        onSubmit={handleSend}
        className="flex gap-2 border-t border-zinc-200 p-3"
      >
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Message ${otherPartyName}...`}
          maxLength={2000}
          disabled={sending}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={sending || !content.trim()}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
