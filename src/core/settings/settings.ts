import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_SETTINGS } from "./defaults";
import type { ColorMode, Settings } from "./types";

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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isColorMode(value: unknown): value is ColorMode {
  return isString(value) && (VALID_COLOR_MODES as readonly string[]).includes(value);
}

async function readField<T>(
  store: Store,
  key: keyof Settings,
  validate: (v: unknown) => v is T,
): Promise<{ found: true; value: T } | { found: false; invalid: boolean }> {
  const raw = await store.get<unknown>(key);
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

  const mainProvider = await readField(store, "main_provider", isNullableString);
  if (mainProvider.found) settings.main_provider = mainProvider.value;

  const main = await readField(store, "main_model", isNullableString);
  if (main.found) settings.main_model = main.value;

  const auxProvider = await readField(store, "auxiliary_provider", isNullableString);
  if (auxProvider.found) settings.auxiliary_provider = auxProvider.value;

  const aux = await readField(store, "auxiliary_model", isNullableString);
  if (aux.found) settings.auxiliary_model = aux.value;

  const baseUrl = await readField(store, "openai_compatible_base_url", isNullableString);
  if (baseUrl.found) settings.openai_compatible_base_url = baseUrl.value;

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
