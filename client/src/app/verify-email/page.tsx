'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { user, resendVerification, fetchUser } = useAuthStore();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'idle'>(
    token ? 'verifying' : 'idle'
  );
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;

    api<{ message: string }>(`/api/auth/verify-email/${token}`)
      .then((res) => {
        setStatus('success');
        setMessage(res.message);
        fetchUser();
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Verification failed');
      });
  }, [token, fetchUser]);

  const handleResend = async () => {
    setResending(true);
    setResendSuccess(false);
    try {
      await resendVerification();
      setResendSuccess(true);
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
            <h1 className="text-xl font-bold text-zinc-900 mb-2">Verify Your Email</h1>
            <p className="text-zinc-600 mb-6">
              {user
                ? "Check your inbox for a verification email, or request a new one below."
                : "Please log in first to resend a verification email."}
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
                {resendSuccess && (
                  <p className="mt-3 text-sm text-green-600">Verification email sent! Check your inbox.</p>
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
