import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { McpServerConfig } from "./types";

/**
 * Build the SDK transport for a remote (http/sse) MCP server.
 *
 * Both transports are fed `@tauri-apps/plugin-http`'s `fetch`, which routes
 * every request through the Rust side: this bypasses webview CORS (the
 * `tauri://localhost` origin would otherwise be rejected by most MCP servers)
 * and keeps all network egress behind the capability-scoped Tauri boundary
 * (VISION #1). We reuse the SDK's protocol handling (session IDs, resumption,
 * SSE parsing, bounded reconnection) rather than re-implementing it.
 *
 * `config` must already have its `${secret:}` header refs resolved.
 *
 * stdio is NOT handled here — it spawns a child via the Rust bridge and uses
 * `TauriTransport`; that path stays in the manager.
 */
export function createRemoteTransport(config: McpServerConfig): Transport {
  if (!config.url) {
    throw new Error(`MCP server "${config.id}" has transport "${config.transport}" but no url`);
  }
  const url = new URL(config.url);
  const requestInit = config.headers ? { headers: config.headers } : undefined;

  if (config.transport === "http") {
    return new StreamableHTTPClientTransport(url, { fetch: tauriFetch, requestInit });
  }
  // sse (legacy, deprecated — kept for back-compat). The custom fetch must also
  // back the EventSource that carries the server->client stream.
  return new SSEClientTransport(url, {
    fetch: tauriFetch,
    eventSourceInit: { fetch: tauriFetch },
    requestInit,
  });
}
