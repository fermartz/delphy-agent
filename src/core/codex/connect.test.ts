import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks (vi.mock factories are hoisted; the SDK Client must be mocked
// with a regular function returning an object — `new ArrowFn()` throws, see the
// manager.test gotcha).
const h = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  clientMock: { connect: vi.fn(), listTools: vi.fn(), close: vi.fn() },
  transportMock: { exitReason: null as string | null, close: vi.fn() },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invokeMock }));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: function MockClient() {
    return h.clientMock;
  },
}));
vi.mock("../mcp/tauri-transport", () => ({
  TauriTransport: function MockTransport() {
    return h.transportMock;
  },
}));

import { CodexConnectError, connectCodex } from "./connect";

const tools = (names: string[]) => ({ tools: names.map((name) => ({ name, inputSchema: {} })) });

beforeEach(() => {
  vi.clearAllMocks();
  h.transportMock.exitReason = null;
  h.invokeMock.mockResolvedValue("codex"); // spawn_mcp_server -> handle
  h.clientMock.connect.mockResolvedValue(undefined);
  h.clientMock.listTools.mockResolvedValue(tools(["codex", "codex-reply"]));
});

describe("connectCodex", () => {
  it("spawns codex mcp-server, handshakes, verifies the tools, and returns the client", async () => {
    const conn = await connectCodex();
    expect(h.invokeMock).toHaveBeenCalledWith("spawn_mcp_server", {
      config: expect.objectContaining({ command: "codex", args: ["mcp-server"] }),
    });
    expect(h.clientMock.connect).toHaveBeenCalled();
    expect(conn.client).toBe(h.clientMock);
  });

  it("throws not-installed when spawn fails", async () => {
    h.invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "spawn_mcp_server") return Promise.reject(new Error("No such file"));
      return Promise.resolve(undefined);
    });
    await expect(connectCodex()).rejects.toMatchObject({ kind: "not-installed" });
  });

  it("throws tools-missing when codex-reply is absent", async () => {
    h.clientMock.listTools.mockResolvedValue(tools(["codex"]));
    await expect(connectCodex()).rejects.toMatchObject({
      kind: "tools-missing",
    });
  });

  it("throws handshake-failed (with the child exit reason) and cleans up when connect fails", async () => {
    h.transportMock.exitReason = "codex: command not found";
    h.clientMock.connect.mockRejectedValue(new Error("Connection closed"));
    const err = await connectCodex().catch((e) => e);
    expect(err).toBeInstanceOf(CodexConnectError);
    expect(err.kind).toBe("handshake-failed");
    expect(err.message).toContain("codex: command not found");
    // cleanup: transport closed + child stopped
    expect(h.transportMock.close).toHaveBeenCalled();
    expect(h.invokeMock).toHaveBeenCalledWith("stop_mcp_server", { handle: "codex" });
  });
});
