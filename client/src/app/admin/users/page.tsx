'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

type AdminUser = {
  id: string;
  email: string;
  username: string;
  name: string;
  role: 'USER' | 'ADMIN';
  sellerType: 'PERSONAL' | 'BUSINESS';
  businessName: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  idVerification: 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

export default function AdminUsersPage() {
  return (
    <ProtectedRoute>
      <Inner />
    </ProtectedRoute>
  );
}

function Inner() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  if (user.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold">Access denied</h1>
      </div>
    );
  }
  return <Loaded />;
}

function Loaded() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Debounce the search input so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (debounced) params.set('q', debounced);
      const res = await api<{ users: AdminUser[]; pagination: Pagination }>(
        `/api/admin/users?${params.toString()}`,
      );
      setUsers(res.users);
      setPagination(res.pagination);
    } finally {
      setLoading(false);
    }
  }, [debounced, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 1 whenever the search changes.
  useEffect(() => {
    setPage(1);
  }, [debounced]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Users</h1>
        <Link href="/admin" className="text-sm text-[var(--text-muted)] hover:text-[var(--neon-cyan)]">
          ← Admin home
        </Link>
      </div>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search email, username, name, business name…"
        className="mt-6 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2 text-sm text-[var(--text-primary)]"
      />

      <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="min-w-full divide-y divide-[var(--border-subtle)] text-xs">
          <thead className="bg-[var(--bg-panel-hi)] text-[var(--text-muted)]">
            <tr>
              <Th>Email</Th>
              <Th>Username</Th>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Seller</Th>
              <Th>Verified</Th>
              <Th>Joined</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-panel)]">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  No users match.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <Td>{u.email}</Td>
                  <Td>
                    <Link
                      href={`/sellers/${u.username}`}
                      className="text-[var(--neon-cyan)] hover:underline"
                    >
                      {u.username}
                    </Link>
                  </Td>
                  <Td>{u.businessName || u.name}</Td>
                  <Td>
                    {u.role === 'ADMIN' ? (
                      <span className="rounded bg-[var(--tint-magenta)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--neon-magenta)]">
                        admin
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">user</span>
                    )}
                  </Td>
                  <Td>{u.sellerType.toLowerCase()}</Td>
                  <Td>
                    <span className="space-x-1">
                      <Badge label="email" on={u.emailVerified} />
                      <Badge label="phone" on={u.phoneVerified} />
                      <Badge
                        label="id"
                        on={u.idVerification === 'APPROVED'}
                      />
                    </span>
                  </Td>
                  <Td>{new Date(u.createdAt).toLocaleDateString()}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-[var(--text-muted)]">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} users
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={page === pagination.totalPages}
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-[var(--text-primary)]">{children}</td>;
}

function Badge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        on
          ? 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)]'
          : 'bg-[var(--bg-panel-hi)] text-[var(--text-dim)]'
      }`}
    >
      {label}
    </span>
  );
}
