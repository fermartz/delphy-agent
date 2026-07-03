import { invoke } from "@tauri-apps/api/core";
import {
  jsonSchema,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolApprovalResponse,
  type ToolSet,
  tool,
} from "ai";
import { saveMemory } from "../db/memory";
import { AuxiliaryClient } from "../llm/auxiliary";
import { mcpManager } from "../mcp/manager";
import { buildSystemPrompt, defaultSystemPromptSlices } from "../prompts/three-tier";
import { getProvider } from "../providers";
import { getRuntimeKey } from "../providers/runtime-keys";
import { compactMessages, DEFAULT_COMPACTOR_CONFIG } from "../session/compactor";
import type {
  AgentEvent,
  BackendAdapter,
  CompactResult,
  MessagePersister,
  RuntimeErrorKind,
  SendOptions,
  Session,
  SessionOptions,
} from "../types";

// Default provider id when SessionOptions.providerId is unset (a legacy
// caller path or a test fixture not yet updated). The boot helper resolves
// the real provider from settings.main_provider per Parameter 10a.
const DEFAULT_PROVIDER_ID = "anthropic";

const CHARS_PER_TOKEN_ANTHROPIC = 3.5;
const CONTEXT_LIMIT_TOKENS = 200_000;
const CONTEXT_WARN_THRESHOLD = 0.75;

const AUTO_COMPACT_THRESHOLD = 0.85;
const ANTI_THRASHING_MIN_SAVED_RATIO = 0.1;

const APPROVAL_CYCLE_CAP = 5;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ANTHROPIC);
}

function estimateMessageTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (typeof part !== "object" || part === null) continue;
        if ("text" in part && typeof part.text === "string") {
          total += estimateTokens(part.text);
        } else {
          total += estimateTokens(JSON.stringify(part));
        }
      }
    }
  }
  return total;
}

export type BootErrorKind =
  | "missing-key"
  | "secure-storage-unavailable"
  | "unknown"
  // Codex backend (agent-cli) boot failures (BACKLOG #7).
  | "codex-missing"
  | "codex-no-workdir"
  | "codex-failed";

export class BootError extends Error {
  kind: BootErrorKind;
  constructor(kind: BootErrorKind, message: string) {
    super(message);
    this.name = "BootError";
    this.kind = kind;
  }
}

async function resolveApiKey(secretKey: string): Promise<{ key: string } | { error: BootError }> {
  try {
    const stored = await invoke<string | null>("get_secret", { key: secretKey });
    if (stored && stored.length > 0) {
      return { key: stored };
    }
    const runtime = getRuntimeKey(secretKey);
    if (runtime && runtime.length > 0) {
      return { key: runtime };
    }
    return {
      error: new BootError(
        "missing-key",
        `No API key found in keychain or runtime memory for "${secretKey}".`,
      ),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("SECURE_STORAGE_UNAVAILABLE:")) {
      const runtime = getRuntimeKey(secretKey);
      if (runtime && runtime.length > 0) {
        return { key: runtime };
      }
      return { error: new BootError("secure-storage-unavailable", message) };
    }
    return { error: new BootError("unknown", message) };
  }
}

function inferRuntimeErrorKind(err: unknown): RuntimeErrorKind {
  if (!err || typeof err !== "object") return "unknown";
  const e = err as { statusCode?: number; status?: number; message?: string };
  const status = e.statusCode ?? e.status;
  if (status === 401 || status === 403) return "invalid-key";
  if (status === 429) return "rate-limited";
  if (status === 404) return "model-deprecated";
  const msg = (e.message ?? "").toLowerCase();
  if (
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  ) {
    return "network";
  }
  if (
    msg.includes("invalid api key") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication")
  ) {
    return "invalid-key";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "rate-limited";
  }
  if (msg.includes("model_not_found") || msg.includes("model not found")) {
    return "model-deprecated";
  }
  return "unknown";
}

// "preparing" is claimed the instant a turn is accepted — before the async
// setup (persist + auto-compaction) that precedes streaming — so a re-entrant
// sendMessage can't interleave in that window (see sendMessage).
type TurnState = "idle" | "preparing" | "streaming" | "awaiting_approval" | "closed";

interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  verdict?: { allowed: boolean; reason?: string };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type IterationOutcome =
  | { outcome: "done"; finishReason: string }
  | { outcome: "awaiting_approval" };

const UPDATE_MEMORY_TOOL_NAME = "update_memory";

const UPDATE_MEMORY_DESCRIPTION =
  "Replace the user's persistent memory with the given content. Use this to record durable facts, preferences, ongoing projects, or constraints the user has shared. The full content you provide replaces what was previously stored, so include everything that should be remembered, not just the delta. Capped at 3000 characters. Saved memory becomes visible to you in the user's next session, not the current one.";

const UPDATE_MEMORY_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description:
        "The complete memory content to store (overwrites prior memory). Plain text, up to 3000 characters.",
    },
  },
  required: ["content"],
  additionalProperties: false,
};

function buildToolSet(): ToolSet | undefined {
  const allTools = mcpManager.getAllTools();
  const toolSet: ToolSet = {};

  toolSet[UPDATE_MEMORY_TOOL_NAME] = tool({
    description: UPDATE_MEMORY_DESCRIPTION,
    inputSchema: jsonSchema(UPDATE_MEMORY_INPUT_SCHEMA),
    needsApproval: false,
    execute: async (input) => {
      const content =
        typeof input === "object" && input !== null && "content" in input
          ? String((input as { content: unknown }).content ?? "")
          : "";
      try {
        const { saved, truncated } = await saveMemory(content);
        return {
          content: [
            {
              type: "text",
              text: truncated
                ? `Memory saved (truncated to ${saved.length} chars). Visible next session.`
                : `Memory saved (${saved.length} chars). Visible next session.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to save memory: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  for (const t of allTools) {
    toolSet[t.namespacedName] = tool({
      description: t.description ?? "",
      inputSchema: jsonSchema(t.inputSchema as Record<string, unknown>),
      needsApproval: true,
      execute: async (input) => {
        const result = await mcpManager.callTool(t.namespacedName, input);
        return result;
      },
    });
  }
  return toolSet;
}

function buildToolContext(): string {
  const allTools = mcpManager.getAllTools();
  if (allTools.length === 0) return "";
  const byServer = new Map<string, string[]>();
  for (const t of allTools) {
    const names = byServer.get(t.serverId) ?? [];
    names.push(t.name);
    byServer.set(t.serverId, names);
  }
  const lines = Array.from(byServer.entries()).map(([id, names]) => `- ${id}: ${names.join(", ")}`);
  return `Connected MCP servers and their tools:\n${lines.join("\n")}`;
}

class DirectApiSession implements Session {
  readonly id: string;

  private readonly eventBuffer: AgentEvent[] = [];
  private resolveNextEvent: (() => void) | null = null;
  private eventsClosed = false;

  private messages: ModelMessage[] = [];
  private readonly systemPrompt: string;
  private persistedCount = 0;

  private readonly providerId: string;
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly auxiliaryProviderId: string;
  private readonly auxiliaryApiKey: string;
  private readonly auxiliaryModelId: string;
  private readonly persister?: MessagePersister;

  private currentAbort: AbortController | null = null;

  private lastCompactionSavedRatio: number | null = null;
  private lastCompactionMetrics: {
    before: number;
    after: number;
    tokensSaved: number;
    at: number;
  } | null = null;
  private compactionInFlight = false;

  // Per-session token usage accumulator (Parameter 16 of the multi-provider
  // plan). Populated from the streamText `usage` event after each turn,
  // surfaced via the `usage` AgentEvent and used by `/status` (Parameter 17).
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCachedInputTokens = 0;
  private totalTurns = 0;

  private turnState: TurnState = "idle";
  private pendingApprovals = new Map<string, PendingApproval>();
  private pendingApprovalsWaiter: Deferred<void> | null = null;

  constructor(
    id: string,
    apiKey: string,
    modelId: string,
    auxiliaryModelId: string,
    initialMessages: ModelMessage[] = [],
    initialMemory = "",
    persister?: MessagePersister,
    providerId: string = DEFAULT_PROVIDER_ID,
    auxiliaryProviderId?: string,
    auxiliaryApiKey?: string,
  ) {
    this.id = id;
    this.apiKey = apiKey;
    this.modelId = modelId;
    this.auxiliaryModelId = auxiliaryModelId;
    this.providerId = providerId;
    this.auxiliaryProviderId = auxiliaryProviderId ?? providerId;
    this.auxiliaryApiKey = auxiliaryApiKey ?? apiKey;
    this.messages = [...initialMessages];
    this.persistedCount = this.messages.length;
    this.persister = persister;
    const slices = defaultSystemPromptSlices();
    if (initialMemory.trim().length > 0) {
      slices.context = `User memory (persists across sessions):\n${initialMemory.trim()}`;
    }
    this.systemPrompt = buildSystemPrompt(slices);
  }

  private async flushPersist(): Promise<void> {
    if (!this.persister) {
      this.persistedCount = this.messages.length;
      return;
    }
    while (this.persistedCount < this.messages.length) {
      const seq = this.persistedCount;
      try {
        await this.persister.append(seq, this.messages[seq]);
      } catch (err) {
        console.warn("[direct-api] persist append failed", err);
        break;
      }
      this.persistedCount = seq + 1;
    }
    try {
      await this.persister.touch();
    } catch (err) {
      console.warn("[direct-api] persist touch failed", err);
    }
  }

  private async persistReplace(): Promise<void> {
    if (!this.persister) {
      this.persistedCount = this.messages.length;
      return;
    }
    try {
      await this.persister.replace([...this.messages]);
      this.persistedCount = this.messages.length;
    } catch (err) {
      console.warn("[direct-api] persist replace failed", err);
    }
  }

  events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]: () => this.iterateEvents(),
  };

  private async *iterateEvents(): AsyncIterator<AgentEvent> {
    while (true) {
      const next = this.eventBuffer.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.eventsClosed) return;
      await new Promise<void>((resolve) => {
        this.resolveNextEvent = resolve;
      });
    }
  }

  private emitEvent(event: AgentEvent): void {
    this.eventBuffer.push(event);
    this.resolveNextEvent?.();
    this.resolveNextEvent = null;
  }

  async sendMessage(text: string, _opts: SendOptions = {}): Promise<void> {
    if (this.eventsClosed) throw new Error("session closed");

    if (this.turnState !== "idle") {
      this.emitEvent({
        type: "error",
        error: new Error("Cannot send a new message while a turn is in progress"),
        kind: "unknown",
      });
      this.emitEvent({ type: "done", reason: "error" });
      return;
    }

    // Claim the turn NOW. The guard above only rejects re-entrancy once
    // turnState is non-idle, but nothing set that until streaming began — so a
    // second sendMessage during the async setup (persist + auto-compaction)
    // could interleave and clobber this.messages / the compaction snapshot. The
    // UI gates this via its streaming flag, but the adapter must not depend on
    // that (a programmatic / inbound-MCP driver can call sendMessage directly).
    this.turnState = "preparing";
    this.currentAbort = new AbortController();

    try {
      this.messages.push({ role: "user", content: text });
      await this.flushPersist();

      const tokensUsed = estimateTokens(this.systemPrompt) + estimateMessageTokens(this.messages);
      if (tokensUsed > CONTEXT_LIMIT_TOKENS * CONTEXT_WARN_THRESHOLD) {
        this.emitEvent({
          type: "text",
          delta:
            `[delphy:context-warning] Context is near the model limit (${tokensUsed.toLocaleString()} / ${CONTEXT_LIMIT_TOKENS.toLocaleString()} tokens estimated). ` +
            `Auto-compaction will fire at ${Math.round(AUTO_COMPACT_THRESHOLD * 100)}% of the limit. Type /compact to compact now.\n\n`,
        });
      }

      const profile = getProvider(this.providerId);
      if (!profile) {
        this.emitEvent({
          type: "error",
          error: new Error(`Provider "${this.providerId}" not found in registry`),
          kind: "unknown",
        });
        this.emitEvent({ type: "done", reason: "error" });
        this.turnState = "idle";
        return;
      }

      const allowedByAntiThrashing =
        this.lastCompactionSavedRatio === null ||
        this.lastCompactionSavedRatio >= ANTI_THRASHING_MIN_SAVED_RATIO;
      if (
        tokensUsed > CONTEXT_LIMIT_TOKENS * AUTO_COMPACT_THRESHOLD &&
        allowedByAntiThrashing &&
        !this.compactionInFlight
      ) {
        await this.runAutoCompaction();
      }

      for (let cycle = 0; cycle < APPROVAL_CYCLE_CAP; cycle++) {
        this.turnState = "streaming";
        this.pendingApprovals.clear();

        const iterResult = await this.runStreamIteration(profile);

        if (iterResult.outcome === "done") {
          this.turnState = "idle";
          const reason =
            iterResult.finishReason === "stop" ||
            iterResult.finishReason === "length" ||
            iterResult.finishReason === "content-filter"
              ? "complete"
              : iterResult.finishReason === "error"
                ? "error"
                : "complete";
          this.emitEvent({ type: "done", reason });
          return;
        }

        this.turnState = "awaiting_approval";
        try {
          await this.awaitAllPendingApprovals();
        } catch {
          // Waiter was rejected by interrupt() or close().
        }

        if (this.turnState !== "awaiting_approval") return;

        this.messages.push(this.buildApprovalResponseMessage());
        await this.flushPersist();
        this.pendingApprovals.clear();
      }

      this.emitEvent({
        type: "error",
        error: new Error(
          `tool-call iteration cap exceeded — ${APPROVAL_CYCLE_CAP} approval cycles per turn`,
        ),
        kind: "unknown",
      });
      this.emitEvent({ type: "done", reason: "error" });
      this.turnState = "idle";
    } catch (err) {
      this.emitEvent({
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        kind: inferRuntimeErrorKind(err),
      });
      this.emitEvent({ type: "done", reason: "error" });
      this.turnState = "idle";
    } finally {
      this.currentAbort = null;
    }
  }

  private async runStreamIteration(
    profile: ReturnType<typeof getProvider> & {},
  ): Promise<IterationOutcome> {
    const model = profile.model(this.apiKey, this.modelId);
    const tools = buildToolSet();
    const toolContext = buildToolContext();
    const systemContent = toolContext
      ? `${this.systemPrompt}\n\n${toolContext}`
      : this.systemPrompt;
    const result = streamText({
      model,
      system: [
        {
          role: "system",
          content: systemContent,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
      ],
      messages: this.messages,
      headers: profile.headers?.(),
      abortSignal: this.currentAbort?.signal,
      ...(tools ? { tools, stopWhen: stepCountIs(APPROVAL_CYCLE_CAP) } : {}),
    });

    let finishReason = "stop";

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          this.emitEvent({ type: "text", delta: part.text });
          break;

        case "tool-call":
          this.emitEvent({
            type: "tool_call",
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
          });
          break;

        case "tool-approval-request":
          this.pendingApprovals.set(part.approvalId, {
            approvalId: part.approvalId,
            toolCallId: part.toolCall.toolCallId,
            toolName: part.toolCall.toolName,
            input: part.toolCall.input,
          });
          this.emitEvent({
            type: "approval_request",
            id: part.approvalId,
            action: part.toolCall.toolName,
            payload: part.toolCall.input,
          });
          break;

        case "tool-result":
          this.emitEvent({
            type: "tool_result",
            id: part.toolCallId,
            output: part.output,
            isError: false,
          });
          break;

        case "tool-error":
          this.emitEvent({
            type: "tool_result",
            id: part.toolCallId,
            output: String(part.error),
            isError: true,
          });
          break;

        case "tool-output-denied":
          this.emitEvent({
            type: "tool_result",
            id: part.toolCallId,
            output: "User denied tool execution",
            isError: true,
          });
          break;

        case "error": {
          const err = part.error;
          this.emitEvent({
            type: "error",
            error: err instanceof Error ? err : new Error(String(err)),
            kind: inferRuntimeErrorKind(err),
          });
          break;
        }

        case "abort":
          this.emitEvent({ type: "done", reason: "interrupted" });
          this.turnState = "idle";
          return { outcome: "done", finishReason: "abort" };

        case "finish":
          finishReason = part.finishReason;
          break;

        default:
          break;
      }
    }

    const resp = await result.response;
    this.messages.push(...(resp.messages as ModelMessage[]));
    await this.flushPersist();

    const usage = await result.usage;
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    // Anthropic surfaces cached-input via `cachedInputTokens` on the
    // standard usage object in Vercel AI SDK 6.x. Other providers may emit 0
    // or undefined; treat as 0.
    const cachedInputTokens = (usage as { cachedInputTokens?: number }).cachedInputTokens ?? 0;

    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCachedInputTokens += cachedInputTokens;
    this.totalTurns += 1;

    this.emitEvent({
      type: "usage",
      inputTokens,
      outputTokens,
      cachedInputTokens,
    });

    // Live context-% indicator for the StatusBar (Parameter 16). Recomputed
    // from the current in-memory messages + system prompt.
    const ctxTokens = estimateTokens(this.systemPrompt) + estimateMessageTokens(this.messages);
    this.emitEvent({
      type: "context_usage",
      tokensUsed: ctxTokens,
      limit: CONTEXT_LIMIT_TOKENS,
      percent: clampRatio(ctxTokens / CONTEXT_LIMIT_TOKENS),
    });

    if (finishReason === "tool-calls" && this.pendingApprovals.size > 0) {
      return { outcome: "awaiting_approval" };
    }

    return { outcome: "done", finishReason };
  }

  /**
   * Snapshot of cumulative session usage. Consumed by `/status` (Parameter
   * 17) via `CommandContext.getStatus()` in CP6.
   */
  getUsageSnapshot(): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    turns: number;
    contextTokens: number;
    contextLimit: number;
    contextPercent: number;
  } {
    const ctxTokens = estimateTokens(this.systemPrompt) + estimateMessageTokens(this.messages);
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      cachedInputTokens: this.totalCachedInputTokens,
      turns: this.totalTurns,
      contextTokens: ctxTokens,
      contextLimit: CONTEXT_LIMIT_TOKENS,
      contextPercent: clampRatio(ctxTokens / CONTEXT_LIMIT_TOKENS),
    };
  }

  getLastCompaction() {
    return this.lastCompactionMetrics;
  }

  async respondToApproval(id: string, allowed: boolean): Promise<void> {
    if (this.turnState !== "awaiting_approval") {
      console.warn(`[direct-api] respondToApproval called in state "${this.turnState}", ignoring.`);
      return;
    }
    const entry = this.pendingApprovals.get(id);
    if (!entry) {
      console.warn(`[direct-api] respondToApproval: unknown approvalId "${id}"`);
      return;
    }
    if (entry.verdict) return;
    entry.verdict = {
      allowed,
      reason: allowed ? undefined : "User denied tool execution",
    };

    const allResolved = Array.from(this.pendingApprovals.values()).every((p) => p.verdict);
    if (allResolved) {
      this.pendingApprovalsWaiter?.resolve();
    }
  }

  private awaitAllPendingApprovals(): Promise<void> {
    const allResolved = Array.from(this.pendingApprovals.values()).every((p) => p.verdict);
    if (allResolved) return Promise.resolve();
    this.pendingApprovalsWaiter = createDeferred<void>();
    return this.pendingApprovalsWaiter.promise;
  }

  private buildApprovalResponseMessage(): ModelMessage {
    const content: ToolApprovalResponse[] = [];
    for (const entry of this.pendingApprovals.values()) {
      if (!entry.verdict) continue;
      content.push({
        type: "tool-approval-response",
        approvalId: entry.approvalId,
        approved: entry.verdict.allowed,
        reason: entry.verdict.reason,
      });
    }
    return { role: "tool", content } as ModelMessage;
  }

  async interrupt(): Promise<void> {
    const wasAwaitingApproval = this.turnState === "awaiting_approval";
    this.currentAbort?.abort();
    this.pendingApprovals.clear();
    if (this.pendingApprovalsWaiter) {
      this.pendingApprovalsWaiter.reject(new Error("interrupted"));
      this.pendingApprovalsWaiter = null;
    }
    this.turnState = "idle";
    if (wasAwaitingApproval) {
      this.emitEvent({ type: "done", reason: "interrupted" });
    }
  }

  async close(): Promise<void> {
    this.currentAbort?.abort();
    this.pendingApprovals.clear();
    if (this.pendingApprovalsWaiter) {
      this.pendingApprovalsWaiter.reject(new Error("closed"));
      this.pendingApprovalsWaiter = null;
    }
    this.turnState = "closed";
    this.eventsClosed = true;
    this.resolveNextEvent?.();
    this.resolveNextEvent = null;
  }

  private async runAutoCompaction(): Promise<void> {
    this.compactionInFlight = true;
    this.emitEvent({
      type: "system_message",
      text: "Compacting older turns to free context budget…",
    });
    try {
      const preTotalTokens = estimateMessageTokens(this.messages);
      const aux = new AuxiliaryClient({
        providerId: this.auxiliaryProviderId,
        apiKey: this.auxiliaryApiKey,
        modelId: this.auxiliaryModelId,
      });
      const result = await compactMessages({
        messages: this.messages,
        config: DEFAULT_COMPACTOR_CONFIG,
        aux,
        signal: this.currentAbort?.signal,
      });
      if (result.unchanged) {
        this.emitEvent({
          type: "system_message",
          text: "Auto-compaction skipped — conversation has no compactible middle yet.",
        });
        return;
      }
      this.messages = result.compactedMessages;
      await this.persistReplace();
      this.lastCompactionSavedRatio = clampRatio(
        result.metrics.estimatedTokensSaved / Math.max(1, preTotalTokens),
      );
      this.lastCompactionMetrics = {
        before: result.metrics.before,
        after: result.metrics.after,
        tokensSaved: result.metrics.estimatedTokensSaved,
        at: Date.now(),
      };
      this.emitEvent({
        type: "system_message",
        text: `Auto-compacted: ${result.metrics.before} → ${result.metrics.after} messages, ~${result.metrics.estimatedTokensSaved.toLocaleString()} tokens saved.`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.emitEvent({
        type: "system_message",
        text: `Auto-compaction failed (${reason}); continuing with un-compacted history.`,
        intent: "error",
      });
    } finally {
      this.compactionInFlight = false;
    }
  }

  async compact(focus?: string): Promise<CompactResult> {
    try {
      const preTotalTokens = estimateMessageTokens(this.messages);
      const aux = new AuxiliaryClient({
        providerId: this.auxiliaryProviderId,
        apiKey: this.auxiliaryApiKey,
        modelId: this.auxiliaryModelId,
      });
      const result = await compactMessages({
        messages: this.messages,
        config: DEFAULT_COMPACTOR_CONFIG,
        aux,
        focus,
      });
      if (result.unchanged) {
        return {
          before: result.metrics.before,
          after: result.metrics.after,
          tokensSaved: result.metrics.estimatedTokensSaved,
        };
      }
      this.messages = result.compactedMessages;
      await this.persistReplace();
      this.lastCompactionSavedRatio = clampRatio(
        result.metrics.estimatedTokensSaved / Math.max(1, preTotalTokens),
      );
      this.lastCompactionMetrics = {
        before: result.metrics.before,
        after: result.metrics.after,
        tokensSaved: result.metrics.estimatedTokensSaved,
        at: Date.now(),
      };
      return {
        before: result.metrics.before,
        after: result.metrics.after,
        tokensSaved: result.metrics.estimatedTokensSaved,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

let sessionCounter = 0;

export const directApiAdapter: BackendAdapter = {
  // Identifier stays "anthropic-api" for back-compat with existing
  // sessions.backend_id rows in SQLite (BACKLOG #4 shipped with this value).
  // Despite the name, the adapter is polymorphic — opts.providerId picks
  // the active ProviderProfile per session.
  id: "anthropic-api",
  kind: "direct-api",
  label: "Direct API",

  async start(opts: SessionOptions): Promise<Session> {
    const providerId = opts.providerId ?? DEFAULT_PROVIDER_ID;
    const profile = getProvider(providerId);
    if (!profile) {
      throw new BootError("unknown", `Provider "${providerId}" not registered`);
    }
    const resolved = await resolveApiKey(profile.secretKey);
    if ("error" in resolved) {
      throw resolved.error;
    }

    // Auxiliary provider/key resolution (Parameter 12 of the multi-provider
    // plan): if no auxiliaryProviderId set, fall back to main; if it IS set
    // and differs from main, resolve its own keychain entry. A failed
    // auxiliary key resolution does not block boot — the auxiliary client
    // surfaces it lazily when first invoked.
    let auxProviderId = opts.auxiliaryProviderId ?? providerId;
    let auxApiKey = resolved.key;
    if (auxProviderId !== providerId) {
      const auxProfile = getProvider(auxProviderId);
      if (auxProfile) {
        const auxResolved = await resolveApiKey(auxProfile.secretKey);
        if ("error" in auxResolved) {
          // Auxiliary key missing — fall back to main provider + key. The
          // user will see compaction skip with a helpful message if/when it
          // fires (per existing runAutoCompaction error handling).
          auxProviderId = providerId;
        } else {
          auxApiKey = auxResolved.key;
        }
      } else {
        auxProviderId = providerId;
      }
    }

    // Per the BACKLOG #12.A build refinement: each profile can declare a
    // `defaultAuxiliaryModel` so the cheap-aux default isn't hardcoded to
    // Claude Haiku here. We resolve via the auxiliary profile (falls back
    // to the main profile when aux === main, which is the common case).
    const auxProfile = getProvider(auxProviderId) ?? profile;
    const auxModel =
      opts.auxiliaryModelId ?? auxProfile.defaultAuxiliaryModel ?? auxProfile.defaultModel;

    sessionCounter += 1;
    const id = opts.sessionId ?? `direct-api-${sessionCounter}`;
    return new DirectApiSession(
      id,
      resolved.key,
      opts.modelId ?? profile.defaultModel,
      auxModel,
      (opts.initialMessages ?? []) as ModelMessage[],
      opts.initialMemory ?? "",
      opts.persister,
      providerId,
      auxProviderId,
      auxApiKey,
    );
  },
};

export { DirectApiSession as _DirectApiSessionForTests };
