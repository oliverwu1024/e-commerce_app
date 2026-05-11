'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  type ListingSummary,
  FULFILLMENT_LABELS,
  formatPrice,
  getConditionStyle,
} from '@/types/listings';
import SaveButton from '@/components/SaveButton';
import AddToCartButton from '@/components/AddToCartButton';

type Props = {
  listing: ListingSummary;
  imageFit?: 'cover' | 'contain';
};

export default function ListingCard({ listing, imageFit = 'cover' }: Props) {
  const imageUrl = listing.images[0]?.url;
  const condition = getConditionStyle(listing.condition);
  const [imageFailed, setImageFailed] = useState(false);
  const showPlaceholder = !imageUrl || imageFailed;

  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group relative block panel panel-hover clip-corner overflow-hidden"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--bg-panel-hi)]">
        {!showPlaceholder ? (
          <img
            src={imageUrl}
            alt={listing.title}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={`h-full w-full ${imageFit === 'contain' ? 'object-contain' : 'object-cover'} opacity-95 transition-all duration-300 group-hover:scale-[1.03] group-hover:opacity-100`}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
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
          className={`absolute top-2 left-2 rounded-md px-2 py-0.5 text-[11px] font-semibold ${condition.bg}`}
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

      <div className="p-3.5 pb-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)] transition-colors group-hover:text-[var(--neon-cyan)]">
          {listing.title}
        </h3>
        <p className="mt-1.5 text-lg font-bold tracking-tight text-[var(--neon-cyan)]">
          {formatPrice(listing.price)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span>{FULFILLMENT_LABELS[listing.fulfillmentMethod]}</span>
          {listing.shippingPrice != null && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {parseFloat(listing.shippingPrice) === 0
                  ? 'free shipping'
                  : `+ ${formatPrice(listing.shippingPrice)} ship`}
              </span>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
          <span className="text-[var(--text-muted)]">{listing.seller.username}</span>
          {listing.seller.location && (
            <>
              <span aria-hidden="true">·</span>
              <span>{listing.seller.location}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
