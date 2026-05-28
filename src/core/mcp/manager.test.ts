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
const callToolMock = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: function MockClient() {
    return { connect: connectMock, listTools: listToolsMock, callTool: callToolMock };
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
    callToolMock.mockReset();
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

  it("callTool returns the normalized result from a connected server", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "test-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "echo", description: "Echoes", inputSchema: { type: "object" } }],
    });
    callToolMock.mockResolvedValue({
      content: [{ type: "text", text: "hello world" }],
      isError: false,
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([ENABLED_CONFIG]);

    const result = await mgr.callTool("test-server__echo", { message: "hello" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
    expect(callToolMock).toHaveBeenCalledWith({
      name: "echo",
      arguments: { message: "hello" },
    });
  });

  it("callTool returns isError when the server is not connected", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "test-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockRejectedValue(new Error("refused"));

    const mgr = new _McpManagerForTests();
    await mgr.init([ENABLED_CONFIG]);

    const result = await mgr.callTool("test-server__echo", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not connected");
  });

  it("callTool returns isError when client.callTool throws", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "test-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "echo", inputSchema: { type: "object" } }],
    });
    callToolMock.mockRejectedValue(new Error("network failure"));

    const mgr = new _McpManagerForTests();
    await mgr.init([ENABLED_CONFIG]);

    const result = await mgr.callTool("test-server__echo", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("network failure");
  });

  it("non-stdio config is set to failed with unsupported transport message", async () => {
    const httpConfig: McpServerConfig = {
      id: "http-server",
      name: "HTTP Server",
      enabled: true,
      transport: "http",
      url: "https://example.com",
    };
    const mgr = new _McpManagerForTests();
    await mgr.init([httpConfig]);

    const status = mgr.getStatus();
    expect(status[0]).toMatchObject({
      id: "http-server",
      kind: "failed",
      error: 'Transport "http" is not yet supported',
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith("spawn_mcp_server", expect.anything());
  });

  it("addServer boots a new server and exposes it in status", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "new-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "ping", inputSchema: { type: "object" } }],
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([]);

    const newConfig: McpServerConfig = {
      id: "new-server",
      name: "New",
      enabled: true,
      transport: "stdio",
      command: "echo",
    };
    await mgr.addServer(newConfig);

    const status = mgr.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ id: "new-server", kind: "connected", toolCount: 1 });
  });

  it("removeServer shuts down and removes from status", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "test-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "echo", inputSchema: { type: "object" } }],
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([ENABLED_CONFIG]);
    expect(mgr.getStatus()).toHaveLength(1);

    await mgr.removeServer("test-server");
    expect(mgr.getStatus()).toHaveLength(0);
    expect(mockedInvoke).toHaveBeenCalledWith("stop_mcp_server", { handle: "test-server" });
  });

  it("restartServer removes then re-boots", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "spawn_mcp_server") return "test-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "echo", inputSchema: { type: "object" } }],
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([ENABLED_CONFIG]);

    await mgr.restartServer(ENABLED_CONFIG);
    const status = mgr.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].kind).toBe("connected");
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal test name
  it("secret resolution replaces ${secret:key} with keychain value", async () => {
    mockedInvoke.mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_secret" && args?.key === "my_token") return "resolved-secret-value";
      if (cmd === "spawn_mcp_server") return "secret-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({ tools: [] });

    const mgr = new _McpManagerForTests();
    const config: McpServerConfig = {
      id: "secret-server",
      name: "Secret",
      enabled: true,
      transport: "stdio",
      command: "echo",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal secret reference
      env: { TOKEN: "${secret:my_token}" },
    };
    await mgr.init([config]);

    const spawnCall = mockedInvoke.mock.calls.find((c) => c[0] === "spawn_mcp_server");
    expect(spawnCall).toBeDefined();
    const spawnedConfig = (spawnCall?.[1] as { config: McpServerConfig }).config;
    expect(spawnedConfig.env?.TOKEN).toBe("resolved-secret-value");
  });

  it("secret resolution failure sets server to failed", async () => {
    mockedInvoke.mockImplementation((async (cmd: string) => {
      if (cmd === "get_secret") return null;
      if (cmd === "spawn_mcp_server") return "secret-server";
      if (cmd === "stop_mcp_server") return undefined;
      return undefined;
    }) as typeof invoke);

    const mgr = new _McpManagerForTests();
    const config: McpServerConfig = {
      id: "secret-server",
      name: "Secret",
      enabled: true,
      transport: "stdio",
      command: "echo",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal secret reference
      env: { TOKEN: "${secret:missing_key}" },
    };
    await mgr.init([config]);

    const status = mgr.getStatus();
    expect(status[0]).toMatchObject({
      id: "secret-server",
      kind: "failed",
    });
    expect(status[0].error).toContain("missing_key");
  });
});
