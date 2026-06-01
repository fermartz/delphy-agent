import type { DbConnection } from "./init";

interface Row {
  [key: string]: unknown;
}

interface TableSpec {
  name: string;
  pk: string;
  uniques?: string[][];
  fks?: Array<{ column: string; refTable: string; onDelete?: "cascade" }>;
}

/**
 * Minimal in-memory SQL stub for unit tests. Recognizes the exact statement
 * shapes used by the db/ wrappers. Does NOT implement general SQL — failing
 * an unknown query is intentional so tests can catch wrapper drift.
 */
export class MockDb implements DbConnection {
  private tables = new Map<string, Row[]>();
  private specs = new Map<string, TableSpec>();
  private snapshot: Map<string, Row[]> | null = null;
  private failNextInsertCount: number | null = null;
  private insertSeen = 0;

  /**
   * Schedule a synthetic failure on the Nth INSERT statement (1-indexed).
   * Used in tests to verify transactional rollback behavior.
   */
  failOnNthInsert(n: number): void {
    this.failNextInsertCount = n;
    this.insertSeen = 0;
  }

  registerTable(spec: TableSpec): void {
    this.specs.set(spec.name, spec);
    if (!this.tables.has(spec.name)) {
      this.tables.set(spec.name, []);
    }
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  reset(): void {
    for (const [name] of this.tables) this.tables.set(name, []);
    this.snapshot = null;
  }

  private takeSnapshot(): void {
    this.snapshot = new Map();
    for (const [k, v] of this.tables) {
      this.snapshot.set(
        k,
        v.map((r) => ({ ...r })),
      );
    }
  }

  async execute(query: string, args: unknown[] = []): Promise<{ rowsAffected: number }> {
    const q = query.trim();

    if (/^BEGIN/i.test(q)) {
      this.takeSnapshot();
      return { rowsAffected: 0 };
    }
    if (/^COMMIT/i.test(q)) {
      this.snapshot = null;
      return { rowsAffected: 0 };
    }
    if (/^ROLLBACK/i.test(q)) {
      if (this.snapshot) this.tables = this.snapshot;
      this.snapshot = null;
      return { rowsAffected: 0 };
    }

    const insertMatch = q.match(/^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (insertMatch) {
      this.insertSeen += 1;
      if (this.failNextInsertCount !== null && this.insertSeen === this.failNextInsertCount) {
        this.failNextInsertCount = null;
        throw new Error(`mock: synthetic failure on INSERT #${this.insertSeen}`);
      }
      const table = insertMatch[1];
      const cols = insertMatch[2].split(",").map((c) => c.trim());
      const conflictMatch = q.match(/ON CONFLICT\(([^)]+)\) DO UPDATE SET ([^;]+)/i);
      const row: Row = {};
      for (let i = 0; i < cols.length; i++) row[cols[i]] = args[i] ?? null;

      const rows = this.tables.get(table);
      if (!rows) throw new Error(`mock: unknown table ${table}`);

      if (conflictMatch) {
        const conflictCol = conflictMatch[1].trim();
        const existing = rows.find((r) => r[conflictCol] === row[conflictCol]);
        if (existing) {
          const sets = conflictMatch[2].split(",").map((s) => s.trim());
          for (const set of sets) {
            const m = set.match(/(\w+)\s*=\s*excluded\.(\w+)/i);
            if (m) existing[m[1]] = row[m[2]];
          }
          return { rowsAffected: 1 };
        }
      }
      rows.push(row);
      return { rowsAffected: 1 };
    }

    const updateOneMatch = q.match(/^UPDATE (\w+) SET ([^W]+) WHERE (\w+) = \?/i);
    if (updateOneMatch) {
      const table = updateOneMatch[1];
      const setClauses = updateOneMatch[2].split(",").map((s) => s.trim());
      const whereCol = updateOneMatch[3];
      const rows = this.tables.get(table) ?? [];
      const whereVal = args[args.length - 1];
      let affected = 0;
      for (const r of rows) {
        if (r[whereCol] === whereVal) {
          let argIdx = 0;
          for (const sc of setClauses) {
            const m = sc.match(/(\w+)\s*=\s*\?/);
            if (m) {
              r[m[1]] = args[argIdx];
              argIdx += 1;
            }
          }
          affected += 1;
        }
      }
      return { rowsAffected: affected };
    }

    const deleteAllMatch = q.match(/^DELETE FROM (\w+)\s*$/i);
    if (deleteAllMatch) {
      const table = deleteAllMatch[1];
      this.tables.set(table, []);
      return { rowsAffected: 0 };
    }

    const deleteWhereMatch = q.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/i);
    if (deleteWhereMatch) {
      const table = deleteWhereMatch[1];
      const col = deleteWhereMatch[2];
      const val = args[0];
      const rows = this.tables.get(table) ?? [];
      const filtered = rows.filter((r) => r[col] !== val);
      const affected = rows.length - filtered.length;
      this.tables.set(table, filtered);
      return { rowsAffected: affected };
    }

    const deleteNotInMatch = q
      .replace(/\s+/g, " ")
      .match(/^DELETE FROM (\w+) WHERE (\w+) NOT IN \(SELECT DISTINCT (\w+) FROM (\w+)\)/i);
    if (deleteNotInMatch) {
      const table = deleteNotInMatch[1];
      const col = deleteNotInMatch[2];
      const refCol = deleteNotInMatch[3];
      const refTable = deleteNotInMatch[4];
      const refRows = this.tables.get(refTable) ?? [];
      const allowedSet = new Set(refRows.map((r) => r[refCol]));
      const rows = this.tables.get(table) ?? [];
      const filtered = rows.filter((r) => allowedSet.has(r[col]));
      const affected = rows.length - filtered.length;
      this.tables.set(table, filtered);
      return { rowsAffected: affected };
    }

    throw new Error(`mock: unsupported execute query: ${q}`);
  }

  async select<T>(query: string, args: unknown[] = []): Promise<T[]> {
    const q = query.trim().replace(/\s+/g, " ");

    const countMatch = q.match(/^SELECT COUNT\(\*\)\s+as\s+n FROM (\w+)/i);
    if (countMatch) {
      const rows = this.tables.get(countMatch[1]) ?? [];
      return [{ n: rows.length } as unknown as T];
    }

    const fromMatch = q.match(/FROM (\w+)/i);
    if (!fromMatch) throw new Error(`mock: select missing FROM: ${q}`);
    const table = fromMatch[1];
    let rows = [...(this.tables.get(table) ?? [])];

    const whereEqMatch = q.match(/WHERE (\w+) = \?/i);
    if (whereEqMatch) {
      const col = whereEqMatch[1];
      const val = args[0];
      rows = rows.filter((r) => r[col] === val);
    }

    const archivedFilter = /WHERE archived = 0/i.test(q);
    if (archivedFilter) {
      rows = rows.filter((r) => (r.archived ?? 0) === 0);
    }

    const orderMatch = q.match(/ORDER BY (\w+)\s+(ASC|DESC)/i);
    if (orderMatch) {
      const col = orderMatch[1];
      const dir = orderMatch[2].toUpperCase();
      rows.sort((a, b) => {
        const av = a[col] as number | string | null;
        const bv = b[col] as number | string | null;
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = av < bv ? -1 : 1;
        return dir === "ASC" ? cmp : -cmp;
      });
    }

    const limitMatch = q.match(/LIMIT (\d+)/i);
    if (limitMatch) {
      rows = rows.slice(0, parseInt(limitMatch[1], 10));
    }

    return rows as unknown as T[];
  }
}

export function createTestDb(): MockDb {
  const db = new MockDb();
  db.registerTable({ name: "sessions", pk: "id" });
  db.registerTable({ name: "messages", pk: "id" });
  db.registerTable({ name: "memory", pk: "id" });
  db.registerTable({ name: "mcp_servers", pk: "id" });
  return db;
}
