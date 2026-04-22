'use client';

import { useState } from 'react';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<Size, { box: string; text: string }> = {
  xs: { box: 'h-6 w-6 text-[10px]', text: 'text-[10px]' },
  sm: { box: 'h-8 w-8 text-xs', text: 'text-xs' },
  md: { box: 'h-10 w-10 text-sm', text: 'text-sm' },
  lg: { box: 'h-14 w-14 text-base', text: 'text-base' },
  xl: { box: 'h-20 w-20 text-xl', text: 'text-xl' },
};

type Props = {
  src?: string | null;
  username: string;
  size?: Size;
  className?: string;
};

/**
 * Renders a circular avatar. When `src` is set and loads, shows the image;
 * otherwise falls back to the first letter of `username` on a blue tile.
 * The onError handler flips to the fallback so a 404'd S3 URL doesn't leave
 * a broken image icon.
 */
export default function Avatar({ src, username, size = 'md', className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const sizes = SIZE_CLASSES[size];
  const showImage = src && !failed;
  const initial = (username || '?').charAt(0).toUpperCase();

  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-bold text-blue-600 ${sizes.box} ${className}`}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className={sizes.text}>{initial}</span>
      )}
    </span>
  );
}
