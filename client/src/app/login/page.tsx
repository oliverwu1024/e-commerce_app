'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, login, error, clearError } = useAuthStore();

  const raw = searchParams.get('returnTo') || '/';
  const safe =
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    !raw.startsWith('/\\') &&
    !raw.includes('\\') &&
    !raw.includes('..');
  const returnTo = safe ? raw : '/';

  useEffect(() => {
    if (user) router.replace(returnTo);
  }, [user, router, returnTo]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      router.push(returnTo);
    } catch {
      // error is set in store
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="panel clip-corner w-full max-w-md p-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          Sign in
        </h1>

        {error && (
          <div className="mb-4 flex items-start justify-between gap-2 rounded-md border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
            <span>{error}</span>
            <button
              onClick={clearError}
              aria-label="Dismiss error"
              className="shrink-0 font-bold hover:brightness-110"
            >
              &times;
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-cyber w-full px-3 py-2.5 text-sm"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-cyber-primary w-full"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-semibold text-[var(--neon-cyan)] transition-colors hover:text-[var(--accent-soft)]"
          >
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
