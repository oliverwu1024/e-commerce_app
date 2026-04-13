'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';

export default function Home() {
  const { user } = useAuthStore();

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-zinc-900 mb-4">
          Used Electronics Marketplace
        </h1>
        <p className="text-lg text-zinc-600 mb-8">
          Buy and sell used electronics — phones, laptops, consoles, and more
        </p>
        {!user && (
          <Link
            href="/register"
            className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
          >
            Get started
          </Link>
        )}
      </div>
    </main>
  );
}
