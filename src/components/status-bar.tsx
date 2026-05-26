interface StatusBarProps {
  brand: string;
  model: string;
  activity: string;
  commandHints: string[];
}

/**
 * Status bar strip between the chat scroll area and the chat input.
 * Two rows on `bg-muted`. Row 1 shows the brand + current model (left) and
 * the activity indicator (right). Row 2 lists the available slash-command hints.
 * Background tint matches the chat input below so they read as one panel.
 */
export function StatusBar({ brand, model, activity, commandHints }: StatusBarProps) {
  return (
    <div className="border-t border-border bg-muted">
      <div className="flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="text-green-400">{brand}</span>
          <span aria-hidden="true">|</span>
          <span className="text-orange-400">{model}</span>
        </div>
        <span>{activity}</span>
      </div>
      <div className="flex items-center px-4 pb-1.5 text-[11px] text-muted-foreground/50">
        <span>{commandHints.join(" · ")}</span>
      </div>
    </div>
  );
}
