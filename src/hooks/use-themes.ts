import { useEffect, useState } from "react";
import type { ColorMode } from "@/core/settings/types";
import { applyTheme } from "@/themes/apply";
import { injectThemeStyles } from "@/themes/inject";
import { loadAllThemes } from "@/themes/loader";
import type { Theme } from "@/themes/types";
import { subscribeToThemeChanges } from "@/themes/watcher";

interface UseThemesOptions {
  selectedThemeId: string;
  colorMode: ColorMode;
}

/**
 * Loads themes on mount, injects their <style> rules, subscribes to live
 * disk changes, and applies the selected theme + color mode. Extracted verbatim
 * from App.tsx; returns the loaded theme list for the switcher UI.
 */
export function useThemes({ selectedThemeId, colorMode }: UseThemesOptions) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  // Bumped by the watcher each time it reloads themes from disk, so the apply
  // effect re-runs and re-asserts data-theme + .dark even when the
  // selectedThemeId / colorMode haven't changed (e.g., the user edited the
  // currently-active theme's JSON in place).
  const [themesVersion, setThemesVersion] = useState(0);

  // Load themes on mount, inject the <style> rules, then subscribe to live
  // changes from the user-themes directory. Each watcher event re-loads,
  // re-injects, and re-applies the current theme.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    (async () => {
      const loaded = await loadAllThemes();
      if (!active) return;
      injectThemeStyles(loaded);
      setThemes(loaded);
      setThemesLoaded(true);

      try {
        unlisten = await subscribeToThemeChanges(async () => {
          const updated = await loadAllThemes();
          if (!active) return;
          injectThemeStyles(updated);
          setThemes(updated);
          setThemesVersion((v) => v + 1);
        });
      } catch (err) {
        // Watcher unavailable (non-Tauri environment, permission denied, etc.) —
        // themes still work, just no live reload.
        console.warn("themes: subscribeToThemeChanges failed", err);
      }
    })();

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  // Apply the selected theme + color mode whenever either changes (or after
  // themes finish loading on boot, or after the watcher reloads themes from
  // disk). themesVersion is a deliberate effect-trigger — bumping it on a
  // watcher reload re-runs applyTheme even when selectedThemeId + colorMode
  // are unchanged. Returns a cleanup for the "system" mode's matchMedia listener.
  // biome-ignore lint/correctness/useExhaustiveDependencies: themesVersion is an effect-trigger (its value isn't read inside the effect, but bumping it must re-assert data-theme + .dark)
  useEffect(() => {
    if (!themesLoaded) return;
    const cleanup = applyTheme(selectedThemeId, colorMode);
    return cleanup;
  }, [themesLoaded, themesVersion, selectedThemeId, colorMode]);

  return { themes };
}
