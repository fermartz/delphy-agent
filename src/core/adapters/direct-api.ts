import { invoke } from "@tauri-apps/api/core";
import { type ModelMessage, streamText } from "ai";
import { AuxiliaryClient } from "../llm/auxiliary";
import { buildSystemPrompt, defaultSystemPromptSlices } from "../prompts/three-tier";
import { getProvider } from "../providers";
import { getRuntimeKey } from "../providers/anthropic-runtime-key";
import { compactMessages, DEFAULT_COMPACTOR_CONFIG } from "../session/compactor";
import type {
  AgentEvent,
  BackendAdapter,
  CompactResult,
  RuntimeErrorKind,
  SendOptions,
  Session,
  SessionOptions,
} from "../types";

const PROVIDER_ID = "anthropic";

// Char-based estimator per memory/decisions.md 2026-05-25 "Token estimation"
const CHARS_PER_TOKEN_ANTHROPIC = 3.5;
const CONTEXT_LIMIT_TOKENS = 200_000;
const CONTEXT_WARN_THRESHOLD = 0.75;

// Auto-compaction trigger (B.2 of v1 direct-API). Compaction fires before the
// next chat turn when estimated usage crosses AUTO_COMPACT_THRESHOLD of the
// context window. Anti-thrashing skips the trigger if the most-recent
// compaction saved less than ANTI_THRASHING_MIN_SAVED_RATIO of tokens —
// otherwise repeated triggers would churn without condensing.
const AUTO_COMPACT_THRESHOLD = 0.85;
const ANTI_THRASHING_MIN_SAVED_RATIO = 0.1;

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
        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          total += estimateTokens(part.text);
        }
      }
    }
  }
  return total;
}

export type BootErrorKind = "missing-key" | "secure-storage-unavailable" | "unknown";

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
    const runtime = getRuntimeKey();
    if (runtime && runtime.length > 0) {
      return { key: runtime };
    }
    return {
      error: new BootError(
        "missing-key",
        "No Anthropic API key found in keychain or runtime memory.",
      ),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("SECURE_STORAGE_UNAVAILABLE:")) {
      const runtime = getRuntimeKey();
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

class DirectApiSession implements Session {
  readonly id: string;

  private readonly eventBuffer: AgentEvent[] = [];
  private resolveNextEvent: (() => void) | null = null;
  private eventsClosed = false;

  private messages: ModelMessage[] = [];
  private readonly systemPrompt: string;

  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly auxiliaryModelId: string;

  private currentAbort: AbortController | null = null;

  // Fraction of total tokens saved by the most recent compaction (manual or
  // auto). Drives the anti-thrashing skip on the next auto-trigger. `null`
  // means "no compaction has run yet"; treated as "always allow first trigger."
  private lastCompactionSavedRatio: number | null = null;

  // Re-entry guard for the rare case where a second trigger fires while a
  // first is still running. Defensive; shouldn't happen under
  // single-stream-at-a-time, but cheap insurance.
  private compactionInFlight = false;

  constructor(id: string, apiKey: string, modelId: string, auxiliaryModelId: string) {
    this.id = id;
    this.apiKey = apiKey;
    this.modelId = modelId;
    this.auxiliaryModelId = auxiliaryModelId;
    this.systemPrompt = buildSystemPrompt(defaultSystemPromptSlices());
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

    this.messages.push({ role: "user", content: text });

    const tokensUsed = estimateTokens(this.systemPrompt) + estimateMessageTokens(this.messages);
    if (tokensUsed > CONTEXT_LIMIT_TOKENS * CONTEXT_WARN_THRESHOLD) {
      this.emitEvent({
        type: "text",
        delta:
          `[delphy:context-warning] Context is near the model limit (${tokensUsed.toLocaleString()} / ${CONTEXT_LIMIT_TOKENS.toLocaleString()} tokens estimated). ` +
          `Auto-compaction will fire at ${Math.round(AUTO_COMPACT_THRESHOLD * 100)}% of the limit. Type /compact to compact now.\n\n`,
      });
    }

    const profile = getProvider(PROVIDER_ID);
    if (!profile) {
      this.emitEvent({
        type: "error",
        error: new Error("Anthropic provider not found in registry"),
        kind: "unknown",
      });
      this.emitEvent({ type: "done", reason: "error" });
      return;
    }

    // Hoist the AbortController creation so auto-compaction can route its
    // auxiliary call through the same `signal` that `streamText` will use.
    // `interrupt()` cancels both with one `abort()`.
    this.currentAbort = new AbortController();

    // Auto-compaction trigger (B.2). Conditions:
    //   - usage over threshold
    //   - last compaction (if any) saved at least the anti-thrashing minimum
    //   - no in-flight compaction (defensive)
    // Failures are swallowed inside runAutoCompaction — the chat turn proceeds
    // with un-compacted messages and a `system_message` surfaces the error.
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
    let assistantText = "";

    try {
      const model = profile.model(this.apiKey, this.modelId);
      const result = streamText({
        model,
        // System prompt is sent as a structured SystemModelMessage so we can
        // attach Anthropic's cache_control hint to the system block itself.
        // Putting cacheControl in the top-level streamText providerOptions sends
        // it as a top-level body field, which Anthropic silently ignores.
        system: [
          {
            role: "system",
            content: this.systemPrompt,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
        ],
        messages: this.messages,
        headers: profile.headers?.(),
        abortSignal: this.currentAbort.signal,
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          assistantText += part.text;
          this.emitEvent({ type: "text", delta: part.text });
        } else if (part.type === "error") {
          const err = part.error;
          this.emitEvent({
            type: "error",
            error: err instanceof Error ? err : new Error(String(err)),
            kind: inferRuntimeErrorKind(err),
          });
          this.emitEvent({ type: "done", reason: "error" });
          return;
        } else if (part.type === "abort") {
          this.emitEvent({ type: "done", reason: "interrupted" });
          return;
        }
      }

      if (assistantText.length > 0) {
        this.messages.push({ role: "assistant", content: assistantText });
      }

      const usage = await result.usage;
      this.emitEvent({
        type: "usage",
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      });
      this.emitEvent({ type: "done", reason: "complete" });
    } catch (err) {
      this.emitEvent({
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        kind: inferRuntimeErrorKind(err),
      });
      this.emitEvent({ type: "done", reason: "error" });
    } finally {
      this.currentAbort = null;
    }
  }

  async interrupt(): Promise<void> {
    this.currentAbort?.abort();
  }

  async close(): Promise<void> {
    this.currentAbort?.abort();
    this.eventsClosed = true;
    this.resolveNextEvent?.();
    this.resolveNextEvent = null;
  }

  async respondToApproval(_id: string, _allowed: boolean): Promise<void> {
    // No tool surface in v1 — MCP lands in BACKLOG #6. Method exists to satisfy Session contract.
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
        apiKey: this.apiKey,
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
      this.lastCompactionSavedRatio = clampRatio(
        result.metrics.estimatedTokensSaved / Math.max(1, preTotalTokens),
      );
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
        apiKey: this.apiKey,
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
      this.lastCompactionSavedRatio = clampRatio(
        result.metrics.estimatedTokensSaved / Math.max(1, preTotalTokens),
      );
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
  id: "anthropic-api",
  kind: "direct-api",
  label: "Anthropic (Claude)",

  async start(opts: SessionOptions): Promise<Session> {
    const profile = getProvider(PROVIDER_ID);
    if (!profile) {
      throw new BootError("unknown", `Provider "${PROVIDER_ID}" not registered`);
    }
    const resolved = await resolveApiKey(profile.secretKey);
    if ("error" in resolved) {
      throw resolved.error;
    }
    sessionCounter += 1;
    return new DirectApiSession(
      `direct-api-${sessionCounter}`,
      resolved.key,
      opts.modelId ?? profile.defaultModel,
      opts.auxiliaryModelId ?? "claude-haiku-4-5",
    );
  },
};
