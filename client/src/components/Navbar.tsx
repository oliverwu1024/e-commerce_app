'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';

export default function Navbar() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-zinc-900">
            ElectroMarket
          </Link>
          <Link
            href="/browse"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            Browse
          </Link>
        </div>

        <div className="flex items-center gap-4">
          {loading ? (
            <div className="h-7 w-32 animate-pulse rounded bg-zinc-100" aria-hidden="true" />
          ) : user ? (
            <>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/listings/new"
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                + Sell Item
              </Link>
              <span className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">{user.name}</span>
                {user.sellerType === 'BUSINESS' && (
                  <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                    Business
                  </span>
                )}
              </span>
              <button
                onClick={logout}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>

      {user && !user.emailVerified && (
        <div className="bg-amber-50 border-t border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
          Please verify your email.{' '}
          <Link href="/verify-email" className="font-medium underline hover:text-amber-900">
            Resend verification email
          </Link>
        </div>
      )}
    </header>
  );
}
