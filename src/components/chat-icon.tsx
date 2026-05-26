import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Shield,
  XCircle,
} from "lucide-react";
import type { ReactElement } from "react";
import { AgentAvatar } from "@/components/agent-avatar";

/**
 * Minimal shape `ChatIcon` needs. We don't import the full `ChatItem` union
 * from App.tsx to keep coupling tight — the icon only cares about `kind` plus
 * two discriminators: `intent` on `system` items, `isError` on `tool-result`.
 * App.tsx passes the relevant chat item directly; structural typing matches.
 */
export interface ChatIconInput {
  kind:
    | "user-text"
    | "assistant-text"
    | "system"
    | "tool-call"
    | "tool-result"
    | "approval"
    | "runtime-error";
  intent?: "info" | "error";
  isError?: boolean;
}

/**
 * Renders the icon for a chat-item kind. Theme-primary by default; semantic
 * red reserved for tool-result errors and runtime errors (adapter-level
 * infrastructure failures). Per Astra's pattern — see docs/DECISIONS.md
 * 2026-05-27 chat-item-icons entry.
 *
 * The icon column is fixed `w-8` (32px) so message bodies line up. For
 * `user-text` we render an empty spacer so the column is consistent even
 * without an avatar.
 */
export function ChatIcon({ item }: { item: ChatIconInput }): ReactElement {
  const wrap = (child: ReactElement): ReactElement => (
    <span className="flex w-8 shrink-0 items-start justify-center pt-0.5">{child}</span>
  );
  const spacer = <span aria-hidden="true" className="block h-5 w-5" />;
  switch (item.kind) {
    case "user-text":
      return wrap(spacer);
    case "assistant-text":
      return wrap(<AgentAvatar size={32} />);
    case "system":
      return wrap(
        item.intent === "error" ? (
          <AlertTriangle className="h-5 w-5 text-primary" />
        ) : (
          <Info className="h-5 w-5 text-primary" />
        ),
      );
    case "tool-call":
      return wrap(<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />);
    case "tool-result":
      return wrap(
        item.isError ? (
          <XCircle className="h-5 w-5 text-destructive" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-primary" />
        ),
      );
    case "approval":
      return wrap(<Shield className="h-5 w-5 text-primary" />);
    case "runtime-error":
      return wrap(<AlertCircle className="h-5 w-5 text-destructive" />);
  }
}
