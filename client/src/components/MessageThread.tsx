'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import Avatar from '@/components/Avatar';

// Generic message shape the thread renders — used by both order messages
// and pre-purchase inquiry messages. Server APIs for both return the same
// fields (id, content, createdAt, sender), so a single component can serve
// either with a configurable endpoint.
export type ThreadMessage = {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; username: string; avatarUrl: string | null };
};

type Props = {
  // Base URL for GET + POST. GET returns `{ messages: ThreadMessage[] }`,
  // POST takes `{ content }` and returns `{ message: ThreadMessage }`.
  endpoint: string;
  currentUserId: string;
  otherPartyName: string;
  // Optional: triggered after a successful send so parent can refresh inbox
  // counts, etc. Optional so existing callers don't have to wire it.
  onSent?: () => void;
};

// Two consecutive messages from the same sender are grouped if their createdAt
// is within this window (ms). Only the last message in each group shows the
// sender/time footer, so a quick back-and-forth doesn't repeat "You · 10:42".
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export default function MessageThread({
  endpoint,
  currentUserId,
  otherPartyName,
  onSent,
}: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
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
        const data = await api<{ messages: ThreadMessage[] }>(endpoint);
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
  }, [endpoint]);

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

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError('');
    try {
      const res = await api<{ message: ThreadMessage }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ content: trimmed }),
      });
      // Always pin to bottom after the user sends — even if they had scrolled
      // up to read history.
      shouldStickRef.current = true;
      setMessages((prev) => [...prev, res.message]);
      setContent('');
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleSend();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter (or any modifier) inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)]">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-64 overflow-y-auto p-3 space-y-1"
        aria-label={`Messages with ${otherPartyName}`}
      >
        {loading ? (
          <p className="text-center text-xs text-[var(--text-dim)] py-4">Loading messages...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-[var(--text-muted)] py-4">
            No messages yet. Say hi to {otherPartyName} to coordinate the sale.
          </p>
        ) : (
          messages.map((msg, idx) => {
            const mine = msg.sender.id === currentUserId;
            const prev = messages[idx - 1];
            const next = messages[idx + 1];
            // Show the avatar only at the TOP of a run by the other party —
            // repeating it on every message gets noisy fast.
            const startsRun =
              !prev ||
              prev.sender.id !== msg.sender.id ||
              new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() >=
                GROUP_WINDOW_MS;
            const continuesRun =
              next &&
              next.sender.id === msg.sender.id &&
              new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime() <
                GROUP_WINDOW_MS;
            const showFooter = !continuesRun;
            const time = new Intl.DateTimeFormat('en-AU', {
              hour: 'numeric',
              minute: '2-digit',
              month: 'short',
              day: 'numeric',
            }).format(new Date(msg.createdAt));
            return (
              <div
                key={msg.id}
                className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${continuesRun ? '' : 'pb-1'}`}
              >
                {!mine && (
                  <span className="w-6 flex-shrink-0">
                    {startsRun && (
                      <Avatar
                        src={msg.sender.avatarUrl}
                        username={msg.sender.username}
                        size="xs"
                      />
                    )}
                  </span>
                )}
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${
                    mine
                      ? 'bg-[var(--neon-cyan)] text-[var(--btn-primary-text)]'
                      : 'bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[var(--text-primary)]'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  {showFooter && (
                    <p
                      className={`mt-0.5 text-[10px] ${
                        mine ? 'opacity-80' : 'text-[var(--text-dim)]'
                      }`}
                    >
                      {mine ? 'You' : msg.sender.username} · {time}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p className="px-3 pt-2 text-xs text-[var(--neon-danger)]">{error}</p>
      )}

      <form
        onSubmit={handleFormSubmit}
        className="flex items-end gap-2 border-t border-[var(--border-subtle)] p-3"
      >
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${otherPartyName}... (Enter to send, Shift+Enter for newline)`}
          maxLength={2000}
          rows={2}
          disabled={sending}
          className="input-cyber flex-1 resize-none px-3 py-1.5 text-sm disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || !content.trim()}
          className="btn-cyber-primary"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
