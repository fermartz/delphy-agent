/**
 * Slice A's subset of the MCP server config shape from `docs/SPEC.md` §
 * "MCP server configuration." HTTP/SSE transports + secret-reference
 * `${secret:...}` syntax + the optional `scopes` array all land later.
 */
export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
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
