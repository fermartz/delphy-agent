import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildThemeStylesCss, injectThemeStyles } from "./inject";
import { REQUIRED_COLOR_TOKENS, type Theme } from "./types";

function makeColorTokens(prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of REQUIRED_COLOR_TOKENS) {
    out[token] = `${prefix}-${token}`;
  }
  return out;
}

function makeTheme(id: string): Theme {
  return {
    id,
    label: id,
    tokens: { "font-sans": "TestFont", radius: "0.5rem" },
    light: makeColorTokens("light") as Theme["light"],
    dark: makeColorTokens("dark") as Theme["dark"],
  };
}

describe("buildThemeStylesCss", () => {
  it("produces a light and dark block for each theme", () => {
    const css = buildThemeStylesCss([makeTheme("alpha"), makeTheme("beta")]);
    expect(css).toContain('[data-theme="alpha"] {');
    expect(css).toContain('[data-theme="alpha"].dark {');
    expect(css).toContain('[data-theme="beta"] {');
    expect(css).toContain('[data-theme="beta"].dark {');
  });

  it("emits each required color token as --<token> in both blocks", () => {
    const css = buildThemeStylesCss([makeTheme("alpha")]);
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(css).toContain(`--${token}: light-${token};`);
      expect(css).toContain(`--${token}: dark-${token};`);
    }
  });

  it("emits non-color tokens only in the light block (avoiding duplication)", () => {
    const css = buildThemeStylesCss([makeTheme("alpha")]);
    // Split into the light and dark sections by their selector.
    const lightStart = css.indexOf('[data-theme="alpha"] {');
    const darkStart = css.indexOf('[data-theme="alpha"].dark {');
    const lightBlock = css.slice(lightStart, darkStart);
    const darkBlock = css.slice(darkStart);
    expect(lightBlock).toContain("--font-sans: TestFont");
    expect(lightBlock).toContain("--radius: 0.5rem");
    expect(darkBlock).not.toContain("--font-sans");
    expect(darkBlock).not.toContain("--radius");
  });

  it("allows legitimate color functions and font stacks through the sanitizer", () => {
    const theme = makeTheme("alpha");
    theme.light.primary = "oklch(0.62 0.19 260)";
    theme.tokens = { "font-sans": '"Inter Variable", system-ui, sans-serif' };
    const css = buildThemeStylesCss([theme]);
    expect(css).toContain("--primary: oklch(0.62 0.19 260);");
    expect(css).toContain('--font-sans: "Inter Variable", system-ui, sans-serif;');
  });

  it("drops tokens whose value tries to break out of the declaration or fetch remote CSS", () => {
    const theme = makeTheme("alpha");
    // Rule breakout + tracking-pixel fetch smuggled through a token value.
    theme.light.background = "#fff; } body { background: url(https://evil/p.png)";
    theme.dark.foreground = "red;color:blue";
    // @import and expression() are also blocked.
    theme.tokens = { radius: "0.5rem", "font-sans": "@import 'https://evil/x.css'" };
    const css = buildThemeStylesCss([theme]);
    expect(css).not.toContain("evil");
    expect(css).not.toContain("url(");
    expect(css).not.toContain("@import");
    expect(css).not.toContain("} body {");
    // The safe token in the same theme still renders.
    expect(css).toContain("--radius: 0.5rem;");
  });

  it("drops tokens with an unsafe name (prevents selector/property breakout)", () => {
    const theme = makeTheme("alpha");
    (theme.light as Record<string, string>)["evil} body {display:none"] = "red";
    const css = buildThemeStylesCss([theme]);
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("} body {");
  });

  it("skips a theme whose id is not a safe identifier", () => {
    const theme = makeTheme("alpha");
    theme.id = 'x"] { color: red } [data-theme="y';
    expect(buildThemeStylesCss([theme])).toBe("\n\n");
  });
});

describe("injectThemeStyles", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("appends a <style id='delphy-themes'> when none exists", () => {
    injectThemeStyles([makeTheme("alpha")]);
    const el = document.getElementById("delphy-themes");
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("STYLE");
    expect(el?.textContent).toContain('[data-theme="alpha"]');
  });

  it("replaces the existing <style> element's content (idempotent)", () => {
    injectThemeStyles([makeTheme("alpha")]);
    const firstEl = document.getElementById("delphy-themes");
    expect(firstEl?.textContent).toContain("alpha");

    injectThemeStyles([makeTheme("beta")]);
    const secondEl = document.getElementById("delphy-themes");
    // Same element, replaced content
    expect(secondEl).toBe(firstEl);
    expect(secondEl?.textContent).toContain("beta");
    expect(secondEl?.textContent).not.toContain("alpha");
    // Only ONE style element in the DOM (no duplicates from repeated calls).
    expect(document.querySelectorAll("#delphy-themes").length).toBe(1);
  });
});
