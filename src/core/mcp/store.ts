import { load, type Store } from "@tauri-apps/plugin-store";
import { z } from "zod";
import type { McpServerConfig } from "./types";

const STORE_FILE = "settings.json";
const STORE_KEY = "mcp_servers";

const MCP_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const LITERAL_KEY_PATTERN = /^(sk-ant-|sk-)[A-Za-z0-9]/;

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
    id: "server-everything",
    name: "Everything (reference)",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
  },
];

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return storePromise;
}

export function resetStoreForTests(): void {
  storePromise = null;
}

export async function loadMcpConfigs(): Promise<McpServerConfig[]> {
  const store = await getStore();
  const raw = await store.get<unknown>(STORE_KEY);
  if (raw === undefined || raw === null) {
    await saveMcpConfigs(DEFAULT_CONFIGS);
    return [...DEFAULT_CONFIGS];
  }
  const result = McpServerConfigArraySchema.safeParse(raw);
  if (!result.success) {
    console.warn("mcp-store: invalid configs, resetting to defaults", result.error);
    await saveMcpConfigs(DEFAULT_CONFIGS);
    return [...DEFAULT_CONFIGS];
  }
  return result.data;
}

export async function saveMcpConfigs(configs: McpServerConfig[]): Promise<void> {
  const store = await getStore();
  await store.set(STORE_KEY, configs);
  await store.save();
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
    if (!config.url?.trim()) {
      errors.push({ field: "url", message: "URL is required for HTTP/SSE transport" });
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
