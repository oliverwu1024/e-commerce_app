'use client';

import { useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { fetchUser } = useAuthStore();

  const handleUnauthorized = useCallback(() => {
    useAuthStore.setState({ user: null, loading: false });
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [handleUnauthorized]);

  return <>{children}</>;
}
