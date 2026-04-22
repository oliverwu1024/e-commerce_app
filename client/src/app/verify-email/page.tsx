'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const retry = searchParams.get('retry') === '1';
  const { user, resendVerification, fetchUser } = useAuthStore();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'idle'>(
    token ? 'verifying' : 'idle'
  );
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  // Server includes this when ENABLE_DEV_EMAIL=1 so you can click through
  // without real SMTP. Never populated in production.
  const [devUrl, setDevUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    api<{ message: string }>(`/api/auth/verify-email/${token}`)
      .then((res) => {
        setStatus('success');
        setMessage(res.message);
        fetchUser();
        // Scrub the token from the URL so it doesn't leak via browser history,
        // the Referer header of any outbound link on this page, or analytics.
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', '/verify-email');
        }
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Verification failed');
      });
  }, [token, fetchUser]);

  const handleResend = async () => {
    setResending(true);
    setResendSuccess(false);
    setDevUrl(null);
    try {
      const result = await resendVerification();
      setResendSuccess(true);
      if (result.devVerificationUrl) setDevUrl(result.devVerificationUrl);
    } catch {
      // error is set in the store
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center">
        {status === 'verifying' && (
          <>
            <h1 className="text-xl font-bold text-zinc-900 mb-2">Verifying your email...</h1>
            <p className="text-zinc-500">Please wait.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-zinc-900 mb-2">Email Verified!</h1>
            <p className="text-zinc-600 mb-6">{message}</p>
            <Link
              href="/"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to Home
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-zinc-900 mb-2">Verification Failed</h1>
            <p className="text-zinc-600 mb-6">{message}</p>
            {user && !user.emailVerified && (
              <button
                onClick={handleResend}
                disabled={resending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {resending ? 'Sending...' : 'Resend Verification Email'}
              </button>
            )}
          </>
        )}

        {status === 'idle' && (
          <>
            <h1 className="text-xl font-bold text-zinc-900 mb-2">
              {retry ? 'Verification email failed to send' : 'Verify Your Email'}
            </h1>
            <p className="text-zinc-600 mb-6">
              {retry
                ? "Your account is created, but we couldn't send the verification email just now. Click below to try again."
                : user
                ? 'Check your inbox for a verification email, or request a new one below.'
                : 'Please log in first to resend a verification email.'}
            </p>
            {user && !user.emailVerified && (
              <>
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {resending ? 'Sending...' : 'Resend Verification Email'}
                </button>
                {resendSuccess && !devUrl && (
                  <p className="mt-3 text-sm text-green-600">Verification email sent! Check your inbox.</p>
                )}
                {devUrl && (
                  <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-900">
                    <p className="font-semibold">Dev mode: click-through link</p>
                    <p className="mt-1">
                      <code className="break-all">ENABLE_DEV_EMAIL=1</code> is set on the server, so here&apos;s the verification URL directly (no inbox needed):
                    </p>
                    <a
                      href={devUrl}
                      className="mt-2 inline-block break-all text-blue-700 underline hover:text-blue-800"
                    >
                      {devUrl}
                    </a>
                  </div>
                )}
              </>
            )}
            {user?.emailVerified && (
              <p className="text-sm text-green-600">Your email is already verified.</p>
            )}
            {!user && (
              <Link
                href="/login"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Log in
              </Link>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <p className="text-zinc-500">Loading...</p>
          </div>
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
