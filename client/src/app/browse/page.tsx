'use client';

import { useState, useEffect, Suspense, FormEvent, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import ListingCard from '@/components/ListingCard';
import ListingCardSkeleton from '@/components/ListingCardSkeleton';
import CategoryIcon from '@/components/CategoryIcon';
import {
  type ListingSummary,
  type ListingsResponse,
  type Pagination,
  CATEGORIES,
  CONDITIONS,
} from '@/types/listings';

const ITEMS_PER_PAGE = 12;

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  if (current <= 3) {
    return [1, 2, 3, 4, 5, 'ellipsis', total];
  }
  if (current >= total - 2) {
    return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total];
}

// ---------------------------------------------------------------------------
// Main browse content (needs Suspense for useSearchParams)
// ---------------------------------------------------------------------------

function BrowseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read current filter state from URL
  const activeCategory = searchParams.get('category') || '';
  const activeCondition = searchParams.get('condition') || '';
  const activeSort = searchParams.get('sort') || 'newest';
  const activeSearch = searchParams.get('search') || '';
  const activeMinPrice = searchParams.get('minPrice') || '';
  const activeMaxPrice = searchParams.get('maxPrice') || '';
  const activeBrand = searchParams.get('brand') || '';
  const activePage = parseInt(searchParams.get('page') || '1', 10);

  // Local state for text inputs (avoids URL updates while typing)
  const [searchInput, setSearchInput] = useState(activeSearch);
  const [brandInput, setBrandInput] = useState(activeBrand);
  const [minPriceInput, setMinPriceInput] = useState(activeMinPrice);
  const [maxPriceInput, setMaxPriceInput] = useState(activeMaxPrice);

  // Sync local inputs when URL changes externally (e.g. "Clear all")
  useEffect(() => {
    setSearchInput(activeSearch);
  }, [activeSearch]);
  useEffect(() => {
    setBrandInput(activeBrand);
  }, [activeBrand]);
  useEffect(() => {
    setMinPriceInput(activeMinPrice);
  }, [activeMinPrice]);
  useEffect(() => {
    setMaxPriceInput(activeMaxPrice);
  }, [activeMaxPrice]);

  // Mobile filter sidebar toggle
  const [showFilters, setShowFilters] = useState(false);

  // Data
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ------- URL update helpers -------

  const updateParams = useCallback(
    (updates: Record<string, string>, resetPage = true) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      if (resetPage && !('page' in updates)) {
        params.delete('page');
      }
      router.push(`/browse?${params.toString()}`);
    },
    [router, searchParams],
  );

  function clearAll() {
    router.push('/browse');
  }

  // ------- Fetch data -------

  useEffect(() => {
    let cancelled = false;

    async function fetchListings() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (activeCategory) params.set('category', activeCategory);
        if (activeCondition) params.set('condition', activeCondition);
        if (activeSort) params.set('sort', activeSort);
        if (activeSearch) params.set('search', activeSearch);
        if (activeMinPrice) params.set('minPrice', activeMinPrice);
        if (activeMaxPrice) params.set('maxPrice', activeMaxPrice);
        if (activeBrand) params.set('brand', activeBrand);
        params.set('page', String(activePage));
        params.set('limit', String(ITEMS_PER_PAGE));

        const data = await api<ListingsResponse>(
          `/api/listings?${params.toString()}`,
        );
        if (!cancelled) {
          setListings(data.listings);
          setPagination(data.pagination);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load listings');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchListings();
    return () => { cancelled = true; };
  }, [activeCategory, activeCondition, activeSort, activeSearch, activeMinPrice, activeMaxPrice, activeBrand, activePage]);

  // ------- Filter actions -------

  function toggleCategory(cat: string) {
    updateParams({ category: activeCategory === cat ? '' : cat });
  }

  function toggleCondition(cond: string) {
    updateParams({ condition: activeCondition === cond ? '' : cond });
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    updateParams({ search: searchInput.trim() });
  }

  // `priceError` also carries per-input flags so aria-invalid + red border
  // only apply to the input(s) actually at fault (min>max flags both).
  type PriceErr = { message: string; min: boolean; max: boolean };
  const [priceError, setPriceError] = useState<PriceErr | null>(null);

  function applyTextFilters() {
    const newBrand = brandInput.trim();
    const newMin = minPriceInput.trim();
    const newMax = maxPriceInput.trim();

    // Validate price range before committing to URL. Empty is fine (no bound).
    const minNum = newMin === '' ? null : Number(newMin);
    const maxNum = newMax === '' ? null : Number(newMax);
    if (minNum !== null && !Number.isFinite(minNum)) {
      setPriceError({ message: 'Min price must be a number', min: true, max: false });
      return;
    }
    if (maxNum !== null && !Number.isFinite(maxNum)) {
      setPriceError({ message: 'Max price must be a number', min: false, max: true });
      return;
    }
    if (minNum !== null && minNum < 0) {
      setPriceError({ message: 'Min price cannot be negative', min: true, max: false });
      return;
    }
    if (maxNum !== null && maxNum < 0) {
      setPriceError({ message: 'Max price cannot be negative', min: false, max: true });
      return;
    }
    if (minNum !== null && maxNum !== null && minNum > maxNum) {
      setPriceError({ message: 'Min price must be less than max', min: true, max: true });
      return;
    }
    setPriceError(null);

    if (newBrand === activeBrand && newMin === activeMinPrice && newMax === activeMaxPrice) return;
    updateParams({ brand: newBrand, minPrice: newMin, maxPrice: newMax });
  }

  function handleTextFilterKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyTextFilters();
    }
  }

  // Count of active filters (for mobile badge)
  const filterCount = [activeCategory, activeCondition, activeBrand, activeMinPrice, activeMaxPrice].filter(Boolean).length;

  return (
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Top bar: search + sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="flex-1">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search listings..."
                aria-label="Search listings"
                className="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </form>

          <div className="flex gap-3">
            {/* Mobile filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="lg:hidden flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {filterCount > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                  {filterCount}
                </span>
              )}
            </button>

            {/* Sort */}
            <select
              value={activeSort}
              onChange={(e) => updateParams({ sort: e.target.value })}
              aria-label="Sort listings"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="newest">Newest first</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>
        </div>

        <div className="lg:flex lg:gap-6">
          {/* ----- Filter sidebar ----- */}
          <aside
            className={`${showFilters ? 'block' : 'hidden'} lg:block w-full lg:w-60 flex-shrink-0 mb-6 lg:mb-0`}
          >
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm p-4 space-y-6">
              {/* Header + clear */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900">Filters</h3>
                {filterCount > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Category */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Category
                </h4>
                <div className="space-y-1">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                        activeCategory === cat
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-zinc-700 hover:bg-zinc-50'
                      }`}
                    >
                      <CategoryIcon
                        category={cat}
                        className="h-4 w-4 flex-shrink-0"
                      />
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Condition */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Condition
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => toggleCondition(c.value)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        activeCondition === c.value
                          ? c.bg + ' ring-1 ring-current'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price range */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Price Range (AUD)
                </h4>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    placeholder="Min"
                    value={minPriceInput}
                    onChange={(e) => setMinPriceInput(e.target.value)}
                    onKeyDown={handleTextFilterKeyDown}
                    onBlur={applyTextFilters}
                    aria-label="Minimum price"
                    aria-invalid={priceError?.min ?? false}
                    className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 ${
                      priceError?.min
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                        : 'border-zinc-300 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                  />
                  <span className="self-center text-zinc-400 text-sm">&ndash;</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Max"
                    value={maxPriceInput}
                    onChange={(e) => setMaxPriceInput(e.target.value)}
                    onKeyDown={handleTextFilterKeyDown}
                    onBlur={applyTextFilters}
                    aria-label="Maximum price"
                    aria-invalid={priceError?.max ?? false}
                    className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 ${
                      priceError?.max
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                        : 'border-zinc-300 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                  />
                </div>
                {priceError && (
                  <p className="mt-1 text-xs text-red-600" role="alert">
                    {priceError.message}
                  </p>
                )}
              </div>

              {/* Brand */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Brand
                </h4>
                <input
                  type="text"
                  placeholder="e.g. Apple, Samsung"
                  value={brandInput}
                  onChange={(e) => setBrandInput(e.target.value)}
                  onKeyDown={handleTextFilterKeyDown}
                  onBlur={applyTextFilters}
                  aria-label="Filter by brand"
                  className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </aside>

          {/* ----- Listings grid ----- */}
          <div className="flex-1 min-w-0">
            {/* Results summary */}
            {!loading && pagination && (
              <p className="text-sm text-zinc-500 mb-4">
                {pagination.total === 0
                  ? 'No results found'
                  : `Showing ${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total} listings`}
                {activeSearch && (
                  <span>
                    {' '}for &ldquo;<span className="font-medium text-zinc-700">{activeSearch}</span>&rdquo;
                  </span>
                )}
              </p>
            )}

            {/* Error */}
            {error && (
              <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-600 border border-red-200">
                {error}
              </div>
            )}

            {/* Grid */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: ITEMS_PER_PAGE }, (_, i) => (
                  <ListingCardSkeleton key={i} />
                ))}
              </div>
            ) : listings.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <svg
                  className="mx-auto h-12 w-12 text-zinc-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <p className="mt-4 text-zinc-500">No listings match your filters.</p>
                <button
                  onClick={clearAll}
                  className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Clear all filters
                </button>
              </div>
            )}

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-8 flex items-center justify-center gap-1"
              >
                <button
                  onClick={() => updateParams({ page: String(activePage - 1) }, false)}
                  disabled={activePage <= 1}
                  aria-label="Previous page"
                  className="rounded-lg border border-zinc-300 bg-white p-2 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                {getPageNumbers(activePage, pagination.totalPages).map(
                  (item, idx) =>
                    item === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-2 text-sm text-zinc-400"
                      >
                        &hellip;
                      </span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => updateParams({ page: String(item) }, false)}
                        aria-current={item === activePage ? 'page' : undefined}
                        className={`min-w-[36px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          item === activePage
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        {item}
                      </button>
                    ),
                )}

                <button
                  onClick={() => updateParams({ page: String(activePage + 1) }, false)}
                  disabled={activePage >= pagination.totalPages}
                  aria-label="Next page"
                  className="rounded-lg border border-zinc-300 bg-white p-2 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </nav>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper with Suspense (required by useSearchParams in Next.js)
// ---------------------------------------------------------------------------

function BrowseLoading() {
  return (
    <main className="flex-1 bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="h-10 bg-zinc-200 rounded-lg animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: ITEMS_PER_PAGE }, (_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<BrowseLoading />}>
      <BrowseContent />
    </Suspense>
  );
}
