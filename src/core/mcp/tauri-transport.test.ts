import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TauriTransport } from "./tauri-transport";

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

describe("TauriTransport", () => {
  // biome-ignore lint/suspicious/noExplicitAny: handler type from Tauri's listen()
  const handlers = new Map<string, any>();
  const unlistenSpies: Array<ReturnType<typeof vi.fn>> = [];

  beforeEach(() => {
    handlers.clear();
    unlistenSpies.length = 0;
    mockedListen.mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: vi.mocked typing struggles with UnlistenFn
      (async (event: string, handler: any) => {
        handlers.set(event, handler);
        const off = vi.fn();
        unlistenSpies.push(off);
        return off as unknown as () => void;
        // biome-ignore lint/suspicious/noExplicitAny: outer cast for listen's overloaded signature
      }) as any,
    );
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("start subscribes to stdout + stderr and dispatches parsed JSON-RPC on onmessage", async () => {
    const t = new TauriTransport("test-server");
    const onmessage = vi.fn();
    t.onmessage = onmessage;

    await t.start();

    expect(mockedListen).toHaveBeenCalledWith("mcp:test-server:stdout", expect.any(Function));
    expect(mockedListen).toHaveBeenCalledWith("mcp:test-server:stderr", expect.any(Function));

    const stdoutHandler = handlers.get("mcp:test-server:stdout");
    stdoutHandler({ payload: { line: '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}' } });

    expect(onmessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  it("send serializes the message to JSON and invokes send_mcp_stdin", async () => {
    const t = new TauriTransport("test-server");
    await t.start();

    await t.send({ jsonrpc: "2.0", id: 7, method: "ping" });

    expect(mockedInvoke).toHaveBeenCalledWith("send_mcp_stdin", {
      handle: "test-server",
      line: '{"jsonrpc":"2.0","id":7,"method":"ping"}',
    });
  });

  it("close unsubscribes all listeners and fires onclose exactly once", async () => {
    const t = new TauriTransport("test-server");
    const onclose = vi.fn();
    t.onclose = onclose;

    await t.start();
    await t.close();
    await t.close(); // idempotent

    // stdout + stderr + exit
    expect(unlistenSpies).toHaveLength(3);
    for (const off of unlistenSpies) {
      expect(off).toHaveBeenCalledTimes(1);
    }
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it("child exit fails fast: fires onerror + onclose, exposes exitReason, and cleans up", async () => {
    const t = new TauriTransport("test-server");
    const onmessage = vi.fn();
    const onerror = vi.fn();
    const onclose = vi.fn();
    t.onmessage = onmessage;
    t.onerror = onerror;
    t.onclose = onclose;

    await t.start();

    // The child writes an npm 404 to stderr, then its stdout closes (exit).
    handlers.get("mcp:test-server:stderr")({
      payload: { line: "npm error 404 Not Found - GET https://registry.npmjs.org/Delphi-mcp" },
    });
    handlers.get("mcp:test-server:exit")({ payload: null });

    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onerror.mock.calls[0][0].message).toContain("Delphi-mcp");
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(t.exitReason).toContain("server process exited");
    expect(t.exitReason).toContain("Delphi-mcp");

    // (a) exit unsubscribed all three listeners.
    expect(unlistenSpies).toHaveLength(3);
    for (const off of unlistenSpies) {
      expect(off).toHaveBeenCalledTimes(1);
    }

    // (b) close() after exit is idempotent — no double onclose.
    await t.close();
    expect(onclose).toHaveBeenCalledTimes(1);
    for (const off of unlistenSpies) {
      expect(off).toHaveBeenCalledTimes(1);
    }

    // (c) stale stdout/stderr events after exit do not dispatch.
    handlers.get("mcp:test-server:stdout")({
      payload: { line: '{"jsonrpc":"2.0","id":2,"result":{}}' },
    });
    expect(onmessage).not.toHaveBeenCalled();
  });

  it("non-JSON stdout lines trigger onerror without crashing the listener", async () => {
    const t = new TauriTransport("test-server");
    const onmessage = vi.fn();
    const onerror = vi.fn();
    t.onmessage = onmessage;
    t.onerror = onerror;

    await t.start();

    const stdoutHandler = handlers.get("mcp:test-server:stdout");
    stdoutHandler({ payload: { line: "not json at all" } });

    expect(onmessage).not.toHaveBeenCalled();
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onerror.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onerror.mock.calls[0][0].message).toContain("not JSON-RPC");
  });
});
