'use client';

import { useState } from 'react';
import Link from 'next/link';
import { type ListingSummary, formatPrice, getConditionStyle } from '@/types/listings';
import SaveButton from '@/components/SaveButton';
import AddToCartButton from '@/components/AddToCartButton';

type Props = {
  listing: ListingSummary;
};

export default function ListingCard({ listing }: Props) {
  const imageUrl = listing.images[0]?.url;
  const condition = getConditionStyle(listing.condition);
  const [imageFailed, setImageFailed] = useState(false);
  const showPlaceholder = !imageUrl || imageFailed;

  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group block rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-[4/3] bg-zinc-100 relative overflow-hidden">
        {!showPlaceholder ? (
          <img
            src={imageUrl}
            alt={listing.title}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-300">
            <svg
              className="h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
        <span
          className={`absolute top-2 left-2 rounded-md px-2 py-0.5 text-xs font-medium ${condition.bg}`}
        >
          {condition.label}
        </span>
        <span className="absolute top-2 right-2 flex gap-1.5">
          <AddToCartButton
            listingId={listing.id}
            sellerId={listing.seller.id}
            status={listing.status}
            variant="icon"
          />
          <SaveButton listingId={listing.id} />
        </span>
      </div>

      <div className="p-3">
        <h3 className="text-sm font-medium text-zinc-900 line-clamp-2 group-hover:text-blue-600 transition-colors">
          {listing.title}
        </h3>
        <p className="mt-1 text-lg font-bold text-zinc-900">
          {formatPrice(listing.price)}
        </p>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
          <span>{listing.seller.username}</span>
          {listing.seller.location && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span>{listing.seller.location}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
