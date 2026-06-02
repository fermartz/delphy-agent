import { getDb } from "./init";

export interface SessionRow {
  id: string;
  backend_id: string;
  main_provider: string | null;
  main_model: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
  archived: number;
}

export interface SessionListEntry {
  id: string;
  backend_id: string;
  main_provider: string | null;
  main_model: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
}

export async function createSession(input: {
  id: string;
  backend_id: string;
  main_provider: string;
  main_model: string | null;
  title?: string | null;
}): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO sessions (id, backend_id, main_provider, main_model, title, created_at, updated_at, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      input.id,
      input.backend_id,
      input.main_provider,
      input.main_model,
      input.title ?? null,
      now,
      now,
    ],
  );
}

export async function touchSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE sessions SET updated_at = ? WHERE id = ?`, [Date.now(), id]);
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`, [
    title,
    Date.now(),
    id,
  ]);
}

export async function getMostRecentSession(): Promise<SessionRow | null> {
  const db = await getDb();
  const rows = await db.select<SessionRow>(
    `SELECT id, backend_id, main_provider, main_model, title, created_at, updated_at, archived
     FROM sessions
     WHERE archived = 0
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function listSessions(): Promise<SessionListEntry[]> {
  const db = await getDb();
  return db.select<SessionListEntry>(
    `SELECT id, backend_id, main_provider, main_model, title, created_at, updated_at
     FROM sessions
     WHERE archived = 0
     ORDER BY updated_at DESC`,
  );
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const db = await getDb();
  const rows = await db.select<SessionRow>(
    `SELECT id, backend_id, main_provider, main_model, title, created_at, updated_at, archived
     FROM sessions WHERE id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Delete session rows that have no messages. Idempotent + cheap; run at boot
 * to clean up rows orphaned by pre-lazy-creation duplicates (Strict Mode
 * double-mount, model changes followed by no message, etc.).
 */
export async function pruneEmptySessions(): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `DELETE FROM sessions
     WHERE id NOT IN (SELECT DISTINCT session_id FROM messages)`,
  );
  return result.rowsAffected ?? 0;
}
