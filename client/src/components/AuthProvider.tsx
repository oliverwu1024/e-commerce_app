'use client';

import { useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useSavedStore } from '@/stores/saved';
import { useCartStore } from '@/stores/cart';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { fetchUser } = useAuthStore();
  const user = useAuthStore((s) => s.user);

  const handleUnauthorized = useCallback(() => {
    useAuthStore.setState({ user: null, loading: false });
    useSavedStore.setState({ ids: new Set(), loaded: false });
    useCartStore.getState().reset();
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (user) {
      useSavedStore.getState().fetchSavedIds();
      useCartStore.getState().fetchCart();
    } else {
      useSavedStore.setState({ ids: new Set(), loaded: false });
      useCartStore.getState().reset();
    }
  }, [user]);

  useEffect(() => {
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [handleUnauthorized]);

  return <>{children}</>;
}
