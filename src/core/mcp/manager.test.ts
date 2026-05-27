import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

// Stub the SDK Client so unit tests don't touch the real Protocol / network
// machinery. Each test sets the connect/listTools behavior it wants.
const connectMock = vi.fn();
const listToolsMock = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  // Plain function (NOT arrow) that returns the mock instance — arrow
  // functions can't be `new`'d, so the manager's `new Client(...)` would
  // throw "is not a constructor."
  Client: function MockClient() {
    return { connect: connectMock, listTools: listToolsMock };
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { _McpManagerForTests } from "./manager";
import type { McpServerConfig } from "./types";

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

const ENABLED_CONFIG: McpServerConfig = {
  id: "test-server",
  name: "Test Server",
  enabled: true,
  transport: "stdio",
  command: "echo",
  args: ["hi"],
};

describe("McpManager", () => {
  beforeEach(() => {
    connectMock.mockReset();
    listToolsMock.mockReset();
    mockedInvoke.mockReset();
    mockedListen.mockReset();
    // listen returns a no-op unlisten; the transport's start() awaits it.
    mockedListen.mockResolvedValue((() => {}) as unknown as () => void);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("init spawns, connects, lists tools, and exposes status + namespaced tools", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "test-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [
        { name: "echo", description: "Echoes input.", inputSchema: { type: "object" } },
        { name: "add", inputSchema: { type: "object" } },
      ],
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([ENABLED_CONFIG]);

    const status = mgr.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      id: "test-server",
      name: "Test Server",
      kind: "connected",
      toolCount: 2,
    });

    const tools = mgr.getAllTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.namespacedName)).toEqual(["test-server__echo", "test-server__add"]);
    expect(tools[0]).toMatchObject({
      serverId: "test-server",
      name: "echo",
      namespacedName: "test-server__echo",
      description: "Echoes input.",
    });
  });

  it("init records a failed status when the SDK connect call rejects, without throwing", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "test-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockRejectedValue(new Error("kaboom"));

    const mgr = new _McpManagerForTests();
    await expect(mgr.init([ENABLED_CONFIG])).resolves.toBeUndefined();

    const status = mgr.getStatus();
    expect(status[0]).toMatchObject({
      id: "test-server",
      kind: "failed",
      error: "kaboom",
    });
    expect(mgr.getAllTools()).toEqual([]);
  });

  it("disabled configs are recorded as disabled and skip spawn / connect entirely", async () => {
    const mgr = new _McpManagerForTests();
    await mgr.init([{ ...ENABLED_CONFIG, enabled: false }]);

    const status = mgr.getStatus();
    expect(status[0]).toMatchObject({ id: "test-server", kind: "disabled" });
    expect(mockedInvoke).not.toHaveBeenCalledWith("spawn_mcp_server", expect.anything());
    expect(connectMock).not.toHaveBeenCalled();
    expect(listToolsMock).not.toHaveBeenCalled();
  });
});
