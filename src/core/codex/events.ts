import type { AgentEvent } from "../types";

/**
 * The `msg` payload inside a `codex/event` notification (`params.msg`). External
 * shape from `codex mcp-server` — typed loosely; we read only the fields we map.
 */
export interface CodexEventMsg {
  type: string;
  [key: string]: unknown;
}

/**
 * Observed (codex 0.137.0) internal/lifecycle events we deliberately do NOT
 * surface in Slice A. Anything NOT in this set and not mapped below is treated
 * as genuinely unknown and surfaced as a `system_message` for auditability,
 * rather than silently dropped (plan Parameter 3).
 */
const SILENT_EVENT_TYPES = new Set([
  "session_configured",
  "mcp_startup_update",
  "mcp_startup_complete",
  "task_started",
  "user_message",
  "item_started",
  "item_completed",
  "raw_response_item",
  "token_count",
  "agent_message", // final assistant message — already streamed via deltas
]);

/**
 * Translate one `codex/event` payload into an `AgentEvent`, or `null` for the
 * internal/non-chat events we don't surface. Pure — tested against recorded
 * real codex/event fixtures.
 *
 * Mapping (codex 0.137.0):
 *   - `agent_message_content_delta.delta` → `text` (the streaming assistant text)
 *   - `agent_reasoning_content_delta`/`agent_reasoning_delta.delta` → `thinking`
 *   - `task_complete` → `done` (the turn's terminal event)
 *   - `error` → `error`
 *   - observed internal/lifecycle events (SILENT_EVENT_TYPES below:
 *     `session_configured`, `mcp_startup_*`, `item_started/completed`,
 *     `user_message`, `raw_response_item`, `token_count`, final `agent_message`)
 *     → `null`.
 *   - any OTHER (genuinely unknown) event type → `system_message` for
 *     auditability (plan Parameter 3) — not silently dropped.
 *
 * Slice A does NOT meter Codex tokens, so `token_count` is intentionally dropped.
 * The final `agent_message` is dropped to avoid double-rendering the deltas.
 */
export function translateCodexEvent(msg: CodexEventMsg): AgentEvent | null {
  switch (msg.type) {
    case "agent_message_content_delta": {
      const delta = typeof msg.delta === "string" ? msg.delta : "";
      return delta ? { type: "text", delta } : null;
    }
    case "agent_reasoning_content_delta":
    case "agent_reasoning_delta": {
      const delta = typeof msg.delta === "string" ? msg.delta : "";
      return delta ? { type: "thinking", delta } : null;
    }
    case "task_complete":
      return { type: "done", reason: "complete" };
    case "error": {
      const message = typeof msg.message === "string" ? msg.message : "Codex error";
      return { type: "error", error: new Error(message) };
    }
    default:
      if (SILENT_EVENT_TYPES.has(msg.type)) return null;
      // Genuinely unknown event type — surface for auditability instead of
      // dropping it. Slice B maps command/tool events (exec_*, mcp_tool_call, …)
      // explicitly; until then they show up here.
      return { type: "system_message", text: `[codex: ${msg.type}]`, intent: "info" };
  }
}
