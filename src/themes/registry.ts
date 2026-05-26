import type { Theme, ThemeSource } from "./types";

interface RegistryEntry {
  theme: Theme;
  source: ThemeSource;
}

const registry = new Map<string, RegistryEntry>();

export function registerTheme(theme: Theme, source: ThemeSource): void {
  const existing = registry.get(theme.id);
  if (existing && existing.source === source) {
    // Same source means a duplicate file landed in the same location — that's
    // a bug in either the build (two builtin files with the same id) or the
    // user's theme directory. Warn and keep the first one.
    console.warn(
      `themes: duplicate theme id "${theme.id}" from source "${source}"; keeping first, ignoring duplicate`,
    );
    return;
  }
  // User-vs-builtin collision is an explicit override per docs/THEMES.md. The
  // user's theme always wins regardless of registration order.
  if (existing && existing.source === "builtin" && source === "user") {
    registry.set(theme.id, { theme, source });
    return;
  }
  if (existing && existing.source === "user" && source === "builtin") {
    // User already overrode — keep the user's version. Builtin is silently dropped.
    return;
  }
  registry.set(theme.id, { theme, source });
}

export function getTheme(id: string): Theme | undefined {
  return registry.get(id)?.theme;
}

export function listThemes(): Theme[] {
  return Array.from(registry.values())
    .map((e) => e.theme)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getThemeSource(id: string): ThemeSource | undefined {
  return registry.get(id)?.source;
}

export function clearRegistry(): void {
  registry.clear();
}
