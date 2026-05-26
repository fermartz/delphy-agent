import type { ParsedInput } from "./types";

// Only a leading `/` followed by one-or-more name characters (alphanumeric,
// `-`, `_`) counts as a command. Everything else falls through to message —
// `//`, `/ `, `///`, and `do not /help mid-line` all parse as message.
const COMMAND_PATTERN = /^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/;

export function parseInput(rawText: string): ParsedInput {
  const candidate = rawText.trimStart();
  const match = candidate.match(COMMAND_PATTERN);
  if (match) {
    return {
      kind: "command",
      name: match[1],
      args: (match[2] ?? "").trim(),
    };
  }
  // Message text is returned verbatim — downstream (App.tsx::handleSubmit)
  // already trims before sending to the LLM. Returning verbatim preserves the
  // plan's pinned-contract behavior for edge cases like `"/ "` → text: `"/ "`.
  return { kind: "message", text: rawText };
}
