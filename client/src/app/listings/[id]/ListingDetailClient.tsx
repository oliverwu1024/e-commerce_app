'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { type ListingDetail, formatPrice, getConditionStyle } from '@/types/listings';
import SaveButton from '@/components/SaveButton';
import AddToCartButton from '@/components/AddToCartButton';
import Stars from '@/components/Stars';
import Avatar from '@/components/Avatar';

// ---------------------------------------------------------------------------
// Image gallery
// ---------------------------------------------------------------------------

function ImageGallery({ images, title }: { images: ListingDetail['images']; title: string }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentImage = images[selectedIndex]?.url;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      setSelectedIndex((i) => (i > 0 ? i - 1 : images.length - 1));
    } else if (e.key === 'ArrowRight') {
      setSelectedIndex((i) => (i < images.length - 1 ? i + 1 : 0));
    }
  }

  return (
    <div>
      {/* Main image */}
      <div className="aspect-[4/3] rounded-xl bg-[var(--bg-panel-hi)] overflow-hidden">
        {currentImage ? (
          <img
            src={currentImage}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
            <svg className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div
          className="mt-3 flex gap-2 overflow-x-auto focus:outline-none"
          role="group"
          aria-label="Image thumbnails"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {images.map((img, idx) => (
            <button
              key={img.id}
              onClick={() => setSelectedIndex(idx)}
              aria-label={`View image ${idx + 1} of ${images.length}`}
              aria-pressed={idx === selectedIndex}
              className={`flex-shrink-0 h-16 w-16 rounded-lg overflow-hidden border-2 transition-colors ${
                idx === selectedIndex
                  ? 'border-[var(--neon-cyan)]'
                  : 'border-[var(--border-subtle)] hover:border-[var(--border-hi)]'
              }`}
            >
              <img
                src={img.url}
                alt={`${title} - image ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="lg:grid lg:grid-cols-5 lg:gap-10">
          <div className="lg:col-span-3">
            <div className="aspect-[4/3] rounded-xl bg-[var(--bg-panel-hi)] animate-pulse" />
          </div>
          <div className="lg:col-span-2 mt-6 lg:mt-0 space-y-4">
            <div className="h-8 bg-[var(--bg-panel-hi)] rounded animate-pulse w-3/4" />
            <div className="h-10 bg-[var(--bg-panel-hi)] rounded animate-pulse w-1/3" />
            <div className="h-6 bg-[var(--bg-panel-hi)] rounded animate-pulse w-1/4" />
            <div className="h-px bg-[var(--border-subtle)] my-4" />
            <div className="space-y-2">
              <div className="h-4 bg-[var(--bg-panel-hi)] rounded animate-pulse" />
              <div className="h-4 bg-[var(--bg-panel-hi)] rounded animate-pulse w-5/6" />
              <div className="h-4 bg-[var(--bg-panel-hi)] rounded animate-pulse w-4/6" />
            </div>
            <div className="h-px bg-[var(--border-subtle)] my-4" />
            <div className="h-24 bg-[var(--bg-panel-hi)] rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

export default function ListingDetailClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Remove listing state
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchListing() {
      setLoading(true);
      setError('');
      try {
        const data = await api<{ listing: ListingDetail }>(`/api/listings/${params.id}`);
        if (!cancelled) setListing(data.listing);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Listing not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchListing();
    return () => { cancelled = true; };
  }, [params.id]);

  async function handleRemove() {
    if (!listing) return;
    setRemoving(true);
    try {
      await api(`/api/listings/${listing.id}`, { method: 'DELETE' });
      router.push('/browse');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove listing');
      setRemoving(false);
      setShowRemoveConfirm(false);
    }
  }

  if (loading) return <DetailSkeleton />;

  if (error || !listing) {
    return (
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Listing not found</h1>
          <p className="text-[var(--text-muted)] mb-6">{error || 'This listing may have been removed.'}</p>
          <Link
            href="/browse"
            className="btn-cyber-primary"
          >
            Browse listings
          </Link>
        </div>
      </main>
    );
  }

  const condition = getConditionStyle(listing.condition);
  const isOwner = user?.id === listing.seller.id;
  const memberSince = new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(listing.seller.createdAt));
  const listedDate = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(listing.createdAt));

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Link href="/browse" className="hover:text-[var(--text-primary)] transition-colors">
            Browse
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={`/browse?category=${encodeURIComponent(listing.category)}`}
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            {listing.category}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-[var(--text-primary)] truncate max-w-[200px]">{listing.title}</span>
        </nav>

        <div className="lg:grid lg:grid-cols-5 lg:gap-10">
          {/* ---- Left: Images ---- */}
          <div className="lg:col-span-3">
            <ImageGallery images={listing.images} title={listing.title} />
          </div>

          {/* ---- Right: Details ---- */}
          <div className="lg:col-span-2 mt-6 lg:mt-0">
            {/* Title & price */}
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">{listing.title}</h1>
            <p className="mt-2 text-3xl font-bold text-[var(--text-primary)]">
              {formatPrice(listing.price)}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${condition.bg}`}>
                {condition.label}
              </span>
              {listing.status === 'SOLD' && (
                <span className="rounded-md bg-[var(--tint-danger)] text-[var(--neon-danger)] border border-[var(--neon-danger)]/40 px-2.5 py-1 text-xs font-medium">
                  Sold
                </span>
              )}
              {listing.status === 'ON_HOLD' && (
                <span className="rounded-md bg-[var(--tint-magenta)] text-[var(--neon-magenta)] border border-[var(--neon-magenta)]/40 px-2.5 py-1 text-xs font-medium">
                  On Hold
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-6 flex gap-3">
              {isOwner ? (
                <>
                  <Link
                    href={`/listings/${listing.id}/edit`}
                    className="btn-cyber-outline flex-1 text-center"
                  >
                    Edit Listing
                  </Link>
                  <button
                    onClick={() => setShowRemoveConfirm(true)}
                    className="flex-1 rounded-lg border border-[var(--neon-danger)]/40 px-4 py-2.5 text-sm font-medium text-[var(--neon-danger)] hover:bg-[var(--tint-danger)] transition-colors"
                  >
                    Remove
                  </button>
                </>
              ) : listing.status === 'ACTIVE' ? (
                <>
                  <AddToCartButton
                    listingId={listing.id}
                    sellerId={listing.seller.id}
                    status={listing.status}
                    variant="full"
                    onError={setError}
                  />
                  <SaveButton listingId={listing.id} size="md" />
                </>
              ) : (
                <div className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel-hi)] px-4 py-2.5 text-center text-sm text-[var(--text-muted)]">
                  {listing.status === 'SOLD'
                    ? 'This listing has been sold.'
                    : listing.status === 'ON_HOLD'
                    ? 'This listing is on hold for another buyer.'
                    : 'This listing is no longer available.'}
                </div>
              )}
            </div>

            {/* Remove confirmation */}
            {showRemoveConfirm && (
              <div role="alertdialog" aria-labelledby="remove-title" className="mt-3 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-4">
                <p id="remove-title" className="text-sm text-[var(--neon-danger)] mb-3">
                  Are you sure you want to remove this listing? This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRemove}
                    disabled={removing}
                    className="rounded-lg bg-[var(--neon-danger)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
                  >
                    {removing ? 'Removing...' : 'Yes, remove'}
                  </button>
                  <button
                    onClick={() => setShowRemoveConfirm(false)}
                    className="btn-cyber-outline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="mt-3 rounded-lg bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)] border border-[var(--neon-danger)]/40">
                {error}
              </div>
            )}

            {/* Description */}
            <div className="mt-6 border-t border-[var(--border-subtle)] pt-6">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Description</h2>
              <p className="text-sm text-[var(--text-muted)] whitespace-pre-line leading-relaxed">
                {listing.description}
              </p>
            </div>

            {/* Details table */}
            <div className="mt-6 border-t border-[var(--border-subtle)] pt-6">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Details</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-[var(--text-muted)]">Category</dt>
                <dd className="text-[var(--text-primary)]">{listing.category}</dd>

                {listing.brand && (
                  <>
                    <dt className="text-[var(--text-muted)]">Brand</dt>
                    <dd className="text-[var(--text-primary)]">{listing.brand}</dd>
                  </>
                )}

                <dt className="text-[var(--text-muted)]">Condition</dt>
                <dd className="text-[var(--text-primary)]">{condition.label}</dd>

                {listing.platform && (
                  <>
                    <dt className="text-[var(--text-muted)]">Platform</dt>
                    <dd className="text-[var(--text-primary)]">{listing.platform}</dd>
                  </>
                )}

                {listing.subcategory && (
                  <>
                    <dt className="text-[var(--text-muted)]">Subcategory</dt>
                    <dd className="text-[var(--text-primary)]">{listing.subcategory}</dd>
                  </>
                )}

                <dt className="text-[var(--text-muted)]">Listed</dt>
                <dd className="text-[var(--text-primary)]">{listedDate}</dd>
              </dl>
            </div>

            {/* Seller card */}
            <div className="mt-6 border-t border-[var(--border-subtle)] pt-6">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Seller</h2>
              <Link
                href={`/sellers/${listing.seller.id}`}
                className="panel clip-corner block p-4 hover:border-[var(--neon-cyan)] hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    src={listing.seller.avatarUrl}
                    username={listing.seller.username}
                    size="md"
                  />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--neon-cyan)] transition-colors">
                      {listing.seller.username}
                    </p>
                    {listing.seller.location && (
                      <p className="text-xs text-[var(--text-muted)]">{listing.seller.location}</p>
                    )}
                  </div>
                  <svg
                    className="h-4 w-4 text-[var(--text-dim)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>

                {/* Rating */}
                <div className="mt-3 flex items-center gap-3 text-sm">
                  {listing.seller.avgRating !== null ? (
                    <div className="flex items-center gap-1.5">
                      <Stars rating={listing.seller.avgRating} />
                      <span className="text-[var(--text-muted)] font-medium">
                        {listing.seller.avgRating.toFixed(1)}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        ({listing.seller.totalReviews} {listing.seller.totalReviews === 1 ? 'review' : 'reviews'})
                      </span>
                    </div>
                  ) : (
                    <span className="text-[var(--text-dim)] text-xs">No reviews yet</span>
                  )}
                </div>

                {/* Stats */}
                <div className="mt-3 flex gap-4 text-xs text-[var(--text-muted)]">
                  <span>{listing.seller.totalSales} {listing.seller.totalSales === 1 ? 'sale' : 'sales'}</span>
                  <span aria-hidden="true">&middot;</span>
                  <span>Member since {memberSince}</span>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
