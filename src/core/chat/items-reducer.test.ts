import { describe, expect, it } from "vitest";
import type { ChatItem } from "../chat-projection";
import type { AgentEvent } from "../types";
import { reduceChatItems } from "./items-reducer";

/** Deterministic injected id generator. */
function makeNextId(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `t-${n}`;
  };
}

const streaming = (text: string, id = "a"): ChatItem => ({
  kind: "assistant-text",
  id,
  text,
  status: "streaming",
});

describe("reduceChatItems", () => {
  describe("text", () => {
    it("starts a new streaming assistant bubble on empty input, using the injected id", () => {
      const out = reduceChatItems([], { type: "text", delta: "Hel" }, makeNextId());
      expect(out).toEqual([
        { kind: "assistant-text", id: "t-1", text: "Hel", status: "streaming" },
      ]);
    });

    it("appends the delta to an in-flight streaming bubble without allocating an id", () => {
      const nextId = makeNextId();
      const out = reduceChatItems([streaming("Hel")], { type: "text", delta: "lo" }, nextId);
      expect(out).toEqual([streaming("Hello")]);
      // no id consumed
      expect(nextId()).toBe("t-1");
    });

    it("starts a fresh bubble when the last item is a completed assistant message", () => {
      const prev: ChatItem[] = [
        { kind: "assistant-text", id: "a", text: "done", status: "complete" },
      ];
      const out = reduceChatItems(prev, { type: "text", delta: "next" }, makeNextId());
      expect(out).toHaveLength(2);
      expect(out[1]).toEqual({
        kind: "assistant-text",
        id: "t-1",
        text: "next",
        status: "streaming",
      });
    });
  });

  describe("approval_request", () => {
    it("finalizes the in-flight bubble then appends the approval card (id from event)", () => {
      const event: AgentEvent = {
        type: "approval_request",
        id: "appr-1",
        action: "delphy__search",
        payload: { q: "x" },
      };
      const out = reduceChatItems([streaming("thinking")], event, makeNextId());
      expect(out[0]).toEqual({
        kind: "assistant-text",
        id: "a",
        text: "thinking",
        status: "complete",
      });
      expect(out[1]).toEqual({
        kind: "approval",
        id: "appr-1",
        action: "delphy__search",
        payload: { q: "x" },
      });
    });
  });

  describe("tool_call", () => {
    it("finalizes the in-flight bubble then appends the tool-call (id from event)", () => {
      const event: AgentEvent = {
        type: "tool_call",
        id: "tc-1",
        name: "search",
        input: { q: "x" },
      };
      const out = reduceChatItems([streaming("calling")], event, makeNextId());
      expect(out[0]).toMatchObject({ status: "complete" });
      expect(out[1]).toEqual({ kind: "tool-call", id: "tc-1", name: "search", input: { q: "x" } });
    });
  });

  describe("tool_result", () => {
    it("replaces a matching tool-call in place, preserving its name", () => {
      const prev: ChatItem[] = [{ kind: "tool-call", id: "tc-1", name: "search", input: {} }];
      const event: AgentEvent = { type: "tool_result", id: "tc-1", output: "ok", isError: false };
      const out = reduceChatItems(prev, event, makeNextId());
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({
        kind: "tool-result",
        id: "tc-1",
        name: "search",
        output: "ok",
        isError: false,
      });
    });

    it("appends with name 'tool' when no matching tool-call exists", () => {
      const event: AgentEvent = {
        type: "tool_result",
        id: "orphan",
        output: "boom",
        isError: true,
      };
      const out = reduceChatItems([], event, makeNextId());
      expect(out).toEqual([
        { kind: "tool-result", id: "orphan", name: "tool", output: "boom", isError: true },
      ]);
    });
  });

  describe("done", () => {
    it("finalizes the in-flight bubble to complete on reason=complete", () => {
      const out = reduceChatItems(
        [streaming("hi")],
        { type: "done", reason: "complete" },
        makeNextId(),
      );
      expect(out).toEqual([{ kind: "assistant-text", id: "a", text: "hi", status: "complete" }]);
    });

    it("finalizes to error on a non-complete reason", () => {
      const out = reduceChatItems(
        [streaming("hi")],
        { type: "done", reason: "interrupted" },
        makeNextId(),
      );
      expect(out[0]).toMatchObject({ status: "error" });
    });

    it("is a no-op (same reference) when nothing is in flight", () => {
      const prev: ChatItem[] = [{ kind: "user-text", id: "u", text: "hi" }];
      const out = reduceChatItems(prev, { type: "done", reason: "complete" }, makeNextId());
      expect(out).toBe(prev);
    });
  });

  describe("error", () => {
    it("finalizes to error then appends a runtime-error with the injected id", () => {
      const event: AgentEvent = {
        type: "error",
        error: new Error("nope"),
        kind: "invalid-key",
      };
      const out = reduceChatItems([streaming("hi")], event, makeNextId());
      expect(out[0]).toMatchObject({ status: "error" });
      expect(out[1]).toEqual({
        kind: "runtime-error",
        id: "t-1",
        errorKind: "invalid-key",
        message: "nope",
      });
    });

    it("defaults errorKind to 'unknown' when the event omits kind", () => {
      const out = reduceChatItems([], { type: "error", error: new Error("x") }, makeNextId());
      expect(out[0]).toMatchObject({ kind: "runtime-error", errorKind: "unknown" });
    });
  });

  describe("system_message", () => {
    it("finalizes the in-flight bubble then appends a system item with intent + injected id", () => {
      const event: AgentEvent = { type: "system_message", text: "compacted", intent: "info" };
      const out = reduceChatItems([streaming("mid")], event, makeNextId());
      expect(out[0]).toMatchObject({ status: "complete" });
      expect(out[1]).toEqual({ kind: "system", id: "t-1", text: "compacted", intent: "info" });
    });
  });

  describe("non-item events preserve identity", () => {
    it("returns the same array reference for usage / context_usage / thinking", () => {
      const prev: ChatItem[] = [streaming("x")];
      const nextId = makeNextId();
      expect(
        reduceChatItems(prev, { type: "usage", inputTokens: 1, outputTokens: 2 }, nextId),
      ).toBe(prev);
      expect(
        reduceChatItems(
          prev,
          { type: "context_usage", tokensUsed: 1, limit: 2, percent: 50 },
          nextId,
        ),
      ).toBe(prev);
      expect(reduceChatItems(prev, { type: "thinking", delta: "hmm" }, nextId)).toBe(prev);
      // no ids consumed by no-op events
      expect(nextId()).toBe("t-1");
    });
  });
});
