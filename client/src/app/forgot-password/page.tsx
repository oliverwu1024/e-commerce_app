'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Server always responds 200 with a generic "if that email exists we sent
  // a link" message (to avoid email enumeration). We mirror that — no
  // "success" vs "email not found" distinction on the UI either.
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setMessage(res.message);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="panel clip-corner w-full max-w-md p-8">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          Forgot password?
        </h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          Enter the email address on your account and we&apos;ll send you a link to reset your password.
        </p>

        {sent ? (
          <div
            role="status"
            className="rounded-lg border border-[var(--neon-green)]/40 bg-[var(--tint-green)] p-4 text-sm text-[var(--neon-green)]"
          >
            {message}
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Didn&apos;t get it? Check spam, or{' '}
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setMessage('');
                }}
                className="underline hover:text-[var(--neon-cyan)]"
              >
                try another address
              </button>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
                {error}
              </div>
            )}
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-cyber w-full px-3 py-2.5 text-sm"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={submitting || email.trim().length === 0}
              className="btn-cyber-primary w-full"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Remembered it?{' '}
          <Link
            href="/login"
            className="font-semibold text-[var(--neon-cyan)] transition-colors hover:text-[var(--accent-soft)]"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
