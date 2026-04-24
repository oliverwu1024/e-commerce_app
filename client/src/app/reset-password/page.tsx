'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await api<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setSuccess(true);
      // Scrub the token from the URL so back-button / analytics / copy-paste
      // can't leak it further.
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/reset-password');
      }
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="panel clip-corner w-full max-w-md p-8 text-center">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Invalid reset link</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            This link is missing or malformed. Request a new one.
          </p>
          <Link href="/forgot-password" className="btn-cyber-primary mt-6 inline-block">
            Request reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="panel clip-corner w-full max-w-md p-8">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          Set a new password
        </h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          Choose a password you haven&apos;t used before. Minimum 8 characters.
        </p>

        {success ? (
          <div
            role="status"
            className="rounded-lg border border-[var(--neon-green)]/40 bg-[var(--tint-green)] p-4 text-sm text-[var(--neon-green)]"
          >
            Password reset successfully. Redirecting to sign in…
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
                htmlFor="password"
                className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]"
              >
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-cyber w-full px-3 py-2.5 text-sm"
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div>
              <label
                htmlFor="confirm"
                className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]"
              >
                Confirm new password
              </label>
              <input
                id="confirm"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-cyber w-full px-3 py-2.5 text-sm"
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || password.length < 8 || password !== confirmPassword}
              className="btn-cyber-primary w-full"
            >
              {submitting ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          <Link
            href="/login"
            className="font-semibold text-[var(--neon-cyan)] transition-colors hover:text-[var(--accent-soft)]"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
