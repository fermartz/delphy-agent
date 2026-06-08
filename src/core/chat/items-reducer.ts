import type { ChatItem } from "../chat-projection";
import type { AgentEvent } from "../types";

/**
 * Pure folding of live AgentEvents into the UI ChatItem[]. Extracted verbatim
 * from App.tsx's event loop so the projection is unit-testable in isolation.
 *
 * Purity: id allocation is injected via `nextId` — the reducer never reaches
 * for module-level mutable counters. Events that don't affect items (usage,
 * context_usage, thinking) return the SAME array reference so a `setItems`
 * updater bails out of re-rendering.
 *
 * Side effects that lived alongside these cases in the loop (setStreaming,
 * refreshSessionList, token/context accounting) stay in the loop — this
 * module only computes the next items array.
 */
export function reduceChatItems(
  items: ChatItem[],
  event: AgentEvent,
  nextId: () => string,
): ChatItem[] {
  switch (event.type) {
    case "text":
      return appendTextToInFlight(items, event.delta, nextId);

    case "approval_request":
      return [
        ...finalizeInFlight(items, "complete"),
        { kind: "approval", id: event.id, action: event.action, payload: event.payload },
      ];

    case "tool_call":
      return [
        ...finalizeInFlight(items, "complete"),
        { kind: "tool-call", id: event.id, name: event.name, input: event.input },
      ];

    case "tool_result": {
      const updated = finalizeInFlight(items, "complete");
      const callIdx = updated.findIndex((it) => it.kind === "tool-call" && it.id === event.id);
      const toolName =
        callIdx !== -1 && updated[callIdx].kind === "tool-call" ? updated[callIdx].name : "tool";
      const resultItem: ChatItem = {
        kind: "tool-result",
        id: event.id,
        name: toolName,
        output: event.output,
        isError: event.isError,
      };
      if (callIdx !== -1) {
        const next = [...updated];
        next[callIdx] = resultItem;
        return next;
      }
      return [...updated, resultItem];
    }

    case "done":
      return finalizeInFlight(items, event.reason === "complete" ? "complete" : "error");

    case "error":
      return [
        ...finalizeInFlight(items, "error"),
        {
          kind: "runtime-error",
          id: nextId(),
          errorKind: event.kind ?? "unknown",
          message: event.error.message,
        },
      ];

    case "system_message":
      // Finalize any in-flight streaming assistant message first, so the system
      // item lands cleanly between turns.
      return [
        ...finalizeInFlight(items, "complete"),
        { kind: "system", id: nextId(), text: event.text, intent: event.intent },
      ];

    default:
      // usage / context_usage / thinking — no items change; preserve identity.
      return items;
  }
}

function appendTextToInFlight(items: ChatItem[], delta: string, nextId: () => string): ChatItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "assistant-text" && last.status === "streaming") {
    return items.map((it, idx) =>
      idx === items.length - 1 && it.kind === "assistant-text"
        ? { ...it, text: it.text + delta }
        : it,
    );
  }
  return [...items, { kind: "assistant-text", id: nextId(), text: delta, status: "streaming" }];
}

function finalizeInFlight(items: ChatItem[], status: "complete" | "error"): ChatItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "assistant-text" && last.status === "streaming") {
    return items.map((it, idx) =>
      idx === items.length - 1 && it.kind === "assistant-text" ? { ...it, status } : it,
    );
  }
  return items;
}
