import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/core";
import type { TauriTransport } from "../mcp/tauri-transport";
import type { AgentEvent, CompactResult, SendOptions, Session } from "../types";
import { CODEX_SERVER_ID } from "./config";
import { type CodexEventMsg, translateCodexEvent } from "./events";

type Sandbox = "read-only" | "workspace-write" | "danger-full-access";
type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

export interface CodexSessionDeps {
  client: Client;
  transport: TauriTransport;
  cwd: string;
  /** Slice A locks these; Slice B opens workspace-write + untrusted approvals. */
  sandbox?: Sandbox;
  approvalPolicy?: ApprovalPolicy;
  id?: string;
}

/**
 * A live Codex session driven over `codex mcp-server`. The first turn calls the
 * `codex` tool (capturing the returned `threadId`); later turns call
 * `codex-reply`. `codex/event` notifications stream in via the transport tee and
 * are translated to `AgentEvent`s while the tool call is pending. The turn's
 * `done` comes from the `task_complete` event; a fallback `done` is emitted if a
 * successful call produced none.
 */
export class CodexSession implements Session {
  readonly id: string;
  private readonly client: Client;
  private readonly transport: TauriTransport;
  private readonly cwd: string;
  private readonly sandbox: Sandbox;
  private readonly approvalPolicy: ApprovalPolicy;
  private readonly unsubscribe: () => void;
  private readonly queue = new AsyncEventQueue<AgentEvent>();
  private threadId: string | null = null;
  private turnDone = false;
  private turnErrored = false;
  private closed = false;

  constructor(deps: CodexSessionDeps) {
    this.id = deps.id ?? CODEX_SERVER_ID;
    this.client = deps.client;
    this.transport = deps.transport;
    this.cwd = deps.cwd;
    this.sandbox = deps.sandbox ?? "read-only";
    this.approvalPolicy = deps.approvalPolicy ?? "never";
    this.unsubscribe = this.transport.subscribe((m) => this.onFrame(m));
  }

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  private onFrame(message: JSONRPCMessage): void {
    if (this.closed) return;
    const m = message as { method?: string; params?: { msg?: CodexEventMsg } };
    if (m.method !== "codex/event" || !m.params?.msg) return;
    const event = translateCodexEvent(m.params.msg);
    if (!event) return;
    if (event.type === "done") this.turnDone = true;
    if (event.type === "error") this.turnErrored = true;
    this.queue.push(event);
  }

  async sendMessage(text: string, _opts?: SendOptions): Promise<void> {
    if (this.closed) return;
    this.turnDone = false;
    this.turnErrored = false;
    try {
      const result =
        this.threadId === null
          ? await this.client.callTool({
              name: "codex",
              arguments: {
                prompt: text,
                cwd: this.cwd,
                sandbox: this.sandbox,
                "approval-policy": this.approvalPolicy,
              },
            })
          : await this.client.callTool({
              name: "codex-reply",
              arguments: { threadId: this.threadId, prompt: text },
            });
      const threadId = (result as { structuredContent?: { threadId?: string } }).structuredContent
        ?.threadId;
      if (typeof threadId === "string") this.threadId = threadId;
      // Safety net: if task_complete never arrived, terminate the turn anyway —
      // reflecting an observed error notification rather than misreporting it
      // as a clean completion.
      if (!this.turnDone) {
        this.queue.push({ type: "done", reason: this.turnErrored ? "error" : "complete" });
      }
    } catch (err) {
      this.queue.push({
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      });
      this.queue.push({ type: "done", reason: "error" });
    }
  }

  async respondToApproval(): Promise<void> {
    // No-op in Slice A — Codex runs read-only with approval-policy `never`, so
    // no approval_request events are emitted. Approvals land in Slice B.
  }

  async compact(): Promise<CompactResult> {
    // Codex manages its own conversation context/compaction; our /compact does
    // not apply to the Codex backend.
    return { error: "Compaction is managed by Codex itself — /compact is not available here." };
  }

  async interrupt(): Promise<void> {
    if (this.closed) return;
    // Slice A has no Stop button; best-effort terminal signal only.
    this.queue.push({ type: "done", reason: "interrupted" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    try {
      await this.client.close();
    } catch {
      // ignore
    }
    try {
      await this.transport.close();
    } catch {
      // ignore
    }
    try {
      await invoke("stop_mcp_server", { handle: this.id });
    } catch {
      // ignore
    }
    this.queue.end();
  }
}

/**
 * Minimal push/pull async queue: producers `push()` events; a single consumer
 * `for await`s them; `end()` terminates the iteration. Buffers when no consumer
 * is waiting; resolves immediately when one is.
 */
class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.buffer.push(item);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters) waiter({ value: undefined, done: true });
    this.waiters.length = 0;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.buffer.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
