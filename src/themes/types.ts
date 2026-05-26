// Source of truth: docs/THEMES.md.
//
// Built-in themes live at src/themes/builtin/*.json. User themes live at
// app_data_dir()/themes/*.json (per the 2026-05-26 path supersession
// matching settings.json). A user theme with the same `id` as a built-in
// overrides the built-in.

export const REQUIRED_COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type RequiredColorToken = (typeof REQUIRED_COLOR_TOKENS)[number];

// `id` follows ^[a-z][a-z0-9-]*$ — used as the data-theme attribute value
// and the registry key. Kebab-case enforced.
export const THEME_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export type ColorTokens = {
  [K in RequiredColorToken]: string;
} & {
  // Forward-compat: extra color tokens are preserved at load time but
  // not consumed by the current Tailwind @theme inline mapping.
  [key: string]: string;
};

export interface NonColorTokens {
  "font-sans"?: string;
  "font-mono"?: string;
  radius?: string;
  // Forward-compat for future non-color tokens (e.g., spacing, animation).
  [key: string]: string | undefined;
}

export interface Theme {
  id: string;
  label: string;
  author?: string;
  version?: string;
  description?: string;
  tokens?: NonColorTokens;
  light: ColorTokens;
  dark: ColorTokens;
}

export type ThemeSource = "builtin" | "user";
