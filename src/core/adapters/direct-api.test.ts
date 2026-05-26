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
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => {
    return vi.fn((modelId: string) => ({ modelId, __fakeProvider: true }));
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { streamText } from "ai";
import { buildSystemPrompt, defaultSystemPromptSlices } from "../prompts/three-tier";
import { clearRuntimeKey, getRuntimeKey, setRuntimeKey } from "../providers/anthropic-runtime-key";
import type { AgentEvent, Session } from "../types";
import { BootError, directApiAdapter } from "./direct-api";

const mockedInvoke = vi.mocked(invoke);
const mockedStreamText = vi.mocked(streamText);

function fakeStreamResult(
  parts: Array<Record<string, unknown>>,
  usage: { inputTokens?: number; outputTokens?: number } = {
    inputTokens: 10,
    outputTokens: 20,
  },
): Any {
  return {
    fullStream: (async function* () {
      for (const p of parts) yield p;
    })(),
    usage: Promise.resolve({ ...usage, totalTokens: 30 }),
    finishReason: Promise.resolve("stop"),
    text: Promise.resolve(""),
    toolCalls: Promise.resolve([]),
    totalUsage: Promise.resolve({ ...usage, totalTokens: 30 }),
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

    expect(events.map((e) => e.type)).toEqual(["text", "text", "usage", "done"]);
    const [t1, t2, u, d] = events;
    expect(t1.type === "text" && t1.delta).toBe("Hello, ");
    expect(t2.type === "text" && t2.delta).toBe("world.");
    expect(u.type === "usage" && u.inputTokens).toBe(10);
    expect(u.type === "usage" && u.outputTokens).toBe(20);
    expect(d.type === "done" && d.reason).toBe("complete");

    await session.close();
  });

  it("error part with statusCode 401 → AgentEvent.error kind=invalid-key, then done(error)", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([{ type: "error", error: { statusCode: 401, message: "Unauthorized" } }]),
    );

    const session = await startSession();
    const iter = session.events[Symbol.asyncIterator]();
    await session.sendMessage("hi");
    const events = await collectOneTurn(iter);

    expect(events.map((e) => e.type)).toEqual(["error", "done"]);
    const [err, done] = events;
    expect(err.type === "error" && err.kind).toBe("invalid-key");
    expect(done.type === "done" && done.reason).toBe("error");

    await session.close();
  });

  it("error part with statusCode 429 → kind=rate-limited", async () => {
    mockedStreamText.mockReturnValueOnce(
      fakeStreamResult([
        { type: "error", error: { statusCode: 429, message: "Too many requests" } },
      ]),
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
      fakeStreamResult([{ type: "error", error: { statusCode: 404, message: "model_not_found" } }]),
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
