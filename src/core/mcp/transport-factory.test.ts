import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the proxied fetch + the two SDK transport constructors so the factory can
// be tested without real network machinery. Defined via vi.hoisted so they are
// initialized before the hoisted vi.mock factories read them.
const { fetchStub, StreamableHTTPClientTransport, SSEClientTransport } = vi.hoisted(() => ({
  fetchStub: vi.fn(),
  StreamableHTTPClientTransport: vi.fn(),
  SSEClientTransport: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchStub }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport,
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport }));

import { createRemoteTransport } from "./transport-factory";
import type { McpServerConfig } from "./types";

function config(over: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "s",
    name: "S",
    enabled: true,
    transport: "http",
    url: "https://example.com/mcp",
    ...over,
  };
}

describe("createRemoteTransport", () => {
  beforeEach(() => {
    StreamableHTTPClientTransport.mockClear();
    SSEClientTransport.mockClear();
  });

  it("builds a Streamable HTTP transport with the proxied fetch and headers", () => {
    createRemoteTransport(config({ transport: "http", headers: { Authorization: "Bearer x" } }));

    expect(StreamableHTTPClientTransport).toHaveBeenCalledTimes(1);
    expect(SSEClientTransport).not.toHaveBeenCalled();
    const [url, opts] = StreamableHTTPClientTransport.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe("https://example.com/mcp");
    expect(opts.fetch).toBe(fetchStub);
    expect(opts.requestInit).toEqual({ headers: { Authorization: "Bearer x" } });
  });

  it("builds an SSE transport with the proxied fetch on both the request and the event stream", () => {
    createRemoteTransport(
      config({ transport: "sse", url: "https://example.com/sse", headers: undefined }),
    );

    expect(SSEClientTransport).toHaveBeenCalledTimes(1);
    expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
    const [url, opts] = SSEClientTransport.mock.calls[0];
    expect((url as URL).href).toBe("https://example.com/sse");
    expect(opts.fetch).toBe(fetchStub);
    expect(opts.eventSourceInit).toEqual({ fetch: fetchStub });
    // No headers -> no requestInit.
    expect(opts.requestInit).toBeUndefined();
  });

  it("throws when the url is missing", () => {
    expect(() => createRemoteTransport(config({ url: undefined }))).toThrow(/no url/);
  });
});
