'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';

const NAV_ITEMS = [
  { href: '/account/settings', label: 'Settings' },
  { href: '/account/verification', label: 'Verification' },
  { href: '/account/notifications', label: 'Notifications' },
  { href: '/account/messages', label: 'Messages' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Account</h1>

        <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
          <aside className="lg:pr-4">
            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-panel-hi)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
          <div>{children}</div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
