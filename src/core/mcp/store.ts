import { load, type Store } from "@tauri-apps/plugin-store";
import { z } from "zod";
import {
  countMcpConfigs,
  listMcpConfigsFromDb,
  replaceMcpConfigs,
  seedMcpConfigs,
} from "../db/mcp";
import { validateProxiedEgressUrl } from "../net/validate-egress-url";
import type { McpServerConfig } from "./types";

const LEGACY_STORE_FILE = "settings.json";
const LEGACY_STORE_KEY = "mcp_servers";
const LEGACY_MIGRATED_FLAG = "_mcp_migrated";

const MCP_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const LITERAL_KEY_PATTERN = /^(sk-ant-|sk-)[A-Za-z0-9]/;

/**
 * Validate a remote (http/sse) server URL. Returns an error message, or null if
 * acceptable: https everywhere, plain http only for loopback hosts, no embedded
 * credentials. Shared by the Settings form (`validateMcpConfig`) AND the
 * boot/transport path (`McpManager.bootOne`) so a persisted/migrated config
 * can't smuggle a bad URL past the form into the transport.
 *
 * A user-configured MCP URL uses the permissive host policy (D1 = broad + a UI
 * warning): local/LAN servers are legitimate, so private hosts are allowed —
 * unlike untrusted-content egress (image loads), which blocks them. See
 * `validateProxiedEgressUrl`.
 */
export function remoteUrlError(rawUrl: string | undefined): string | null {
  return validateProxiedEgressUrl(rawUrl, {
    requireHttpsExceptLoopback: true,
    allowPrivateHosts: true,
  });
}

const McpServerConfigSchema = z.object({
  id: z.string().regex(MCP_ID_PATTERN),
  name: z.string().min(1),
  enabled: z.boolean(),
  transport: z.enum(["stdio", "http", "sse"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  scopes: z.array(z.string()).optional(),
});

const McpServerConfigArraySchema = z.array(McpServerConfigSchema);

const DEFAULT_CONFIGS: McpServerConfig[] = [
  {
    id: "fetch",
    name: "Fetch",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-fetch-server"],
  },
];

let legacyStorePromise: Promise<Store> | null = null;
let migrationAttempted = false;

function getLegacyStore(): Promise<Store> {
  if (!legacyStorePromise) {
    legacyStorePromise = load(LEGACY_STORE_FILE, { autoSave: false, defaults: {} });
  }
  return legacyStorePromise;
}

export function resetStoreForTests(): void {
  legacyStorePromise = null;
  migrationAttempted = false;
}

/**
 * One-time migration from the old tauri-plugin-store backing to SQLite.
 * Runs when the mcp_servers SQLite table is empty AND a legacy store file
 * has not yet been flagged as migrated. Subsequent boots short-circuit
 * via the in-memory `migrationAttempted` flag.
 */
async function migrateFromLegacyStoreIfNeeded(): Promise<void> {
  if (migrationAttempted) return;
  migrationAttempted = true;

  try {
    const dbCount = await countMcpConfigs();
    if (dbCount > 0) return;
  } catch {
    // SQLite unavailable — treat as no-op; subsequent loads will still try.
    migrationAttempted = false;
    return;
  }

  let store: Store;
  try {
    store = await getLegacyStore();
  } catch {
    return;
  }

  const alreadyMigrated = await store.get<boolean>(LEGACY_MIGRATED_FLAG);
  if (alreadyMigrated) return;

  const raw = await store.get<unknown>(LEGACY_STORE_KEY);
  if (raw === undefined || raw === null) return;

  const parsed = McpServerConfigArraySchema.safeParse(raw);
  if (!parsed.success) return;

  try {
    await replaceMcpConfigs(parsed.data);
    await store.set(LEGACY_MIGRATED_FLAG, true);
    await store.save();
  } catch (err) {
    console.warn("[mcp-store] migration to SQLite failed", err);
  }
}

export async function loadMcpConfigs(): Promise<McpServerConfig[]> {
  await migrateFromLegacyStoreIfNeeded();
  try {
    await seedMcpConfigs(DEFAULT_CONFIGS);
    return await listMcpConfigsFromDb();
  } catch (err) {
    console.warn("[mcp-store] SQLite load failed, returning defaults", err);
    return [...DEFAULT_CONFIGS];
  }
}

export async function saveMcpConfigs(configs: McpServerConfig[]): Promise<void> {
  await replaceMcpConfigs(configs);
}

export interface McpConfigValidationError {
  field: string;
  message: string;
}

export function validateMcpConfig(
  config: Partial<McpServerConfig>,
  existingIds: string[],
  editingId?: string,
): McpConfigValidationError[] {
  const errors: McpConfigValidationError[] = [];

  if (!config.id || !MCP_ID_PATTERN.test(config.id)) {
    errors.push({
      field: "id",
      message: "ID must be lowercase letters, numbers, and hyphens (start with a letter)",
    });
  } else if (existingIds.includes(config.id) && config.id !== editingId) {
    errors.push({ field: "id", message: "A server with this ID already exists" });
  }

  if (!config.name?.trim()) {
    errors.push({ field: "name", message: "Name is required" });
  }

  if (config.transport === "stdio" && !config.command?.trim()) {
    errors.push({ field: "command", message: "Command is required for stdio transport" });
  }

  if (config.transport === "http" || config.transport === "sse") {
    const urlErr = remoteUrlError(config.url);
    if (urlErr) {
      errors.push({ field: "url", message: urlErr });
    }
  }

  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      if (LITERAL_KEY_PATTERN.test(value)) {
        errors.push({
          field: `env.${key}`,
          message: `Inline API keys are not allowed. Use \${secret:${key.toLowerCase()}} instead`,
        });
      }
    }
  }

  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (LITERAL_KEY_PATTERN.test(value)) {
        errors.push({
          field: `headers.${key}`,
          message: `Inline API keys are not allowed. Use \${secret:${key.toLowerCase()}} instead`,
        });
      }
    }
  }

  return errors;
}

export { DEFAULT_CONFIGS, LITERAL_KEY_PATTERN, MCP_ID_PATTERN, McpServerConfigSchema };
