'use client';

import { useState, useEffect, FormEvent, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import ListingCard from '@/components/ListingCard';
import ListingCardSkeleton from '@/components/ListingCardSkeleton';
import CategoryIcon from '@/components/CategoryIcon';
import {
  type ListingSummary,
  type ListingsResponse,
  formatPrice,
} from '@/types/listings';

export default function Home() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [allListings, setAllListings] = useState<ListingSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const data = await api<ListingsResponse>('/api/listings?limit=40&sort=newest');
        if (!cancelled) {
          setAllListings(data.listings);
          setTotalCount(data.pagination.total);
        }
      } catch {
        // Listings may not be available yet — empty states handle it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, []);

  const trending = allListings.slice(0, 4);
  const featured = allListings.slice(4, 12);
  const recent = allListings.length > 12 ? allListings.slice(12, 20) : allListings.slice(0, 8);

  const categoryThumbs = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const l of allListings) {
      if (!map[l.category] && l.images[0]?.url) {
        map[l.category] = l.images[0].url;
      }
    }
    return map;
  }, [allListings]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/browse?search=${encodeURIComponent(q)}` : '/browse');
  }

  return (
    <main className="flex-1">
      {/* ============================================================
         HERO (split)
         ============================================================ */}
      <section className="relative overflow-hidden border-b border-[var(--border-subtle)]">
        <div className="hero-glow absolute inset-0" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:py-14 lg:py-20">
          <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
            {/* LEFT */}
            <div>
              <h1 className="text-[2rem] font-medium leading-[1.08] tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-6xl">
                Buy &amp; sell
                <br />
                <span className="font-display font-semibold text-[var(--neon-cyan)]">
                  used electronics
                </span>
                <span className="text-[var(--text-dim)]">.</span>
              </h1>
              <p className="mt-4 max-w-xl text-sm font-medium leading-relaxed text-[var(--text-muted)] sm:mt-5 sm:text-lg">
                Phones, laptops, consoles, cameras and peripherals — from trusted
                sellers across Australia.
              </p>

              <form onSubmit={handleSearch} className="mt-6 max-w-xl sm:mt-7" data-tour="search">
                <div className="flex overflow-hidden rounded-lg border border-[var(--border-hi)] bg-[var(--bg-input)] backdrop-blur-sm focus-within:border-[var(--neon-cyan)] focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--neon-cyan)_18%,transparent)] transition-all">
                  <div className="relative flex-1">
                    <svg
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--text-dim)] sm:left-4"
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
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search phones, laptops…"
                      aria-label="Search listings"
                      className="w-full bg-transparent py-3 pl-11 pr-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none sm:py-4 sm:pl-12 sm:pr-4 sm:text-base"
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-[var(--neon-cyan)] px-4 text-sm font-semibold text-[var(--btn-primary-text)] transition-colors hover:bg-[var(--accent-soft)] sm:px-7 sm:text-base"
                  >
                    Search
                  </button>
                </div>
              </form>
            </div>

            {/* RIGHT */}
            <TrendingMiniGrid listings={trending} loading={loading} />
          </div>

          {/* Trust strip */}
          <TrustStrip totalCount={totalCount} />
        </div>
      </section>

      {/* ============================================================
         BENTO CATEGORIES — white band on light
         ============================================================ */}
      <section className="relative bg-[var(--bg-band)] transition-colors">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16 lg:py-20">
          <div className="mb-6 sm:mb-10">
            <p className="font-serif-italic text-base text-[var(--text-primary)] sm:text-xl">
              Curated categories
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
              Browse by category
            </h2>
          </div>
          <CategoryBento thumbs={categoryThumbs} />
        </div>
      </section>

      {/* ============================================================
         TRENDING STRIP — default cream band
         ============================================================ */}
      {(loading || featured.length > 0) && (
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16 lg:py-20">
            <div className="mb-6 flex items-end justify-between gap-3 sm:mb-10 sm:gap-4">
              <div className="min-w-0">
                <p className="font-serif-italic text-base text-[var(--text-primary)] sm:text-xl">
                  What&rsquo;s moving today
                </p>
                <h2 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:gap-3 sm:text-4xl">
                  <span
                    aria-hidden="true"
                    className="relative inline-flex h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3"
                  >
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--neon-cyan)] opacity-60"></span>
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--neon-cyan)] shadow-[0_0_10px_color-mix(in_oklab,var(--neon-cyan)_50%,transparent)] sm:h-3 sm:w-3"></span>
                  </span>
                  <span>
                    <span className="text-[var(--neon-cyan)]">Trending</span>
                    <span className="text-[var(--text-primary)]"> right now</span>
                  </span>
                </h2>
              </div>
              <Link
                href="/browse?sort=newest"
                className="shrink-0 text-xs font-semibold text-[var(--neon-cyan)] transition-colors hover:text-[var(--accent-soft)] sm:text-sm"
              >
                View more →
              </Link>
            </div>
            <DealsStrip listings={featured} loading={loading} />
          </div>
        </section>
      )}

      {/* ============================================================
         RECENT LISTINGS — white band
         ============================================================ */}
      <section className="relative bg-[var(--bg-band)] transition-colors">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16 lg:py-20">
          <div className="mb-6 flex items-end justify-between gap-3 sm:mb-10 sm:gap-4">
            <div className="min-w-0">
              <p className="font-serif-italic text-base text-[var(--text-primary)] sm:text-xl">
                Just listed
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
                Recent listings
              </h2>
            </div>
            <Link
              href="/browse"
              className="shrink-0 text-xs font-semibold text-[var(--neon-cyan)] transition-colors hover:text-[var(--accent-soft)] sm:text-sm"
            >
              View all →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {loading
              ? Array.from({ length: 8 }, (_, i) => <ListingCardSkeleton key={i} />)
              : recent.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
          </div>

          {!loading && allListings.length === 0 && (
            <div className="panel clip-corner mt-4 py-16 text-center">
              <p className="text-[var(--text-muted)]">
                No listings yet. Be the first to post!
              </p>
              <Link href="/listings/new" className="btn-cyber-primary mt-6">
                + Sell an item
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ============================================================
         FEATURED FROM SQUARE — pulled live from a partner Square
         Catalog (read-only). Demonstrates the platform's Square API
         integration in a buyer-facing surface.
         ============================================================ */}
      <SquareFeaturedRail />
    </main>
  );
}

/* ================================================================
   TRENDING AD (right side of hero) — single featured product,
   auto-rotates through the top picks every 4.5s
   ================================================================ */
function TrendingMiniGrid({
  listings,
  loading,
}: {
  listings: ListingSummary[];
  loading: boolean;
}) {
  const items = listings.slice(0, 5);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused || items.length < 2) return;
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % items.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [isPaused, items.length]);

  const safeIndex = items.length > 0 ? activeIndex % items.length : 0;

  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.16em] sm:mb-4 sm:gap-2.5 sm:text-lg sm:tracking-[0.18em]">
        <span aria-hidden="true" className="relative inline-flex h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--neon-cyan)] opacity-70"></span>
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--neon-cyan)] shadow-[0_0_10px_color-mix(in_oklab,var(--neon-cyan)_60%,transparent)] sm:h-3 sm:w-3"></span>
        </span>
        <span className="text-bling">Trending right now</span>
      </p>

      <div
        className="panel clip-corner relative aspect-[4/3] overflow-hidden"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {!items[0] ? (
          <div className="absolute inset-0 animate-pulse bg-[var(--bg-panel-hi)]" />
        ) : (
          <>
            {items.map((item, i) => (
              <Link
                key={item.id}
                href={`/listings/${item.id}`}
                aria-hidden={i !== safeIndex}
                tabIndex={i !== safeIndex ? -1 : 0}
                className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${
                  i === safeIndex
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none'
                }`}
              >
                {item.images[0]?.url ? (
                  <img
                    src={item.images[0].url}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-[var(--bg-panel-hi)]">
                    <CategoryIcon
                      category={item.category}
                      className="h-16 w-16 text-[var(--text-dim)]"
                    />
                  </div>
                )}

                {/* Dark bottom gradient for legibility */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.88)] via-[rgba(0,0,0,0.15)] to-transparent"
                />

                {/* Rank badge */}
                <span className="absolute top-3 left-3 rounded-md bg-[var(--neon-cyan)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] text-[var(--btn-primary-text)] shadow-[0_0_18px_color-mix(in_oklab,var(--neon-cyan)_50%,transparent)]">
                  #{i + 1} Trending
                </span>

                {/* Content */}
                <div className="absolute inset-x-0 bottom-0 p-4 pb-10 text-white">
                  <h3 className="line-clamp-2 text-base font-bold leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-2xl font-extrabold text-[var(--accent-soft)] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                    {formatPrice(item.price)}
                  </p>
                  {item.seller.location && (
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/75">
                      {item.seller.location}
                    </p>
                  )}
                </div>
              </Link>
            ))}

            {/* Progress pills */}
            {items.length > 1 && (
              <div className="absolute bottom-3 left-0 right-0 z-10 flex justify-center gap-1.5">
                {items.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveIndex(i);
                    }}
                    aria-label={`Show trending item ${i + 1}`}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      i === safeIndex
                        ? 'w-8 bg-[var(--neon-cyan)] shadow-[0_0_8px_color-mix(in_oklab,var(--neon-cyan)_70%,transparent)]'
                        : 'w-2.5 bg-white/55 hover:bg-white/85'
                    }`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   TRUST STRIP
   ================================================================ */
function TrustStrip({ totalCount }: { totalCount: number }) {
  const countLabel =
    totalCount > 0
      ? `${totalCount.toLocaleString()} listing${totalCount === 1 ? '' : 's'} · growing daily`
      : 'Growing daily';

  const items = [
    { key: 'verified', label: 'Verified sellers' },
    { key: 'australia', label: 'Australia-wide' },
    { key: 'trending', label: countLabel },
  ];

  return (
    <div className="mt-8 grid grid-cols-1 gap-y-3 gap-x-6 border-t border-[var(--border-subtle)] pt-5 sm:mt-12 sm:grid-cols-3 sm:gap-y-4 sm:pt-6">
      {items.map((item, i) => (
        <div key={item.key} className="flex items-center gap-3">
          <span
            className="trust-icon-box flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md sm:h-11 sm:w-11"
            style={{ animationDelay: `${i * 1.25}s` }}
          >
            <TrustIcon name={item.key} />
          </span>
          <span className="text-xs font-semibold text-[var(--text-primary)] sm:text-sm">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrustIcon({ name }: { name: string }) {
  const common = 'h-6 w-6';
  switch (name) {
    // Seal/badge rosette with a check — evokes a verified-profile sticker
    case 'verified':
      return (
        <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
          />
        </svg>
      );
    // Simplified Australian flag — colored, breaks the stroke convention
    // intentionally so it reads immediately as "Australia"
    case 'australia':
      return (
        <svg className={common} viewBox="0 0 24 16">
          <rect width="24" height="16" rx="1.5" fill="#012169" />
          {/* Union Jack quadrant (top-left) */}
          <g>
            <path d="M0 0h12v8H0z" fill="#012169" />
            <path d="M0 0l12 8M12 0L0 8" stroke="#fff" strokeWidth="1.4" />
            <path d="M0 0l12 8M12 0L0 8" stroke="#C8102E" strokeWidth="0.7" />
            <path d="M6 0v8M0 4h12" stroke="#fff" strokeWidth="1.8" />
            <path d="M6 0v8M0 4h12" stroke="#C8102E" strokeWidth="0.9" />
          </g>
          {/* Commonwealth Star */}
          <circle cx="6" cy="12.5" r="1.4" fill="#fff" />
          {/* Southern Cross — 5 stars on the fly */}
          <circle cx="16" cy="5" r="0.55" fill="#fff" />
          <circle cx="19.5" cy="7" r="0.75" fill="#fff" />
          <circle cx="18.5" cy="11" r="0.65" fill="#fff" />
          <circle cx="15" cy="10.5" r="0.55" fill="#fff" />
          <circle cx="21.5" cy="10" r="0.4" fill="#fff" />
        </svg>
      );
    // Trending-up arrow — growth over time
    case 'trending':
      return (
        <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.519l2.74-1.22m0 0-5.94-2.28m5.94 2.28-2.28 5.941"
          />
        </svg>
      );
    default:
      return null;
  }
}

/* ================================================================
   CATEGORY BENTO
   ================================================================ */
function CategoryBento({
  thumbs,
}: {
  thumbs: Record<string, string | undefined>;
}) {
  return (
    <>
      {/* Desktop bento — 5 cols × 3 rows with a 2×3 vertical hero */}
      <div className="hidden h-[540px] grid-cols-5 grid-rows-3 gap-3 lg:grid">
        <CategoryTile cat="Phones" size="large" thumb={thumbs['Phones']} className="col-span-2 row-span-3" />
        <CategoryTile cat="Laptops" size="med" thumb={thumbs['Laptops']} />
        <CategoryTile cat="Consoles" size="med" thumb={thumbs['Consoles']} />
        <CategoryTile cat="Cameras" size="med" thumb={thumbs['Cameras']} />
        <CategoryTile cat="Audio" size="med" thumb={thumbs['Audio']} />
        <CategoryTile cat="Tablets" size="small" thumb={thumbs['Tablets']} />
        <CategoryTile cat="Desktops" size="small" thumb={thumbs['Desktops']} />
        <CategoryTile cat="Computer Accessories" size="small" thumb={thumbs['Computer Accessories']} />
        <CategoryTile cat="Mobile Accessories" size="small" thumb={thumbs['Mobile Accessories']} />
        <CategoryTile cat="PC Parts" size="small" thumb={thumbs['PC Parts']} />
      </div>

      {/* Mobile/tablet — simpler uniform grid */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:hidden">
        <CategoryTile cat="Phones" size="med" thumb={thumbs['Phones']} />
        <CategoryTile cat="Laptops" size="med" thumb={thumbs['Laptops']} />
        <CategoryTile cat="Desktops" size="small" thumb={thumbs['Desktops']} />
        <CategoryTile cat="Tablets" size="small" thumb={thumbs['Tablets']} />
        <CategoryTile cat="Consoles" size="med" thumb={thumbs['Consoles']} />
        <CategoryTile cat="Cameras" size="med" thumb={thumbs['Cameras']} />
        <CategoryTile cat="Audio" size="small" thumb={thumbs['Audio']} />
        <CategoryTile cat="Computer Accessories" size="small" thumb={thumbs['Computer Accessories']} />
        <CategoryTile cat="Mobile Accessories" size="small" thumb={thumbs['Mobile Accessories']} />
        <CategoryTile cat="PC Parts" size="small" thumb={thumbs['PC Parts']} />
      </div>
    </>
  );
}

function CategoryTile({
  cat,
  size,
  thumb,
  className = '',
}: {
  cat: string;
  size: 'large' | 'med' | 'small';
  thumb?: string;
  className?: string;
}) {
  const withImage = thumb && size !== 'small';

  return (
    <Link
      href={`/browse?category=${encodeURIComponent(cat)}`}
      className={`group panel panel-hover clip-corner-sm relative block h-full min-h-[140px] overflow-hidden ${className}`}
    >
      {withImage ? (
        <>
          <img
            src={thumb}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[rgba(15,23,42,0.88)] via-[rgba(15,23,42,0.3)] to-[rgba(15,23,42,0.1)]"
            aria-hidden="true"
          />
          <div className="relative flex h-full flex-col justify-between p-4">
            <CategoryIcon
              category={cat}
              className={`${size === 'large' ? 'h-12 w-12' : 'h-8 w-8'} text-white/85 transition-colors group-hover:text-white`}
            />
            <div>
              <p
                className={`${size === 'large' ? 'text-2xl' : 'text-base'} font-bold tracking-tight text-white`}
              >
                {cat}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-white/70 transition-colors group-hover:text-[var(--accent-soft)]">
                Browse
                <span aria-hidden="true">→</span>
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2.5 p-4">
          <CategoryIcon
            category={cat}
            className="h-9 w-9 text-[var(--text-muted)] transition-colors group-hover:text-[var(--neon-cyan)]"
          />
          <p className="text-center text-sm font-semibold leading-tight text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]">
            {cat}
          </p>
        </div>
      )}
    </Link>
  );
}

/* ================================================================
   DEALS / TRENDING STRIP (horizontal scroller)
   ================================================================ */
function DealsStrip({
  listings,
  loading,
}: {
  listings: ListingSummary[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="-mx-4 overflow-x-hidden px-4">
        <div className="flex gap-3 sm:gap-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="panel clip-corner aspect-[3/4] w-[200px] flex-shrink-0 animate-pulse bg-[var(--bg-panel-hi)] sm:w-[260px]"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="-mx-4 overflow-x-auto px-4 pb-3"
      style={{ scrollSnapType: 'x proximity', scrollbarWidth: 'thin' }}
    >
      <div className="flex gap-3 sm:gap-4">
        {listings.map((listing) => (
          <Link
            key={listing.id}
            href={`/listings/${listing.id}`}
            className="group panel panel-hover clip-corner relative block w-[200px] flex-shrink-0 overflow-hidden sm:w-[260px]"
            style={{ scrollSnapAlign: 'start' }}
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-[var(--bg-panel-hi)]">
              {listing.images[0]?.url ? (
                <img
                  src={listing.images[0].url}
                  alt={listing.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
                  <CategoryIcon category={listing.category} className="h-12 w-12" />
                </div>
              )}
              <span className="absolute top-2 left-2 rounded-md bg-[var(--neon-cyan)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--btn-primary-text)]">
                Trending
              </span>
            </div>
            <div className="p-3.5">
              <h3 className="line-clamp-1 text-sm font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--neon-cyan)]">
                {listing.title}
              </h3>
              <p className="mt-1 text-lg font-bold tracking-tight text-[var(--neon-cyan)]">
                {formatPrice(listing.price)}
              </p>
              <p className="mt-0.5 line-clamp-1 text-xs text-[var(--text-dim)]">
                {listing.seller.location || listing.seller.username}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   SQUARE FEATURED RAIL — server-cached pull from a curated demo
   Square Catalog. Cached server-side for 60s and read here.
   Shown as a buyer-facing rail; renders nothing if the demo
   merchant isn't configured (no SQUARE_FEATURED_ACCESS_TOKEN).
   ================================================================ */
function SquareFeaturedRail() {
  const [items, setItems] = useState<SquareFeaturedItemView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<{ items: SquareFeaturedItemView[] }>('/api/square-catalog/featured')
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch(() => {
        // Quiet failure — the rail just doesn't render.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Quietly hide the section once we know there's nothing to show. This
  // keeps the homepage clean for visitors when the demo merchant isn't
  // configured (most local-dev environments).
  if (!loading && items.length === 0) return null;

  return (
    <section className="relative border-t border-[var(--border-subtle)] bg-[var(--bg-base)] transition-colors">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16 lg:py-20">
        <div className="mb-6 flex items-end justify-between gap-3 sm:mb-10 sm:gap-4">
          <div className="min-w-0">
            <p className="font-serif-italic text-base text-[var(--text-primary)] sm:text-xl">
              Powered by Square Catalog
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
              Featured from our partners
            </h2>
            <p className="mt-2 max-w-xl text-xs text-[var(--text-muted)] sm:text-sm">
              Live pull from a partner merchant&apos;s Square Catalog — refreshed daily.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">
          {loading
            ? Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="aspect-[3/4] animate-pulse rounded-lg bg-[var(--bg-panel)]"
                />
              ))
            : items.map((it) => (
                <SquareFeaturedCard key={it.id} item={it} />
              ))}
        </div>
      </div>
    </section>
  );
}

type SquareFeaturedItemView = {
  id: string;
  squareObjectId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  currency: string;
};

function SquareFeaturedCard({ item }: { item: SquareFeaturedItemView }) {
  const price = (item.priceCents / 100).toFixed(2);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] transition-colors hover:border-[var(--neon-cyan)]">
      <div className="aspect-square w-full bg-[var(--bg-base)]">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-[var(--text-dim)]">
            No image
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 text-sm font-medium text-[var(--text-primary)]">
          {item.name}
        </p>
        <p className="mt-1 text-base font-bold text-[var(--neon-cyan)]">
          {item.currency} ${price}
        </p>
      </div>
    </div>
  );
}
