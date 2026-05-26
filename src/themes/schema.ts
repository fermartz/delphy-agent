import { z } from "zod";
import { REQUIRED_COLOR_TOKENS, THEME_ID_PATTERN } from "./types";

// Build a Zod object schema where every required color token must be a
// non-empty string; extra string-typed keys are allowed (forward-compat for
// new color tokens added in future versions of the spec).
function colorTokensSchema() {
  const shape: Record<string, z.ZodString> = {};
  for (const token of REQUIRED_COLOR_TOKENS) {
    shape[token] = z.string().min(1);
  }
  return z.object(shape).catchall(z.string());
}

const nonColorTokensSchema = z
  .object({
    "font-sans": z.string().optional(),
    "font-mono": z.string().optional(),
    radius: z.string().optional(),
  })
  .catchall(z.string());

export const themeSchema = z
  .object({
    id: z.string().regex(THEME_ID_PATTERN, "id must match ^[a-z][a-z0-9-]*$"),
    label: z.string().min(1, "label must be non-empty"),
    author: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    tokens: nonColorTokensSchema.optional(),
    light: colorTokensSchema(),
    dark: colorTokensSchema(),
  })
  // Preserve unknown top-level keys (forward-compat per docs/THEMES.md).
  .passthrough();

export type ThemeInput = z.input<typeof themeSchema>;
export type ThemeParsed = z.output<typeof themeSchema>;
