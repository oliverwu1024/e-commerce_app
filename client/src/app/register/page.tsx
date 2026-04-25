'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';
import { queuePostRegistrationTour } from '@/components/OnboardingTour';

export default function RegisterPage() {
  const router = useRouter();
  const { user, register, error, clearError } = useAuthStore();

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sellerType, setSellerType] = useState<'PERSONAL' | 'BUSINESS'>('PERSONAL');
  const [businessName, setBusinessName] = useState('');
  const [localError, setLocalError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }

    if (sellerType === 'BUSINESS' && !businessName.trim()) {
      setLocalError('Business name is required for business accounts');
      return;
    }

    setSubmitting(true);
    try {
      const { verificationEmailSent } = await register({
        name,
        username,
        email,
        password,
        sellerType,
        ...(sellerType === 'BUSINESS' ? { businessName } : {}),
      });
      // Queue the appropriate first-run tour. Personal accounts get the
      // buyer tour on the homepage; business accounts go straight to the
      // dashboard for the seller tour. The OnboardingTour component picks
      // this up from localStorage and only fires once per user.
      queuePostRegistrationTour(sellerType === 'BUSINESS' ? 'seller' : 'buyer');
      // If the verification email failed to send, route to the verify page so
      // the user sees a clear explanation + the Resend button, instead of the
      // generic "please verify your email" banner on home (which implies one
      // was actually sent).
      if (!verificationEmailSent) {
        router.push('/verify-email?retry=1');
      } else {
        router.push(sellerType === 'BUSINESS' ? '/dashboard' : '/');
      }
    } catch {
      // error is set in store
    } finally {
      setSubmitting(false);
    }
  }

  const displayError = localError || error;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="panel clip-corner w-full max-w-md p-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          Create an account
        </h1>

        {displayError && (
          <div className="mb-4 flex items-start justify-between gap-2 rounded-md border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
            <span>{displayError}</span>
            <button
              onClick={() => { setLocalError(''); clearError(); }}
              aria-label="Dismiss error"
              className="shrink-0 font-bold hover:brightness-110"
            >
              &times;
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Seller type toggle */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
              Account type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSellerType('PERSONAL')}
                className={`rounded-md border px-4 py-2.5 text-sm font-semibold transition-all ${
                  sellerType === 'PERSONAL'
                    ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
                    : 'border-[var(--border-hi)] text-[var(--text-muted)] hover:border-[var(--neon-cyan)]/50 hover:text-[var(--text-primary)]'
                }`}
              >
                Personal
              </button>
              <button
                type="button"
                onClick={() => setSellerType('BUSINESS')}
                className={`rounded-md border px-4 py-2.5 text-sm font-semibold transition-all ${
                  sellerType === 'BUSINESS'
                    ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
                    : 'border-[var(--border-hi)] text-[var(--text-muted)] hover:border-[var(--neon-cyan)]/50 hover:text-[var(--text-primary)]'
                }`}
              >
                Business
              </button>
            </div>
          </div>

          {sellerType === 'BUSINESS' && (
            <div>
              <label
                htmlFor="businessName"
                className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]"
              >
                Business name
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="input-cyber w-full px-3 py-2.5 text-sm"
                placeholder="Your business name"
              />
            </div>
          )}

          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
              Full name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-cyber w-full px-3 py-2.5 text-sm"
              placeholder="John Smith"
            />
          </div>

          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
              Username
            </label>
            <input
              id="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-cyber w-full px-3 py-2.5 text-sm"
              placeholder="johnsmith"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
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
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-cyber w-full px-3 py-2.5 text-sm"
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-cyber w-full px-3 py-2.5 text-sm"
              placeholder="Confirm your password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-cyber-primary w-full"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Already have an account?{' '}
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
