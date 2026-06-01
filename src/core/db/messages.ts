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
 * Replace the entire message log for a session. Used after compaction.
 * Runs inside a single SQL transaction so a partial failure cannot leave
 * the session in a half-compacted state.
 */
export async function replaceMessages(sessionId: string, messages: ModelMessage[]): Promise<void> {
  const db = await getDb();
  await db.execute(`BEGIN`);
  try {
    await db.execute(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
    for (let i = 0; i < messages.length; i++) {
      const { role, content } = serializeMessage(messages[i]);
      await db.execute(
        `INSERT INTO messages (id, session_id, seq, role, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nextMessageId(), sessionId, i, role, content, Date.now()],
      );
    }
    await db.execute(`COMMIT`);
  } catch (err) {
    await db.execute(`ROLLBACK`);
    throw err;
  }
}
