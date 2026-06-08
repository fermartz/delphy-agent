import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type MockDb } from "../db/db-mock";
import { setDbForTests } from "../db/init";

let mockLegacyStoreData: Record<string, unknown> = {};
const saveMock = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((key: string) => Promise.resolve(mockLegacyStoreData[key])),
      set: vi.fn((key: string, value: unknown) => {
        mockLegacyStoreData[key] = value;
        return Promise.resolve();
      }),
      save: saveMock,
    }),
  ),
}));

import {
  DEFAULT_CONFIGS,
  loadMcpConfigs,
  resetStoreForTests,
  saveMcpConfigs,
  validateMcpConfig,
} from "./store";

let db: MockDb;

beforeEach(() => {
  mockLegacyStoreData = {};
  saveMock.mockReset();
  resetStoreForTests();
  db = createTestDb();
  setDbForTests(db);
});

afterEach(() => {
  setDbForTests(null);
});

describe("loadMcpConfigs", () => {
  it("seeds defaults when SQLite is empty and no legacy store exists", async () => {
    const configs = await loadMcpConfigs();
    expect(configs).toEqual(DEFAULT_CONFIGS);
  });

  it("returns persisted SQLite configs without re-seeding", async () => {
    const custom = [
      {
        id: "my-server",
        name: "My Server",
        enabled: true,
        transport: "stdio" as const,
        command: "node",
        args: ["server.js"],
      },
    ];
    await saveMcpConfigs(custom);
    resetStoreForTests();
    const configs = await loadMcpConfigs();
    expect(configs).toEqual(custom);
  });

  it("preserves non-stdio configs through round-trip", async () => {
    const mixed = [
      {
        id: "stdio-one",
        name: "Stdio",
        enabled: true,
        transport: "stdio" as const,
        command: "echo",
      },
      {
        id: "http-one",
        name: "HTTP",
        enabled: true,
        transport: "http" as const,
        url: "https://example.com",
      },
    ];
    await saveMcpConfigs(mixed);
    resetStoreForTests();
    const configs = await loadMcpConfigs();
    expect(configs).toHaveLength(2);
    expect(configs.find((c) => c.id === "http-one")?.transport).toBe("http");
    expect(configs.find((c) => c.id === "http-one")?.url).toBe("https://example.com");
  });

  it("migrates from legacy tauri-plugin-store on first load when SQLite is empty", async () => {
    mockLegacyStoreData.mcp_servers = [
      {
        id: "legacy",
        name: "Legacy",
        enabled: true,
        transport: "stdio",
        command: "node",
        args: ["legacy.js"],
      },
    ];
    const configs = await loadMcpConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("legacy");
    expect(mockLegacyStoreData._mcp_migrated).toBe(true);
  });

  it("skips legacy migration when SQLite already has rows", async () => {
    await saveMcpConfigs([
      {
        id: "sqlite-one",
        name: "Sqlite",
        enabled: true,
        transport: "stdio",
        command: "echo",
      },
    ]);
    mockLegacyStoreData.mcp_servers = [
      {
        id: "legacy",
        name: "Legacy",
        enabled: true,
        transport: "stdio",
        command: "node",
      },
    ];
    resetStoreForTests();
    const configs = await loadMcpConfigs();
    expect(configs.map((c) => c.id)).toEqual(["sqlite-one"]);
    expect(mockLegacyStoreData._mcp_migrated).toBeUndefined();
  });

  it("skips legacy migration when legacy data is invalid", async () => {
    mockLegacyStoreData.mcp_servers = [{ id: 123, bad: true }];
    const configs = await loadMcpConfigs();
    expect(configs).toEqual(DEFAULT_CONFIGS);
    expect(mockLegacyStoreData._mcp_migrated).toBeUndefined();
  });

  it("re-running loadMcpConfigs is idempotent (does not re-migrate)", async () => {
    mockLegacyStoreData.mcp_servers = [
      {
        id: "legacy",
        name: "Legacy",
        enabled: true,
        transport: "stdio",
        command: "node",
      },
    ];
    await loadMcpConfigs();
    const callCountAfterFirst = (mockLegacyStoreData._mcp_migrated as boolean) ? 1 : 0;
    expect(callCountAfterFirst).toBe(1);
    const second = await loadMcpConfigs();
    expect(second.map((c) => c.id)).toEqual(["legacy"]);
  });
});

describe("saveMcpConfigs", () => {
  it("persists configs to SQLite", async () => {
    const configs = [
      { id: "test", name: "Test", enabled: true, transport: "stdio" as const, command: "echo" },
    ];
    await saveMcpConfigs(configs);
    const loaded = await loadMcpConfigs();
    expect(loaded).toEqual(configs);
  });

  it("overwrites prior configs entirely", async () => {
    await saveMcpConfigs([{ id: "a", name: "A", enabled: true, transport: "stdio", command: "x" }]);
    await saveMcpConfigs([
      { id: "b", name: "B", enabled: false, transport: "stdio", command: "y" },
    ]);
    resetStoreForTests();
    const loaded = await loadMcpConfigs();
    expect(loaded.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("validateMcpConfig", () => {
  it("passes a valid stdio config", () => {
    const errors = validateMcpConfig(
      { id: "my-server", name: "My Server", transport: "stdio", command: "node" },
      [],
    );
    expect(errors).toEqual([]);
  });

  it("rejects invalid id format", () => {
    const errors = validateMcpConfig(
      { id: "My Server!", name: "Test", transport: "stdio", command: "node" },
      [],
    );
    expect(errors.some((e) => e.field === "id")).toBe(true);
  });

  it("rejects duplicate id", () => {
    const errors = validateMcpConfig(
      { id: "existing", name: "Test", transport: "stdio", command: "node" },
      ["existing"],
    );
    expect(errors.some((e) => e.field === "id" && e.message.includes("already exists"))).toBe(true);
  });

  it("allows same id when editing", () => {
    const errors = validateMcpConfig(
      { id: "existing", name: "Test", transport: "stdio", command: "node" },
      ["existing"],
      "existing",
    );
    expect(errors).toEqual([]);
  });

  it("rejects missing command for stdio", () => {
    const errors = validateMcpConfig({ id: "test", name: "Test", transport: "stdio" }, []);
    expect(errors.some((e) => e.field === "command")).toBe(true);
  });

  it("rejects missing url for http", () => {
    const errors = validateMcpConfig({ id: "test", name: "Test", transport: "http" }, []);
    expect(errors.some((e) => e.field === "url")).toBe(true);
  });

  it("accepts an https url for http/sse", () => {
    const errors = validateMcpConfig(
      { id: "test", name: "Test", transport: "http", url: "https://example.com/mcp" },
      [],
    );
    expect(errors).toEqual([]);
  });

  it("rejects a plain-http url for a non-loopback host", () => {
    const errors = validateMcpConfig(
      { id: "test", name: "Test", transport: "http", url: "http://example.com/mcp" },
      [],
    );
    expect(errors.some((e) => e.field === "url" && e.message.includes("https"))).toBe(true);
  });

  it("allows http for loopback hosts (local dev servers)", () => {
    for (const url of ["http://localhost:3000/mcp", "http://127.0.0.1:8080"]) {
      const errors = validateMcpConfig({ id: "test", name: "Test", transport: "sse", url }, []);
      expect(errors).toEqual([]);
    }
  });

  it("rejects a malformed url for http/sse", () => {
    const errors = validateMcpConfig(
      { id: "test", name: "Test", transport: "http", url: "not a url" },
      [],
    );
    expect(errors.some((e) => e.field === "url")).toBe(true);
  });

  it("rejects inline API keys in env", () => {
    const errors = validateMcpConfig(
      {
        id: "test",
        name: "Test",
        transport: "stdio",
        command: "node",
        env: { API_KEY: "sk-ant-abc123" },
      },
      [],
    );
    expect(errors.some((e) => e.field.startsWith("env.") && e.message.includes("secret"))).toBe(
      true,
    );
  });

  it("accepts secret references in env", () => {
    const errors = validateMcpConfig(
      {
        id: "test",
        name: "Test",
        transport: "stdio",
        command: "node",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal secret reference
        env: { API_KEY: "${secret:my_key}" },
      },
      [],
    );
    expect(errors).toEqual([]);
  });

  it("rejects empty name", () => {
    const errors = validateMcpConfig(
      { id: "test", name: "", transport: "stdio", command: "node" },
      [],
    );
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });
});
