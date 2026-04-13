'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    }
  }, [user, router]);

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-500">Redirecting...</p>
      </div>
    );
  }

  return <>{children}</>;
}
