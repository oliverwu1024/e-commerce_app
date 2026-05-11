'use client';

import { useState, useEffect, useMemo, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import ListingCard from '@/components/ListingCard';
import ListingCardSkeleton from '@/components/ListingCardSkeleton';
import CategoryIcon from '@/components/CategoryIcon';
import {
  type ListingSummary,
  formatPrice,
} from '@/types/listings';

type HomeBundle = {
  trending: ListingSummary[];
  featured: ListingSummary[];
  recent: ListingSummary[];
};

// Fisher-Yates shuffle — used to randomise the "More to explore" pool each
// load so the same visitor sees a different mix on reload.
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function Home() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [bundle, setBundle] = useState<HomeBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const data = await api<HomeBundle>('/api/listings/home');
        if (!cancelled) {
          setBundle(data);
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

  const trending = bundle?.trending ?? [];
  // Shuffle once per mount — visitors who reload get a different mix.
  const featured = useMemo(
    () => (bundle ? shuffle(bundle.featured).slice(0, 8) : []),
    [bundle],
  );
  const recent = bundle?.recent ?? [];
  const isEmpty = !loading && !bundle?.recent.length;

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
          <TrustStrip />
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
          <CategoryBento />
        </div>
      </section>

      {/* ============================================================
         MORE TO EXPLORE — default cream band
         ============================================================ */}
      {(loading || featured.length > 0) && (
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16 lg:py-20">
            <div className="mb-6 flex items-end justify-between gap-3 sm:mb-10 sm:gap-4">
              <div className="min-w-0">
                <p className="font-serif-italic text-base text-[var(--text-primary)] sm:text-xl">
                  Keep scrolling
                </p>
                <h2 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-4xl">
                  <span className="text-[var(--neon-cyan)]">More</span>
                  <span className="text-[var(--text-primary)]"> to explore</span>
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
                  <ListingCard key={listing.id} listing={listing} imageFit="contain" />
                ))}
          </div>

          {isEmpty && (
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
  }, [isPaused, items.length, activeIndex]);

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
                    className="h-full w-full object-contain"
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
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[rgba(0,0,0,0.82)] to-transparent"
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
                  <p className="mt-1 text-2xl font-extrabold text-[var(--accent-soft)] drop-shadow-[0_2px_5px_rgba(0,0,0,0.95)]">
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

            {/* Prev / next arrows */}
            {items.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveIndex((i) => (i - 1 + items.length) % items.length);
                  }}
                  aria-label="Previous trending item"
                  className="absolute left-2 top-1/2 z-20 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveIndex((i) => (i + 1) % items.length);
                  }}
                  aria-label="Next trending item"
                  className="absolute right-2 top-1/2 z-20 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}

            {/* Progress pills */}
            {items.length > 1 && (
              <div className="absolute bottom-1 left-0 right-0 z-20 flex justify-center gap-1">
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
                    className="group/pill flex h-7 items-center justify-center px-1.5"
                  >
                    <span
                      className={`block h-1 rounded-full transition-all duration-300 ${
                        i === safeIndex
                          ? 'w-8 bg-[var(--neon-cyan)] shadow-[0_0_8px_color-mix(in_oklab,var(--neon-cyan)_70%,transparent)]'
                          : 'w-2.5 bg-white/55 group-hover/pill:bg-white/85'
                      }`}
                    />
                  </button>
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
function TrustStrip() {
  const items = [
    { key: 'verified', label: 'Verified sellers' },
    { key: 'australia', label: 'Australia-wide' },
    { key: 'trending', label: 'Growing daily' },
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
   CATEGORY BENTO — gradient + oversized-icon tiles (no photos)
   Each category has its own colour identity. Pattern overlay adds
   texture so tiles read as editorial rather than flat blocks.
   ================================================================ */
type CategoryTheme = {
  slug: string;              // selects per-category CSS vars defined in globals.css
  pattern: 'dots' | 'grid' | 'lines' | 'circuit';
};

// Theme-aware: actual colours live in globals.css under --cat-{slug}-{from,to,fg,accent}
// so light mode can use soft pastels with tinted text, and dark mode keeps
// the saturated single-hue gradients with white text.
const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  Phones:                 { slug: 'phones',     pattern: 'dots' },
  Laptops:                { slug: 'laptops',    pattern: 'grid' },
  Desktops:               { slug: 'desktops',   pattern: 'grid' },
  Tablets:                { slug: 'tablets',    pattern: 'dots' },
  Consoles:               { slug: 'consoles',   pattern: 'circuit' },
  Cameras:                { slug: 'cameras',    pattern: 'lines' },
  Audio:                  { slug: 'audio',      pattern: 'lines' },
  'Computer Accessories': { slug: 'comp-acc',   pattern: 'grid' },
  'Mobile Accessories':   { slug: 'mob-acc',    pattern: 'dots' },
  'PC Parts':             { slug: 'pc-parts',   pattern: 'circuit' },
};

function patternBg(pattern: CategoryTheme['pattern']): string {
  const svg = (() => {
    switch (pattern) {
      case 'dots':
        return `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><circle cx='2' cy='2' r='1' fill='white' fill-opacity='0.22'/></svg>`;
      case 'grid':
        return `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M0 0H32V32' fill='none' stroke='white' stroke-opacity='0.16' stroke-width='1'/></svg>`;
      case 'lines':
        return `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><path d='M-2 6 L6 -2 M6 14 L14 6' stroke='white' stroke-opacity='0.18' stroke-width='1'/></svg>`;
      case 'circuit':
        return `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M0 20 H15 V5 H30 V20 H40 M20 40 V25 H5' fill='none' stroke='white' stroke-opacity='0.20' stroke-width='1'/><circle cx='15' cy='20' r='1.5' fill='white' fill-opacity='0.4'/><circle cx='30' cy='5' r='1.5' fill='white' fill-opacity='0.4'/></svg>`;
    }
  })();
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

function CategoryBento() {
  return (
    <>
      {/* Desktop bento — 5 cols × 3 rows with a 2×3 vertical hero */}
      <div className="hidden h-[540px] grid-cols-5 grid-rows-3 gap-3 lg:grid">
        <CategoryTile cat="Phones" size="large" className="col-span-2 row-span-3" />
        <CategoryTile cat="Laptops" size="med" />
        <CategoryTile cat="Consoles" size="med" />
        <CategoryTile cat="Cameras" size="med" />
        <CategoryTile cat="Audio" size="med" />
        <CategoryTile cat="Tablets" size="small" />
        <CategoryTile cat="Desktops" size="small" />
        <CategoryTile cat="Computer Accessories" size="small" />
        <CategoryTile cat="Mobile Accessories" size="small" />
        <CategoryTile cat="PC Parts" size="small" />
      </div>

      {/* Mobile/tablet — simpler uniform grid */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:hidden">
        <CategoryTile cat="Phones" size="med" />
        <CategoryTile cat="Laptops" size="med" />
        <CategoryTile cat="Desktops" size="small" />
        <CategoryTile cat="Tablets" size="small" />
        <CategoryTile cat="Consoles" size="med" />
        <CategoryTile cat="Cameras" size="med" />
        <CategoryTile cat="Audio" size="small" />
        <CategoryTile cat="Computer Accessories" size="small" />
        <CategoryTile cat="Mobile Accessories" size="small" />
        <CategoryTile cat="PC Parts" size="small" />
      </div>
    </>
  );
}

function CategoryTile({
  cat,
  size,
  className = '',
}: {
  cat: string;
  size: 'large' | 'med' | 'small';
  className?: string;
}) {
  const theme = CATEGORY_THEMES[cat] ?? CATEGORY_THEMES.Phones;
  const isLarge = size === 'large';
  const isSmall = size === 'small';
  const slug = theme.slug;

  return (
    <Link
      href={`/browse?category=${encodeURIComponent(cat)}`}
      aria-label={`Browse ${cat}`}
      className={`group clip-corner-sm relative block h-full min-h-[140px] overflow-hidden border shadow-[0_4px_18px_-10px_rgba(15,23,42,0.20)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-14px_rgba(15,23,42,0.32)] ${className}`}
      style={{
        backgroundImage: `linear-gradient(135deg, var(--cat-${slug}-from) 0%, var(--cat-${slug}-to) 100%)`,
        color: `var(--cat-${slug}-fg)`,
        borderColor: 'var(--cat-tile-border)',
      }}
    >
      {/* Pattern overlay — hidden in light mode (var=0), shown in dark */}
      <div
        aria-hidden="true"
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          backgroundImage: patternBg(theme.pattern),
          opacity: `var(--cat-pattern-opacity)`,
        }}
      />

      {/* Soft radial spotlight — adds depth, brightens on hover */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-1/4 -top-1/3 h-[140%] w-[80%] rounded-full opacity-40 blur-3xl transition-opacity duration-500 group-hover:opacity-65"
        style={{ backgroundColor: `var(--cat-${slug}-accent)` }}
      />

      {/* Watermark icon (large + medium): big, off-canvas-ish, behind the label.
          Uses currentColor (= category fg var) so it tints with the theme. */}
      {!isSmall && (
        <CategoryIcon
          category={cat}
          className={`pointer-events-none absolute opacity-90 transition-transform duration-500 ease-out group-hover:scale-105 group-hover:rotate-[3deg] ${
            isLarge
              ? '-right-3 -top-2 h-44 w-44 sm:h-56 sm:w-56'
              : '-right-1 top-3 h-20 w-20 sm:h-24 sm:w-24'
          }`}
        />
      )}

      {/* Foreground content */}
      <div
        className={`relative flex h-full flex-col p-4 sm:p-5 ${
          isSmall ? 'items-center justify-center gap-2.5 text-center' : 'justify-end'
        }`}
      >
        {isSmall ? (
          <>
            <CategoryIcon
              category={cat}
              className="h-9 w-9 transition-transform duration-300 group-hover:scale-110"
            />
            <p className="text-sm font-bold leading-tight">
              {cat}
            </p>
          </>
        ) : (
          <div>
            <p
              className={`font-bold tracking-tight ${
                isLarge ? 'text-3xl sm:text-4xl' : 'text-base sm:text-lg'
              }`}
            >
              {cat}
            </p>
            <p
              className={`mt-1.5 inline-flex items-center gap-1 font-extrabold uppercase tracking-[0.18em] opacity-75 transition-opacity group-hover:opacity-100 ${
                isLarge ? 'text-xs sm:text-[13px]' : 'text-[10px] sm:text-[11px]'
              }`}
            >
              Browse
              <span
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:translate-x-1"
              >
                →
              </span>
            </p>
          </div>
        )}
      </div>
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
                  className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.04]"
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
            className="h-full w-full object-contain"
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
