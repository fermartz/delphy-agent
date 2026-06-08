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
  private exitOff: UnlistenFn | null = null;
  private closed = false;
  /** Last line the child wrote to stderr — surfaced as the exit reason. */
  private lastStderr: string | null = null;
  /** Set when the child process exits before/while connecting. */
  private exitReasonText: string | null = null;
  /** Extra read-only observers of every incoming frame (the Codex "tee"). */
  private readonly observers = new Set<(message: JSONRPCMessage) => void>();

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
      if (this.closed) return;
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
      // Dispatch to tee observers (Codex's codex/event stream) before the SDK
      // Client's onmessage. Observers are read-only and must not break dispatch.
      for (const observer of this.observers) {
        try {
          observer(msg);
        } catch (obsErr) {
          console.warn(`[mcp:${this.handle}] tee observer error`, obsErr);
        }
      }
      this.onmessage?.(msg);
    });
    this.stderrOff = await listen<LinePayload>(`mcp:${this.handle}:stderr`, (event) => {
      if (this.closed) return;
      this.lastStderr = event.payload.line;
      console.warn(`[mcp:${this.handle}] ${event.payload.line}`);
    });
    // When the child process exits (its stdout closes), fail fast instead of
    // waiting out the connect timeout. Firing onclose rejects the SDK's pending
    // `initialize` request immediately; `exitReason` carries the child's last
    // stderr line (e.g. an npm 404) so the caller can show why.
    this.exitOff = await listen(`mcp:${this.handle}:exit`, () => {
      if (this.closed) return;
      this.exitReasonText = this.lastStderr
        ? `server process exited: ${this.lastStderr}`
        : "server process exited before completing the connection";
      this.closed = true;
      this.unsubscribe();
      this.onerror?.(new Error(`TauriTransport(${this.handle}): ${this.exitReasonText}`));
      this.onclose?.();
    });
  }

  /** Reason the child exited, if it did (the last stderr line when available). */
  get exitReason(): string | null {
    return this.exitReasonText;
  }

  /**
   * Register an additional read-only observer ("tee") that receives every parsed
   * incoming JSON-RPC frame, dispatched alongside `onmessage`. The Codex adapter
   * uses it to watch custom `codex/event` notifications while the MCP SDK Client
   * owns request/response correlation via `onmessage`. Returns an unsubscribe fn.
   */
  subscribe(listener: (message: JSONRPCMessage) => void): () => void {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  }

  /** Unsubscribe all Tauri listeners. Idempotent. */
  private unsubscribe(): void {
    this.stdoutOff?.();
    this.stderrOff?.();
    this.exitOff?.();
    this.stdoutOff = null;
    this.stderrOff = null;
    this.exitOff = null;
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
    this.unsubscribe();
    this.onclose?.();
  }
}
