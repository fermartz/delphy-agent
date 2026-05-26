export type BackendKind = "agent-cli" | "direct-api";

export interface SendOptions {
  signal?: AbortSignal;
}

export interface SessionOptions {
  systemPrompt?: string;
  signal?: AbortSignal;
  modelId?: string;
}

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
  | { type: "done"; reason: "complete" | "interrupted" | "error" | "max_turns" };

export interface Session {
  readonly id: string;
  sendMessage(text: string, opts?: SendOptions): Promise<void>;
  events: AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  respondToApproval(id: string, allowed: boolean): Promise<void>;
}

export interface BackendAdapter {
  readonly id: string;
  readonly kind: BackendKind;
  readonly label: string;
  start(opts: SessionOptions): Promise<Session>;
}
