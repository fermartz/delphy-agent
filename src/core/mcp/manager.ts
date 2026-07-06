import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { invoke } from "@tauri-apps/api/core";
import { remoteUrlError } from "./store";
import { TauriTransport } from "./tauri-transport";
import { createRemoteTransport } from "./transport-factory";
import type { McpServerConfig, McpServerStatus, McpTool, McpToolResult } from "./types";

const INIT_TIMEOUT_MS = 30_000;
// The MCP `initialize` handshake gets a longer budget than spawn/listTools:
// for an `npx -y <pkg>` server the first run downloads the package + its deps
// before the server can answer, which routinely exceeds 30s on a cold cache.
// (We SIGKILL on timeout, so too short a budget kills npx mid-download and the
// next attempt just re-downloads — it never warms the cache.)
const CONNECT_TIMEOUT_MS = 120_000;
// Remote (http/sse) servers have no `npx` cold-download to wait out, so they
// get the shorter budget; a slow/unreachable endpoint becomes a `failed` row
// the user can restart, rather than hanging two minutes.
const REMOTE_CONNECT_TIMEOUT_MS = 30_000;
const CALL_TOOL_TIMEOUT_MS = 30_000;

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  transport: Transport;
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
  // Bumped on every mutation that can change the model-facing tool surface
  // (server connect/fail/disable, removal, shutdown, per-tool toggles).
  // Consumers memoize derived artifacts (the streamText ToolSet, the
  // system-prompt tool context) keyed on this, so the tools payload stays
  // byte-stable across turns — a prompt-cache prefix — and is rebuilt only
  // when the user actually changes MCP state. (BACKLOG #18)
  private revision = 0;

  getRevision(): number {
    return this.revision;
  }

  async init(configs: McpServerConfig[]): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await Promise.all(configs.map((config) => this.bootOne(config)));
      this.initDone = true;
      this.revision++;
    })();
    return this.initPromise;
  }

  async addServer(config: McpServerConfig): Promise<void> {
    await this.bootOne(config);
    this.revision++;
  }

  async removeServer(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (entry?.kind === "connected") {
      await this.disconnect(entry.data);
    }
    this.servers.delete(id);
    this.revision++;
  }

  /**
   * Tear down one connected server. Streamable HTTP gets an explicit
   * `terminateSession()` (DELETE) to end the server-side session before close;
   * servers that don't support it answer 405 and we ignore it. The SDK client
   * is closed (-> transport.close() -> unsubscribes any Tauri listeners) BEFORE
   * stopping a stdio child, so the expected stdout-EOF `exit` isn't observed by
   * a live transport and surfaced as an error. Only stdio has a child to stop.
   */
  private async disconnect(server: ConnectedServer): Promise<void> {
    if (server.transport instanceof StreamableHTTPClientTransport) {
      try {
        await server.transport.terminateSession();
      } catch {
        // ignore — server may not support session termination (405)
      }
    }
    try {
      await server.client.close();
    } catch {
      // ignore
    }
    if (server.config.transport === "stdio") {
      try {
        await invoke("stop_mcp_server", { handle: server.config.id });
      } catch {
        // ignore
      }
    }
  }

  async restartServer(config: McpServerConfig): Promise<void> {
    await this.removeServer(config.id);
    await this.bootOne(config);
    this.revision++;
  }

  /**
   * Apply a per-tool disable list to an already-booted server without
   * restarting it (read-time filter — the server keeps its full tool list;
   * we only trim what `getAllTools` forwards to the model). Call this on a
   * `disabledTools`-only config save instead of `restartServer`. No-op if the
   * id is unknown.
   */
  setDisabledTools(id: string, disabledTools: string[] | undefined): void {
    const entry = this.servers.get(id);
    if (!entry) return;
    entry.data.config = { ...entry.data.config, disabledTools };
    this.revision++;
  }

  isInitialized(): boolean {
    return this.initDone;
  }

  getStatus(): McpServerStatus[] {
    return Array.from(this.servers.values()).map(entryToStatus);
  }

  /**
   * Flattened list of MODEL-FACING tools across all connected servers,
   * namespaced by `<serverId>__<toolName>` to prevent collisions. Returns
   * `[]` if init hasn't completed. Consumed by `streamText({ tools })`.
   *
   * Tools the user disabled (`config.disabledTools`) are filtered out here —
   * the manager boundary is the single filtering point, so the tool set, the
   * system-prompt tool context, and call routing all agree. Output is sorted
   * (serverId, then tool name) so the serialized tools payload is byte-stable
   * across turns regardless of Map insertion order. The Settings UI needs the
   * unfiltered list — see `getServerTools`.
   */
  getAllTools(): McpTool[] {
    const out: McpTool[] = [];
    for (const entry of this.servers.values()) {
      if (entry.kind !== "connected") continue;
      const disabled = new Set(entry.data.config.disabledTools ?? []);
      out.push(...entry.data.tools.filter((t) => !disabled.has(t.name)));
    }
    out.sort((a, b) =>
      a.serverId === b.serverId
        ? a.name.localeCompare(b.name)
        : a.serverId.localeCompare(b.serverId),
    );
    return out;
  }

  /**
   * UNFILTERED tool list for one connected server (disabled tools included),
   * for the Settings UI's per-tool toggles — a disabled tool must stay
   * listed so the user can re-enable it. Returns `[]` when the server isn't
   * connected. The model-facing path must use `getAllTools`.
   */
  getServerTools(serverId: string): McpTool[] {
    const entry = this.servers.get(serverId);
    if (!entry || entry.kind !== "connected") return [];
    return [...entry.data.tools].sort((a, b) => a.name.localeCompare(b.name));
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
    // Defense-in-depth for the read-time filter: a disabled tool should never
    // be offered to the model (getAllTools filters it), but a stale/cached
    // tool set or a mid-turn toggle could still route a call here.
    if (entry.data.config.disabledTools?.includes(toolName)) {
      return {
        content: [{ type: "text", text: `Tool "${toolName}" is disabled by the user in Settings` }],
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
        await this.disconnect(entry.data);
      }),
    );
    this.servers.clear();
    this.initPromise = null;
    this.initDone = false;
    this.revision++;
  }

  private async bootOne(config: McpServerConfig): Promise<void> {
    if (!config.enabled) {
      this.servers.set(config.id, { kind: "disabled", data: { config } });
      return;
    }

    const isStdio = config.transport === "stdio";
    // Enforce the remote-URL gate at the boot boundary, not just in the Settings
    // form: persisted/migrated configs reach bootOne without ever passing
    // through validateMcpConfig, so a non-https non-loopback URL could otherwise
    // slip into createRemoteTransport.
    if (!isStdio) {
      const urlErr = remoteUrlError(config.url);
      if (urlErr) {
        this.servers.set(config.id, { kind: "failed", data: { config, error: urlErr } });
        return;
      }
    }

    let transport: Transport | null = null;
    try {
      const resolved = await this.resolveSecrets(config);

      let connectTimeout: number;
      if (isStdio) {
        const handle = await this.spawnWithTimeout(resolved);
        transport = new TauriTransport(handle);
        connectTimeout = CONNECT_TIMEOUT_MS;
      } else {
        // http/sse: build an SDK web transport routed through the Rust-proxied
        // fetch (no child to spawn). No npx cold-start, so the shorter budget.
        transport = createRemoteTransport(resolved);
        connectTimeout = REMOTE_CONNECT_TIMEOUT_MS;
      }

      const client = new Client({ name: "delphy-agent", version: "0.0.0" }, { capabilities: {} });

      // Pass the timeout INTO the SDK's initialize request — the client applies
      // its own DEFAULT_REQUEST_TIMEOUT_MSEC (60s) per request and would raise
      // "-32001: Request timed out" before our outer withTimeout fires. The
      // outer withTimeout stays as a backstop in case connect hangs entirely.
      await withTimeout(
        client.connect(transport, { timeout: connectTimeout }),
        connectTimeout,
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

      this.servers.set(config.id, {
        kind: "connected",
        data: { config, client, transport, tools },
      });
    } catch (err) {
      // Prefer the stdio child's exit reason (e.g. an npm 404 on the last
      // stderr line) over a generic "Connection closed" from the SDK when the
      // process died during connect. Remote transports have no exit reason.
      const exitReason = transport instanceof TauriTransport ? transport.exitReason : null;
      const error = exitReason ?? (err instanceof Error ? err.message : String(err));
      this.servers.set(config.id, { kind: "failed", data: { config, error } });
      // If a Streamable HTTP session was established before a later step (e.g.
      // listTools) failed, end it server-side before closing — otherwise the
      // session leaks. No-op/405 if no session exists yet.
      if (transport instanceof StreamableHTTPClientTransport) {
        try {
          await transport.terminateSession();
        } catch {
          // ignore — server may not support session termination (405)
        }
      }
      // Close the transport so any listeners are unsubscribed (idempotent if the
      // fail-fast exit path already closed it) — otherwise a retry of the same
      // id would stack duplicates.
      try {
        await transport?.close();
      } catch {
        // ignore
      }
      // Only stdio spawned a child process to stop.
      if (isStdio) {
        try {
          await invoke("stop_mcp_server", { handle: config.id });
        } catch {
          // ignore
        }
      }
    }
  }

  private async resolveSecrets(config: McpServerConfig): Promise<McpServerConfig> {
    if (!config.env && !config.headers) return config;
    const next = { ...config };
    // stdio servers carry secrets in `env`; remote (http/sse) servers carry them
    // in `headers` (e.g. `Authorization: Bearer ${secret:token}`). Resolve both
    // so a placeholder ref is never sent literally to a remote server.
    if (config.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.env)) {
        resolvedEnv[key] = await this.resolveSecretRefs(value);
      }
      next.env = resolvedEnv;
    }
    if (config.headers) {
      const resolvedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.headers)) {
        resolvedHeaders[key] = await this.resolveSecretRefs(value);
      }
      next.headers = resolvedHeaders;
    }
    return next;
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
