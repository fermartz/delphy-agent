/**
 * Full MCP server config shape per `docs/SPEC.md` § "MCP server configuration."
 * Persisted in the SQLite `mcp_servers` table since BACKLOG #4 (2026-05-30);
 * see `src/core/db/mcp.ts` + `src/core/mcp/store.ts`. The manager only boots
 * stdio configs; non-stdio entries are preserved but shown as unsupported.
 */
export type McpTransport = "stdio" | "http" | "sse";

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  scopes?: string[];
}

export type McpServerStatusKind = "connecting" | "connected" | "failed" | "disabled";

/**
 * Read-only status row consumed by the Settings modal's "MCP servers"
 * section. One entry per configured server. `toolCount` is set only when
 * `kind === "connected"`; `error` is set only when `kind === "failed"`.
 */
export interface McpServerStatus {
  id: string;
  name: string;
  kind: McpServerStatusKind;
  toolCount?: number;
  error?: string;
}

/**
 * Single tool surface from a connected MCP server. `namespacedName` is what
 * slice B will feed into `streamText({ tools })` to keep tool names unique
 * across multiple servers (collisions are otherwise easy — two servers can
 * each define `search`). `<serverId>__<toolName>` with double underscore.
 */
export interface McpTool {
  serverId: string;
  name: string;
  namespacedName: string;
  description?: string;
  inputSchema: unknown;
}

/**
 * Normalized result from an MCP tool call. Mirrors the relevant fields from
 * the MCP SDK's `CallToolResult` but exposed as our own type so the chat
 * adapter doesn't import SDK types directly.
 */
export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError: boolean;
}
