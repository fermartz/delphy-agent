import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { loadAllThemes } from "./loader";
import { clearRegistry } from "./registry";
import { REQUIRED_COLOR_TOKENS } from "./types";

const mockedInvoke = vi.mocked(invoke);

function makeColorTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of REQUIRED_COLOR_TOKENS) out[token] = "oklch(0.5 0 0)";
  return out;
}

function makeUserThemeJson(id: string, label?: string): string {
  return JSON.stringify({
    id,
    label: label ?? id,
    light: makeColorTokens(),
    dark: makeColorTokens(),
  });
}

describe("loadAllThemes", () => {
  beforeEach(() => {
    clearRegistry();
    mockedInvoke.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the 6 builtins when the user dir is empty", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    const themes = await loadAllThemes();
    const ids = themes.map((t) => t.id).sort();
    expect(ids).toEqual([
      "cosmic-night",
      "cyber-wave",
      "cyberpunk",
      "ocean-breeze",
      "perpetuity",
      "vercel",
    ]);
  });

  it("loads valid user themes alongside builtins", async () => {
    mockedInvoke.mockResolvedValueOnce([
      ["my-custom.json", makeUserThemeJson("my-custom", "My Custom Theme")],
    ]);
    const themes = await loadAllThemes();
    const custom = themes.find((t) => t.id === "my-custom");
    expect(custom?.label).toBe("My Custom Theme");
    expect(themes.length).toBe(7); // 6 builtins + 1 user
  });

  it("a user theme with the same id as a builtin overrides the builtin", async () => {
    mockedInvoke.mockResolvedValueOnce([
      ["perpetuity.json", makeUserThemeJson("perpetuity", "My Perpetuity Override")],
    ]);
    const themes = await loadAllThemes();
    const perpetuity = themes.find((t) => t.id === "perpetuity");
    expect(perpetuity?.label).toBe("My Perpetuity Override");
    expect(themes.length).toBe(6); // user overrides builtin — same count
  });

  it("a malformed user theme JSON is logged and skipped; other themes still load", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedInvoke.mockResolvedValueOnce([
      ["broken.json", "{not valid json"],
      ["good.json", makeUserThemeJson("good")],
    ]);
    const themes = await loadAllThemes();
    expect(themes.find((t) => t.id === "good")).toBeDefined();
    expect(themes.some((t) => t.id === "broken")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/broken\.json.*failed to parse/),
      expect.anything(),
    );
  });

  it("a user theme that fails Zod validation is logged and skipped", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = JSON.stringify({
      id: "BadId-WithCaps", // violates ^[a-z][a-z0-9-]*$
      label: "Bad",
      light: makeColorTokens(),
      dark: makeColorTokens(),
    });
    mockedInvoke.mockResolvedValueOnce([["bad-id.json", invalid]]);
    const themes = await loadAllThemes();
    expect(themes.some((t) => t.id === "BadId-WithCaps")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/bad-id\.json.*failed validation/),
      expect.anything(),
    );
  });

  it("Tauri command failure is non-fatal — only builtins load", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce(new Error("command not registered"));
    const themes = await loadAllThemes();
    expect(themes.length).toBe(6);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/list_user_themes invocation failed/),
      expect.anything(),
    );
  });

  it("re-calling loadAllThemes clears the registry first (idempotent)", async () => {
    mockedInvoke.mockResolvedValueOnce([["my-custom.json", makeUserThemeJson("my-custom")]]);
    const first = await loadAllThemes();
    expect(first.length).toBe(7);

    // Second call: no user themes this time. Should drop the user theme.
    mockedInvoke.mockResolvedValueOnce([]);
    const second = await loadAllThemes();
    expect(second.length).toBe(6);
    expect(second.some((t) => t.id === "my-custom")).toBe(false);
  });
});
