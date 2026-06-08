import { describe, expect, it } from "vitest";
import { type CodexEventMsg, translateCodexEvent } from "./events";

// Fixtures captured from a real `codex mcp-server` read-only turn (codex 0.137.0).
const fixtures = {
  agentMessageDelta: {
    type: "agent_message_content_delta",
    thread_id: "019ea7aa-6279-7322-b5ab-20fbb92bb396",
    turn_id: "3",
    item_id: "msg_0ab1",
    delta: "hello",
  },
  agentMessageFinal: { type: "agent_message", message: "hello", phase: "final_answer" },
  taskComplete: {
    type: "task_complete",
    turn_id: "3",
    last_agent_message: "hello",
    duration_ms: 3641,
  },
  tokenCount: { type: "token_count", info: { total_token_usage: { output_tokens: 5 } } },
  sessionConfigured: { type: "session_configured", cwd: "/tmp", approval_policy: "never" },
  userMessage: { type: "user_message" },
  itemStarted: { type: "item_started" },
  rawResponseItem: { type: "raw_response_item", item: { role: "developer" } },
  mcpStartup: { type: "mcp_startup_update", server: "codex_apps" },
} satisfies Record<string, CodexEventMsg>;

describe("translateCodexEvent", () => {
  it("maps streaming assistant text deltas to `text`", () => {
    expect(translateCodexEvent(fixtures.agentMessageDelta)).toEqual({
      type: "text",
      delta: "hello",
    });
  });

  it("maps reasoning deltas to `thinking`", () => {
    expect(
      translateCodexEvent({ type: "agent_reasoning_content_delta", delta: "let me think" }),
    ).toEqual({
      type: "thinking",
      delta: "let me think",
    });
  });

  it("maps task_complete to `done` (terminal)", () => {
    expect(translateCodexEvent(fixtures.taskComplete)).toEqual({
      type: "done",
      reason: "complete",
    });
  });

  it("maps error to an `error` event", () => {
    const out = translateCodexEvent({ type: "error", message: "model exploded" });
    expect(out).toMatchObject({ type: "error" });
    expect((out as { error: Error }).error.message).toBe("model exploded");
  });

  it("drops the final agent_message (already streamed via deltas)", () => {
    expect(translateCodexEvent(fixtures.agentMessageFinal)).toBeNull();
  });

  it("drops token_count (Slice A does not meter Codex tokens)", () => {
    expect(translateCodexEvent(fixtures.tokenCount)).toBeNull();
  });

  it("drops internal/lifecycle events", () => {
    for (const m of [
      fixtures.sessionConfigured,
      fixtures.userMessage,
      fixtures.itemStarted,
      fixtures.rawResponseItem,
      fixtures.mcpStartup,
    ]) {
      expect(translateCodexEvent(m)).toBeNull();
    }
  });

  it("drops an empty delta", () => {
    expect(translateCodexEvent({ type: "agent_message_content_delta", delta: "" })).toBeNull();
  });

  it("surfaces a genuinely unknown event type as a system_message (auditability)", () => {
    expect(translateCodexEvent({ type: "exec_command_begin", command: "ls" })).toEqual({
      type: "system_message",
      text: "[codex: exec_command_begin]",
      intent: "info",
    });
  });
});
