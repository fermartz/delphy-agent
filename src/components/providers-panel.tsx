import { useEffect, useRef, useState } from "react";
import { ApiKeyInput } from "@/components/api-key-input";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { ProviderProfile } from "@/core/providers/types";

export type ProviderKeyStatus = "configured" | "not-configured" | "invalid" | "testing";

export interface ProviderRowState {
  status: ProviderKeyStatus;
  /** Last-4-char preview, present when status is "configured". */
  preview?: string;
  /** Error message from the most recent Test action (when status is "invalid"). */
  testError?: string;
}

export interface ProvidersPanelProps {
  profiles: ProviderProfile[];
  states: Record<string, ProviderRowState>;
  /** Open inline editor for the given provider id (Add or Update). */
  editingId: string | null;
  /**
   * Provider id to visually pre-focus (ring + scroll-into-view) without
   * entering edit mode. Used by the First-Run Welcome handoff per Parameter 10
   * so the user sees confirmation of which key is wired to which provider —
   * even when a key already exists. The highlight fades after ~3 seconds.
   */
  highlightId?: string | null;
  saving: boolean;
  onEdit: (providerId: string | null) => void;
  onSave: (providerId: string, key: string) => void | Promise<void>;
  onTest: (providerId: string) => void | Promise<void>;
  onRemove: (providerId: string) => void | Promise<void>;
}

function placeholderFor(secretKey: string): string {
  if (secretKey.startsWith("anthropic")) return "sk-ant-...";
  if (secretKey.startsWith("openrouter")) return "sk-or-...";
  if (secretKey.startsWith("openai")) return "sk-...";
  if (secretKey.startsWith("google")) return "AIza...";
  if (secretKey.startsWith("xai")) return "xai-...";
  if (secretKey.startsWith("groq")) return "gsk_...";
  if (secretKey.startsWith("deepseek")) return "sk-...";
  if (secretKey.startsWith("kimi")) return "sk-...";
  return "Paste API key";
}

function ProviderStatusBadge({ state }: { state: ProviderRowState }) {
  if (state.status === "configured") {
    return (
      <StatusBadge kind="configured">
        Configured{state.preview ? ` (${state.preview})` : ""}
      </StatusBadge>
    );
  }
  if (state.status === "invalid") {
    return <StatusBadge kind="invalid" title={state.testError ?? ""} />;
  }
  if (state.status === "testing") {
    return <StatusBadge kind="testing" />;
  }
  return <StatusBadge kind="neutral" />;
}

/**
 * Settings → Providers panel. Per-profile row with status badge, last-4-char
 * preview when configured, and Add/Update/Test/Remove actions. The Remove
 * action confirms before invoking `onRemove`. Edit opens an inline
 * `ApiKeyInput`.
 */
export function ProvidersPanel({
  profiles,
  states,
  editingId,
  highlightId,
  saving,
  onEdit,
  onSave,
  onTest,
  onRemove,
}: ProvidersPanelProps) {
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const highlightedRowRef = useRef<HTMLLIElement | null>(null);

  // Scroll the highlighted row into view (no-op when highlightId is null).
  useEffect(() => {
    if (highlightId && highlightedRowRef.current) {
      highlightedRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightId]);

  return (
    <section className="rounded border border-border bg-card p-3">
      <h3 className="mb-2 text-sm font-medium text-foreground">Providers</h3>
      <ul className="space-y-1.5">
        {profiles.map((p) => {
          const state = states[p.id] ?? { status: "not-configured" as const };
          const editing = editingId === p.id;
          const removing = confirmRemoveId === p.id;
          const highlighted = highlightId === p.id;
          return (
            <li
              key={p.id}
              ref={highlighted ? highlightedRowRef : undefined}
              className={`rounded bg-muted/30 px-3 py-2 transition-shadow ${
                highlighted ? "ring-2 ring-primary" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-xs font-medium text-foreground">{p.label}</span>
                  <ProviderStatusBadge state={state} />
                </div>
                {!editing && !removing ? (
                  <div className="flex items-center gap-1">
                    {state.status === "configured" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => void onTest(p.id)}
                        >
                          Test
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => onEdit(p.id)}
                        >
                          Update
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive"
                          onClick={() => setConfirmRemoveId(p.id)}
                        >
                          Remove
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => onEdit(p.id)}
                      >
                        Add key
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>

              {editing ? (
                <div className="mt-2">
                  <ApiKeyInput
                    placeholder={placeholderFor(p.secretKey)}
                    disabled={saving}
                    onSubmit={(key) => onSave(p.id, key)}
                    onCancel={() => onEdit(null)}
                  />
                </div>
              ) : null}

              {removing ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Remove {p.label} key from keychain?
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-xs"
                    onClick={async () => {
                      await onRemove(p.id);
                      setConfirmRemoveId(null);
                    }}
                  >
                    Remove
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setConfirmRemoveId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}

              {state.status === "invalid" && state.testError ? (
                <p className="mt-1 text-[11px] text-destructive">{state.testError}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
