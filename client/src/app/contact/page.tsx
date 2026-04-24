'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

const SUPPORT_EMAIL = 'support@electromarket-app.com';

export default function ContactPage() {
  const user = useAuthStore((s) => s.user);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  // Prefill name/email from the signed-in user. Not read-only so a user can
  // override (e.g. to reach support from a different address).
  useEffect(() => {
    if (user) {
      setName((prev) => prev || user.name || user.username);
      setEmail((prev) => prev || user.email);
    }
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const res = await api<{ message: string }>('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      setSent(true);
      setSubject('');
      setMessage('');
      // Keep the success copy visible; handlers above reset the writable fields.
      void res;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">Contact us</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Have a question, issue, or a bug to report? Fill in the form below and
        we&apos;ll get back to you. You can also email us directly at{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-[var(--neon-cyan)] hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
        .
      </p>

      {sent && (
        <div
          role="status"
          className="mt-6 rounded-lg border border-[var(--neon-green)]/40 bg-[var(--tint-green)] p-4 text-sm text-[var(--neon-green)]"
        >
          Thanks — we&apos;ve got your message and will reply to{' '}
          <strong>{email}</strong> soon.
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="contact-name"
            className="block text-sm font-medium text-[var(--text-primary)]"
          >
            Your name
          </label>
          <input
            id="contact-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="contact-email"
            className="block text-sm font-medium text-[var(--text-primary)]"
          >
            Email address
          </label>
          <input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={255}
            className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-[var(--text-dim)]">
            We&apos;ll reply to this address.
          </p>
        </div>

        <div>
          <label
            htmlFor="contact-subject"
            className="block text-sm font-medium text-[var(--text-primary)]"
          >
            Subject
          </label>
          <input
            id="contact-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            minLength={3}
            maxLength={150}
            placeholder="e.g. Problem with an order"
            className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="contact-message"
            className="block text-sm font-medium text-[var(--text-primary)]"
          >
            Message
          </label>
          <textarea
            id="contact-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={10}
            maxLength={3000}
            rows={6}
            placeholder="Tell us what's going on…"
            className="input-cyber mt-1 block w-full px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-[var(--text-dim)]">
            {message.length}/3000
          </p>
        </div>

        <button
          type="submit"
          disabled={
            sending ||
            name.trim().length === 0 ||
            email.trim().length === 0 ||
            subject.trim().length < 3 ||
            message.trim().length < 10
          }
          className="btn-cyber-primary"
        >
          {sending ? 'Sending…' : 'Send message'}
        </button>
      </form>
    </div>
  );
}
