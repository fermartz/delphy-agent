import type { ColorMode } from "../core/settings/types";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/**
 * Apply a theme to the document. Sets `data-theme` on `<html>` and toggles
 * the `.dark` class based on the requested color mode.
 *
 * For mode "system": follows the OS via `matchMedia(prefers-color-scheme)`
 * and re-applies on OS theme changes. Returns a cleanup function that
 * removes the media-query listener.
 *
 * For modes "light" / "dark": no listener; returns a no-op cleanup.
 */
export function applyTheme(themeId: string, mode: ColorMode): () => void {
  const root = document.documentElement;
  root.dataset.theme = themeId;

  if (mode === "light" || mode === "dark") {
    root.classList.toggle("dark", mode === "dark");
    return () => {};
  }

  // mode === "system"
  const mq = window.matchMedia(DARK_MEDIA_QUERY);
  const handler = (event: MediaQueryListEvent): void => {
    root.classList.toggle("dark", event.matches);
  };
  // Initial application.
  root.classList.toggle("dark", mq.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
