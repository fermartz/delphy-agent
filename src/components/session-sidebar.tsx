import { Plus } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import type { SessionListEntry } from "@/core/db/sessions";

export interface SessionSidebarProps {
  sessions: SessionListEntry[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

function formatRelative(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  return `${Math.floor(diff / day)}d`;
}

function titleFor(entry: SessionListEntry): string {
  if (entry.title && entry.title.trim().length > 0) return entry.title;
  return entry.id.slice(0, 12);
}

export const SessionSidebar = memo(function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
}: SessionSidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="border-b border-border p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={onNew}
        >
          <Plus className="h-3 w-3" />
          New session
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No sessions yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => {
              const active = s.id === activeSessionId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${
                      active
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{titleFor(s)}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                      {formatRelative(s.updated_at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
});
