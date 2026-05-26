/** Delphy Agent brand logo — colorful gradient with blinking eyes (ported from astra-cli). */
export function BrandLogo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Delphy Agent logo"
    >
      <title>Delphy Agent</title>
      <style>{`
        @keyframes blink {
          0%, 100% { transform: scaleY(1); }
          1% { transform: scaleY(0.05); }
          2% { transform: scaleY(1); }
          3% { transform: scaleY(0.05); }
          4% { transform: scaleY(1); }
        }
        .eye { animation: blink 20s ease-in-out infinite; transform-origin: center; }
      `}</style>
      <defs>
        <linearGradient id="brand-base" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a1a2e" />
          <stop offset="100%" stopColor="#16213e" />
        </linearGradient>
        <radialGradient id="brand-g1" cx="10%" cy="10%" r="60%">
          <stop offset="0%" stopColor="rgb(0,255,255)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="rgb(0,255,255)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="brand-g2" cx="90%" cy="10%" r="60%">
          <stop offset="0%" stopColor="rgb(255,0,255)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="rgb(255,0,255)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="brand-g3" cx="10%" cy="90%" r="60%">
          <stop offset="0%" stopColor="rgb(255,255,255)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="rgb(255,255,255)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="brand-g4" cx="90%" cy="90%" r="60%">
          <stop offset="0%" stopColor="rgb(255,255,0)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="rgb(255,255,0)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect
        x="7.5"
        y="7.5"
        width="105"
        height="105"
        rx="14.89"
        ry="14.89"
        fill="url(#brand-base)"
      />
      <rect x="7.5" y="7.5" width="105" height="105" rx="14.89" ry="14.89" fill="url(#brand-g1)" />
      <rect x="7.5" y="7.5" width="105" height="105" rx="14.89" ry="14.89" fill="url(#brand-g2)" />
      <rect x="7.5" y="7.5" width="105" height="105" rx="14.89" ry="14.89" fill="url(#brand-g3)" />
      <rect x="7.5" y="7.5" width="105" height="105" rx="14.89" ry="14.89" fill="url(#brand-g4)" />
      <rect x="19.83" y="19.83" width="80.34" height="80.34" rx="14.89" ry="14.89" fill="#000" />
      <circle className="eye" cx="40.85" cy="53.61" r="6" fill="#fff" />
      <circle className="eye" cx="79.85" cy="53.61" r="6" fill="#fff" />
    </svg>
  );
}
