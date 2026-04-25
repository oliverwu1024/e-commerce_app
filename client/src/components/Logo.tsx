type LogoProps = {
  size?: number;
  className?: string;
};

export default function Logo({ size = 28, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="#0369a1" />
      <path d="M19 3 L10 17 L15 17 L12 26 L22 12 L17 12 Z" fill="#fbbf24" />
      <g fill="white">
        <path d="M8 23 L24 23 L22 27 L10 27 Z" />
        <circle cx="13" cy="29" r="1.2" />
        <circle cx="20" cy="29" r="1.2" />
      </g>
    </svg>
  );
}
