import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import type { Settings } from "../settings/types";
import { getProvider, listProviders } from "./index";

const ALL_PROFILE_IDS = ["anthropic", "openai", "google", "xai", "openai-compatible"] as const;

describe("provider registry", () => {
  it("registers all five v1 profiles", () => {
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

      if (id !== "openai-compatible") {
        it("has at least one curated model", () => {
          expect(profile.curatedModels.length).toBeGreaterThan(0);
        });

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

        it("defaultModel is in the curated list", () => {
          expect(profile.curatedModels).toContain(profile.defaultModel);
        });

        it("discoveryFingerprint returns the apiKey directly (no per-instance config)", () => {
          expect(profile.discoveryFingerprint("k1", DEFAULT_SETTINGS)).toBe("k1");
          expect(profile.discoveryFingerprint("k2", DEFAULT_SETTINGS)).toBe("k2");
        });
      }
    });
  }
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
