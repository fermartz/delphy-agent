import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_SETTINGS } from "./defaults";
import type { ColorMode, Settings, WindowState } from "./types";

const STORE_FILE = "settings.json";
const VALID_COLOR_MODES: readonly ColorMode[] = ["light", "dark", "system"];

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return storePromise;
}

export function resetStoreForTests(): void {
  storePromise = null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isColorMode(value: unknown): value is ColorMode {
  return isString(value) && (VALID_COLOR_MODES as readonly string[]).includes(value);
}

function isWindowState(value: unknown): value is WindowState | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.width !== "number" || typeof obj.height !== "number") return false;
  if (obj.x !== null && typeof obj.x !== "number") return false;
  if (obj.y !== null && typeof obj.y !== "number") return false;
  return true;
}

async function readField<T>(
  store: Store,
  key: keyof Settings,
  validate: (v: unknown) => v is T,
): Promise<{ found: true; value: T } | { found: false; invalid: boolean }> {
  const raw = await store.get<unknown>(key);
  // Only `undefined` means the key is absent. An explicit `null` (or any other
  // value) must pass through the validator — the spec says invalid persisted
  // values warn + fall back, and `null` is invalid for every field except
  // window_state (whose validator allows it).
  if (raw === undefined) {
    return { found: false, invalid: false };
  }
  if (validate(raw)) {
    return { found: true, value: raw };
  }
  console.warn(`settings: invalid value for "${key}", using default`);
  return { found: false, invalid: true };
}

export async function loadSettings(): Promise<Settings> {
  let store: Store;
  try {
    store = await getStore();
  } catch (e) {
    console.warn("settings: failed to load store, using defaults", e);
    return { ...DEFAULT_SETTINGS };
  }

  const settings: Settings = { ...DEFAULT_SETTINGS };

  const schema = await readField(store, "$schema", isString);
  if (schema.found) settings.$schema = schema.value;

  const theme = await readField(store, "selected_theme", isString);
  if (theme.found) settings.selected_theme = theme.value;

  const mode = await readField(store, "color_mode", isColorMode);
  if (mode.found) settings.color_mode = mode.value;

  const backend = await readField(store, "default_backend", isString);
  if (backend.found) settings.default_backend = backend.value;

  const main = await readField(store, "main_model", isString);
  if (main.found) settings.main_model = main.value;

  const aux = await readField(store, "auxiliary_model", isString);
  if (aux.found) settings.auxiliary_model = aux.value;

  const win = await readField(store, "window_state", isWindowState);
  if (win.found) settings.window_state = win.value;

  return settings;
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const store = await getStore();
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      await store.set(key, value);
    }
  }
  await store.save();
  return loadSettings();
}
