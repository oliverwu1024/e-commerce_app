'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';

export default function Navbar() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);
  const cartCount = useCartStore((s) => s.cart.itemCount);

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
                href="/cart"
                aria-label={`Cart${cartCount > 0 ? ` (${cartCount} item${cartCount === 1 ? '' : 's'})` : ''}`}
                className="relative rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.5 3h13M9 20a1 1 0 102 0 1 1 0 00-2 0zm8 0a1 1 0 102 0 1 1 0 00-2 0z"
                  />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </Link>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/account/settings"
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                Account
              </Link>
              {user.role === 'ADMIN' && (
                <Link
                  href="/admin/verifications"
                  className="text-sm font-medium text-amber-700 hover:text-amber-900 transition-colors"
                >
                  Admin
                </Link>
              )}
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
