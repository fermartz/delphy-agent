import { getDb } from "./init";

export const GLOBAL_MEMORY_ID = "global";
export const MEMORY_MAX_CHARS = 3000;

export interface MemoryRow {
  id: string;
  content: string;
  updated_at: number;
}

export async function loadMemory(id: string = GLOBAL_MEMORY_ID): Promise<string> {
  const db = await getDb();
  const rows = await db.select<MemoryRow>(
    `SELECT id, content, updated_at FROM memory WHERE id = ?`,
    [id],
  );
  return rows[0]?.content ?? "";
}

export async function saveMemory(
  content: string,
  id: string = GLOBAL_MEMORY_ID,
): Promise<{ saved: string; truncated: boolean }> {
  const truncated = content.length > MEMORY_MAX_CHARS;
  const finalContent = truncated ? content.slice(0, MEMORY_MAX_CHARS) : content;
  const db = await getDb();
  await db.execute(
    `INSERT INTO memory (id, content, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    [id, finalContent, Date.now()],
  );
  return { saved: finalContent, truncated };
}
