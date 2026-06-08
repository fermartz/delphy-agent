interface ToastProps {
  message: string | null;
}

/** Fixed top-center transient notification. Renders nothing when empty. */
export function Toast({ message }: ToastProps) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 rounded border border-primary/30 bg-primary px-4 py-2 text-xs text-primary-foreground shadow-lg">
      {message}
    </div>
  );
}
