'use client';

import { useSavedStore } from '@/stores/saved';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'next/navigation';

type Props = {
  listingId: string;
  size?: 'sm' | 'md';
};

export default function SaveButton({ listingId, size = 'sm' }: Props) {
  const { user } = useAuthStore();
  const router = useRouter();
  const saved = useSavedStore((s) => s.ids.has(listingId));
  const toggle = useSavedStore((s) => s.toggle);

  const sizeClass = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const padClass = size === 'md' ? 'p-2.5' : 'p-1.5';

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      router.push('/login');
      return;
    }
    toggle(listingId);
  }

  return (
    <button
      onClick={handleClick}
      aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      className={`rounded-md backdrop-blur-sm transition-all ${padClass} ${
        saved
          ? 'bg-[var(--tint-magenta)] text-[var(--neon-magenta)] border border-[var(--neon-magenta)]/50'
          : 'bg-[var(--bg-overlay)] text-[var(--text-muted)] border border-[var(--border-hi)] hover:text-[var(--neon-magenta)] hover:border-[var(--neon-magenta)]/50'
      }`}
    >
      <svg
        className={sizeClass}
        viewBox="0 0 24 24"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    </button>
  );
}
