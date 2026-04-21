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
      <div className="aspect-[4/3] rounded-xl bg-zinc-100 overflow-hidden">
        {currentImage ? (
          <img
            src={currentImage}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-300">
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
                  ? 'border-blue-600'
                  : 'border-zinc-200 hover:border-zinc-400'
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
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="lg:grid lg:grid-cols-5 lg:gap-10">
          <div className="lg:col-span-3">
            <div className="aspect-[4/3] rounded-xl bg-zinc-200 animate-pulse" />
          </div>
          <div className="lg:col-span-2 mt-6 lg:mt-0 space-y-4">
            <div className="h-8 bg-zinc-200 rounded animate-pulse w-3/4" />
            <div className="h-10 bg-zinc-200 rounded animate-pulse w-1/3" />
            <div className="h-6 bg-zinc-200 rounded animate-pulse w-1/4" />
            <div className="h-px bg-zinc-200 my-4" />
            <div className="space-y-2">
              <div className="h-4 bg-zinc-200 rounded animate-pulse" />
              <div className="h-4 bg-zinc-200 rounded animate-pulse w-5/6" />
              <div className="h-4 bg-zinc-200 rounded animate-pulse w-4/6" />
            </div>
            <div className="h-px bg-zinc-200 my-4" />
            <div className="h-24 bg-zinc-200 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

export default function ListingDetailPage() {
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
      <main className="flex-1 bg-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Listing not found</h1>
          <p className="text-zinc-500 mb-6">{error || 'This listing may have been removed.'}</p>
          <Link
            href="/browse"
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
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
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-zinc-500">
          <Link href="/browse" className="hover:text-zinc-700 transition-colors">
            Browse
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={`/browse?category=${encodeURIComponent(listing.category)}`}
            className="hover:text-zinc-700 transition-colors"
          >
            {listing.category}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-zinc-900 truncate max-w-[200px]">{listing.title}</span>
        </nav>

        <div className="lg:grid lg:grid-cols-5 lg:gap-10">
          {/* ---- Left: Images ---- */}
          <div className="lg:col-span-3">
            <ImageGallery images={listing.images} title={listing.title} />
          </div>

          {/* ---- Right: Details ---- */}
          <div className="lg:col-span-2 mt-6 lg:mt-0">
            {/* Title & price */}
            <h1 className="text-2xl font-bold text-zinc-900">{listing.title}</h1>
            <p className="mt-2 text-3xl font-bold text-zinc-900">
              {formatPrice(listing.price)}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${condition.bg}`}>
                {condition.label}
              </span>
              {listing.status === 'SOLD' && (
                <span className="rounded-md bg-red-100 text-red-700 px-2.5 py-1 text-xs font-medium">
                  Sold
                </span>
              )}
              {listing.status === 'ON_HOLD' && (
                <span className="rounded-md bg-purple-100 text-purple-700 px-2.5 py-1 text-xs font-medium">
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
                    className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                  >
                    Edit Listing
                  </Link>
                  <button
                    onClick={() => setShowRemoveConfirm(true)}
                    className="flex-1 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
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
                <div className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-center text-sm text-zinc-600">
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
              <div role="alertdialog" aria-labelledby="remove-title" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <p id="remove-title" className="text-sm text-red-700 mb-3">
                  Are you sure you want to remove this listing? This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRemove}
                    disabled={removing}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {removing ? 'Removing...' : 'Yes, remove'}
                  </button>
                  <button
                    onClick={() => setShowRemoveConfirm(false)}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200">
                {error}
              </div>
            )}

            {/* Description */}
            <div className="mt-6 border-t border-zinc-200 pt-6">
              <h2 className="text-sm font-semibold text-zinc-900 mb-2">Description</h2>
              <p className="text-sm text-zinc-600 whitespace-pre-line leading-relaxed">
                {listing.description}
              </p>
            </div>

            {/* Details table */}
            <div className="mt-6 border-t border-zinc-200 pt-6">
              <h2 className="text-sm font-semibold text-zinc-900 mb-3">Details</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-zinc-500">Category</dt>
                <dd className="text-zinc-900">{listing.category}</dd>

                {listing.brand && (
                  <>
                    <dt className="text-zinc-500">Brand</dt>
                    <dd className="text-zinc-900">{listing.brand}</dd>
                  </>
                )}

                <dt className="text-zinc-500">Condition</dt>
                <dd className="text-zinc-900">{condition.label}</dd>

                {listing.platform && (
                  <>
                    <dt className="text-zinc-500">Platform</dt>
                    <dd className="text-zinc-900">{listing.platform}</dd>
                  </>
                )}

                {listing.subcategory && (
                  <>
                    <dt className="text-zinc-500">Subcategory</dt>
                    <dd className="text-zinc-900">{listing.subcategory}</dd>
                  </>
                )}

                <dt className="text-zinc-500">Listed</dt>
                <dd className="text-zinc-900">{listedDate}</dd>
              </dl>
            </div>

            {/* Seller card */}
            <div className="mt-6 border-t border-zinc-200 pt-6">
              <h2 className="text-sm font-semibold text-zinc-900 mb-3">Seller</h2>
              <Link
                href={`/sellers/${listing.seller.id}`}
                className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar placeholder */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold text-sm">
                    {listing.seller.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 hover:text-blue-600 transition-colors">
                      {listing.seller.username}
                    </p>
                    {listing.seller.location && (
                      <p className="text-xs text-zinc-500">{listing.seller.location}</p>
                    )}
                  </div>
                  <svg
                    className="h-4 w-4 text-zinc-400"
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
                      <span className="text-zinc-700 font-medium">
                        {listing.seller.avgRating.toFixed(1)}
                      </span>
                      <span className="text-zinc-500">
                        ({listing.seller.totalReviews} {listing.seller.totalReviews === 1 ? 'review' : 'reviews'})
                      </span>
                    </div>
                  ) : (
                    <span className="text-zinc-400 text-xs">No reviews yet</span>
                  )}
                </div>

                {/* Stats */}
                <div className="mt-3 flex gap-4 text-xs text-zinc-500">
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
