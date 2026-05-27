import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { invoke } from "@tauri-apps/api/core";
import { BUILTIN_MCP_CONFIGS } from "./configs";
import { TauriTransport } from "./tauri-transport";
import type { McpServerConfig, McpServerStatus, McpTool } from "./types";

const INIT_TIMEOUT_MS = 30_000;

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  tools: McpTool[];
}

interface FailedServer {
  config: McpServerConfig;
  error: string;
}

interface DisabledServer {
  config: McpServerConfig;
}

type ServerEntry =
  | { kind: "connected"; data: ConnectedServer }
  | { kind: "failed"; data: FailedServer }
  | { kind: "disabled"; data: DisabledServer };

/**
 * Singleton manager for all configured MCP servers. Initialized once at app
 * boot via `mcpManager.init()`. The chat path consumes `getAllTools()` (slice
 * B); the Settings modal consumes `getStatus()` (slice A).
 *
 * Slice A loads configs from `BUILTIN_MCP_CONFIGS` (one hardcoded entry).
 * Slice C swaps that for `tauri-plugin-store`-backed loading + add/remove UI.
 */
class McpManager {
  private servers = new Map<string, ServerEntry>();
  private initPromise: Promise<void> | null = null;
  private initDone = false;

  /**
   * Idempotent across concurrent + repeat callers. Subsequent calls return
   * the SAME in-flight promise — important for React Strict Mode, where the
   * boot effect fires twice and both invocations must observe the real
   * completion (not the second one resolving instantly because the first
   * already kicked things off).
   */
  async init(configs: McpServerConfig[] = BUILTIN_MCP_CONFIGS): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await Promise.all(configs.map((config) => this.bootOne(config)));
      this.initDone = true;
    })();
    return this.initPromise;
  }

  isInitialized(): boolean {
    return this.initDone;
  }

  getStatus(): McpServerStatus[] {
    return Array.from(this.servers.values()).map(entryToStatus);
  }

  /**
   * Flattened list of tools across all connected servers, namespaced by
   * `<serverId>__<toolName>` to prevent collisions. Returns `[]` if init
   * hasn't completed. Consumed by slice B for `streamText({ tools })`.
   */
  getAllTools(): McpTool[] {
    const out: McpTool[] = [];
    for (const entry of this.servers.values()) {
      if (entry.kind === "connected") {
        out.push(...entry.data.tools);
      }
    }
    return out;
  }

  async shutdown(): Promise<void> {
    const handles: string[] = [];
    for (const entry of this.servers.values()) {
      if (entry.kind === "connected") {
        handles.push(entry.data.config.id);
      }
    }
    await Promise.allSettled(
      handles.map(async (handle) => {
        try {
          await invoke("stop_mcp_server", { handle });
        } catch (err) {
          console.warn(`[mcp-manager] stop_mcp_server(${handle}) failed:`, err);
        }
      }),
    );
    this.servers.clear();
    this.initPromise = null;
    this.initDone = false;
  }

  private async bootOne(config: McpServerConfig): Promise<void> {
    if (!config.enabled) {
      this.servers.set(config.id, { kind: "disabled", data: { config } });
      return;
    }

    try {
      const handle = await this.spawnWithTimeout(config);
      const transport = new TauriTransport(handle);
      const client = new Client({ name: "delphy-agent", version: "0.0.0" }, { capabilities: {} });

      await withTimeout(client.connect(transport), INIT_TIMEOUT_MS, `connect ${config.id}`);

      const result = await withTimeout(
        client.listTools(),
        INIT_TIMEOUT_MS,
        `listTools ${config.id}`,
      );

      const tools: McpTool[] = result.tools.map((t) => ({
        serverId: config.id,
        name: t.name,
        namespacedName: `${config.id}__${t.name}`,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      this.servers.set(config.id, { kind: "connected", data: { config, client, tools } });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.servers.set(config.id, { kind: "failed", data: { config, error } });
      // Best-effort cleanup if the child actually started before failure.
      try {
        await invoke("stop_mcp_server", { handle: config.id });
      } catch {
        // ignore — child may not exist
      }
    }
  }

  private async spawnWithTimeout(config: McpServerConfig): Promise<string> {
    return withTimeout(
      invoke<string>("spawn_mcp_server", { config }),
      INIT_TIMEOUT_MS,
      `spawn ${config.id}`,
    );
  }
}

function entryToStatus(entry: ServerEntry): McpServerStatus {
  if (entry.kind === "connected") {
    return {
      id: entry.data.config.id,
      name: entry.data.config.name,
      kind: "connected",
      toolCount: entry.data.tools.length,
    };
  }
  if (entry.kind === "failed") {
    return {
      id: entry.data.config.id,
      name: entry.data.config.name,
      kind: "failed",
      error: entry.data.error,
    };
  }
  // disabled — exhaustive over ServerEntry's `kind` union.
  return {
    id: entry.data.config.id,
    name: entry.data.config.name,
    kind: "disabled",
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export const mcpManager = new McpManager();

// Test-only export so unit tests can construct fresh instances without
// touching the singleton's state.
export { McpManager as _McpManagerForTests };
