import { describe, expect, it } from "vitest";
import { themeSchema } from "./schema";
import { REQUIRED_COLOR_TOKENS } from "./types";

function makeColorTokens(value = "oklch(0.5 0 0)"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of REQUIRED_COLOR_TOKENS) {
    out[token] = value;
  }
  return out;
}

function makeValidTheme(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-theme",
    label: "Test Theme",
    light: makeColorTokens("oklch(0.95 0 0)"),
    dark: makeColorTokens("oklch(0.2 0 0)"),
    ...overrides,
  };
}

describe("themeSchema", () => {
  it("accepts a fully valid theme", () => {
    const result = themeSchema.safeParse(makeValidTheme());
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const theme = makeValidTheme();
    delete (theme as Record<string, unknown>).id;
    const result = themeSchema.safeParse(theme);
    expect(result.success).toBe(false);
  });

  it("rejects id that does not match ^[a-z][a-z0-9-]*$", () => {
    const bad = ["Test-theme", "1theme", "test_theme", "-theme", "", "test theme"];
    for (const id of bad) {
      const result = themeSchema.safeParse(makeValidTheme({ id }));
      expect(result.success, `expected ${JSON.stringify(id)} to reject`).toBe(false);
    }
  });

  it("rejects empty label", () => {
    const result = themeSchema.safeParse(makeValidTheme({ label: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects when a required color token is missing from light", () => {
    const lightMissing = makeColorTokens();
    delete lightMissing.background;
    const result = themeSchema.safeParse(makeValidTheme({ light: lightMissing }));
    expect(result.success).toBe(false);
  });

  it("rejects when a required color token is missing from dark", () => {
    const darkMissing = makeColorTokens();
    delete darkMissing["sidebar-ring"];
    const result = themeSchema.safeParse(makeValidTheme({ dark: darkMissing }));
    expect(result.success).toBe(false);
  });

  it("preserves extra color tokens in light and dark (forward-compat)", () => {
    const lightExtra = { ...makeColorTokens(), "new-token-v2": "oklch(0.5 0 0)" };
    const result = themeSchema.safeParse(makeValidTheme({ light: lightExtra }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.light as Record<string, string>)["new-token-v2"]).toBe("oklch(0.5 0 0)");
    }
  });

  it("preserves unknown top-level keys (forward-compat)", () => {
    const result = themeSchema.safeParse(makeValidTheme({ "future-field": "future-value" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["future-field"]).toBe("future-value");
    }
  });

  it("accepts optional fields (author, version, description, tokens)", () => {
    const result = themeSchema.safeParse(
      makeValidTheme({
        author: "fermartz",
        version: "1.0.0",
        description: "A test theme",
        tokens: {
          "font-sans": "Inter, sans-serif",
          "font-mono": "JetBrains Mono, monospace",
          radius: "0.5rem",
        },
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("built-in theme JSON files", () => {
  const builtins = [
    "perpetuity",
    "cosmic-night",
    "vercel",
    "ocean-breeze",
    "cyberpunk",
    "cyber-wave",
  ] as const;

  for (const id of builtins) {
    it(`${id}.json passes schema validation`, async () => {
      const theme = (await import(`./builtin/${id}.json`)).default;
      const result = themeSchema.safeParse(theme);
      if (!result.success) {
        // Surface the actual issue so the test failure is debuggable.
        throw new Error(
          `${id}.json failed validation: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
      expect(result.data.id).toBe(id);
    });
  }
});
