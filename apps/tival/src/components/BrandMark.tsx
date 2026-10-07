/** Marca tival: squircle + t moderna. */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="32" height="32" rx="9" fill="#202023" />
      <path
        d="M10 12.5h12M16 9.5v14.5"
        stroke="url(#tival-brand-gradient)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient
          id="tival-brand-gradient"
          x1="10"
          y1="9"
          x2="22"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ee797e" />
          <stop offset="0.55" stopColor="#edbdbc" />
          <stop offset="1" stopColor="#8bb9b9" />
        </linearGradient>
      </defs>
    </svg>
  );
}
