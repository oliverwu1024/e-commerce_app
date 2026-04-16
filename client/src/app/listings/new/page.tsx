'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import ImageUpload, { type ImageFile } from '@/components/ImageUpload';
import { api } from '@/lib/api';
import { CATEGORIES, CONDITIONS, type Condition } from '@/types/listings';

type FormErrors = {
  title?: string;
  category?: string;
  condition?: string;
  price?: string;
  description?: string;
  images?: string;
};

const CONDITION_DESCRIPTIONS: Record<Condition, string> = {
  LIKE_NEW: 'Barely used, no visible wear. Includes all original accessories and packaging.',
  GOOD: 'Normal use with minor cosmetic wear. Fully functional, may be missing some accessories.',
  FAIR: 'Noticeable wear or cosmetic damage. Fully functional but shows clear signs of use.',
  POOR: 'Heavy wear or damage. May have functional issues. Sold as-is.',
};

export default function CreateListingPage() {
  return (
    <ProtectedRoute>
      <CreateListingForm />
    </ProtectedRoute>
  );
}

function CreateListingForm() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [condition, setCondition] = useState<Condition | ''>('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [platform, setPlatform] = useState('');
  const [images, setImages] = useState<ImageFile[]>([]);

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

    if (!category) {
      errs.category = 'Category is required';
    }

    if (!condition) {
      errs.condition = 'Condition is required';
    }

    const priceNum = parseFloat(price);
    if (!price.trim()) {
      errs.price = 'Price is required';
    } else if (isNaN(priceNum) || priceNum <= 0) {
      errs.price = 'Price must be greater than $0';
    } else if (priceNum > 999999.99) {
      errs.price = 'Price must be under $1,000,000';
    } else {
      const decimals = price.split('.')[1];
      if (decimals && decimals.length > 2) {
        errs.price = 'Price can have at most 2 decimal places';
      }
    }

    if (!description.trim()) {
      errs.description = 'Description is required';
    } else if (description.trim().length < 10) {
      errs.description = 'Description must be at least 10 characters';
    } else if (description.length > 5000) {
      errs.description = 'Description must be under 5,000 characters';
    }

    const hasUploadingImages = images.some((img) => img.uploading);
    if (hasUploadingImages) {
      errs.images = 'Please wait for images to finish uploading';
    }

    const hasFailedImages = images.some((img) => img.error);
    if (hasFailedImages) {
      errs.images = 'Some images failed to upload. Remove them or try again.';
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
        .map((img, index) => ({
          url: img.url!,
          displayOrder: index,
        }));

      const body: Record<string, unknown> = {
        title: title.trim(),
        category,
        condition,
        price: parseFloat(price),
        description: description.trim(),
      };

      if (brand.trim()) body.brand = brand.trim();
      if (subcategory.trim()) body.subcategory = subcategory.trim();
      if (platform.trim()) body.platform = platform.trim();
      if (uploadedImages.length > 0) body.images = uploadedImages;

      const res = await api<{ listing: { id: string } }>('/api/listings', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      router.push(`/listings/${res.listing.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create listing');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-zinc-500">
        <Link href="/" className="hover:text-zinc-700">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-900">Sell an Item</span>
      </nav>

      <h1 className="text-2xl font-bold text-zinc-900">Create a Listing</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Fill in the details below to list your item for sale.
      </p>

      {submitError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {submitError}
          <button
            onClick={() => setSubmitError('')}
            className="float-right font-medium hover:text-red-800"
          >
            &times;
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-8">
        {/* --- Photos --- */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900">Photos</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Add up to 10 photos. The first image will be the cover photo.
          </p>
          <div className="mt-3">
            <ImageUpload images={images} onChange={setImages} maxImages={10} />
          </div>
          {errors.images && (
            <p className="mt-1.5 text-sm text-red-600">{errors.images}</p>
          )}
        </section>

        <hr className="border-zinc-200" />

        {/* --- Details --- */}
        <section className="space-y-5">
          <h2 className="text-lg font-semibold text-zinc-900">Item Details</h2>

          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-zinc-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "iPhone 14 Pro 128GB — Space Black"'
              maxLength={200}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 ${
                errors.title
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-zinc-300 focus:border-blue-500 focus:ring-blue-500'
              }`}
            />
            <div className="mt-1 flex justify-between">
              {errors.title ? (
                <p className="text-sm text-red-600">{errors.title}</p>
              ) : (
                <span />
              )}
              <span className="text-xs text-zinc-400">{title.length}/200</span>
            </div>
          </div>

          {/* Category */}
          <div>
            <label htmlFor="category" className="block text-sm font-medium text-zinc-700">
              Category <span className="text-red-500">*</span>
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-zinc-900 focus:outline-none focus:ring-1 ${
                errors.category
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-zinc-300 focus:border-blue-500 focus:ring-blue-500'
              } ${!category ? 'text-zinc-400' : ''}`}
            >
              <option value="" disabled>
                Select a category
              </option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            {errors.category && (
              <p className="mt-1 text-sm text-red-600">{errors.category}</p>
            )}
          </div>

          {/* Brand + Subcategory + Platform row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="brand" className="block text-sm font-medium text-zinc-700">
                Brand
              </label>
              <input
                id="brand"
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Apple, Samsung"
                maxLength={100}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="subcategory" className="block text-sm font-medium text-zinc-700">
                Subcategory
              </label>
              <input
                id="subcategory"
                type="text"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                placeholder="e.g. Smartphone, Laptop"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="platform" className="block text-sm font-medium text-zinc-700">
                Platform
              </label>
              <input
                id="platform"
                type="text"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="e.g. iOS, Windows"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </section>

        <hr className="border-zinc-200" />

        {/* --- Condition --- */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-700">
            Condition <span className="text-red-500">*</span>
          </h2>
          {errors.condition && (
            <p className="mt-1 text-sm text-red-600">{errors.condition}</p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CONDITIONS.map((c) => {
              const selected = condition === c.value;
              return (
                <label
                  key={c.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                    selected
                      ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                      : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="condition"
                    value={c.value}
                    checked={selected}
                    onChange={() => setCondition(c.value)}
                    className="mt-0.5 h-4 w-4 border-zinc-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${c.bg}`}
                    >
                      {c.label}
                    </span>
                    <p className="mt-1 text-sm text-zinc-600">
                      {CONDITION_DESCRIPTIONS[c.value]}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <hr className="border-zinc-200" />

        {/* --- Pricing --- */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900">Pricing</h2>
          <div className="mt-3">
            <label htmlFor="price" className="block text-sm font-medium text-zinc-700">
              Price (AUD) <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
                $
              </span>
              <input
                id="price"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                    setPrice(val);
                  }
                }}
                placeholder="0.00"
                className={`w-full rounded-lg border py-2 pl-8 pr-14 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 ${
                  errors.price
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-zinc-300 focus:border-blue-500 focus:ring-blue-500'
                }`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                AUD
              </span>
            </div>
            {errors.price && (
              <p className="mt-1 text-sm text-red-600">{errors.price}</p>
            )}
          </div>
        </section>

        <hr className="border-zinc-200" />

        {/* --- Description --- */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900">Description</h2>
          <div className="mt-3">
            <label htmlFor="description" className="block text-sm font-medium text-zinc-700">
              Describe your item <span className="text-red-500">*</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={5000}
              placeholder="Include details like model, storage, colour, what's included, any defects or damage, and reason for selling."
              className={`mt-1 w-full resize-y rounded-lg border px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 ${
                errors.description
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-zinc-300 focus:border-blue-500 focus:ring-blue-500'
              }`}
            />
            <div className="mt-1 flex justify-between">
              {errors.description ? (
                <p className="text-sm text-red-600">{errors.description}</p>
              ) : (
                <span />
              )}
              <span className="text-xs text-zinc-400">
                {description.length}/5000
              </span>
            </div>
          </div>
        </section>

        <hr className="border-zinc-200" />

        {/* --- Submit --- */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Publishing...' : 'Publish Listing'}
          </button>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-800"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
