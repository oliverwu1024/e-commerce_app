type Props = {
  category: string;
  className?: string;
};

export default function CategoryIcon({ category, className = 'h-8 w-8' }: Props) {
  const svgProps = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (category) {
    case 'Phones':
      return (
        <svg {...svgProps}>
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2" />
        </svg>
      );

    case 'Laptops':
      return (
        <svg {...svgProps}>
          <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v11H4V5z" />
          <path d="M2 19h20" />
          <path d="M4 16l-2 3" />
          <path d="M20 16l2 3" />
        </svg>
      );

    case 'Desktops':
      return (
        <svg {...svgProps}>
          <rect x="2" y="3" width="20" height="13" rx="1" />
          <line x1="12" y1="16" x2="12" y2="20" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </svg>
      );

    case 'Tablets':
      return (
        <svg {...svgProps}>
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2" />
        </svg>
      );

    case 'Consoles':
      return (
        <svg {...svgProps}>
          <path d="M6 9a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3H6z" />
          <path d="M7.5 12h3" />
          <path d="M9 10.5v3" />
          <circle cx="15.5" cy="11" r="0.5" fill="currentColor" />
          <circle cx="17" cy="13" r="0.5" fill="currentColor" />
        </svg>
      );

    case 'Cameras':
      return (
        <svg {...svgProps}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );

    case 'Audio':
      return (
        <svg {...svgProps}>
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z" />
        </svg>
      );

    case 'Computer Accessories':
      return (
        <svg {...svgProps}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <line x1="6" y1="10" x2="6.01" y2="10" strokeWidth="2.5" />
          <line x1="10" y1="10" x2="10.01" y2="10" strokeWidth="2.5" />
          <line x1="14" y1="10" x2="14.01" y2="10" strokeWidth="2.5" />
          <line x1="18" y1="10" x2="18.01" y2="10" strokeWidth="2.5" />
          <line x1="7" y1="14" x2="17" y2="14" />
        </svg>
      );

    case 'Mobile Accessories':
      return (
        <svg {...svgProps}>
          <rect x="7" y="9" width="10" height="9" rx="1" />
          <line x1="10" y1="6" x2="10" y2="9" />
          <line x1="14" y1="6" x2="14" y2="9" />
          <line x1="12" y1="18" x2="12" y2="21" />
          <line x1="10" y1="21" x2="14" y2="21" />
        </svg>
      );

    case 'PC Parts':
      return (
        <svg {...svgProps}>
          <rect x="5" y="5" width="14" height="14" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="0.5" />
          <line x1="9" y1="2" x2="9" y2="5" />
          <line x1="15" y1="2" x2="15" y2="5" />
          <line x1="9" y1="19" x2="9" y2="22" />
          <line x1="15" y1="19" x2="15" y2="22" />
          <line x1="19" y1="9" x2="22" y2="9" />
          <line x1="19" y1="15" x2="22" y2="15" />
          <line x1="2" y1="9" x2="5" y2="9" />
          <line x1="2" y1="15" x2="5" y2="15" />
        </svg>
      );

    default:
      return (
        <svg {...svgProps}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
  }
}
