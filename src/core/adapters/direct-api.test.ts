import { beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: mock factory ergonomics
type Any = any;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn(),
    generateText: vi.fn(),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => {
    return vi.fn((modelId: string) => ({ modelId, __fakeProvider: true }));
  }),
}));

vi.mock("../session/compactor", async () => {
  const actual =
    await vi.importActual<typeof import("../session/compactor")>("../session/compactor");
  return {
    ...actual,
    compactMessages: vi.fn(),
  };
});

const mockGetAllTools = vi.fn();
const mockCallTool = vi.fn();
vi.mock("../mcp/manager", () => ({
  mcpManager: {
    getAllTools: (...args: unknown[]) => mockGetAllTools(...args),
    callTool: (...args: unknown[]) => mockCallTool(...args),
  },
}));

const mockSaveMemory = vi.fn();
vi.mock("../db/memory", () => ({
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
  loadMemory: vi.fn().mockResolvedValue(""),
  GLOBAL_MEMORY_ID: "global",
  MEMORY_MAX_CHARS: 3000,
}));

import { invoke } from "@tauri-apps/api/core";
import { generateText, streamText } from "ai";
import { buildSystemPrompt, defaultSystemPromptSlices } from "../prompts/three-tier";
import { clearRuntimeKey, getRuntimeKey, setRuntimeKey } from "../providers/anthropic-runtime-key";
import { compactMessages } from "../session/compactor";
import type { AgentEvent, Session } from "../types";
import { BootError, directApiAdapter } from "./direct-api";

const mockedInvoke = vi.mocked(invoke);
const mockedStreamText = vi.mocked(streamText);
const mockedGenerateText = vi.mocked(generateText);
const mockedCompactMessages = vi.mocked(compactMessages);

function fakeStreamResult(
  parts: Array<Record<string, unknown>>,
  options: {
    usage?: { inputTokens?: number; outputTokens?: number };
    responseMessages?: Array<Record<string, unknown>>;
    finishReason?: string;
  } = {},
): Any {
  const usage = options.usage ?? { inputTokens: 10, outputTokens: 20 };
  const finishReason = options.finishReason ?? "stop";
  const textParts = parts.filter((p) => p.type === "text-delta");
  const fullText = textParts.map((p) => p.text).join("");
  const defaultResponseMessages: Array<Record<string, unknown>> =
    fullText.length > 0 ? [{ role: "assistant", content: fullText }] : [];
  const responseMessages = options.responseMessages ?? defaultResponseMessages;
  const hasFinish = parts.some((p) => p.type === "finish");
  const hasAbort = parts.some((p) => p.type === "abort");
  return {
    fullStream: (async function* () {
      for (const p of parts) yield p;
      if (!hasFinish && !hasAbort) {
        yield { type: "finish", finishReason, rawFinishReason: finishReason, totalUsage: usage };
      }
    })(),
    usage: Promise.resolve({ ...usage, totalTokens: 30 }),
    finishReason: Promise.resolve(finishReason),
    text: Promise.resolve(fullText),
    toolCalls: Promise.resolve([]),
    totalUsage: Promise.resolve({ ...usage, totalTokens: 30 }),
    response: Promise.resolve({
      messages: responseMessages,
    }),
  };
}

async function collectOneTurn(iter: AsyncIterator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  while (true) {
    const r = await iter.next();
    if (r.done) break;
    out.push(r.value);
    if (r.value.type === "done") break;
  }
  return out;
}

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedStreamText.mockReset();
  mockedGenerateText.mockReset();
  mockedCompactMessages.mockReset();
  mockGetAllTools.mockReset();
  mockCallTool.mockReset();
  mockSaveMemory.mockReset();
  mockSaveMemory.mockResolvedValue({ saved: "", truncated: false });
  mockedCompactMessages.mockResolvedValue({
    unchanged: true,
    compactedMessages: [],
    summary: "",
    metrics: { before: 0, after: 0, estimatedTokensSaved: 0 },
  } as Any);
  mockGetAllTools.mockReturnValue([]);
  clearRuntimeKey();
});

describe("directApiAdapter — boot", () => {
  it("rejects with BootError(missing-key) when keychain is empty and runtime is empty", async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    await expect(directApiAdapter.start({})).rejects.toMatchObject({
      name: "BootError",
      kind: "missing-key",
    });
  });

  it("rejects with BootError(secure-storage-unavailable) when keychain throws SECURE_STORAGE_UNAVAILABLE", async () => {
    mockedInvoke.mockRejectedValueOnce(
      "SECURE_STORAGE_UNAVAILABLE: dbus: org.freedesktop.secrets not available",
    );
    await expect(directApiAdapter.start({})).rejects.toMatchObject({
      name: "BootError",
      kind: "secure-storage-unavailable",
    });
  });

  it("rejects with BootError(unknown) on generic keychain failure", async () => {
    mockedInvoke.mockRejectedValueOnce("KEYRING_ERROR: something else broke");
    await expect(directApiAdapter.start({})).rejects.toMatchObject({
      name: "BootError",
      kind: "unknown",
    });
  });

  it("falls back to runtime key when keychain is empty but runtime is set", async () => {
    mockedInvoke.mockResolvedValueOnce(null);
    setRuntimeKey("runtime-test-key");
    const session = await directApiAdapter.start({});
    expect(session.id).toMatch(/^direct-api-/);
    await session.close();
  });

  it("falls back to runtime key when keychain throws SECURE_STORAGE_UNAVAILABLE but runtime is set", async () => {
    mockedInvoke.mockRejectedValueOnce(
      "SECURE_STORAGE_UNAVAILABLE: dbus: secret-service unavailable",
    );
    setRuntimeKey("runtime-test-key");
    const session = await directApiAdapter.start({});
    expect(session.id).toMatch(/^direct-api-/);
    await session.close();
  });
});

describe("directApiAdapter — event mapping", () => {
  async function startSession(): Promise<Session> {
    mockedInvoke.mockResolvedValueOnce("sk-ant-test");
    return directApiAdapter.start({});
  }

  it("happy path: text-delta parts → text events, then usage + done(complete)", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([
        { type: "text-delta", text: "Hello, " },
        { type: "text-delta", text: "world." },
      ]),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("hi");
    const events = await collectOneTurn(iter);

    // BACKLOG #12.A CP3 added a `context_usage` event after each turn's
    // `usage`. The sequence is now: text* + usage + context_usage + done.
    expect(events.map((e) => e.type)).toEqual(["text", "text", "usage", "context_usage", "done"]);
    const [t1, t2, u, ctx, d] = events;
    expect(t1.type === "text" && t1.delta).toBe("Hello, ");
    expect(t2.type === "text" && t2.delta).toBe("world.");
    expect(u.type === "usage" && u.inputTokens).toBe(10);
    expect(u.type === "usage" && u.outputTokens).toBe(20);
    expect(ctx.type === "context_usage" && ctx.limit).toBe(200_000);
    expect(ctx.type === "context_usage" && ctx.percent).toBeGreaterThanOrEqual(0);
    expect(d.type === "done" && d.reason).toBe("complete");

    await session.close();
  });

  it("error part with statusCode 401 → AgentEvent.error kind=invalid-key, then done(error)", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([{ type: "error", error: { statusCode: 401, message: "Unauthorized" } }], {
        finishReason: "error",
      }),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("hi");
    const events = await collectOneTurn(iter);

    // CP3 added context_usage after usage; sequence is now error + usage + context_usage + done.
    expect(events.map((e) => e.type)).toEqual(["error", "usage", "context_usage", "done"]);
    const [err, , , done] = events;
    expect(err.type === "error" && err.kind).toBe("invalid-key");
    expect(done.type === "done" && done.reason).toBe("error");

    await session.close();
  });

  it("error part with statusCode 429 → kind=rate-limited", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult(
        [{ type: "error", error: { statusCode: 429, message: "Too many requests" } }],
        { finishReason: "error" },
      ),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("hi");
    const events = await collectOneTurn(iter);

    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent?.type === "error" && errEvent.kind).toBe("rate-limited");

    await session.close();
  });

  it("error part with statusCode 404 → kind=model-deprecated", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult(
        [{ type: "error", error: { statusCode: 404, message: "model_not_found" } }],
        { finishReason: "error" },
      ),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("hi");
    const events = await collectOneTurn(iter);

    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent?.type === "error" && errEvent.kind).toBe("model-deprecated");

    await session.close();
  });

  it("abort part → done(interrupted)", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([{ type: "text-delta", text: "partial output" }, { type: "abort" }]),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("hi");
    const events = await collectOneTurn(iter);

    expect(events.map((e) => e.type)).toEqual(["text", "done"]);
    const done = events[1];
    expect(done.type === "done" && done.reason).toBe("interrupted");

    await session.close();
  });

  it("multi-turn: messages array grows correctly between turns", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([{ type: "text-delta", text: "First reply" }]),
    );

    let secondCallMessages: Array<{ role: string; content: unknown }> | undefined;
    mockedStreamText.mockImplementationOnce(((opts: { messages: Any }) => {
      // Snapshot the messages array at call time — the adapter mutates the
      // underlying array after streamText returns (to append the assistant turn),
      // so capturing by reference would over-count.
      secondCallMessages = [...opts.messages];
      return fakeStreamResult([{ type: "text-delta", text: "Second reply" }]);
    }) as Any);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    await session.sendMessage("hello");
    await collectOneTurn(iter);

    await session.sendMessage("how are you?");
    await collectOneTurn(iter);

    expect(secondCallMessages).toBeDefined();
    expect(secondCallMessages?.length).toBe(3);
    expect(secondCallMessages?.[0]).toMatchObject({ role: "user", content: "hello" });
    expect(secondCallMessages?.[1]).toMatchObject({
      role: "assistant",
      content: "First reply",
    });
    expect(secondCallMessages?.[2]).toMatchObject({
      role: "user",
      content: "how are you?",
    });

    await session.close();
  });
});

describe("directApiAdapter — auto-compaction trigger (B.2)", () => {
  async function startSession(): Promise<Session> {
    mockedInvoke.mockResolvedValueOnce("sk-ant-test");
    return directApiAdapter.start({});
  }

  // ~600K chars / 3.5 ≈ 171K tokens — just above the 200K * 0.85 = 170K
  // AUTO_COMPACT_THRESHOLD. Enough to fire the trigger in one shot.
  const HUGE_TEXT = "x".repeat(600_000);

  it("does not auto-trigger when usage is below threshold", async () => {
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("small message");
    const events = await collectOneTurn(iter);

    expect(events.filter((e) => e.type === "system_message")).toHaveLength(0);
    expect(mockedCompactMessages).not.toHaveBeenCalled();
    await session.close();
  });

  it("auto-trigger fires when usage exceeds threshold; emits pre + post system_message banners", async () => {
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    mockedCompactMessages.mockResolvedValueOnce({
      unchanged: false,
      compactedMessages: [{ role: "user", content: "compacted" }],
      summary: "summary text",
      metrics: { before: 10, after: 3, estimatedTokensSaved: 50_000 },
    } as Any);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage(HUGE_TEXT);
    const events = await collectOneTurn(iter);

    const systemMessages = events.filter((e) => e.type === "system_message");
    expect(systemMessages).toHaveLength(2);
    expect(systemMessages[0].type === "system_message" && systemMessages[0].text).toMatch(
      /Compacting/,
    );
    expect(systemMessages[1].type === "system_message" && systemMessages[1].text).toMatch(
      /Auto-compacted: 10 → 3 messages/,
    );
    expect(mockedCompactMessages).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it("rejects a re-entrant sendMessage while parked in pre-stream setup (compacting)", async () => {
    // Regression for the compaction re-entrancy window: the turn is claimed as
    // "preparing" the instant it's accepted, so a second sendMessage that
    // arrives while the first is still in auto-compaction (before streaming) is
    // rejected rather than interleaving and clobbering this.messages.
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    let resolveCompaction!: () => void;
    mockedCompactMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCompaction = () =>
            resolve({
              unchanged: false,
              compactedMessages: [{ role: "user", content: "compacted" }],
              summary: "s",
              metrics: { before: 10, after: 3, estimatedTokensSaved: 50_000 },
            } as Any);
        }),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise1 = session.sendMessage(HUGE_TEXT); // parks in compaction
    await new Promise((r) => setTimeout(r, 10));

    await session.sendMessage("second while preparing"); // must be rejected

    resolveCompaction();
    await sendPromise1;

    const events: AgentEvent[] = [];
    while (true) {
      const r = await iter.next();
      if (r.done) break;
      events.push(r.value);
      if (events.filter((e) => e.type === "done").length >= 2) break;
    }

    const errors = events.filter((e) => e.type === "error");
    expect(
      errors.some((e) => e.type === "error" && e.error.message.includes("turn is in progress")),
    ).toBe(true);
    await session.close();
  });

  it("auto-trigger failure emits a failure system_message and chat continues normally", async () => {
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    mockedCompactMessages.mockRejectedValueOnce(new Error("aux down"));

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage(HUGE_TEXT);
    const events = await collectOneTurn(iter);

    const systemMessages = events.filter((e) => e.type === "system_message");
    // pre-banner + failure banner
    expect(systemMessages).toHaveLength(2);
    const last = systemMessages[systemMessages.length - 1];
    expect(last.type === "system_message" && last.text).toMatch(/Auto-compaction failed.*aux down/);
    // The failure banner carries the error intent so it renders with the
    // theme-tinted AlertTriangle icon (per Astra catalog) instead of Info.
    expect(last.type === "system_message" && last.intent).toBe("error");
    // Chat still produced a normal text event from the mocked stream.
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "done" && e.reason === "complete")).toBe(true);
    await session.close();
  });

  it("anti-thrashing: low prior-saved ratio skips the next auto-trigger", async () => {
    mockedStreamText.mockReturnValue(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    // First compaction succeeds with a tiny saved ratio (100 tokens out of
    // huge preTotal). lastCompactionSavedRatio ends up well below 0.10.
    mockedCompactMessages.mockResolvedValueOnce({
      unchanged: false,
      compactedMessages: [{ role: "user", content: "still-huge" }],
      summary: "summary",
      metrics: { before: 10, after: 3, estimatedTokensSaved: 100 },
    } as Any);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    // Turn 1: huge message triggers compaction; tiny ratio recorded.
    await session.sendMessage(HUGE_TEXT);
    await collectOneTurn(iter);
    expect(mockedCompactMessages).toHaveBeenCalledTimes(1);

    // Turn 2: another huge message — anti-thrashing should skip the trigger.
    await session.sendMessage(HUGE_TEXT);
    const events2 = await collectOneTurn(iter);

    expect(mockedCompactMessages).toHaveBeenCalledTimes(1); // STILL just 1 — no second call
    expect(events2.filter((e) => e.type === "system_message")).toHaveLength(0);
    await session.close();
  });
});

describe("BootError", () => {
  it("is named BootError and carries the kind", () => {
    const e = new BootError("missing-key", "no key");
    expect(e.name).toBe("BootError");
    expect(e.kind).toBe("missing-key");
    expect(e.message).toBe("no key");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("buildSystemPrompt", () => {
  it("joins all three slices with double newlines when all populated", () => {
    expect(buildSystemPrompt({ stable: "a", context: "b", volatile: "c" })).toBe("a\n\nb\n\nc");
  });

  it("omits empty slices", () => {
    expect(buildSystemPrompt({ stable: "a", context: "", volatile: "c" })).toBe("a\n\nc");
    expect(buildSystemPrompt({ stable: "a", context: "", volatile: "" })).toBe("a");
  });

  it("defaultSystemPromptSlices yields a populated stable + empty context/volatile", () => {
    const slices = defaultSystemPromptSlices();
    expect(slices.stable.length).toBeGreaterThan(0);
    expect(slices.context).toBe("");
    expect(slices.volatile).toBe("");
    expect(buildSystemPrompt(slices)).toBe(slices.stable);
  });
});

describe("anthropic runtime-key module", () => {
  it("getRuntimeKey returns null by default", () => {
    expect(getRuntimeKey()).toBe(null);
  });

  it("set then get roundtrips", () => {
    setRuntimeKey("test-key");
    expect(getRuntimeKey()).toBe("test-key");
  });

  it("clearRuntimeKey resets to null", () => {
    setRuntimeKey("test-key");
    clearRuntimeKey();
    expect(getRuntimeKey()).toBe(null);
  });
});

describe("directApiAdapter — tool wiring + approval flow", () => {
  async function startSession(): Promise<Session> {
    mockedInvoke.mockResolvedValueOnce("sk-ant-test");
    return directApiAdapter.start({});
  }

  function setupToolMock() {
    mockGetAllTools.mockReturnValue([
      {
        serverId: "test-server",
        name: "echo",
        namespacedName: "test-server__echo",
        description: "Echoes input",
        inputSchema: { type: "object", properties: { message: { type: "string" } } },
      },
    ]);
  }

  it("tool-call part → tool_call AgentEvent emission", async () => {
    setupToolMock();
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "test-server__echo",
          input: { message: "hello" },
        },
        { type: "text-delta", text: "Done." },
      ]),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("echo hello");
    const events = await collectOneTurn(iter);

    const tc = events.find((e) => e.type === "tool_call");
    expect(tc).toBeDefined();
    expect(tc?.type === "tool_call" && tc.name).toBe("test-server__echo");
    expect(tc?.type === "tool_call" && tc.input).toEqual({ message: "hello" });
    await session.close();
  });

  it("tool-approval-request part → approval_request AgentEvent + awaiting_approval", async () => {
    setupToolMock();
    const approvalStream = fakeStreamResult(
      [
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "test-server__echo",
          input: { message: "hello" },
        },
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "test-server__echo",
            input: { message: "hello" },
          },
        },
      ],
      { finishReason: "tool-calls" },
    );

    const resumeStream = fakeStreamResult([{ type: "text-delta", text: "Echoed!" }]);

    mockedStreamText.mockReturnValueOnce(approvalStream);
    mockedStreamText.mockReturnValueOnce(resumeStream);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("echo hello");

    await new Promise((r) => setTimeout(r, 10));

    await session.respondToApproval("ap-1", true);
    await sendPromise;
    const events = await collectOneTurn(iter);

    const ar = events.find((e) => e.type === "approval_request");
    expect(ar).toBeDefined();
    expect(ar?.type === "approval_request" && ar.id).toBe("ap-1");
    expect(ar?.type === "approval_request" && ar.action).toBe("test-server__echo");
    expect(mockedStreamText).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it("respondToApproval(true) resumes execution → tool-result → done(complete)", async () => {
    setupToolMock();
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "echoed: hello" }],
      isError: false,
    });

    const approvalStream = fakeStreamResult(
      [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "test-server__echo",
            input: { message: "hello" },
          },
        },
      ],
      { finishReason: "tool-calls" },
    );

    const resumeStream = fakeStreamResult([
      {
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "test-server__echo",
        input: { message: "hello" },
        output: { content: [{ type: "text", text: "echoed: hello" }], isError: false },
      },
      { type: "text-delta", text: "All done." },
    ]);

    mockedStreamText.mockReturnValueOnce(approvalStream);
    mockedStreamText.mockReturnValueOnce(resumeStream);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("echo hello");
    await new Promise((r) => setTimeout(r, 10));
    await session.respondToApproval("ap-1", true);
    await sendPromise;
    const events = await collectOneTurn(iter);

    const tr = events.find((e) => e.type === "tool_result");
    expect(tr).toBeDefined();
    expect(tr?.type === "tool_result" && tr.isError).toBe(false);
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("complete");
    await session.close();
  });

  it("respondToApproval(false) → denied tool-result → done(complete)", async () => {
    setupToolMock();

    const approvalStream = fakeStreamResult(
      [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "test-server__echo",
            input: { message: "hello" },
          },
        },
      ],
      { finishReason: "tool-calls" },
    );

    const resumeStream = fakeStreamResult([
      {
        type: "tool-output-denied",
        toolCallId: "tc-1",
        toolName: "test-server__echo",
      },
      { type: "text-delta", text: "I understand." },
    ]);

    mockedStreamText.mockReturnValueOnce(approvalStream);
    mockedStreamText.mockReturnValueOnce(resumeStream);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("echo hello");
    await new Promise((r) => setTimeout(r, 10));
    await session.respondToApproval("ap-1", false);
    await sendPromise;
    const events = await collectOneTurn(iter);

    const tr = events.find((e) => e.type === "tool_result");
    expect(tr).toBeDefined();
    expect(tr?.type === "tool_result" && tr.isError).toBe(true);
    expect(tr?.type === "tool_result" && tr.output).toBe("User denied tool execution");
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("complete");
    await session.close();
  });

  it("tool-less chat: only the built-in update_memory tool when getAllTools returns empty", async () => {
    mockGetAllTools.mockReturnValue([]);
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([{ type: "text-delta", text: "No tools here." }]),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("hi");
    const events = await collectOneTurn(iter);

    expect(events.some((e) => e.type === "text")).toBe(true);
    const callArgs = mockedStreamText.mock.calls[0]?.[0] as Any;
    expect(Object.keys(callArgs.tools)).toEqual(["update_memory"]);
    await session.close();
  });

  it("multi-tool chained turn: model uses tool A → approve → tool B → approve → done", async () => {
    setupToolMock();

    const stream1 = fakeStreamResult(
      [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: { type: "tool-call", toolCallId: "tc-1", toolName: "echo", input: {} },
        },
      ],
      { finishReason: "tool-calls" },
    );
    const stream2 = fakeStreamResult(
      [
        {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "echo",
          input: {},
          output: "result-1",
        },
        {
          type: "tool-approval-request",
          approvalId: "ap-2",
          toolCall: { type: "tool-call", toolCallId: "tc-2", toolName: "echo", input: {} },
        },
      ],
      { finishReason: "tool-calls" },
    );
    const stream3 = fakeStreamResult([{ type: "text-delta", text: "All done." }]);

    mockedStreamText.mockReturnValueOnce(stream1);
    mockedStreamText.mockReturnValueOnce(stream2);
    mockedStreamText.mockReturnValueOnce(stream3);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("chain");
    await new Promise((r) => setTimeout(r, 10));
    await session.respondToApproval("ap-1", true);
    await new Promise((r) => setTimeout(r, 10));
    await session.respondToApproval("ap-2", true);
    await sendPromise;
    const events = await collectOneTurn(iter);

    expect(mockedStreamText).toHaveBeenCalledTimes(3);
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("complete");
    await session.close();
  });

  it("multi-tool parallel: 2 approval requests in one iteration, both resolved", async () => {
    setupToolMock();

    const stream1 = fakeStreamResult(
      [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: { type: "tool-call", toolCallId: "tc-1", toolName: "echo", input: { a: 1 } },
        },
        {
          type: "tool-approval-request",
          approvalId: "ap-2",
          toolCall: { type: "tool-call", toolCallId: "tc-2", toolName: "echo", input: { b: 2 } },
        },
      ],
      { finishReason: "tool-calls" },
    );
    const stream2 = fakeStreamResult([{ type: "text-delta", text: "Both done." }]);

    mockedStreamText.mockReturnValueOnce(stream1);
    mockedStreamText.mockReturnValueOnce(stream2);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("parallel");
    await new Promise((r) => setTimeout(r, 10));
    await session.respondToApproval("ap-1", true);
    await session.respondToApproval("ap-2", true);
    await sendPromise;
    const events = await collectOneTurn(iter);

    expect(mockedStreamText).toHaveBeenCalledTimes(2);
    const approvals = events.filter((e) => e.type === "approval_request");
    expect(approvals).toHaveLength(2);
    await session.close();
  });

  it("approval-cycle cap exceeded → AgentEvent.error + done(error)", async () => {
    setupToolMock();

    for (let i = 0; i < 6; i++) {
      mockedStreamText.mockReturnValueOnce(
        fakeStreamResult(
          [
            {
              type: "tool-approval-request",
              approvalId: `ap-${i}`,
              toolCall: {
                type: "tool-call",
                toolCallId: `tc-${i}`,
                toolName: "echo",
                input: {},
              },
            },
          ],
          { finishReason: "tool-calls" },
        ),
      );
    }

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("loop");
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await session.respondToApproval(`ap-${i}`, true);
    }
    await sendPromise;
    const events = await collectOneTurn(iter);

    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect(err?.type === "error" && err.error.message).toMatch(/cap exceeded/);
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("error");
    expect(mockedStreamText).toHaveBeenCalledTimes(5);
    await session.close();
  });

  it("sendMessage rejected while awaiting approval → error + done(error)", async () => {
    setupToolMock();

    const stream1 = fakeStreamResult(
      [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: { type: "tool-call", toolCallId: "tc-1", toolName: "echo", input: {} },
        },
      ],
      { finishReason: "tool-calls" },
    );
    const stream2 = fakeStreamResult([{ type: "text-delta", text: "ok" }]);

    mockedStreamText.mockReturnValueOnce(stream1);
    mockedStreamText.mockReturnValueOnce(stream2);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise1 = session.sendMessage("first");
    await new Promise((r) => setTimeout(r, 10));

    await session.sendMessage("second while awaiting");

    await session.respondToApproval("ap-1", true);
    await sendPromise1;

    const events: AgentEvent[] = [];
    while (true) {
      const r = await iter.next();
      if (r.done) break;
      events.push(r.value);
      if (events.filter((e) => e.type === "done").length >= 2) break;
    }

    const errors = events.filter((e) => e.type === "error");
    expect(
      errors.some((e) => e.type === "error" && e.error.message.includes("turn is in progress")),
    ).toBe(true);
    await session.close();
  });

  it("sendMessage rejected while streaming → error + done(error)", async () => {
    setupToolMock();

    let resolveBlock!: () => void;
    const blockingStream = {
      fullStream: (async function* () {
        yield { type: "text-delta" as const, text: "thinking" };
        await new Promise<void>((r) => {
          resolveBlock = r;
        });
        yield {
          type: "finish" as const,
          finishReason: "stop",
          rawFinishReason: "stop",
          totalUsage: { inputTokens: 10, outputTokens: 20 },
        };
      })(),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
      finishReason: Promise.resolve("stop"),
      text: Promise.resolve("thinking"),
      toolCalls: Promise.resolve([]),
      totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "thinking" }] }),
    };

    mockedStreamText.mockReturnValueOnce(blockingStream as Any);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise1 = session.sendMessage("first");
    await new Promise((r) => setTimeout(r, 10));

    await session.sendMessage("second while streaming");

    resolveBlock();
    await sendPromise1;

    const events: AgentEvent[] = [];
    while (true) {
      const r = await iter.next();
      if (r.done) break;
      events.push(r.value);
      if (events.filter((e) => e.type === "done").length >= 2) break;
    }

    const errors = events.filter((e) => e.type === "error");
    expect(
      errors.some((e) => e.type === "error" && e.error.message.includes("turn is in progress")),
    ).toBe(true);
    await session.close();
  });

  it("close() mid-await → pending cleared, turnState closed, no resume", async () => {
    setupToolMock();

    const stream1 = fakeStreamResult(
      [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: { type: "tool-call", toolCallId: "tc-1", toolName: "echo", input: {} },
        },
      ],
      { finishReason: "tool-calls" },
    );

    mockedStreamText.mockReturnValueOnce(stream1);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("close me");
    await new Promise((r) => setTimeout(r, 10));
    await session.close();

    await sendPromise.catch(() => {});

    expect(mockedStreamText).toHaveBeenCalledTimes(1);

    // Drain any remaining buffered events (approval_request, usage, etc.)
    // until the iterator terminates (eventsClosed = true).
    const remaining: AgentEvent[] = [];
    while (true) {
      const r = await iter.next();
      if (r.done) break;
      remaining.push(r.value);
    }
    // No done(complete) or resume — close terminated the session.
    expect(remaining.filter((e) => e.type === "done" && e.reason === "complete")).toHaveLength(0);
  });

  it("interrupt() mid-await → done(interrupted), session continues", async () => {
    setupToolMock();

    const stream1 = fakeStreamResult(
      [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: { type: "tool-call", toolCallId: "tc-1", toolName: "echo", input: {} },
        },
      ],
      { finishReason: "tool-calls" },
    );
    const nextStream = fakeStreamResult([{ type: "text-delta", text: "next turn" }]);

    mockedStreamText.mockReturnValueOnce(stream1);
    mockedStreamText.mockReturnValueOnce(nextStream);

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise1 = session.sendMessage("interrupt me");
    await new Promise((r) => setTimeout(r, 10));
    await session.interrupt();
    await sendPromise1.catch(() => {});

    const events1 = await collectOneTurn(iter);
    const done1 = events1.find((e) => e.type === "done");
    expect(done1?.type === "done" && done1.reason).toBe("interrupted");

    await session.sendMessage("continue");
    const events2 = await collectOneTurn(iter);
    expect(events2.some((e) => e.type === "text")).toBe(true);

    await session.close();
  });

  it("interrupt() during streaming → no double done event", async () => {
    setupToolMock();
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([
        { type: "text-delta", text: "streaming..." },
        { type: "abort", reason: "user" },
      ]),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();

    const sendPromise = session.sendMessage("interrupt during stream");
    await new Promise((r) => setTimeout(r, 5));
    await session.interrupt();
    await sendPromise.catch(() => {});

    const events = await collectOneTurn(iter);
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].type === "done" && doneEvents[0].reason).toBe("interrupted");

    await session.close();
  });
});

describe("directApiAdapter — built-in update_memory tool", () => {
  async function startSession(): Promise<Session> {
    mockedInvoke.mockResolvedValueOnce("sk-ant-test");
    return directApiAdapter.start({});
  }

  function captureToolSet(): Record<string, Any> {
    const call = mockedStreamText.mock.calls[0]?.[0] as { tools?: Record<string, Any> } | undefined;
    if (!call?.tools) throw new Error("no tools registered on streamText call");
    return call.tools;
  }

  it("registers update_memory even when no MCP tools are connected", async () => {
    mockGetAllTools.mockReturnValue([]);
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    const session = await startSession();
    await session.sendMessage("hi");
    const tools = captureToolSet();
    expect(tools.update_memory).toBeDefined();
    await session.close();
  });

  it("update_memory tool has needsApproval: false (runs inline without approval card)", async () => {
    mockGetAllTools.mockReturnValue([]);
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    const session = await startSession();
    await session.sendMessage("hi");
    const tools = captureToolSet();
    expect(tools.update_memory.needsApproval).toBe(false);
    await session.close();
  });

  it("update_memory.execute writes through saveMemory and returns success content", async () => {
    mockGetAllTools.mockReturnValue([]);
    mockSaveMemory.mockResolvedValueOnce({ saved: "hello world", truncated: false });
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    const session = await startSession();
    await session.sendMessage("hi");
    const tools = captureToolSet();
    const result = await tools.update_memory.execute({ content: "hello world" });
    expect(mockSaveMemory).toHaveBeenCalledWith("hello world");
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("11 chars");
    expect(result.content[0].text).toContain("next session");
    await session.close();
  });

  it("update_memory.execute signals truncation when saveMemory reports it", async () => {
    mockGetAllTools.mockReturnValue([]);
    mockSaveMemory.mockResolvedValueOnce({ saved: "x".repeat(3000), truncated: true });
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    const session = await startSession();
    await session.sendMessage("hi");
    const tools = captureToolSet();
    const result = await tools.update_memory.execute({ content: "x".repeat(5000) });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("truncated");
  });

  it("update_memory.execute returns isError when saveMemory throws", async () => {
    mockGetAllTools.mockReturnValue([]);
    mockSaveMemory.mockRejectedValueOnce(new Error("db locked"));
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    const session = await startSession();
    await session.sendMessage("hi");
    const tools = captureToolSet();
    const result = await tools.update_memory.execute({ content: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("db locked");
  });

  it("initialMemory is injected into the system prompt context slot", async () => {
    mockedInvoke.mockResolvedValueOnce("sk-ant-test");
    mockGetAllTools.mockReturnValue([]);
    mockedStreamText.mockReturnValueOnce(fakeStreamResult([{ type: "text-delta", text: "ok" }]));
    const session = await directApiAdapter.start({
      initialMemory: "User likes concise answers.",
    });
    await session.sendMessage("hi");
    const call = mockedStreamText.mock.calls[0]?.[0] as { system?: unknown };
    const sys = call?.system as Array<{ content: string }> | undefined;
    expect(sys?.[0].content).toContain("User memory");
    expect(sys?.[0].content).toContain("User likes concise answers");
    await session.close();
  });
});
