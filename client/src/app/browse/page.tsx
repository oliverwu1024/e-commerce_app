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

const ITEMS_PER_PAGE = 9;

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

  const activeCategory = searchParams.get('category') || '';
  const activeCondition = searchParams.get('condition') || '';
  const activeSort = searchParams.get('sort') || 'newest';
  const activeSearch = searchParams.get('search') || '';
  const activeMinPrice = searchParams.get('minPrice') || '';
  const activeMaxPrice = searchParams.get('maxPrice') || '';
  const activeBrand = searchParams.get('brand') || '';
  const activePage = parseInt(searchParams.get('page') || '1', 10);

  const [searchInput, setSearchInput] = useState(activeSearch);
  const [brandInput, setBrandInput] = useState(activeBrand);
  const [minPriceInput, setMinPriceInput] = useState(activeMinPrice);
  const [maxPriceInput, setMaxPriceInput] = useState(activeMaxPrice);

  useEffect(() => { setSearchInput(activeSearch); }, [activeSearch]);
  useEffect(() => { setBrandInput(activeBrand); }, [activeBrand]);
  useEffect(() => { setMinPriceInput(activeMinPrice); }, [activeMinPrice]);
  useEffect(() => { setMaxPriceInput(activeMaxPrice); }, [activeMaxPrice]);

  const [showFilters, setShowFilters] = useState(false);

  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  type PriceErr = { message: string; min: boolean; max: boolean };
  const [priceError, setPriceError] = useState<PriceErr | null>(null);

  function applyTextFilters() {
    const newBrand = brandInput.trim();
    const newMin = minPriceInput.trim();
    const newMax = maxPriceInput.trim();

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

  const filterCount = [activeCategory, activeCondition, activeBrand, activeMinPrice, activeMaxPrice].filter(Boolean).length;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Page heading */}
        <div className="mb-6 border-b border-[var(--border-subtle)] pb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            Browse listings
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Filter by category, condition, price and brand.
          </p>
        </div>

        {/* Top bar: search + sort */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <form onSubmit={handleSearchSubmit} className="flex-1">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-dim)]"
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
                placeholder="Search listings…"
                aria-label="Search listings"
                className="input-cyber w-full py-2.5 pl-10 pr-4 text-sm"
              />
            </div>
          </form>

          <div className="flex gap-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="btn-cyber-outline text-sm lg:hidden"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {filterCount > 0 && (
                <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--neon-cyan)] px-1 text-[11px] font-bold text-[#062027]">
                  {filterCount}
                </span>
              )}
            </button>

            <select
              value={activeSort}
              onChange={(e) => updateParams({ sort: e.target.value })}
              aria-label="Sort listings"
              className="input-cyber px-3 py-2.5 text-sm"
            >
              <option value="newest">Newest first</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </div>
        </div>

        <div className="lg:flex lg:gap-6">
          {/* ----- Filter sidebar ----- */}
          <aside
            className={`${showFilters ? 'block' : 'hidden'} lg:block w-full lg:w-64 flex-shrink-0 mb-6 lg:mb-0`}
          >
            <div className="panel clip-corner-sm space-y-6 p-5">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Filters
                </h3>
                {filterCount > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs font-semibold text-[var(--neon-cyan)] hover:text-[var(--accent-soft)] transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Category */}
              <div>
                <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">
                  Category
                </h4>
                <div className="space-y-0.5">
                  {CATEGORIES.map((cat) => {
                    const active = activeCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                          active
                            ? 'bg-[var(--tint-cyan)] text-[var(--neon-cyan)] font-semibold'
                            : 'text-[var(--text-muted)] hover:bg-[var(--bg-panel-hi)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <CategoryIcon
                          category={cat}
                          className="h-4 w-4 flex-shrink-0"
                        />
                        <span>{cat}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Condition */}
              <div>
                <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">
                  Condition
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {CONDITIONS.map((c) => {
                    const active = activeCondition === c.value;
                    return (
                      <button
                        key={c.value}
                        onClick={() => toggleCondition(c.value)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                          active
                            ? c.bg + ' ring-1 ring-current'
                            : 'bg-[var(--bg-panel-hi)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:border-[var(--border-hi)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Price range */}
              <div>
                <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">
                  Price range (AUD)
                </h4>
                <div className="flex items-center gap-2">
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
                    className={`input-cyber w-full px-2.5 py-1.5 text-sm ${
                      priceError?.min ? '!border-[var(--neon-danger)]' : ''
                    }`}
                  />
                  <span className="text-[var(--text-dim)]">–</span>
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
                    className={`input-cyber w-full px-2.5 py-1.5 text-sm ${
                      priceError?.max ? '!border-[var(--neon-danger)]' : ''
                    }`}
                  />
                </div>
                {priceError && (
                  <p className="mt-1.5 text-xs text-[var(--neon-danger)]" role="alert">
                    {priceError.message}
                  </p>
                )}
              </div>

              {/* Brand */}
              <div>
                <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-dim)]">
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
                  className="input-cyber w-full px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
          </aside>

          {/* ----- Listings grid ----- */}
          <div className="min-w-0 flex-1">
            {!loading && pagination && (
              <p className="mb-4 text-sm text-[var(--text-muted)]">
                {pagination.total === 0
                  ? 'No results found'
                  : `Showing ${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total} listings`}
                {activeSearch && (
                  <span>
                    {' '}for &ldquo;
                    <span className="font-semibold text-[var(--text-primary)]">{activeSearch}</span>
                    &rdquo;
                  </span>
                )}
              </p>
            )}

            {error && (
              <div className="mb-4 rounded-md border border-[var(--neon-danger)]/40 bg-[var(--tint-danger)] p-4 text-sm text-[var(--neon-danger)]">
                {error}
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: ITEMS_PER_PAGE }, (_, i) => (
                  <ListingCardSkeleton key={i} />
                ))}
              </div>
            ) : listings.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            ) : (
              <div className="panel clip-corner py-20 text-center">
                <svg
                  className="mx-auto h-12 w-12 text-[var(--text-dim)]"
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
                <p className="mt-4 text-[var(--text-muted)]">
                  No listings match your filters.
                </p>
                <button onClick={clearAll} className="btn-cyber-outline mt-5 text-sm">
                  Clear all filters
                </button>
              </div>
            )}

            {pagination && pagination.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-10 flex items-center justify-center gap-1"
              >
                <button
                  onClick={() => updateParams({ page: String(activePage - 1) }, false)}
                  disabled={activePage <= 1}
                  aria-label="Previous page"
                  className="rounded-md border border-[var(--border-hi)] bg-[var(--bg-panel)] p-2 text-[var(--text-muted)] transition-colors hover:border-[var(--neon-cyan)]/50 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--border-hi)] disabled:hover:text-[var(--text-muted)]"
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
                        className="px-2 text-sm text-[var(--text-dim)]"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => updateParams({ page: String(item) }, false)}
                        aria-current={item === activePage ? 'page' : undefined}
                        className={`min-w-[36px] rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                          item === activePage
                            ? 'bg-[var(--neon-cyan)] text-[#062027]'
                            : 'border border-[var(--border-hi)] bg-[var(--bg-panel)] text-[var(--text-muted)] hover:border-[var(--neon-cyan)]/50 hover:text-[var(--text-primary)]'
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
                  className="rounded-md border border-[var(--border-hi)] bg-[var(--bg-panel)] p-2 text-[var(--text-muted)] transition-colors hover:border-[var(--neon-cyan)]/50 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[var(--border-hi)] disabled:hover:text-[var(--text-muted)]"
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
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 h-10 animate-pulse rounded bg-[var(--bg-panel)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
