'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { fetchUser } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return <>{children}</>;
}
