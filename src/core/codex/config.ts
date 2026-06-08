import type { McpServerConfig } from "../mcp/types";

export const CODEX_SERVER_ID = "codex";

/**
 * Spawn spec for `codex mcp-server`, driven through the existing Rust MCP bridge
 * (`spawn_mcp_server` + TauriTransport). At the wire level Codex is just another
 * stdio MCP child. The per-session `cwd` / `sandbox` / `approval-policy` are
 * passed as arguments to the `codex` tool at call time (CP2) — NOT here; the
 * server process itself is launched plainly.
 */
export function buildCodexServerConfig(): McpServerConfig {
  return {
    id: CODEX_SERVER_ID,
    name: "Codex",
    enabled: true,
    transport: "stdio",
    command: "codex",
    args: ["mcp-server"],
  };
}
