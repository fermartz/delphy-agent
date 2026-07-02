import { THEME_ID_PATTERN, type Theme } from "./types";

const STYLE_ELEMENT_ID = "delphy-themes";

// The theme <style> is injected inline, and `style-src 'unsafe-inline'` is
// required (Radix/Tailwind emit inline styles), so CSP can't backstop a
// malicious user theme. Sanitize at the injection boundary: kebab-case token
// names only, and values free of declaration/rule breakout (`;{}`), remote
// fetches (`url(`, `@import`), `expression(`, comments, markup, backslash
// escapes, or control chars. Allows color functions (oklch/rgb/hsl), font
// stacks (commas/quotes), and lengths.
const SAFE_TOKEN_NAME = /^[a-z][a-z0-9-]*$/;
const UNSAFE_TOKEN_VALUE = /[;{}<>\\`]|url\(|@import|expression\(|\/\*|\*\//i;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

function isSafeThemeToken(name: string, value: string): boolean {
  return (
    SAFE_TOKEN_NAME.test(name) &&
    value.length > 0 &&
    !UNSAFE_TOKEN_VALUE.test(value) &&
    !hasControlChar(value)
  );
}

/**
 * Replace any existing themes <style> element with a fresh one containing
 * `[data-theme="<id>"] { --token: value; ... }` for each theme's light mode
 * and `[data-theme="<id>"].dark { ... }` for each theme's dark mode.
 *
 * Idempotent: calling repeatedly (e.g., after a live-watcher reload) replaces
 * the element rather than appending duplicates.
 */
export function injectThemeStyles(themes: readonly Theme[]): void {
  const css = buildThemeStylesCss(themes);

  let element = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (element === null) {
    element = document.createElement("style");
    element.id = STYLE_ELEMENT_ID;
    document.head.appendChild(element);
  }
  element.textContent = css;
}

/**
 * Builds the CSS rule strings for a set of themes. Exposed for testing.
 */
export function buildThemeStylesCss(themes: readonly Theme[]): string {
  const parts: string[] = [];
  for (const theme of themes) {
    parts.push(buildThemeBlock(theme, "light"));
    parts.push(buildThemeBlock(theme, "dark"));
  }
  return parts.join("\n\n");
}

function buildThemeBlock(theme: Theme, mode: "light" | "dark"): string {
  // Defense in depth: `id` is regex-validated at load, but the selector
  // interpolates it, so skip any theme whose id isn't a safe kebab identifier.
  if (!THEME_ID_PATTERN.test(theme.id)) return "";

  const selector =
    mode === "light" ? `[data-theme="${theme.id}"]` : `[data-theme="${theme.id}"].dark`;
  const colorTokens = mode === "light" ? theme.light : theme.dark;
  const lines: string[] = [];

  // Color tokens (mode-specific).
  for (const [token, value] of Object.entries(colorTokens)) {
    if (isSafeThemeToken(token, value)) {
      lines.push(`  --${token}: ${value};`);
    }
  }

  // Non-color tokens (font-sans, font-mono, radius) — same for both modes,
  // emitted in the light block only to avoid redundant duplication.
  if (mode === "light" && theme.tokens) {
    for (const [token, value] of Object.entries(theme.tokens)) {
      if (value !== undefined && isSafeThemeToken(token, value)) {
        lines.push(`  --${token}: ${value};`);
      }
    }
  }

  return `${selector} {\n${lines.join("\n")}\n}`;
}
