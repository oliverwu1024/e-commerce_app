'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import ListingForm from '@/components/ListingForm';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';
import { type ListingDetail } from '@/types/listings';

export default function EditListingPage() {
  return (
    <ProtectedRoute>
      <EditListingLoader />
    </ProtectedRoute>
  );
}

function EditListingLoader() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchListing() {
      try {
        const data = await api<{ listing: ListingDetail }>(`/api/listings/${params.id}`);
        if (cancelled) return;

        if (data.listing.seller.id !== user?.id) {
          setError('You can only edit your own listings');
          return;
        }
        if (data.listing.status !== 'ACTIVE') {
          setError('Only active listings can be edited');
          return;
        }

        setListing(data.listing);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Listing not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchListing();
    return () => { cancelled = true; };
  }, [params.id, user?.id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="space-y-6 animate-pulse">
          <div className="h-6 w-1/3 rounded bg-[var(--bg-panel-hi)]" />
          <div className="h-8 w-1/2 rounded bg-[var(--bg-panel-hi)]" />
          <div className="h-40 rounded-lg bg-[var(--bg-panel-hi)]" />
          <div className="h-10 w-full rounded-lg bg-[var(--bg-panel-hi)]" />
          <div className="h-10 w-full rounded-lg bg-[var(--bg-panel-hi)]" />
          <div className="h-32 w-full rounded-lg bg-[var(--bg-panel-hi)]" />
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Cannot edit listing</h1>
        <p className="text-[var(--text-muted)] mb-6">{error || 'This listing could not be loaded.'}</p>
        <Link
          href="/dashboard"
          className="btn-cyber-primary"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return <ListingForm listing={listing} />;
}
