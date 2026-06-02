import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { invoke } from "@tauri-apps/api/core";
import { TauriTransport } from "./tauri-transport";
import type { McpServerConfig, McpServerStatus, McpTool, McpToolResult } from "./types";

const INIT_TIMEOUT_MS = 30_000;
// The MCP `initialize` handshake gets a longer budget than spawn/listTools:
// for an `npx -y <pkg>` server the first run downloads the package + its deps
// before the server can answer, which routinely exceeds 30s on a cold cache.
// (We SIGKILL on timeout, so too short a budget kills npx mid-download and the
// next attempt just re-downloads — it never warms the cache.)
const CONNECT_TIMEOUT_MS = 120_000;
const CALL_TOOL_TIMEOUT_MS = 30_000;

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

const SECRET_REF_PATTERN = /\$\{secret:([^}]+)\}/g;

class McpManager {
  private servers = new Map<string, ServerEntry>();
  private initPromise: Promise<void> | null = null;
  private initDone = false;

  async init(configs: McpServerConfig[]): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await Promise.all(configs.map((config) => this.bootOne(config)));
      this.initDone = true;
    })();
    return this.initPromise;
  }

  async addServer(config: McpServerConfig): Promise<void> {
    await this.bootOne(config);
  }

  async removeServer(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (entry?.kind === "connected") {
      // Close the SDK client first (-> transport.close() -> unsubscribes the
      // Tauri listeners) BEFORE killing the child, so the expected stdout-EOF
      // `exit` event isn't observed by a live transport and reported as an
      // error (and so no stale listener survives to see a replacement's events
      // on restart).
      try {
        await entry.data.client.close();
      } catch {
        // ignore
      }
      try {
        await invoke("stop_mcp_server", { handle: id });
      } catch {
        // ignore
      }
    }
    this.servers.delete(id);
  }

  async restartServer(config: McpServerConfig): Promise<void> {
    await this.removeServer(config.id);
    await this.bootOne(config);
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

  async callTool(namespacedName: string, args: unknown): Promise<McpToolResult> {
    const sep = namespacedName.indexOf("__");
    if (sep === -1) {
      return {
        content: [{ type: "text", text: `Invalid namespaced tool name: ${namespacedName}` }],
        isError: true,
      };
    }
    const serverId = namespacedName.slice(0, sep);
    const toolName = namespacedName.slice(sep + 2);
    const entry = this.servers.get(serverId);
    if (!entry || entry.kind !== "connected") {
      return {
        content: [{ type: "text", text: `MCP server "${serverId}" is not connected` }],
        isError: true,
      };
    }
    try {
      const result = await withTimeout(
        entry.data.client.callTool({ name: toolName, arguments: args as Record<string, unknown> }),
        CALL_TOOL_TIMEOUT_MS,
        `callTool ${namespacedName}`,
      );
      const content = Array.isArray(result.content)
        ? (result.content as McpToolResult["content"])
        : [{ type: "text", text: String(result.content) }];
      return { content, isError: result.isError === true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Tool call failed: ${message}` }],
        isError: true,
      };
    }
  }

  async shutdown(): Promise<void> {
    const entries = [...this.servers.values()];
    await Promise.allSettled(
      entries.map(async (entry) => {
        if (entry.kind !== "connected") return;
        const handle = entry.data.config.id;
        try {
          await entry.data.client.close();
        } catch {
          // ignore
        }
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

    if (config.transport !== "stdio") {
      this.servers.set(config.id, {
        kind: "failed",
        data: { config, error: `Transport "${config.transport}" is not yet supported` },
      });
      return;
    }

    let transport: TauriTransport | null = null;
    try {
      const resolved = await this.resolveSecrets(config);
      const handle = await this.spawnWithTimeout(resolved);
      transport = new TauriTransport(handle);
      const client = new Client({ name: "delphy-agent", version: "0.0.0" }, { capabilities: {} });

      // Pass the timeout INTO the SDK's initialize request — the client applies
      // its own DEFAULT_REQUEST_TIMEOUT_MSEC (60s) per request and would raise
      // "-32001: Request timed out" before our outer withTimeout fires. The
      // outer withTimeout stays as a backstop in case connect hangs entirely.
      await withTimeout(
        client.connect(transport, { timeout: CONNECT_TIMEOUT_MS }),
        CONNECT_TIMEOUT_MS,
        `connect ${config.id}`,
      );

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
      // Prefer the child's exit reason (e.g. an npm 404 on the last stderr
      // line) over a generic "Connection closed" from the SDK when the process
      // died during connect.
      const error = transport?.exitReason ?? (err instanceof Error ? err.message : String(err));
      this.servers.set(config.id, { kind: "failed", data: { config, error } });
      // Close the transport so its Tauri listeners are unsubscribed (idempotent
      // if the fail-fast exit path already closed it) — otherwise a retry of the
      // same id would stack a second set of listeners.
      try {
        await transport?.close();
      } catch {
        // ignore
      }
      try {
        await invoke("stop_mcp_server", { handle: config.id });
      } catch {
        // ignore
      }
    }
  }

  private async resolveSecrets(config: McpServerConfig): Promise<McpServerConfig> {
    if (!config.env) return config;
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env)) {
      resolved[key] = await this.resolveSecretRefs(value);
    }
    return { ...config, env: resolved };
  }

  private async resolveSecretRefs(value: string): Promise<string> {
    const matches = [...value.matchAll(SECRET_REF_PATTERN)];
    if (matches.length === 0) return value;
    let result = value;
    for (const match of matches) {
      const secretKey = match[1];
      const secret = await invoke<string | null>("get_secret", { key: secretKey });
      if (secret === null) {
        throw new Error(`Secret "${secretKey}" not found in keychain — set it in Settings`);
      }
      result = result.replace(match[0], secret);
    }
    return result;
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
