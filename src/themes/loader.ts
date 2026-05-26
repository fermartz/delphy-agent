import { invoke } from "@tauri-apps/api/core";
import cosmicNight from "./builtin/cosmic-night.json";
import cyberWave from "./builtin/cyber-wave.json";
import cyberpunk from "./builtin/cyberpunk.json";
import oceanBreeze from "./builtin/ocean-breeze.json";
import perpetuity from "./builtin/perpetuity.json";
import vercel from "./builtin/vercel.json";
import { clearRegistry, listThemes, registerTheme } from "./registry";
import { themeSchema } from "./schema";
import type { Theme } from "./types";

const BUILTIN_THEMES = [
  perpetuity,
  cosmicNight,
  vercel,
  oceanBreeze,
  cyberpunk,
  cyberWave,
] as const;

/**
 * Loads all themes — builtins (statically imported) + user themes (read from
 * `app_data_dir()/themes/*.json` via the Tauri `list_user_themes` command).
 * Each is validated by the Zod schema; invalid themes log a `console.warn` and
 * are skipped. Re-callable: clears the registry first, so live-watcher
 * triggered re-loads see a fresh state.
 */
export async function loadAllThemes(): Promise<Theme[]> {
  clearRegistry();

  // Builtins. These should have already passed Zod via schema.test.ts; the
  // safeParse here is defensive — if a builtin somehow breaks, we'd rather
  // warn + ship the others than crash the app.
  for (const raw of BUILTIN_THEMES) {
    const result = themeSchema.safeParse(raw);
    if (result.success) {
      // Schema validated all REQUIRED_COLOR_TOKENS, but Zod's catchall infers
      // light/dark as Record<string, string> which TS can't narrow to ColorTokens.
      registerTheme(result.data as unknown as Theme, "builtin");
    } else {
      console.warn(
        "themes: a built-in theme failed validation; this is a bug.",
        result.error.issues,
      );
    }
  }

  // User themes. Failures of any single file are isolated — one bad theme
  // doesn't take out the others.
  try {
    const userFiles = await invoke<[string, string][]>("list_user_themes");
    for (const [filename, raw] of userFiles) {
      try {
        const json = JSON.parse(raw);
        const result = themeSchema.safeParse(json);
        if (result.success) {
          registerTheme(result.data as unknown as Theme, "user");
        } else {
          console.warn(`themes: user theme "${filename}" failed validation`, result.error.issues);
        }
      } catch (err) {
        console.warn(`themes: user theme "${filename}" failed to parse`, err);
      }
    }
  } catch (err) {
    // Non-fatal: a missing themes directory or unavailable Tauri command means
    // we ship only built-ins. The user can still pick from those.
    console.warn("themes: list_user_themes invocation failed", err);
  }

  return listThemes();
}
