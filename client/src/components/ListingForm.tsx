'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ImageUpload, { type ImageFile } from '@/components/ImageUpload';
import VideoUpload, { type VideoFile } from '@/components/VideoUpload';
import { api } from '@/lib/api';
import {
  CATEGORIES,
  CONDITIONS,
  type Condition,
  type FulfillmentMethod,
  type ListingDetail,
} from '@/types/listings';

type FormErrors = {
  title?: string;
  category?: string;
  condition?: string;
  price?: string;
  fulfillmentMethod?: string;
  shippingPrice?: string;
  description?: string;
  images?: string;
  video?: string;
};

const FULFILLMENT_OPTIONS: { value: FulfillmentMethod; label: string; hint: string }[] = [
  {
    value: 'PICKUP_ONLY',
    label: 'Pickup only',
    hint: 'Buyer collects in person — no shipping cost.',
  },
  {
    value: 'POST_ONLY',
    label: 'Post only',
    hint: 'You ship to the buyer. Set the shipping cost below.',
  },
  {
    value: 'BOTH',
    label: 'Pickup or post',
    hint: 'Buyer chooses at checkout. Set the shipping cost below.',
  },
];

const CONDITION_DESCRIPTIONS: Record<Condition, string> = {
  LIKE_NEW: 'Barely used, no visible wear. Includes all original accessories and packaging.',
  GOOD: 'Normal use with minor cosmetic wear. Fully functional, may be missing some accessories.',
  FAIR: 'Noticeable wear or cosmetic damage. Fully functional but shows clear signs of use.',
  POOR: 'Heavy wear or damage. May have functional issues. Sold as-is.',
};

type Props = {
  listing?: ListingDetail;
};

export default function ListingForm({ listing }: Props) {
  const router = useRouter();
  const isEdit = !!listing;

  const [title, setTitle] = useState(listing?.title ?? '');
  const [category, setCategory] = useState(listing?.category ?? '');
  const [brand, setBrand] = useState(listing?.brand ?? '');
  const [condition, setCondition] = useState<Condition | ''>(listing?.condition ?? '');
  const [price, setPrice] = useState(listing ? parseFloat(listing.price).toString() : '');
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>(
    listing?.fulfillmentMethod ?? 'PICKUP_ONLY',
  );
  const [shippingPrice, setShippingPrice] = useState(
    listing?.shippingPrice != null ? parseFloat(listing.shippingPrice).toString() : '',
  );
  const [description, setDescription] = useState(listing?.description ?? '');
  const [subcategory, setSubcategory] = useState(listing?.subcategory ?? '');
  const [platform, setPlatform] = useState(listing?.platform ?? '');
  const [images, setImages] = useState<ImageFile[]>(() => {
    if (!listing?.images.length) return [];
    return listing.images.map((img) => ({
      id: img.id,
      preview: img.url,
      url: img.url,
      uploading: false,
      error: null,
    }));
  });
  const [video, setVideo] = useState<VideoFile | null>(() => {
    const existing = listing?.videos?.[0];
    if (!existing) return null;
    return {
      id: existing.id,
      preview: existing.url,
      url: existing.url,
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
      uploading: false,
      error: null,
    };
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function validate(): FormErrors {
    const errs: FormErrors = {};

    if (!title.trim()) {
      errs.title = 'Title is required';
    } else if (title.trim().length < 3) {
      errs.title = 'Title must be at least 3 characters';
    } else if (title.length > 200) {
      errs.title = 'Title must be under 200 characters';
    }

    if (!category) errs.category = 'Category is required';
    if (!condition) errs.condition = 'Condition is required';

    const priceNum = parseFloat(price);
    if (!price.trim()) {
      errs.price = 'Price is required';
    } else if (isNaN(priceNum) || priceNum < 0) {
      errs.price = 'Price cannot be negative';
    } else if (priceNum > 999999.99) {
      errs.price = 'Price must be under $1,000,000';
    } else {
      const decimals = price.split('.')[1];
      if (decimals && decimals.length > 2) {
        errs.price = 'Price can have at most 2 decimal places';
      }
    }

    const postEnabled = fulfillmentMethod === 'POST_ONLY' || fulfillmentMethod === 'BOTH';
    if (postEnabled) {
      const shipNum = parseFloat(shippingPrice);
      if (!shippingPrice.trim()) {
        errs.shippingPrice = 'Shipping price is required';
      } else if (isNaN(shipNum) || shipNum < 0) {
        errs.shippingPrice = 'Shipping price cannot be negative';
      } else if (shipNum > 999999.99) {
        errs.shippingPrice = 'Shipping price must be under $1,000,000';
      } else {
        const decimals = shippingPrice.split('.')[1];
        if (decimals && decimals.length > 2) {
          errs.shippingPrice = 'Shipping price can have at most 2 decimal places';
        }
      }
    }

    if (!description.trim()) {
      errs.description = 'Description is required';
    } else if (description.trim().length < 10) {
      errs.description = 'Description must be at least 10 characters';
    } else if (description.length > 5000) {
      errs.description = 'Description must be under 5,000 characters';
    }

    if (images.some((img) => img.uploading)) {
      errs.images = 'Please wait for images to finish uploading';
    } else if (images.some((img) => img.error)) {
      errs.images = 'Some images failed to upload. Remove them or try again.';
    }

    if (video?.uploading) {
      errs.video = 'Please wait for the video to finish uploading';
    } else if (video?.error) {
      errs.video = 'The video failed to upload. Remove it or try again.';
    }

    return errs;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError('');

    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);

    try {
      const uploadedImages = images
        .filter((img) => img.url)
        .map((img, index) => ({ url: img.url!, displayOrder: index }));

      const postEnabled =
        fulfillmentMethod === 'POST_ONLY' || fulfillmentMethod === 'BOTH';
      const body: Record<string, unknown> = {
        title: title.trim(),
        category,
        condition,
        price: parseFloat(price),
        fulfillmentMethod,
        shippingPrice: postEnabled ? parseFloat(shippingPrice) : null,
        description: description.trim(),
      };

      if (brand.trim()) body.brand = brand.trim();
      else if (isEdit) body.brand = null;

      if (subcategory.trim()) body.subcategory = subcategory.trim();
      else if (isEdit) body.subcategory = null;

      if (platform.trim()) body.platform = platform.trim();
      else if (isEdit) body.platform = null;

      body.images = uploadedImages;

      // Always send `videos` (as an empty array if cleared) so PUT can
      // distinguish "remove the video" from "leave it alone" — the server
      // treats undefined as "don't touch", same as images.
      const videoPayload =
        video && video.url
          ? [
              {
                url: video.url,
                mimeType: video.mimeType,
                sizeBytes: video.sizeBytes,
                displayOrder: 0,
              },
            ]
          : [];
      body.videos = videoPayload;

      if (isEdit) {
        await api<{ listing: { id: string } }>(`/api/listings/${listing.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        router.push(`/listings/${listing.id}`);
      } else {
        const res = await api<{ listing: { id: string } }>('/api/listings', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        router.push(`/listings/${res.listing.id}`);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--text-primary)]">Home</Link>
        <span className="mx-2">/</span>
        {isEdit ? (
          <>
            <Link href={`/listings/${listing.id}`} className="hover:text-[var(--text-primary)]">
              {listing.title}
            </Link>
            <span className="mx-2">/</span>
            <span className="text-[var(--text-primary)]">Edit</span>
          </>
        ) : (
          <span className="text-[var(--text-primary)]">Sell an Item</span>
        )}
      </nav>

      <h1 className="text-2xl font-bold text-[var(--text-primary)]">
        {isEdit ? 'Edit Listing' : 'Create a Listing'}
      </h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {isEdit
          ? 'Update the details of your listing.'
          : 'Fill in the details below to list your item for sale.'}
      </p>

      {submitError && (
        <div className="mt-4 rounded-lg border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-3 text-sm text-[var(--neon-danger)]">
          {submitError}
          <button
            onClick={() => setSubmitError('')}
            className="float-right font-medium hover:brightness-110"
          >
            &times;
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-8">
        {/* Photos */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Photos</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Add up to 10 photos. The first image will be the cover photo.
          </p>
          <div className="mt-3">
            <ImageUpload images={images} onChange={setImages} maxImages={10} />
          </div>
          {errors.images && <p className="mt-1.5 text-sm text-[var(--neon-danger)]">{errors.images}</p>}
        </section>

        <hr className="border-[var(--border-subtle)]" />

        {/* Video (optional) */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Video <span className="text-[var(--text-muted)] text-sm font-normal">(optional)</span>
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            One short demo or showcase clip. Shown after your photos on the listing.
          </p>
          <div className="mt-3">
            <VideoUpload video={video} onChange={setVideo} />
          </div>
          {errors.video && <p className="mt-1.5 text-sm text-[var(--neon-danger)]">{errors.video}</p>}
        </section>

        <hr className="border-[var(--border-subtle)]" />

        {/* Item Details */}
        <section className="space-y-5">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Item Details</h2>

          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-[var(--text-primary)]">
              Title <span className="text-[var(--neon-danger)]">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "iPhone 14 Pro 128GB — Space Black"'
              maxLength={200}
              className={`mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-1 ${
                errors.title
                  ? 'border-[var(--neon-danger)]/60 bg-[var(--bg-input)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
                  : 'input-cyber'
              }`}
            />
            <div className="mt-1 flex justify-between">
              {errors.title ? <p className="text-sm text-[var(--neon-danger)]">{errors.title}</p> : <span />}
              <span className="text-xs text-[var(--text-dim)]">{title.length}/200</span>
            </div>
          </div>

          {/* Category */}
          <div>
            <label htmlFor="category" className="block text-sm font-medium text-[var(--text-primary)]">
              Category <span className="text-[var(--neon-danger)]">*</span>
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-1 ${
                errors.category
                  ? 'border-[var(--neon-danger)]/60 bg-[var(--bg-input)] text-[var(--text-primary)] focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
                  : 'input-cyber'
              } ${!category ? 'text-[var(--text-dim)]' : ''}`}
            >
              <option value="" disabled>Select a category</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            {errors.category && <p className="mt-1 text-sm text-[var(--neon-danger)]">{errors.category}</p>}
          </div>

          {/* Brand / Subcategory / Platform */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="brand" className="block text-sm font-medium text-[var(--text-primary)]">Brand</label>
              <input
                id="brand"
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Apple, Samsung"
                maxLength={100}
                className="input-cyber mt-1 w-full px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="subcategory" className="block text-sm font-medium text-[var(--text-primary)]">Subcategory</label>
              <input
                id="subcategory"
                type="text"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                placeholder="e.g. Smartphone, Laptop"
                className="input-cyber mt-1 w-full px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="platform" className="block text-sm font-medium text-[var(--text-primary)]">Platform</label>
              <input
                id="platform"
                type="text"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="e.g. iOS, Windows"
                className="input-cyber mt-1 w-full px-3 py-2"
              />
            </div>
          </div>
        </section>

        <hr className="border-[var(--border-subtle)]" />

        {/* Condition */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Condition <span className="text-[var(--neon-danger)]">*</span>
          </h2>
          {errors.condition && <p className="mt-1 text-sm text-[var(--neon-danger)]">{errors.condition}</p>}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CONDITIONS.map((c) => {
              const selected = condition === c.value;
              return (
                <label
                  key={c.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                    selected
                      ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)] ring-1 ring-[var(--neon-cyan)]'
                      : 'border-[var(--border-subtle)] hover:border-[var(--border-hi)] hover:bg-[var(--bg-panel-hi)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="condition"
                    value={c.value}
                    checked={selected}
                    onChange={() => setCondition(c.value)}
                    className="mt-0.5 h-4 w-4 border-[var(--border-hi)] text-[var(--neon-cyan)] focus:ring-[var(--neon-cyan)]"
                  />
                  <div>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${c.bg}`}>
                      {c.label}
                    </span>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{CONDITION_DESCRIPTIONS[c.value]}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <hr className="border-[var(--border-subtle)]" />

        {/* Pricing */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Pricing</h2>
          <div className="mt-3">
            <label htmlFor="price" className="block text-sm font-medium text-[var(--text-primary)]">
              Price (AUD) <span className="text-[var(--neon-danger)]">*</span>
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">$</span>
              <input
                id="price"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) setPrice(val);
                }}
                placeholder="0.00"
                className={`w-full rounded-lg border py-2 pl-8 pr-14 focus:outline-none focus:ring-1 ${
                  errors.price
                    ? 'border-[var(--neon-danger)]/60 bg-[var(--bg-input)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
                    : 'input-cyber'
                }`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-dim)]">AUD</span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Use $0.00 to give the item away.
            </p>
            {errors.price && <p className="mt-1 text-sm text-[var(--neon-danger)]">{errors.price}</p>}
          </div>
        </section>

        <hr className="border-[var(--border-subtle)]" />

        {/* Delivery */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Delivery <span className="text-[var(--neon-danger)]">*</span>
          </h2>
          {errors.fulfillmentMethod && (
            <p className="mt-1 text-sm text-[var(--neon-danger)]">{errors.fulfillmentMethod}</p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FULFILLMENT_OPTIONS.map((opt) => {
              const selected = fulfillmentMethod === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                    selected
                      ? 'border-[var(--neon-cyan)] bg-[var(--tint-cyan)] ring-1 ring-[var(--neon-cyan)]'
                      : 'border-[var(--border-subtle)] hover:border-[var(--border-hi)] hover:bg-[var(--bg-panel-hi)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="fulfillmentMethod"
                    value={opt.value}
                    checked={selected}
                    onChange={() => setFulfillmentMethod(opt.value)}
                    className="mt-0.5 h-4 w-4 border-[var(--border-hi)] text-[var(--neon-cyan)] focus:ring-[var(--neon-cyan)]"
                  />
                  <div>
                    <span className="block text-sm font-medium text-[var(--text-primary)]">
                      {opt.label}
                    </span>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{opt.hint}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {(fulfillmentMethod === 'POST_ONLY' || fulfillmentMethod === 'BOTH') && (
            <div className="mt-4">
              <label
                htmlFor="shippingPrice"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Shipping price (AUD) <span className="text-[var(--neon-danger)]">*</span>
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                  $
                </span>
                <input
                  id="shippingPrice"
                  type="text"
                  inputMode="decimal"
                  value={shippingPrice}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) setShippingPrice(val);
                  }}
                  placeholder="0.00"
                  className={`w-full rounded-lg border py-2 pl-8 pr-14 focus:outline-none focus:ring-1 ${
                    errors.shippingPrice
                      ? 'border-[var(--neon-danger)]/60 bg-[var(--bg-input)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
                      : 'input-cyber'
                  }`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-dim)]">
                  AUD
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Charged on top of the item price when the buyer chooses delivery. Use $0.00
                for free shipping.
              </p>
              {errors.shippingPrice && (
                <p className="mt-1 text-sm text-[var(--neon-danger)]">{errors.shippingPrice}</p>
              )}
            </div>
          )}
        </section>

        <hr className="border-[var(--border-subtle)]" />

        {/* Description */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Description</h2>
          <div className="mt-3">
            <label htmlFor="description" className="block text-sm font-medium text-[var(--text-primary)]">
              Describe your item <span className="text-[var(--neon-danger)]">*</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={5000}
              placeholder="Include details like model, storage, colour, what's included, any defects or damage, and reason for selling."
              className={`mt-1 w-full resize-y rounded-lg border px-3 py-2 focus:outline-none focus:ring-1 ${
                errors.description
                  ? 'border-[var(--neon-danger)]/60 bg-[var(--bg-input)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:border-[var(--neon-danger)] focus:ring-[var(--neon-danger)]'
                  : 'input-cyber'
              }`}
            />
            <div className="mt-1 flex justify-between">
              {errors.description ? (
                <p className="text-sm text-[var(--neon-danger)]">{errors.description}</p>
              ) : (
                <span />
              )}
              <span className="text-xs text-[var(--text-dim)]">{description.length}/5000</span>
            </div>
          </div>
        </section>

        <hr className="border-[var(--border-subtle)]" />

        {/* Submit */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting}
            className="btn-cyber-primary"
          >
            {submitting
              ? isEdit ? 'Saving...' : 'Publishing...'
              : isEdit ? 'Save Changes' : 'Publish Listing'}
          </button>
          <Link
            href={isEdit ? `/listings/${listing.id}` : '/'}
            className="btn-cyber-ghost"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
