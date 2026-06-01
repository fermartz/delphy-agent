import type { ModelMessage } from "ai";
import type { RuntimeErrorKind } from "./types";

export type ChatItem =
  | { kind: "user-text"; id: string; text: string }
  | {
      kind: "assistant-text";
      id: string;
      text: string;
      status: "streaming" | "complete" | "error";
    }
  | {
      kind: "approval";
      id: string;
      action: string;
      payload: unknown;
      verdict?: "allowed" | "denied";
    }
  | { kind: "tool-call"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; id: string; name: string; output: unknown; isError?: boolean }
  | { kind: "runtime-error"; id: string; errorKind: RuntimeErrorKind; message: string }
  | { kind: "system"; id: string; text: string; intent?: "info" | "error" };

let projCounter = 0;
function nextProjId(prefix: string): string {
  projCounter += 1;
  return `${prefix}-${projCounter}`;
}

/**
 * Reconstruct a UI ChatItem[] from a stored ModelMessage[]. Mirrors the live
 * event loop's projection: user → user-text, assistant content → assistant-text
 * + tool-call items, tool role → tool-result items. Approval cards, system
 * banners, and runtime errors are intentionally NOT recovered — they are
 * ephemeral UI-only state per the persistence plan.
 */
export function projectMessagesToChatItems(messages: ModelMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  const toolNameById = new Map<string, string>();

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = stringifyUserContent(msg.content);
      if (text.length > 0) {
        items.push({ kind: "user-text", id: nextProjId("rs-u"), text });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const blocks = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text", text: String(msg.content) }];
      let textBuf = "";
      for (const part of blocks) {
        if (!part || typeof part !== "object") continue;
        if (
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          textBuf += (part as { text: string }).text;
          continue;
        }
        if ((part as { type?: string }).type === "tool-call") {
          if (textBuf.length > 0) {
            items.push({
              kind: "assistant-text",
              id: nextProjId("rs-a"),
              text: textBuf,
              status: "complete",
            });
            textBuf = "";
          }
          const tc = part as { toolCallId: string; toolName: string; input?: unknown };
          toolNameById.set(tc.toolCallId, tc.toolName);
          items.push({
            kind: "tool-call",
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.input,
          });
        }
      }
      if (textBuf.length > 0) {
        items.push({
          kind: "assistant-text",
          id: nextProjId("rs-a"),
          text: textBuf,
          status: "complete",
        });
      }
      continue;
    }

    if (msg.role === "tool") {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      for (const part of blocks) {
        if (!part || typeof part !== "object") continue;
        const pp = part as {
          type?: string;
          toolCallId?: string;
          toolName?: string;
          output?: unknown;
        };
        if (pp.type !== "tool-result" || !pp.toolCallId) continue;
        const name = pp.toolName ?? toolNameById.get(pp.toolCallId) ?? "tool";
        const isError =
          typeof pp.output === "object" &&
          pp.output !== null &&
          "isError" in (pp.output as Record<string, unknown>) &&
          Boolean((pp.output as { isError?: unknown }).isError);
        const resultItem: ChatItem = {
          kind: "tool-result",
          id: pp.toolCallId,
          name,
          output: pp.output,
          isError,
        };
        const callIdx = items.findIndex((it) => it.kind === "tool-call" && it.id === pp.toolCallId);
        if (callIdx !== -1) {
          items[callIdx] = resultItem;
        } else {
          items.push(resultItem);
        }
      }
    }
  }

  return items;
}

function stringifyUserContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let buf = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const text = (part as { text?: unknown }).text;
    if (typeof text === "string") buf += text;
  }
  return buf;
}
