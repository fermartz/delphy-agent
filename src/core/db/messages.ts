import { invoke } from "@tauri-apps/api/core";
import type { ModelMessage } from "ai";
import { getDb } from "./init";

export interface MessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: string;
  content: string;
  created_at: number;
}

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `m-${Date.now()}-${messageCounter}`;
}

/**
 * Serialize a ModelMessage to a JSON string. Content blocks (text, tool_call,
 * tool_result, thinking, tool-approval-response) round-trip through JSON
 * because they are already plain objects per the AI SDK contract.
 */
export function serializeMessage(message: ModelMessage): { role: string; content: string } {
  return {
    role: message.role,
    content: JSON.stringify(message.content),
  };
}

export function deserializeMessage(row: { role: string; content: string }): ModelMessage {
  return {
    role: row.role,
    content: JSON.parse(row.content),
  } as ModelMessage;
}

export async function appendMessage(
  sessionId: string,
  seq: number,
  message: ModelMessage,
): Promise<void> {
  const db = await getDb();
  const { role, content } = serializeMessage(message);
  await db.execute(
    `INSERT INTO messages (id, session_id, seq, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nextMessageId(), sessionId, seq, role, content, Date.now()],
  );
}

export async function loadMessages(sessionId: string): Promise<ModelMessage[]> {
  const db = await getDb();
  const rows = await db.select<{ role: string; content: string }>(
    `SELECT role, content FROM messages
     WHERE session_id = ?
     ORDER BY seq ASC`,
    [sessionId],
  );
  return rows.map(deserializeMessage);
}

/**
 * Replace the entire message log for a session (used after compaction), as a
 * single ATOMIC operation.
 *
 * This runs in Rust (`replace_session_messages` → `src-tauri/src/db_tx.rs`),
 * inside one sqlx transaction on a single connection. A JS-side
 * `BEGIN`/`COMMIT` is NOT a real transaction: `tauri-plugin-sql` runs each
 * `execute()` on a pooled connection, so a mid-loop `INSERT` failure after the
 * `DELETE` would wipe the session's history (BACKLOG #15). Ids and timestamps
 * are generated here so the Rust command is a pure atomic writer.
 */
export async function replaceMessages(sessionId: string, messages: ModelMessage[]): Promise<void> {
  // Ensure the plugin's sqlite pool is loaded before the Rust command reaches
  // for it (normal path; the command also errors clearly if it isn't).
  await getDb();
  const now = Date.now();
  const rows = messages.map((message, i) => {
    const { role, content } = serializeMessage(message);
    return { id: nextMessageId(), seq: i, role, content, created_at: now };
  });
  await invoke("replace_session_messages", { sessionId, messages: rows });
}
