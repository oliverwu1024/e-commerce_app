'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { fetchUser, loading } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
