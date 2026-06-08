import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { invoke } from "@tauri-apps/api/core";
import type { TauriTransport } from "../mcp/tauri-transport";
import { CodexSession } from "./session";

function makeFakeTransport() {
  let listener: ((m: unknown) => void) | null = null;
  return {
    subscribe(l: (m: unknown) => void) {
      listener = l;
      return () => {
        listener = null;
      };
    },
    close: vi.fn().mockResolvedValue(undefined),
    /** Simulate the Rust bridge delivering a codex/event frame. */
    emit(msg: Record<string, unknown>) {
      listener?.({ jsonrpc: "2.0", method: "codex/event", params: { msg } });
    },
  };
}

const delta = (d: string) => ({ type: "agent_message_content_delta", delta: d });
const taskComplete = () => ({ type: "task_complete", turn_id: "1" });

function makeSession(callTool: ReturnType<typeof vi.fn>) {
  const transport = makeFakeTransport();
  const client = { callTool, close: vi.fn().mockResolvedValue(undefined) };
  const session = new CodexSession({
    client: client as unknown as Client,
    transport: transport as unknown as TauriTransport,
    cwd: "/work",
  });
  return { session, client, transport, iter: session.events[Symbol.asyncIterator]() };
}

beforeEach(() => vi.clearAllMocks());

describe("CodexSession", () => {
  it("first turn calls `codex` with the locked safety args, streams text, ends on task_complete, captures threadId", async () => {
    const callTool = vi.fn();
    const { session, client, transport, iter } = makeSession(callTool);
    callTool.mockImplementation(async () => {
      transport.emit(delta("hel"));
      transport.emit(delta("lo"));
      transport.emit(taskComplete());
      return { content: [{ type: "text", text: "hello" }], structuredContent: { threadId: "t1" } };
    });

    await session.sendMessage("hi");

    expect(client.callTool).toHaveBeenCalledWith({
      name: "codex",
      arguments: { prompt: "hi", cwd: "/work", sandbox: "read-only", "approval-policy": "never" },
    });
    expect((await iter.next()).value).toEqual({ type: "text", delta: "hel" });
    expect((await iter.next()).value).toEqual({ type: "text", delta: "lo" });
    expect((await iter.next()).value).toEqual({ type: "done", reason: "complete" });

    // Turn 2 continues the same thread via codex-reply.
    callTool.mockClear();
    callTool.mockImplementation(async () => {
      transport.emit(taskComplete());
      return { structuredContent: { threadId: "t1" } };
    });
    await session.sendMessage("more");
    expect(client.callTool).toHaveBeenCalledWith({
      name: "codex-reply",
      arguments: { threadId: "t1", prompt: "more" },
    });
    expect((await iter.next()).value).toEqual({ type: "done", reason: "complete" });
  });

  it("emits error + done(error) when the tool call rejects (e.g. not logged in)", async () => {
    const { session, iter } = makeSession(vi.fn().mockRejectedValue(new Error("not logged in")));
    await session.sendMessage("hi");
    const errEvent = await iter.next();
    expect(errEvent.value).toMatchObject({ type: "error" });
    expect((errEvent.value as { error: Error }).error.message).toBe("not logged in");
    expect((await iter.next()).value).toEqual({ type: "done", reason: "error" });
  });

  it("a Codex error notification (no task_complete) terminates as done(error), not done(complete)", async () => {
    const callTool = vi.fn();
    const { session, transport, iter } = makeSession(callTool);
    callTool.mockImplementation(async () => {
      transport.emit({ type: "error", message: "model error" });
      return { structuredContent: { threadId: "t1" } }; // resolves, no task_complete
    });
    await session.sendMessage("hi");
    expect((await iter.next()).value).toMatchObject({ type: "error" });
    expect((await iter.next()).value).toEqual({ type: "done", reason: "error" });
  });

  it("emits a fallback done when a successful call produced no task_complete", async () => {
    const { session, iter } = makeSession(
      vi.fn().mockResolvedValue({ structuredContent: { threadId: "t1" } }),
    );
    await session.sendMessage("hi");
    expect((await iter.next()).value).toEqual({ type: "done", reason: "complete" });
  });

  it("close stops the child, closes client + transport, and ends the event stream", async () => {
    const { session, client, transport, iter } = makeSession(vi.fn());
    await session.close();
    expect(client.close).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("stop_mcp_server", { handle: "codex" });
    expect((await iter.next()).done).toBe(true);
  });
});
