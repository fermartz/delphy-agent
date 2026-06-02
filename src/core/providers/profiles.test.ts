import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { Settings } from "../settings/types";
import { getProvider, listProviders } from "./index";

// Exact discovery endpoint each first-class profile must hit. Guards against
// regressions like Groq dropping /openai, or DeepSeek adding/removing /v1.
const FETCH_MODELS_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/models",
  kimi: "https://api.moonshot.ai/v1/models",
  deepseek: "https://api.deepseek.com/models",
  groq: "https://api.groq.com/openai/v1/models",
};

// Priced profiles maintain a rate card (cost shows in /status).
const PRICED_PROFILE_IDS = ["anthropic", "openai", "google", "xai"] as const;
// First-class OpenAI-compatible profiles: real profiles with curated models +
// discovery, but pricing is intentionally empty (per-model/drifts) → cost
// renders `—` (BACKLOG #12.C). NOT a mistake.
const NO_PRICING_FIRST_CLASS_IDS = ["openrouter", "kimi", "deepseek", "groq"] as const;
const NON_CUSTOM_IDS = [...PRICED_PROFILE_IDS, ...NO_PRICING_FIRST_CLASS_IDS] as const;
const ALL_PROFILE_IDS = [...NON_CUSTOM_IDS, "openai-compatible"] as const;

describe("provider registry", () => {
  it("registers all nine profiles", () => {
    expect(
      listProviders()
        .map((p) => p.id)
        .sort(),
    ).toEqual([...ALL_PROFILE_IDS].sort());
  });

  it("getProvider returns the registered profile by id", () => {
    for (const id of ALL_PROFILE_IDS) {
      const p = getProvider(id);
      expect(p).toBeDefined();
      expect(p?.id).toBe(id);
    }
  });

  it("returns undefined for unknown provider ids", () => {
    expect(getProvider("nope")).toBeUndefined();
  });
});

describe("profile contract", () => {
  // Shared shape + unique-key checks for every profile.
  for (const id of ALL_PROFILE_IDS) {
    describe(`${id} profile`, () => {
      const profile = getProvider(id);
      if (!profile) throw new Error(`unreachable: profile ${id} missing`);

      it("declares the required fields", () => {
        expect(profile.label.length).toBeGreaterThan(0);
        expect(profile.secretKey.length).toBeGreaterThan(0);
        expect(typeof profile.model).toBe("function");
        expect(typeof profile.discoveryFingerprint).toBe("function");
        expect(typeof profile.pricing).toBe("object");
        expect(Array.isArray(profile.curatedModels)).toBe(true);
      });

      it("uses a unique secretKey", () => {
        const others = listProviders().filter((p) => p.id !== id);
        expect(others.map((p) => p.secretKey)).not.toContain(profile.secretKey);
      });
    });
  }

  // Curated-list + fingerprint checks apply to all non-Custom profiles.
  for (const id of NON_CUSTOM_IDS) {
    describe(`${id} (non-custom)`, () => {
      const profile = getProvider(id);
      if (!profile) throw new Error(`unreachable: profile ${id} missing`);

      it("has at least one curated model", () => {
        expect(profile.curatedModels.length).toBeGreaterThan(0);
      });

      it("defaultModel is in the curated list", () => {
        expect(profile.curatedModels).toContain(profile.defaultModel);
      });

      it("discoveryFingerprint returns the apiKey directly (no per-instance config)", () => {
        expect(profile.discoveryFingerprint("k1", DEFAULT_SETTINGS)).toBe("k1");
        expect(profile.discoveryFingerprint("k2", DEFAULT_SETTINGS)).toBe("k2");
      });
    });
  }

  // Pricing invariant applies only to priced profiles.
  for (const id of PRICED_PROFILE_IDS) {
    describe(`${id} (priced)`, () => {
      const profile = getProvider(id);
      if (!profile) throw new Error(`unreachable: profile ${id} missing`);

      it("has at least one pricing entry", () => {
        expect(Object.keys(profile.pricing).length).toBeGreaterThan(0);
      });

      it("every curated model has a pricing entry", () => {
        for (const m of profile.curatedModels) {
          expect(profile.pricing[m]).toBeDefined();
          expect(profile.pricing[m].inputPerMTok).toBeGreaterThan(0);
          expect(profile.pricing[m].outputPerMTok).toBeGreaterThan(0);
        }
      });
    });
  }

  // First-class OpenAI-compatible profiles intentionally ship no pricing.
  for (const id of NO_PRICING_FIRST_CLASS_IDS) {
    describe(`${id} (no-pricing first-class)`, () => {
      const profile = getProvider(id);
      if (!profile) throw new Error(`unreachable: profile ${id} missing`);

      it("intentionally has empty pricing (cost renders —) but real curated models", () => {
        expect(profile.pricing).toEqual({});
        expect(profile.curatedModels.length).toBeGreaterThan(0);
      });
    });
  }
});

describe("first-class OpenAI-compatible fetchModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const id of NO_PRICING_FIRST_CLASS_IDS) {
    it(`${id} hits ${FETCH_MODELS_URLS[id]} with Bearer auth and maps data[].id`, async () => {
      const profile = getProvider(id);
      if (!profile?.fetchModels) throw new Error(`${id} missing fetchModels`);
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "model-a" }, { id: "model-b" }] }),
      }));
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const models = await profile.fetchModels("test-key", DEFAULT_SETTINGS);

      expect(models).toEqual(["model-a", "model-b"]);
      expect(fetchMock).toHaveBeenCalledWith(FETCH_MODELS_URLS[id], {
        headers: { Authorization: "Bearer test-key" },
      });
    });
  }

  it("tolerates a response with no data array (returns [])", async () => {
    const profile = getProvider("openrouter");
    if (!profile?.fetchModels) throw new Error("unreachable");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    );
    expect(await profile.fetchModels("k", DEFAULT_SETTINGS)).toEqual([]);
  });

  it("throws on a non-ok response (surfaces status)", async () => {
    const profile = getProvider("groq");
    if (!profile?.fetchModels) throw new Error("unreachable");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      })) as unknown as typeof fetch,
    );
    await expect(profile.fetchModels("k", DEFAULT_SETTINGS)).rejects.toThrow(/401/);
  });
});

describe("openai-compatible profile (per-instance)", () => {
  const profile = getProvider("openai-compatible");
  if (!profile) throw new Error("unreachable");

  it("has empty curatedModels and pricing (operator-defined)", () => {
    expect(profile.curatedModels).toEqual([]);
    expect(profile.pricing).toEqual({});
  });

  it("discoveryFingerprint includes baseUrl from settings", () => {
    const s1: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: "https://kimi/v1" };
    const s2: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: "https://ds/v1" };
    expect(profile.discoveryFingerprint("k", s1)).toBe("k@https://kimi/v1");
    expect(profile.discoveryFingerprint("k", s2)).toBe("k@https://ds/v1");
    expect(profile.discoveryFingerprint("k", s1)).not.toBe(profile.discoveryFingerprint("k", s2));
  });

  it("treats null baseUrl as empty string in fingerprint", () => {
    const s: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: null };
    expect(profile.discoveryFingerprint("k", s)).toBe("k@");
  });

  it("model() throws when baseUrl is unset", () => {
    const s: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: null };
    expect(() => profile.model("k", "any-model", s)).toThrow(/base URL/);
  });

  it("model() throws when baseUrl is whitespace-only", () => {
    const s: Settings = { ...DEFAULT_SETTINGS, openai_compatible_base_url: "   " };
    expect(() => profile.model("k", "any-model", s)).toThrow(/base URL/);
  });
});
