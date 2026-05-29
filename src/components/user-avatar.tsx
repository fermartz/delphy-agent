export function UserAvatar({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="User"
    >
      <title>User</title>
      <rect
        x="7.5"
        y="7.5"
        width="105"
        height="105"
        rx="14.89"
        ry="14.89"
        className="fill-primary"
      />
      <rect
        x="19.83"
        y="19.83"
        width="80.34"
        height="80.34"
        rx="14.89"
        ry="14.89"
        className="fill-background"
      />
      <path
        d="M 38 62 Q 60 80 82 62"
        fill="none"
        className="stroke-primary"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
