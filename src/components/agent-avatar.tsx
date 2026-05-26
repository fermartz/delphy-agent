/** Delphy Agent avatar — theme-adaptive 2-tone variant of BrandLogo (ported from astra-cli). */
export function AgentAvatar({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Assistant"
    >
      <title>Assistant</title>
      {/* Outer frame — primary color */}
      <rect
        x="7.5"
        y="7.5"
        width="105"
        height="105"
        rx="14.89"
        ry="14.89"
        className="fill-primary"
      />
      {/* Inner face — dark background */}
      <rect
        x="19.83"
        y="19.83"
        width="80.34"
        height="80.34"
        rx="14.89"
        ry="14.89"
        className="fill-background"
      />
      {/* Eyes — primary color */}
      <circle cx="40.85" cy="53.61" r="6" className="fill-primary" />
      <circle cx="79.85" cy="53.61" r="6" className="fill-primary" />
    </svg>
  );
}
