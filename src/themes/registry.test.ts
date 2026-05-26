import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, getTheme, getThemeSource, listThemes, registerTheme } from "./registry";
import { REQUIRED_COLOR_TOKENS, type Theme } from "./types";

function makeColorTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of REQUIRED_COLOR_TOKENS) out[token] = "oklch(0.5 0 0)";
  return out;
}

function makeTheme(id: string, label = id): Theme {
  return {
    id,
    label,
    light: makeColorTokens() as Theme["light"],
    dark: makeColorTokens() as Theme["dark"],
  };
}

describe("theme registry", () => {
  beforeEach(() => {
    clearRegistry();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("registers and retrieves a theme", () => {
    registerTheme(makeTheme("alpha"), "builtin");
    expect(getTheme("alpha")?.id).toBe("alpha");
    expect(getThemeSource("alpha")).toBe("builtin");
  });

  it("returns undefined for an unregistered id", () => {
    expect(getTheme("missing")).toBeUndefined();
    expect(getThemeSource("missing")).toBeUndefined();
  });

  it("listThemes returns themes in alphabetical label order", () => {
    registerTheme(makeTheme("zzz", "Zzz Theme"), "builtin");
    registerTheme(makeTheme("aaa", "Aaa Theme"), "builtin");
    registerTheme(makeTheme("mmm", "Mmm Theme"), "builtin");
    const ids = listThemes().map((t) => t.id);
    expect(ids).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("user theme with the same id overrides a previously-registered builtin", () => {
    const builtin = makeTheme("perpetuity", "Perpetuity (builtin)");
    const user = makeTheme("perpetuity", "Perpetuity (user)");
    registerTheme(builtin, "builtin");
    registerTheme(user, "user");
    expect(getTheme("perpetuity")?.label).toBe("Perpetuity (user)");
    expect(getThemeSource("perpetuity")).toBe("user");
  });

  it("builtin theme registered AFTER a user override is silently dropped", () => {
    registerTheme(makeTheme("perpetuity", "Perpetuity (user)"), "user");
    registerTheme(makeTheme("perpetuity", "Perpetuity (builtin)"), "builtin");
    expect(getTheme("perpetuity")?.label).toBe("Perpetuity (user)");
    expect(getThemeSource("perpetuity")).toBe("user");
  });

  it("same-source duplicate is rejected with a console.warn (first one wins)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnSpy.mockClear();
    registerTheme(makeTheme("alpha", "Alpha v1"), "user");
    registerTheme(makeTheme("alpha", "Alpha v2"), "user");
    expect(getTheme("alpha")?.label).toBe("Alpha v1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/duplicate theme id/);
  });
});
