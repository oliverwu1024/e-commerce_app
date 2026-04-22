'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { useInboxStore } from '@/stores/inbox';
import Avatar from '@/components/Avatar';

export default function Navbar() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);
  const cartCount = useCartStore((s) => s.cart.itemCount);
  const unreadNotif = useInboxStore((s) => s.counts.notifications);
  const unreadMsg = useInboxStore((s) => s.counts.messages);

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
                href="/account/notifications"
                aria-label={`Notifications${unreadNotif > 0 ? ` (${unreadNotif} unread)` : ''}`}
                className="relative rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadNotif > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadNotif > 99 ? '99+' : unreadNotif}
                  </span>
                )}
              </Link>
              <Link
                href="/account/messages"
                aria-label={`Messages${unreadMsg > 0 ? ` (${unreadMsg} unread)` : ''}`}
                className="relative rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {unreadMsg > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadMsg > 99 ? '99+' : unreadMsg}
                  </span>
                )}
              </Link>
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
                  href="/admin"
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
              <span className="flex items-center gap-2 text-sm text-zinc-600">
                <Avatar src={user.avatarUrl} username={user.username} size="sm" />
                <span className="font-medium text-zinc-900">{user.name}</span>
                {user.sellerType === 'BUSINESS' && (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
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
