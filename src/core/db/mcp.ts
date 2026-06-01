import type { McpServerConfig } from "../mcp/types";
import { getDb } from "./init";

export interface McpServerRow {
  id: string;
  name: string;
  enabled: number;
  transport: string;
  config: string;
}

function rowToConfig(row: McpServerRow): McpServerConfig {
  const extra = JSON.parse(row.config) as Partial<McpServerConfig>;
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled !== 0,
    transport: row.transport as McpServerConfig["transport"],
    ...extra,
  };
}

function configToRow(config: McpServerConfig): McpServerRow {
  const { id, name, enabled, transport, ...rest } = config;
  return {
    id,
    name,
    enabled: enabled ? 1 : 0,
    transport,
    config: JSON.stringify(rest),
  };
}

export async function listMcpConfigsFromDb(): Promise<McpServerConfig[]> {
  const db = await getDb();
  const rows = await db.select<McpServerRow>(
    `SELECT id, name, enabled, transport, config FROM mcp_servers ORDER BY id ASC`,
  );
  return rows.map(rowToConfig);
}

export async function countMcpConfigs(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }>(`SELECT COUNT(*) as n FROM mcp_servers`);
  return rows[0]?.n ?? 0;
}

export async function replaceMcpConfigs(configs: McpServerConfig[]): Promise<void> {
  const db = await getDb();
  await db.execute(`BEGIN`);
  try {
    await db.execute(`DELETE FROM mcp_servers`);
    for (const config of configs) {
      const row = configToRow(config);
      await db.execute(
        `INSERT INTO mcp_servers (id, name, enabled, transport, config) VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.name, row.enabled, row.transport, row.config],
      );
    }
    await db.execute(`COMMIT`);
  } catch (err) {
    await db.execute(`ROLLBACK`);
    throw err;
  }
}

export async function seedMcpConfigs(configs: McpServerConfig[]): Promise<void> {
  const existing = await countMcpConfigs();
  if (existing > 0) return;
  await replaceMcpConfigs(configs);
}
