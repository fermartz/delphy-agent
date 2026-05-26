import type { ModelMessage } from "ai";
import type { AuxiliaryClient } from "../llm/auxiliary";

const CHARS_PER_TOKEN = 3.5;

export const SUMMARY_SENTINEL_PREFIX =
  "[Earlier conversation summary, generated for token economy]";

export interface CompactorConfig {
  headSize: number;
  tailTokenBudget: number;
  minMiddleMessages: number;
  summarySentinelPrefix: string;
}

export const DEFAULT_COMPACTOR_CONFIG: CompactorConfig = {
  headSize: 4,
  tailTokenBudget: 8000,
  minMiddleMessages: 2,
  summarySentinelPrefix: SUMMARY_SENTINEL_PREFIX,
};

export interface CompactionMetrics {
  before: number;
  after: number;
  estimatedTokensSaved: number;
}

export interface CompactionResult {
  unchanged: boolean;
  compactedMessages: ModelMessage[];
  summary: string;
  metrics: CompactionMetrics;
}

function singleMessageTokens(m: ModelMessage): number {
  return Math.ceil(messageContentText(m).length / CHARS_PER_TOKEN);
}

function totalMessageTokens(messages: ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + singleMessageTokens(m), 0);
}

function messageContentText(m: ModelMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) =>
        typeof p === "object" && p !== null && "text" in p && typeof p.text === "string"
          ? p.text
          : "",
      )
      .join("");
  }
  return "";
}

// Walk messages from the end backward, accumulating per-message token estimates
// (chars/3.5 — same estimator pattern as direct-api.ts). Return the index where
// `tail` starts: messages.slice(returned) is the tail under the token budget.
//
// Guarantees:
//   - Never returns lower than `headBoundary` (head + tail never overlap).
//   - Always preserves at least the newest message in tail — even if that
//     single message exceeds the budget — per docs/SPEC.md's "the most recent
//     tail is preserved verbatim" contract. Without this guarantee, an
//     oversized newest message would get summarized away on the next
//     `/compact`, which silently drops the very last user turn.
function findTailStartByTokenBudget(
  messages: ModelMessage[],
  budget: number,
  headBoundary: number,
): number {
  if (messages.length <= headBoundary) return headBoundary;

  // Start with the newest message guaranteed in tail, even if it alone exceeds
  // budget. This is the contract the function promises callers.
  let tailStartIdx = messages.length - 1;
  let runningTotal = singleMessageTokens(messages[tailStartIdx]);

  // Walk backward from second-newest, accumulating until budget is hit.
  for (let i = messages.length - 2; i >= headBoundary; i--) {
    const t = singleMessageTokens(messages[i]);
    if (runningTotal + t > budget) {
      // Including messages[i] would push over budget. tail starts at i+1.
      return i + 1;
    }
    runningTotal += t;
    tailStartIdx = i;
  }
  return tailStartIdx;
}

const SUMMARIZER_SYSTEM_PROMPT =
  "You compress a conversation history into a faithful summary. Keep concrete details (names, decisions, code references, tool outputs). Strip filler. Write in past tense, third-person. Keep it under 400 words unless the conversation is genuinely longer than that.";

export async function compactMessages({
  messages,
  config,
  aux,
  focus,
  signal,
}: {
  messages: ModelMessage[];
  config: CompactorConfig;
  aux: AuxiliaryClient;
  focus?: string;
  signal?: AbortSignal;
}): Promise<CompactionResult> {
  const unchanged = (): CompactionResult => ({
    unchanged: true,
    compactedMessages: messages,
    summary: "",
    metrics: { before: messages.length, after: messages.length, estimatedTokensSaved: 0 },
  });

  // 1. Below the bare minimum to bother compacting.
  if (messages.length < config.headSize + config.minMiddleMessages + 1) {
    return unchanged();
  }

  // 2. Token-aware tail walk-backward.
  const head = messages.slice(0, config.headSize);
  const tailStartIdx = findTailStartByTokenBudget(
    messages,
    config.tailTokenBudget,
    config.headSize,
  );
  if (tailStartIdx <= config.headSize) {
    return unchanged();
  }
  const middle = messages.slice(config.headSize, tailStartIdx);
  const tail = messages.slice(tailStartIdx);

  if (middle.length < config.minMiddleMessages) {
    return unchanged();
  }

  // 3. Detect a prior summary at middle[0] (the position it would land in after
  // a prior compaction). If found, fold its content into the new summarization
  // call instead of stacking a second summary on top.
  let priorSummary = "";
  let middleToSummarize = middle;
  const firstMiddleText = messageContentText(middle[0]);
  if (firstMiddleText.startsWith(config.summarySentinelPrefix)) {
    priorSummary = firstMiddleText;
    middleToSummarize = middle.slice(1);
  }

  // 4. Build summarization prompt.
  let userPrompt = "";
  if (priorSummary) {
    userPrompt += `Previous summary of earlier turns:\n${priorSummary}\n\n`;
  }
  userPrompt += "Conversation to summarize:\n\n";
  for (const m of middleToSummarize) {
    userPrompt += `${m.role.toUpperCase()}: ${messageContentText(m)}\n\n`;
  }
  if (focus) {
    userPrompt += `\nFocus the summary on: ${focus}`;
  }

  // 5. Call auxiliary. Errors propagate to caller (no fallback in B.1).
  const summary = await aux.complete(userPrompt, {
    systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
    signal,
  });

  // 6. Wrap as a single assistant message with the sentinel prefix.
  const summaryMessage: ModelMessage = {
    role: "assistant",
    content: `${config.summarySentinelPrefix}\n\n${summary}`,
  };

  // 7. Return the new shape + metrics.
  const middleTokens = totalMessageTokens(middle);
  const summaryTokens = singleMessageTokens(summaryMessage);
  return {
    unchanged: false,
    compactedMessages: [...head, summaryMessage, ...tail],
    summary,
    metrics: {
      before: messages.length,
      after: head.length + 1 + tail.length,
      estimatedTokensSaved: Math.max(0, middleTokens - summaryTokens),
    },
  };
}
