import MarkdownText from "@/components/markdown-text";
import { Button } from "@/components/ui/button";
import type { ChatItem } from "@/core/chat-projection";
import type { RuntimeErrorKind } from "@/core/types";

interface ChatMessageProps {
  item: ChatItem;
  onApproval: (id: string, allowed: boolean) => void;
  onChangeKey: () => void;
}

/**
 * Renders a single chat row's content (the right-hand column next to the
 * ChatIcon). Extracted verbatim from App.tsx's `renderItem` switch; the
 * kind→JSX mapping and the two helpers below are unchanged.
 */
export function ChatMessage({ item: it, onApproval, onChangeKey }: ChatMessageProps) {
  switch (it.kind) {
    case "user-text":
      return (
        <span className="inline-block rounded-md bg-muted px-3 py-1.5 text-sm text-foreground whitespace-pre-wrap">
          {it.text}
        </span>
      );
    case "assistant-text":
      return (
        <div className={`text-sm ${it.status === "error" ? "text-destructive" : ""}`}>
          <MarkdownText>{it.text}</MarkdownText>
        </div>
      );
    case "approval":
      return (
        <div className="rounded border border-border bg-muted px-3 py-2 text-sm">
          <div className="font-medium text-foreground">
            {it.verdict
              ? `Approval ${it.verdict} — ${it.action}`
              : `Agent wants to use ${it.action}`}
          </div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
            {previewPayload(it.payload)}
          </pre>
          {!it.verdict ? (
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" onClick={() => onApproval(it.id, true)}>
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onApproval(it.id, false)}
              >
                Deny
              </Button>
            </div>
          ) : null}
        </div>
      );
    case "tool-call":
      return (
        <div className="font-mono text-sm text-muted-foreground">
          → {it.name}({previewPayload(it.input)})
        </div>
      );
    case "tool-result":
      if (it.isError) {
        return (
          <pre className="font-mono text-sm whitespace-pre-wrap text-destructive">
            {it.name} failed: {previewPayload(it.output)}
          </pre>
        );
      }
      return <div className="font-mono text-sm text-muted-foreground">{it.name} completed</div>;
    case "runtime-error":
      return (
        <div className="rounded border border-border bg-muted px-3 py-2 text-sm">
          <div className="font-medium text-foreground">{runtimeErrorTitle(it.errorKind)}</div>
          <div className="mt-1 text-muted-foreground">{it.message}</div>
          {it.errorKind === "invalid-key" ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onChangeKey}
              className="mt-2"
            >
              Change API key
            </Button>
          ) : null}
        </div>
      );
    case "system":
      return (
        <pre className="font-mono text-sm whitespace-pre-wrap text-muted-foreground italic">
          {it.text}
        </pre>
      );
  }
}

function runtimeErrorTitle(kind: RuntimeErrorKind): string {
  switch (kind) {
    case "invalid-key":
      return "API key rejected";
    case "rate-limited":
      return "Rate limited";
    case "network":
      return "Network error";
    case "model-deprecated":
      return "Model unavailable";
    case "unknown":
      return "Unexpected error";
  }
}

function previewPayload(payload: unknown): string {
  if (typeof payload === "string")
    return payload.length > 400 ? `${payload.slice(0, 400)}…` : payload;
  try {
    const json = JSON.stringify(payload, null, 2);
    return json.length > 400 ? `${json.slice(0, 400)}…` : json;
  } catch {
    return String(payload);
  }
}
