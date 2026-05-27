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

  it("close unsubscribes both listeners and fires onclose exactly once", async () => {
    const t = new TauriTransport("test-server");
    const onclose = vi.fn();
    t.onclose = onclose;

    await t.start();
    await t.close();
    await t.close(); // idempotent

    expect(unlistenSpies).toHaveLength(2);
    for (const off of unlistenSpies) {
      expect(off).toHaveBeenCalledTimes(1);
    }
    expect(onclose).toHaveBeenCalledTimes(1);
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
