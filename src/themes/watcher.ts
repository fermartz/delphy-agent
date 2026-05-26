import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const DEBOUNCE_MS = 200;

/**
 * Subscribe to live user-theme directory changes. The Rust-side watcher emits
 * one event per FS change (Create/Modify/Remove on a *.json file in
 * `app_data_dir()/themes/`); we debounce ~200ms because a single editor save
 * often fires multiple rapid events (write-to-tmp + rename, etc.).
 *
 * Returns an unlisten function that cancels both the underlying Tauri
 * subscription and any pending debounce timer.
 */
export async function subscribeToThemeChanges(handler: () => void): Promise<UnlistenFn> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      handler();
    }, DEBOUNCE_MS);
  };

  const unlistenTauri = await listen("themes-changed", debounced);

  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    unlistenTauri();
  };
}
