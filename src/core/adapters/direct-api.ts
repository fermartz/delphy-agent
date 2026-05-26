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
          "Type /compact to summarize older turns and free token budget. Automatic compaction lands in a future slice.\n\n",
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

    this.currentAbort = new AbortController();
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

  async compact(focus?: string): Promise<CompactResult> {
    try {
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
