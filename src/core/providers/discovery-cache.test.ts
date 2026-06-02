import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { Settings } from "../settings/types";
import { fetchDiscovery, invalidate, resetDiscoveryCacheForTests } from "./discovery-cache";

// Stub fetchModels on anthropic + openai-compatible profiles via mocked module.
const mockAnthropicFetch = vi.fn();
const mockCustomFetch = vi.fn();

vi.mock("./index", async () => {
  const actual = await vi.importActual<typeof import("./index")>("./index");
  return {
    ...actual,
    getProvider: (id: string) => {
      const p = actual.getProvider(id);
      if (!p) return undefined;
      if (id === "anthropic") {
        return { ...p, fetchModels: mockAnthropicFetch };
      }
      if (id === "openai-compatible") {
        return { ...p, fetchModels: mockCustomFetch };
      }
      return p;
    },
  };
});

describe("discovery cache", () => {
  beforeEach(() => {
    resetDiscoveryCacheForTests();
    mockAnthropicFetch.mockReset();
    mockCustomFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches + caches on first call; cache hit on second", async () => {
    mockAnthropicFetch.mockResolvedValueOnce(["claude-sonnet-4-6", "claude-haiku-4-5"]);
    const a = await fetchDiscovery("anthropic", "key1", DEFAULT_SETTINGS);
    expect(a.status).toBe("ok");
    expect(a.models).toEqual(["claude-sonnet-4-6", "claude-haiku-4-5"]);

    const b = await fetchDiscovery("anthropic", "key1", DEFAULT_SETTINGS);
    expect(b.models).toEqual(a.models);
    expect(mockAnthropicFetch).toHaveBeenCalledTimes(1);
  });

  it("cache miss when apiKey changes", async () => {
    mockAnthropicFetch.mockResolvedValueOnce(["a"]);
    mockAnthropicFetch.mockResolvedValueOnce(["b"]);
    await fetchDiscovery("anthropic", "key1", DEFAULT_SETTINGS);
    await fetchDiscovery("anthropic", "key2", DEFAULT_SETTINGS);
    expect(mockAnthropicFetch).toHaveBeenCalledTimes(2);
  });

  it("cache miss when openai_compatible_base_url changes (Custom profile)", async () => {
    mockCustomFetch.mockResolvedValueOnce(["kimi-1"]);
    mockCustomFetch.mockResolvedValueOnce(["deepseek-1"]);
    const s1: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: "https://kimi/v1" };
    const s2: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: "https://ds/v1" };
    await fetchDiscovery("openai-compatible", "k", s1);
    await fetchDiscovery("openai-compatible", "k", s2);
    expect(mockCustomFetch).toHaveBeenCalledTimes(2);
  });

  it("cache hit when only an unrelated settings field changes (Custom profile)", async () => {
    mockCustomFetch.mockResolvedValueOnce(["m1"]);
    const s1: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: "https://kimi/v1" };
    const s2: Settings = {
      ...DEFAULT_SETTINGS,
      openai_compatible_base_url: "https://kimi/v1",
      selected_theme: "cyberpunk",
    };
    await fetchDiscovery("openai-compatible", "k", s1);
    await fetchDiscovery("openai-compatible", "k", s2);
    expect(mockCustomFetch).toHaveBeenCalledTimes(1);
  });

  it("cache expires after 5 minutes", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-06-02T12:00:00Z");
    vi.setSystemTime(start);
    mockAnthropicFetch.mockResolvedValueOnce(["a"]);
    mockAnthropicFetch.mockResolvedValueOnce(["b"]);
    await fetchDiscovery("anthropic", "k", DEFAULT_SETTINGS);
    vi.setSystemTime(new Date(start.getTime() + 6 * 60 * 1000));
    await fetchDiscovery("anthropic", "k", DEFAULT_SETTINGS);
    expect(mockAnthropicFetch).toHaveBeenCalledTimes(2);
  });

  it("error caches with status invalid and explicit error message", async () => {
    mockAnthropicFetch.mockRejectedValueOnce(
      new Error("Anthropic /v1/models failed: 401 Unauthorized"),
    );
    const r = await fetchDiscovery("anthropic", "bad", DEFAULT_SETTINGS);
    expect(r.status).toBe("invalid");
    expect(r.error).toContain("401");
    expect(r.models).toEqual([]);
  });

  it("returns no-key when apiKey is empty", async () => {
    const r = await fetchDiscovery("anthropic", "", DEFAULT_SETTINGS);
    expect(r.status).toBe("no-key");
    expect(mockAnthropicFetch).not.toHaveBeenCalled();
  });

  it("invalidate(providerId) forces re-fetch on next call", async () => {
    mockAnthropicFetch.mockResolvedValueOnce(["a"]);
    mockAnthropicFetch.mockResolvedValueOnce(["b"]);
    await fetchDiscovery("anthropic", "k", DEFAULT_SETTINGS);
    invalidate("anthropic");
    await fetchDiscovery("anthropic", "k", DEFAULT_SETTINGS);
    expect(mockAnthropicFetch).toHaveBeenCalledTimes(2);
  });
});
