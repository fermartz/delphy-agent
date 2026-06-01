import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:delphy.db";

export interface DbConnection {
  execute(
    query: string,
    bindValues?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

let connection: DbConnection | null = null;
let loadPromise: Promise<DbConnection> | null = null;

export function setDbForTests(db: DbConnection | null): void {
  connection = db;
  loadPromise = null;
}

export async function getDb(): Promise<DbConnection> {
  if (connection) return connection;
  if (!loadPromise) {
    loadPromise = Database.load(DB_URL).then((db) => {
      connection = db as unknown as DbConnection;
      return connection;
    });
  }
  return loadPromise;
}
