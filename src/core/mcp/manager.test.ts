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
const closeMock = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: function MockClient() {
    return {
      connect: connectMock,
      listTools: listToolsMock,
      callTool: callToolMock,
      close: closeMock,
    };
  },
}));

// Mock the Streamable HTTP transport + the remote-transport factory so the
// http/sse branch is exercised without real network I/O. The manager checks
// `transport instanceof StreamableHTTPClientTransport` to drive terminateSession,
// so the factory returns an instance of this exact mocked class. Defined via
// vi.hoisted so the class is initialized before the hoisted vi.mock factories
// read it.
const {
  terminateSessionMock,
  remoteCloseMock,
  sseCloseMock,
  createRemoteTransportMock,
  MockStreamableHTTPClientTransport,
  MockSSEClientTransport,
} = vi.hoisted(() => {
  const terminateSessionMock = vi.fn();
  const remoteCloseMock = vi.fn();
  const sseCloseMock = vi.fn();
  const createRemoteTransportMock = vi.fn();
  class MockStreamableHTTPClientTransport {
    terminateSession = terminateSessionMock;
    close = remoteCloseMock;
  }
  // The legacy SSE transport has no session to terminate — it must NOT be an
  // instance of MockStreamableHTTPClientTransport so disconnect()/boot cleanup
  // skip terminateSession for it.
  class MockSSEClientTransport {
    close = sseCloseMock;
  }
  return {
    terminateSessionMock,
    remoteCloseMock,
    sseCloseMock,
    createRemoteTransportMock,
    MockStreamableHTTPClientTransport,
    MockSSEClientTransport,
  };
});
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}));
vi.mock("./transport-factory", () => ({
  createRemoteTransport: createRemoteTransportMock,
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
    closeMock.mockReset();
    closeMock.mockResolvedValue(undefined);
    terminateSessionMock.mockReset();
    terminateSessionMock.mockResolvedValue(undefined);
    remoteCloseMock.mockReset();
    remoteCloseMock.mockResolvedValue(undefined);
    sseCloseMock.mockReset();
    sseCloseMock.mockResolvedValue(undefined);
    createRemoteTransportMock.mockReset();
    createRemoteTransportMock.mockReturnValue(new MockStreamableHTTPClientTransport());
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
    // Sorted by tool name (BACKLOG #18 cache-stable ordering), not server order.
    expect(tools.map((t) => t.namespacedName)).toEqual(["test-server__add", "test-server__echo"]);
    expect(tools[1]).toMatchObject({
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

  const HTTP_CONFIG: McpServerConfig = {
    id: "http-server",
    name: "HTTP Server",
    enabled: true,
    transport: "http",
    url: "https://example.com/mcp",
  };

  const SSE_CONFIG: McpServerConfig = {
    id: "sse-server",
    name: "SSE Server",
    enabled: true,
    transport: "sse",
    url: "https://example.com/sse",
  };

  it("http config connects via the remote transport (no spawn) and exposes tools", async () => {
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "search", description: "Search.", inputSchema: { type: "object" } }],
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([HTTP_CONFIG]);

    expect(createRemoteTransportMock).toHaveBeenCalledTimes(1);
    // No child process is spawned for a remote transport.
    expect(mockedInvoke).not.toHaveBeenCalledWith("spawn_mcp_server", expect.anything());

    const status = mgr.getStatus();
    expect(status[0]).toMatchObject({ id: "http-server", kind: "connected", toolCount: 1 });
    expect(mgr.getAllTools().map((t) => t.namespacedName)).toEqual(["http-server__search"]);
  });

  it("http connect failure becomes a failed row and never calls stop_mcp_server", async () => {
    connectMock.mockRejectedValue(new Error("connection refused"));

    const mgr = new _McpManagerForTests();
    await expect(mgr.init([HTTP_CONFIG])).resolves.toBeUndefined();

    const status = mgr.getStatus();
    expect(status[0]).toMatchObject({
      id: "http-server",
      kind: "failed",
      error: "connection refused",
    });
    // Remote transport is closed on failure, but there is no child to stop.
    expect(remoteCloseMock).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).not.toHaveBeenCalledWith("stop_mcp_server", expect.anything());
  });

  it("removeServer for http terminates the session, closes the client, and skips stop_mcp_server", async () => {
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "search", inputSchema: { type: "object" } }],
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([HTTP_CONFIG]);
    expect(mgr.getStatus()).toHaveLength(1);

    await mgr.removeServer("http-server");
    expect(mgr.getStatus()).toHaveLength(0);
    // Streamable HTTP ends the server-side session (DELETE) before close.
    expect(terminateSessionMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    // No child process exists for a remote server.
    expect(mockedInvoke).not.toHaveBeenCalledWith("stop_mcp_server", expect.anything());
  });

  it("http listTools failure after a successful connect still terminates the session", async () => {
    // connect succeeds (a server session may exist) but listTools fails — the
    // cleanup must terminateSession() before close so the session can't leak.
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockRejectedValue(new Error("listTools boom"));

    const mgr = new _McpManagerForTests();
    await mgr.init([HTTP_CONFIG]);

    expect(mgr.getStatus()[0]).toMatchObject({ id: "http-server", kind: "failed" });
    expect(terminateSessionMock).toHaveBeenCalledTimes(1);
    expect(remoteCloseMock).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).not.toHaveBeenCalledWith("stop_mcp_server", expect.anything());
  });

  it("a non-https, non-loopback url is rejected at boot before building a transport", async () => {
    const mgr = new _McpManagerForTests();
    await mgr.init([{ ...HTTP_CONFIG, url: "http://example.com/mcp" }]);

    expect(mgr.getStatus()[0]).toMatchObject({ id: "http-server", kind: "failed" });
    expect(mgr.getStatus()[0].error).toContain("https");
    // The transport is never constructed for a rejected URL.
    expect(createRemoteTransportMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal secret reference
  it("resolves ${secret:key} in headers before building the remote transport", async () => {
    mockedInvoke.mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_secret" && args?.key === "api_token") return "resolved-token";
      return undefined;
    }) as typeof invoke);
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({ tools: [] });

    const mgr = new _McpManagerForTests();
    await mgr.init([
      {
        ...HTTP_CONFIG,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal secret reference
        headers: { Authorization: "Bearer ${secret:api_token}" },
      },
    ]);

    expect(createRemoteTransportMock).toHaveBeenCalledTimes(1);
    const passedConfig = createRemoteTransportMock.mock.calls[0][0] as McpServerConfig;
    expect(passedConfig.headers?.Authorization).toBe("Bearer resolved-token");
  });

  it("sse config connects via the remote transport (no spawn) and exposes tools", async () => {
    createRemoteTransportMock.mockReturnValue(new MockSSEClientTransport());
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({
      tools: [{ name: "ping", inputSchema: { type: "object" } }],
    });

    const mgr = new _McpManagerForTests();
    await mgr.init([SSE_CONFIG]);

    expect(createRemoteTransportMock).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).not.toHaveBeenCalledWith("spawn_mcp_server", expect.anything());
    expect(mgr.getStatus()[0]).toMatchObject({ id: "sse-server", kind: "connected", toolCount: 1 });
  });

  it("removeServer for sse closes the client without terminateSession or stop_mcp_server", async () => {
    createRemoteTransportMock.mockReturnValue(new MockSSEClientTransport());
    connectMock.mockResolvedValue(undefined);
    listToolsMock.mockResolvedValue({ tools: [] });

    const mgr = new _McpManagerForTests();
    await mgr.init([SSE_CONFIG]);
    await mgr.removeServer("sse-server");

    expect(mgr.getStatus()).toHaveLength(0);
    // SDK client is closed, but SSE has no server-side session to terminate and
    // no child process to stop.
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(terminateSessionMock).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalledWith("stop_mcp_server", expect.anything());
  });

  it("sse boot failure closes the transport without terminateSession or stop_mcp_server", async () => {
    createRemoteTransportMock.mockReturnValue(new MockSSEClientTransport());
    connectMock.mockRejectedValue(new Error("sse connect boom"));

    const mgr = new _McpManagerForTests();
    await mgr.init([SSE_CONFIG]);

    expect(mgr.getStatus()[0]).toMatchObject({
      id: "sse-server",
      kind: "failed",
      error: "sse connect boom",
    });
    // The SSE transport is closed on failure, but it has no session to terminate
    // and no child process to stop.
    expect(sseCloseMock).toHaveBeenCalledTimes(1);
    expect(terminateSessionMock).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalledWith("stop_mcp_server", expect.anything());
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
    // Client is closed (-> transport unsubscribes) before the child is killed,
    // so the expected stdout-EOF exit can't surface as an error or leak listeners.
    expect(closeMock).toHaveBeenCalledTimes(1);
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

  describe("per-tool disable + cache-stable ordering (BACKLOG #18)", () => {
    const SECOND_CONFIG: McpServerConfig = {
      id: "alpha-server",
      name: "Alpha",
      enabled: true,
      transport: "stdio",
      command: "echo",
    };

    function stubStdioBoot() {
      mockedInvoke.mockImplementation((async (cmd: string) => {
        if (cmd === "spawn_mcp_server") return "handle";
        if (cmd === "stop_mcp_server") return undefined;
        return undefined;
      }) as typeof invoke);
      connectMock.mockResolvedValue(undefined);
      listToolsMock.mockResolvedValue({
        tools: [
          { name: "zeta", inputSchema: { type: "object" } },
          { name: "alpha", inputSchema: { type: "object" } },
        ],
      });
    }

    it("getAllTools filters disabledTools and sorts by serverId then name", async () => {
      stubStdioBoot();
      const mgr = new _McpManagerForTests();
      await mgr.init([{ ...ENABLED_CONFIG, disabledTools: ["zeta"] }, SECOND_CONFIG]);

      const names = mgr.getAllTools().map((t) => t.namespacedName);
      expect(names).toEqual(["alpha-server__alpha", "alpha-server__zeta", "test-server__alpha"]);
    });

    it("getAllTools output is byte-stable across consecutive calls", async () => {
      stubStdioBoot();
      const mgr = new _McpManagerForTests();
      await mgr.init([SECOND_CONFIG, ENABLED_CONFIG]);

      const first = JSON.stringify(mgr.getAllTools());
      const second = JSON.stringify(mgr.getAllTools());
      expect(second).toBe(first);
    });

    it("getServerTools returns the unfiltered sorted list for the Settings UI", async () => {
      stubStdioBoot();
      const mgr = new _McpManagerForTests();
      await mgr.init([{ ...ENABLED_CONFIG, disabledTools: ["zeta"] }]);

      expect(mgr.getServerTools("test-server").map((t) => t.name)).toEqual(["alpha", "zeta"]);
      expect(mgr.getServerTools("unknown")).toEqual([]);
    });

    it("callTool rejects a disabled tool without reaching the client", async () => {
      stubStdioBoot();
      const mgr = new _McpManagerForTests();
      await mgr.init([{ ...ENABLED_CONFIG, disabledTools: ["zeta"] }]);

      const result = await mgr.callTool("test-server__zeta", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("disabled");
      expect(callToolMock).not.toHaveBeenCalled();
    });

    it("setDisabledTools applies without restart and bumps the revision", async () => {
      stubStdioBoot();
      const mgr = new _McpManagerForTests();
      await mgr.init([ENABLED_CONFIG]);
      const spawnCallsAfterInit = mockedInvoke.mock.calls.filter(
        (c) => c[0] === "spawn_mcp_server",
      ).length;
      const revBefore = mgr.getRevision();

      mgr.setDisabledTools("test-server", ["alpha"]);

      expect(mgr.getRevision()).toBeGreaterThan(revBefore);
      expect(mgr.getAllTools().map((t) => t.name)).toEqual(["zeta"]);
      // No restart: no additional spawn, no stop.
      expect(mockedInvoke.mock.calls.filter((c) => c[0] === "spawn_mcp_server").length).toBe(
        spawnCallsAfterInit,
      );
      expect(mockedInvoke.mock.calls.some((c) => c[0] === "stop_mcp_server")).toBe(false);

      // Re-enable: clears the filter.
      mgr.setDisabledTools("test-server", undefined);
      expect(mgr.getAllTools().map((t) => t.name)).toEqual(["alpha", "zeta"]);
    });

    it("revision bumps on addServer, removeServer, and shutdown", async () => {
      stubStdioBoot();
      const mgr = new _McpManagerForTests();
      await mgr.init([ENABLED_CONFIG]);
      let rev = mgr.getRevision();

      await mgr.addServer(SECOND_CONFIG);
      expect(mgr.getRevision()).toBeGreaterThan(rev);
      rev = mgr.getRevision();

      await mgr.removeServer(SECOND_CONFIG.id);
      expect(mgr.getRevision()).toBeGreaterThan(rev);
      rev = mgr.getRevision();

      await mgr.shutdown();
      expect(mgr.getRevision()).toBeGreaterThan(rev);
    });
  });
});
