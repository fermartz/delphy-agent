import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  data: Record<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

function makeFakeStore(initial: Record<string, unknown> = {}): FakeStore {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key: string) => data[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      data[key] = value;
    }),
    save: vi.fn(async () => {}),
  };
}

let currentStore: FakeStore = makeFakeStore();
const mockedInvoke = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => currentStore),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockedInvoke(...args),
}));

import { migrateProviderBootstrap } from "./migrate";
import { resetStoreForTests } from "./settings";

function resetMocks(initial: Record<string, unknown> = {}): void {
  currentStore = makeFakeStore(initial);
  resetStoreForTests();
  mockedInvoke.mockReset();
}

describe("migrateProviderBootstrap", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("sets main_provider='anthropic' when missing AND anthropic_api_key exists", async () => {
    resetMocks({});
    mockedInvoke.mockResolvedValueOnce("sk-ant-xxx");
    await migrateProviderBootstrap();
    expect(currentStore.data.main_provider).toBe("anthropic");
    expect(currentStore.save).toHaveBeenCalled();
  });

  it("leaves main_provider null when no keychain key present", async () => {
    resetMocks({});
    mockedInvoke.mockResolvedValueOnce(null);
    await migrateProviderBootstrap();
    expect(currentStore.data.main_provider).toBeUndefined();
    expect(currentStore.save).not.toHaveBeenCalled();
  });

  it("is idempotent when main_provider is already set", async () => {
    resetMocks({ main_provider: "openai" });
    await migrateProviderBootstrap();
    expect(currentStore.data.main_provider).toBe("openai");
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(currentStore.save).not.toHaveBeenCalled();
  });

  it("leaves main_provider null when get_secret throws (SECURE_STORAGE_UNAVAILABLE)", async () => {
    resetMocks({});
    mockedInvoke.mockRejectedValueOnce("SECURE_STORAGE_UNAVAILABLE: no Secret Service daemon");
    await migrateProviderBootstrap();
    expect(currentStore.data.main_provider).toBeUndefined();
    expect(currentStore.save).not.toHaveBeenCalled();
  });

  it("treats empty-string keychain value as no key", async () => {
    resetMocks({});
    mockedInvoke.mockResolvedValueOnce("");
    await migrateProviderBootstrap();
    expect(currentStore.data.main_provider).toBeUndefined();
  });
});
