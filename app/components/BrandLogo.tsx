export function BrandLogo({
  className = ''
}: {
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`brand-lockup ${className}`.trim()} aria-label="Fix Your Leads">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" className="brand-mark-svg" role="presentation">
          <defs>
            <linearGradient id="fyl-brand-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#cc4fff" />
              <stop offset="100%" stopColor="#7d17ff" />
            </linearGradient>
          </defs>
          <path
            d="M22 52 L12 60 L14 47 C9 42 6 36 6 28 C6 14 17 4 32 4 C47 4 58 14 58 28 C58 42 47 52 32 52 Z"
            fill="none"
            stroke="url(#fyl-brand-gradient)"
            strokeWidth="4.5"
            strokeLinejoin="round"
          />
          <path
            d="M16 28 H25 L29 20 L34 36 L39 28 H48"
            fill="none"
            stroke="url(#fyl-brand-gradient)"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="32" cy="28" r="19" fill="none" stroke="url(#fyl-brand-gradient)" strokeWidth="2.5" opacity="0.8" />
        </svg>
      </span>
    </div>
  );
}
