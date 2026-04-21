'use client';

import { useState } from 'react';

const SIZE_CLASS = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
} as const;

type Size = keyof typeof SIZE_CLASS;

function StarPath() {
  return (
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  );
}

// Renders a single star with a zinc base and an amber layer clipped to `fill`
// (0..1). This produces real fractional fills — 0.5 is a literal half-star.
function Star({ fill, size }: { fill: number; size: Size }) {
  const pct = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <span className={`relative inline-block ${SIZE_CLASS[size]}`} aria-hidden="true">
      <svg
        className={`${SIZE_CLASS[size]} text-zinc-200`}
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <StarPath />
      </svg>
      {pct > 0 && (
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          <svg
            className={`${SIZE_CLASS[size]} text-amber-400`}
            viewBox="0 0 20 20"
            fill="currentColor"
            preserveAspectRatio="xMinYMid slice"
          >
            <StarPath />
          </svg>
        </span>
      )}
    </span>
  );
}

// Read-only star display. Supports fractional ratings via per-star partial fill
// (e.g., 3.7 renders three full stars, one 70%-filled star, and one empty).
export default function Stars({
  rating,
  size = 'md',
}: {
  rating: number;
  size?: Size;
}) {
  const label =
    typeof rating === 'number' && !Number.isNaN(rating)
      ? `${rating.toFixed(1)} out of 5 stars`
      : 'Unrated';
  return (
    <div className="flex gap-0.5" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} fill={rating - (star - 1)} size={size} />
      ))}
    </div>
  );
}

// Interactive star picker. Calls onChange(1..5) when a star is clicked.
// Uses plain button semantics (not radiogroup) — no arrow-key nav, each star is
// its own tab stop. aria-pressed indicates the current selection.
export function StarInput({
  value,
  onChange,
  disabled = false,
  size = 'lg',
}: {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
  size?: Size;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div
      className="flex gap-1"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = active >= star;
        return (
          <button
            key={star}
            type="button"
            aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'}`}
            aria-pressed={value === star}
            disabled={disabled}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHover(star)}
            className={`transition-transform ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:scale-110 cursor-pointer'} ${filled ? 'text-amber-400' : 'text-zinc-300'}`}
          >
            <svg className={SIZE_CLASS[size]} viewBox="0 0 20 20" fill="currentColor">
              <StarPath />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
