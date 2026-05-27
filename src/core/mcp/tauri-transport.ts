import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface LinePayload {
  line: string;
}

/**
 * MCP SDK Transport implementation backed by the Rust `mcp_bridge` Tauri
 * commands. The SDK's bundled StdioClientTransport spawns child processes via
 * Node's `child_process`, which is unavailable in a Tauri webview — this is
 * the equivalent wrapper that talks to the Rust-spawned child over Tauri
 * commands + events.
 *
 * Contract (verified at CP1 against `node_modules/@modelcontextprotocol/sdk/
 * dist/esm/shared/transport.d.ts`):
 *   - `start()`: subscribes to `mcp:<handle>:stdout` + `:stderr`; parses each
 *     stdout line as JSON-RPC and dispatches to `onmessage`. Stderr lines go
 *     to `console.warn` with prefix `[mcp:<handle>]`.
 *   - `send(msg, options?)`: invokes `send_mcp_stdin(handle, JSON.stringify(msg))`.
 *     The optional `TransportSendOptions` (resumption tokens, request ID
 *     correlation) is accepted and ignored — stdio doesn't carry resumption.
 *   - `close()`: unsubscribes events + invokes `onclose`. Does NOT call
 *     `stop_mcp_server` — server lifecycle is owned by `McpManager`.
 *
 * Slice A omits the optional `sessionId` + `setProtocolVersion` fields; the
 * SDK treats both as opt-in.
 */
export class TauriTransport implements Transport {
  private readonly handle: string;
  private stdoutOff: UnlistenFn | null = null;
  private stderrOff: UnlistenFn | null = null;
  private closed = false;

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(handle: string) {
    this.handle = handle;
  }

  async start(): Promise<void> {
    if (this.closed) {
      throw new Error(`TauriTransport(${this.handle}): cannot start after close`);
    }
    this.stdoutOff = await listen<LinePayload>(`mcp:${this.handle}:stdout`, (event) => {
      const raw = event.payload.line;
      let msg: JSONRPCMessage;
      try {
        msg = JSON.parse(raw) as JSONRPCMessage;
      } catch (err) {
        this.onerror?.(
          new Error(
            `TauriTransport(${this.handle}): stdout line is not JSON-RPC: ${raw} (${err instanceof Error ? err.message : String(err)})`,
          ),
        );
        return;
      }
      this.onmessage?.(msg);
    });
    this.stderrOff = await listen<LinePayload>(`mcp:${this.handle}:stderr`, (event) => {
      console.warn(`[mcp:${this.handle}] ${event.payload.line}`);
    });
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.closed) {
      throw new Error(`TauriTransport(${this.handle}): cannot send after close`);
    }
    await invoke("send_mcp_stdin", { handle: this.handle, line: JSON.stringify(message) });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stdoutOff?.();
    this.stderrOff?.();
    this.stdoutOff = null;
    this.stderrOff = null;
    this.onclose?.();
  }
}
