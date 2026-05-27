import type { McpServerConfig } from "./types";

/**
 * Slice A: one hardcoded reference server. Slice C replaces this with
 * `tauri-plugin-store`-backed loading + add/remove UI.
 *
 * `@modelcontextprotocol/server-everything` is the MCP team's canonical
 * reference server — broad tool variety (echo, add, get-sum, get-tiny-image,
 * etc.), maintained by the same team that owns the spec. npx-spawned, so
 * first-run cold cache may take 1-2 min to download.
 */
export const BUILTIN_MCP_CONFIGS: McpServerConfig[] = [
  {
    id: "server-everything",
    name: "Everything (reference)",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
  },
];
