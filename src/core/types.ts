export type BackendKind = "agent-cli" | "direct-api";

export interface SendOptions {
  signal?: AbortSignal;
}

export interface MessagePersister {
  append(seq: number, message: unknown): Promise<void>;
  replace(messages: unknown[]): Promise<void>;
  touch(): Promise<void>;
}

export interface SessionOptions {
  systemPrompt?: string;
  signal?: AbortSignal;
  providerId?: string;
  modelId?: string;
  auxiliaryProviderId?: string;
  auxiliaryModelId?: string;
  sessionId?: string;
  initialMessages?: unknown[];
  initialMemory?: string;
  persister?: MessagePersister;
  /** Working directory for agent-cli backends (Codex). */
  cwd?: string;
}

export interface CompactionMetrics {
  before: number;
  after: number;
  tokensSaved: number;
}

export type CompactResult = CompactionMetrics | { error: string };

export type RuntimeErrorKind =
  | "invalid-key"
  | "rate-limited"
  | "network"
  | "model-deprecated"
  | "unknown";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: unknown; isError?: boolean }
  | { type: "approval_request"; id: string; action: string; payload: unknown }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
    }
  | {
      // Emitted after each turn's usage event so the StatusBar can render a
      // live context-% indicator without re-running the token estimator in
      // the UI layer. tokensUsed includes the system prompt + all messages
      // (current best estimate); limit is CONTEXT_LIMIT_TOKENS.
      type: "context_usage";
      tokensUsed: number;
      limit: number;
      percent: number;
    }
  | { type: "error"; error: Error; kind?: RuntimeErrorKind }
  | { type: "done"; reason: "complete" | "interrupted" | "error" | "max_turns" }
  | { type: "system_message"; text: string; intent?: "info" | "error" };

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  turns: number;
  contextTokens: number;
  contextLimit: number;
  contextPercent: number;
}

export interface LastCompactionSnapshot {
  before: number;
  after: number;
  tokensSaved: number;
  at: number;
}

export interface Session {
  readonly id: string;
  sendMessage(text: string, opts?: SendOptions): Promise<void>;
  events: AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  respondToApproval(id: string, allowed: boolean): Promise<void>;
  compact(focus?: string): Promise<CompactResult>;
  /** Optional; not all adapters track per-session usage (echo doesn't). */
  getUsageSnapshot?(): UsageSnapshot;
  /** Optional; returns null when no compaction has happened in this session. */
  getLastCompaction?(): LastCompactionSnapshot | null;
}

export interface BackendAdapter {
  readonly id: string;
  readonly kind: BackendKind;
  readonly label: string;
  start(opts: SessionOptions): Promise<Session>;
}
