interface StatusBarProps {
  brand: string;
  model: string;
  activity: string;
  commandHints: string[];
  tokens?: { in: number; out: number; cached?: number };
  contextPercent?: number;
}

const CONTEXT_WARN_THRESHOLD = 0.75;
const CONTEXT_DANGER_THRESHOLD = 0.85;

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n / 1000)}K`;
}

function contextTintClass(percent: number): string {
  if (percent >= CONTEXT_DANGER_THRESHOLD) return "text-destructive";
  if (percent >= CONTEXT_WARN_THRESHOLD) return "text-yellow-500";
  return "";
}

/**
 * Status bar strip between the chat scroll area and the chat input.
 * Two rows on `bg-muted`. Row 1 shows the brand + current model (left), a
 * token + context-usage indicator (middle, when present), and the activity
 * indicator (right). Row 2 lists the available slash-command hints.
 * Background tint matches the chat input below so they read as one panel.
 */
export function StatusBar({
  brand,
  model,
  activity,
  commandHints,
  tokens,
  contextPercent,
}: StatusBarProps) {
  const showTokens = tokens && (tokens.in > 0 || tokens.out > 0);
  const showCtx = typeof contextPercent === "number" && contextPercent > 0;
  return (
    <div className="border-t border-border bg-muted">
      <div className="flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="text-green-400">{brand}</span>
          <span aria-hidden="true">|</span>
          <span className="text-orange-400">{model}</span>
        </div>
        <div className="flex items-center gap-3">
          {showTokens ? (
            <span className="font-mono text-[11px]">
              {formatTokens(tokens.in)} in · {formatTokens(tokens.out)} out
            </span>
          ) : null}
          {showCtx ? (
            <span className={`font-mono text-[11px] ${contextTintClass(contextPercent)}`}>
              {Math.round(contextPercent * 100)}% ctx
            </span>
          ) : null}
          <span>{activity}</span>
        </div>
      </div>
      <div className="flex items-center px-4 pb-1.5 text-[11px] text-muted-foreground/50">
        <span>{commandHints.join(" · ")}</span>
      </div>
    </div>
  );
}
