import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuxiliaryClient } from "../llm/auxiliary";
import { type CompactorConfig, compactMessages, SUMMARY_SENTINEL_PREFIX } from "./compactor";

function makeAux(returnText = "MOCK_SUMMARY"): AuxiliaryClient {
  return {
    complete: vi.fn(async () => returnText),
  } as unknown as AuxiliaryClient;
}

function makeMsg(role: "user" | "assistant", text: string): ModelMessage {
  return { role, content: text };
}

// Tight test-config so the tail-budget boundary actually fires on small fixture
// messages (a typical real-world budget of 8000 tokens would just consume the
// entire middle of a fixture).
const testConfig: CompactorConfig = {
  headSize: 2,
  tailTokenBudget: 5,
  minMiddleMessages: 1,
  summarySentinelPrefix: SUMMARY_SENTINEL_PREFIX,
};

describe("compactMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unchanged when there are too few messages to bother compacting", async () => {
    const messages = [makeMsg("user", "hi"), makeMsg("assistant", "hello")];
    const aux = makeAux();
    const result = await compactMessages({ messages, config: testConfig, aux });
    expect(result.unchanged).toBe(true);
    expect(result.compactedMessages).toBe(messages);
    expect(aux.complete).not.toHaveBeenCalled();
  });

  it("produces a head + summary + tail shape when the conversation is long enough", async () => {
    const messages: ModelMessage[] = [
      makeMsg("user", "head 1 user message"),
      makeMsg("assistant", "head 2 assistant response — anchor"),
      makeMsg("user", "middle 1"),
      makeMsg("assistant", "middle 2"),
      makeMsg("user", "middle 3"),
      makeMsg("assistant", "middle 4"),
      makeMsg("user", "tail 1"),
      makeMsg("assistant", "tail 2 recent"),
    ];
    const aux = makeAux("compressed summary text");
    const result = await compactMessages({ messages, config: testConfig, aux });
    expect(result.unchanged).toBe(false);
    // shape: head(2) + summary(1) + tail(rest)
    expect(result.compactedMessages.length).toBeLessThan(messages.length);
    expect(result.compactedMessages[0]).toBe(messages[0]); // head preserved
    expect(result.compactedMessages[1]).toBe(messages[1]);
    // The summary is at index 2 (after the 2-message head).
    const summaryMsg = result.compactedMessages[2];
    expect(summaryMsg.role).toBe("assistant");
    expect(typeof summaryMsg.content === "string" ? summaryMsg.content : "").toContain(
      SUMMARY_SENTINEL_PREFIX,
    );
    // Last message of compacted equals the last original message (tail preserved at the end).
    expect(result.compactedMessages[result.compactedMessages.length - 1]).toBe(
      messages[messages.length - 1],
    );
  });

  it("tail token-budget walk-backward picks the right boundary", async () => {
    // Each message has ~35 chars → 10 tokens (chars/3.5). With tailTokenBudget=20,
    // the tail should be the last 2 messages exactly (sum = 20, including the 3rd
    // would exceed budget). headSize=2, so we need at least 2 head + 1 middle + 2 tail = 5 messages.
    const longText = "x".repeat(35); // 10 tokens per message
    const messages: ModelMessage[] = [
      makeMsg("user", "head 1"),
      makeMsg("assistant", "head 2"),
      makeMsg("user", longText), // middle (10 tokens)
      makeMsg("assistant", longText), // middle (10 tokens)
      makeMsg("user", longText), // tail (10 tokens — fits in 20-budget)
      makeMsg("assistant", longText), // tail (10 tokens — fits in 20-budget)
    ];
    const tightConfig: CompactorConfig = { ...testConfig, tailTokenBudget: 20 };
    const aux = makeAux("summary");
    const result = await compactMessages({ messages, config: tightConfig, aux });
    expect(result.unchanged).toBe(false);
    // Expected: head (2) + summary (1) + tail (2) = 5 compacted messages.
    // The tail walk-backward should include the last 2 messages (10 + 10 = 20, on the edge).
    expect(result.compactedMessages.length).toBe(5);
    // Last two messages of compacted should be the last two originals.
    expect(result.compactedMessages[3]).toBe(messages[4]);
    expect(result.compactedMessages[4]).toBe(messages[5]);
  });

  it("summary message uses assistant role with the sentinel prefix", async () => {
    const messages: ModelMessage[] = Array.from({ length: 8 }, (_, i) =>
      makeMsg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`),
    );
    const aux = makeAux("compressed!");
    const result = await compactMessages({ messages, config: testConfig, aux });
    expect(result.unchanged).toBe(false);
    const summaryMsg = result.compactedMessages.find((m) =>
      typeof m.content === "string" ? m.content.startsWith(SUMMARY_SENTINEL_PREFIX) : false,
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg?.role).toBe("assistant");
    expect(summaryMsg?.content).toContain("compressed!");
  });

  it("iteratively recompacts: prior summary at middle[0] is folded into the new summary prompt", async () => {
    // Construct a messages array where middle[0] (index = headSize = 2) is a
    // prior-summary message. The aux client should see the prior summary in its prompt.
    const priorSummaryContent = `${SUMMARY_SENTINEL_PREFIX}\n\nOriginal summary of turns 1-10.`;
    const messages: ModelMessage[] = [
      makeMsg("user", "head 1"),
      makeMsg("assistant", "head 2"),
      makeMsg("assistant", priorSummaryContent), // middle[0] — the prior summary
      makeMsg("user", "new middle 1"),
      makeMsg("assistant", "new middle 2"),
      makeMsg("user", "tail 1"),
      makeMsg("assistant", "tail 2"),
    ];
    const aux = makeAux("merged summary text");
    await compactMessages({ messages, config: testConfig, aux });
    // The first call to aux.complete must contain the prior summary text.
    expect(aux.complete).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(aux.complete).mock.calls[0][0];
    expect(promptArg).toContain("Original summary of turns 1-10");
    expect(promptArg).toContain("Previous summary of earlier turns");
  });

  it("preserves at least the newest message in tail even when it alone exceeds the budget", async () => {
    // Newest message is huge (1000 chars = ~286 tokens), budget is 5. Without
    // the "always keep newest" guarantee, tail would be empty and the newest
    // message would be summarized away. Per docs/SPEC.md the most recent tail
    // must be preserved verbatim.
    const hugeNewest = "x".repeat(1000);
    const messages: ModelMessage[] = [
      makeMsg("user", "head 1"),
      makeMsg("assistant", "head 2"),
      makeMsg("user", "middle"),
      makeMsg("assistant", "middle"),
      makeMsg("user", "middle"),
      makeMsg("assistant", hugeNewest), // oversized newest
    ];
    const aux = makeAux("summary");
    const result = await compactMessages({ messages, config: testConfig, aux });
    expect(result.unchanged).toBe(false);
    // The very last message of compactedMessages MUST be the oversized newest message.
    expect(result.compactedMessages[result.compactedMessages.length - 1]).toBe(
      messages[messages.length - 1],
    );
  });

  it("propagates auxiliary failures (no fallback in B.1)", async () => {
    const messages: ModelMessage[] = Array.from({ length: 8 }, (_, i) =>
      makeMsg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`),
    );
    const aux: AuxiliaryClient = {
      complete: vi.fn(async () => {
        throw new Error("aux down");
      }),
    } as unknown as AuxiliaryClient;
    await expect(compactMessages({ messages, config: testConfig, aux })).rejects.toThrow(
      "aux down",
    );
  });

  it("passes focus text through into the summarization prompt", async () => {
    const messages: ModelMessage[] = Array.from({ length: 8 }, (_, i) =>
      makeMsg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`),
    );
    const aux = makeAux();
    await compactMessages({ messages, config: testConfig, aux, focus: "the deploy pipeline" });
    const promptArg = vi.mocked(aux.complete).mock.calls[0][0];
    expect(promptArg).toContain("Focus the summary on: the deploy pipeline");
  });
});
