export type BackendKind = "agent-cli" | "direct-api";

export interface SendOptions {
  signal?: AbortSignal;
}

export interface SessionOptions {
  systemPrompt?: string;
  signal?: AbortSignal;
  modelId?: string;
  auxiliaryModelId?: string;
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
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: Error; kind?: RuntimeErrorKind }
  | { type: "done"; reason: "complete" | "interrupted" | "error" | "max_turns" }
  | { type: "system_message"; text: string; intent?: "info" | "error" };

export interface Session {
  readonly id: string;
  sendMessage(text: string, opts?: SendOptions): Promise<void>;
  events: AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  respondToApproval(id: string, allowed: boolean): Promise<void>;
  compact(focus?: string): Promise<CompactResult>;
}

export interface BackendAdapter {
  readonly id: string;
  readonly kind: BackendKind;
  readonly label: string;
  start(opts: SessionOptions): Promise<Session>;
}
