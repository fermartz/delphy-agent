import { beforeEach, describe, expect, it, vi } from "vitest";

let mockStoreData: Record<string, unknown> = {};
const saveMock = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((key: string) => Promise.resolve(mockStoreData[key])),
      set: vi.fn((key: string, value: unknown) => {
        mockStoreData[key] = value;
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

beforeEach(() => {
  mockStoreData = {};
  saveMock.mockReset();
  resetStoreForTests();
});

describe("loadMcpConfigs", () => {
  it("seeds defaults when key is absent", async () => {
    const configs = await loadMcpConfigs();
    expect(configs).toEqual(DEFAULT_CONFIGS);
    expect(mockStoreData.mcp_servers).toEqual(DEFAULT_CONFIGS);
    expect(saveMock).toHaveBeenCalled();
  });

  it("returns persisted configs when valid", async () => {
    const custom = [
      {
        id: "my-server",
        name: "My Server",
        enabled: true,
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      },
    ];
    mockStoreData.mcp_servers = custom;
    const configs = await loadMcpConfigs();
    expect(configs).toEqual(custom);
  });

  it("resets to defaults when persisted data is invalid", async () => {
    mockStoreData.mcp_servers = [{ id: 123, bad: true }];
    const configs = await loadMcpConfigs();
    expect(configs).toEqual(DEFAULT_CONFIGS);
  });

  it("preserves non-stdio configs", async () => {
    const mixed = [
      { id: "stdio-one", name: "Stdio", enabled: true, transport: "stdio", command: "echo" },
      {
        id: "http-one",
        name: "HTTP",
        enabled: true,
        transport: "http",
        url: "https://example.com",
      },
    ];
    mockStoreData.mcp_servers = mixed;
    const configs = await loadMcpConfigs();
    expect(configs).toHaveLength(2);
    expect(configs[1].transport).toBe("http");
  });

  it("seeds defaults when key is null", async () => {
    mockStoreData.mcp_servers = null;
    const configs = await loadMcpConfigs();
    expect(configs).toEqual(DEFAULT_CONFIGS);
  });
});

describe("saveMcpConfigs", () => {
  it("persists configs and calls save", async () => {
    const configs = [
      { id: "test", name: "Test", enabled: true, transport: "stdio" as const, command: "echo" },
    ];
    await saveMcpConfigs(configs);
    expect(mockStoreData.mcp_servers).toEqual(configs);
    expect(saveMock).toHaveBeenCalled();
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
