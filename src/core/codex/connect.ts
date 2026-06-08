import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { invoke } from "@tauri-apps/api/core";
import { TauriTransport } from "../mcp/tauri-transport";
import { buildCodexServerConfig, CODEX_SERVER_ID } from "./config";

// codex mcp-server is a local binary that starts fast (no npx download), so a
// shorter handshake budget than the MCP manager's 120s cold-start budget is fine.
const CONNECT_TIMEOUT_MS = 30_000;

/** The two tools `codex mcp-server` must expose for us to drive it. */
const REQUIRED_TOOLS = ["codex", "codex-reply"] as const;

export type CodexConnectErrorKind = "not-installed" | "handshake-failed" | "tools-missing";

export class CodexConnectError extends Error {
  constructor(
    readonly kind: CodexConnectErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "CodexConnectError";
  }
}

export interface CodexConnection {
  client: Client;
  transport: TauriTransport;
}

/**
 * Spawn `codex mcp-server` through the existing Rust MCP bridge and complete the
 * MCP initialize handshake (reusing `TauriTransport` + the MCP SDK `Client`),
 * then verify it exposes the `codex` + `codex-reply` tools we drive.
 *
 * Does NOT call any tool — Codex auth (`codex login`) is only exercised when a
 * turn actually runs (CP2). A missing binary surfaces here as `not-installed`.
 */
export async function connectCodex(): Promise<CodexConnection> {
  const config = buildCodexServerConfig();

  let handle: string;
  try {
    handle = await invoke<string>("spawn_mcp_server", { config });
  } catch (err) {
    throw new CodexConnectError(
      "not-installed",
      `Could not start Codex (${errMsg(err)}). Is the Codex CLI installed and on your PATH?`,
    );
  }

  const transport = new TauriTransport(handle);
  const client = new Client({ name: "delphy-agent", version: "0.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    const missing = REQUIRED_TOOLS.filter((t) => !names.has(t));
    if (missing.length > 0) {
      throw new CodexConnectError(
        "tools-missing",
        `codex mcp-server did not expose expected tools (missing: ${missing.join(", ")}; got: ${[...names].join(", ") || "none"}). Codex CLI version may be incompatible.`,
      );
    }
    return { client, transport };
  } catch (err) {
    await cleanup(transport);
    if (err instanceof CodexConnectError) throw err;
    // Prefer the child's exit reason (last stderr line) over the SDK's generic
    // "Connection closed" when the process died during the handshake.
    const reason = transport.exitReason ?? errMsg(err);
    throw new CodexConnectError("handshake-failed", `Codex MCP handshake failed: ${reason}`);
  }
}

async function cleanup(transport: TauriTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    // ignore
  }
  try {
    await invoke("stop_mcp_server", { handle: CODEX_SERVER_ID });
  } catch {
    // ignore
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
