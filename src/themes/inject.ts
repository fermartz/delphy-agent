import type { Theme } from "./types";

const STYLE_ELEMENT_ID = "delphy-themes";

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
  const selector =
    mode === "light" ? `[data-theme="${theme.id}"]` : `[data-theme="${theme.id}"].dark`;
  const colorTokens = mode === "light" ? theme.light : theme.dark;
  const lines: string[] = [];

  // Color tokens (mode-specific).
  for (const [token, value] of Object.entries(colorTokens)) {
    lines.push(`  --${token}: ${value};`);
  }

  // Non-color tokens (font-sans, font-mono, radius) — same for both modes,
  // emitted in the light block only to avoid redundant duplication.
  if (mode === "light" && theme.tokens) {
    for (const [token, value] of Object.entries(theme.tokens)) {
      if (value !== undefined) {
        lines.push(`  --${token}: ${value};`);
      }
    }
  }

  return `${selector} {\n${lines.join("\n")}\n}`;
}
