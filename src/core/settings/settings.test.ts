import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  data: Record<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

function makeFakeStore(initial: Record<string, unknown> = {}): FakeStore {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key: string) => data[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      data[key] = value;
    }),
    save: vi.fn(async () => {}),
  };
}

let currentStore: FakeStore = makeFakeStore();
let loadShouldThrow: Error | null = null;

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => {
    if (loadShouldThrow) throw loadShouldThrow;
    return currentStore;
  }),
}));

import { DEFAULT_SETTINGS } from "./defaults";
import { loadSettings, resetStoreForTests, saveSettings } from "./settings";

function resetMocks(initial: Record<string, unknown> = {}): void {
  currentStore = makeFakeStore(initial);
  loadShouldThrow = null;
  resetStoreForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("settings module", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns defaults when the store has no entries", async () => {
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial stored values over defaults", async () => {
    resetMocks({
      main_model: "claude-opus-4-7",
      color_mode: "dark",
    });
    const settings = await loadSettings();
    expect(settings.main_model).toBe("claude-opus-4-7");
    expect(settings.color_mode).toBe("dark");
    // unchanged fields stay at defaults
    expect(settings.selected_theme).toBe(DEFAULT_SETTINGS.selected_theme);
    expect(settings.auxiliary_model).toBe(DEFAULT_SETTINGS.auxiliary_model);
  });

  it("round-trips a save through load", async () => {
    await saveSettings({ main_model: "claude-haiku-4-5" });
    const settings = await loadSettings();
    expect(settings.main_model).toBe("claude-haiku-4-5");
    expect(currentStore.save).toHaveBeenCalled();
  });

  it("save is a partial merge — other fields preserved", async () => {
    resetMocks({ color_mode: "dark" });
    await saveSettings({ main_model: "claude-opus-4-7" });
    const settings = await loadSettings();
    expect(settings.main_model).toBe("claude-opus-4-7");
    expect(settings.color_mode).toBe("dark"); // not overwritten
  });

  it("preserves unknown keys on write (forward-compat per SPEC)", async () => {
    resetMocks({
      unknown_future_field: "future-value",
      nested_unknown: { foo: "bar" },
    });
    await saveSettings({ main_model: "claude-opus-4-7" });
    // The unknown keys are still in the store's underlying map — we never deleted them.
    expect(currentStore.data.unknown_future_field).toBe("future-value");
    expect(currentStore.data.nested_unknown).toEqual({ foo: "bar" });
    // And main_model was actually written
    expect(currentStore.data.main_model).toBe("claude-opus-4-7");
  });

  it("falls back to defaults + logs a warning for invalid known-field values", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetMocks({
      color_mode: "purple", // invalid — only light/dark/system allowed
      main_model: 42, // invalid — must be a string
    });
    const settings = await loadSettings();
    expect(settings.color_mode).toBe(DEFAULT_SETTINGS.color_mode);
    expect(settings.main_model).toBe(DEFAULT_SETTINGS.main_model);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("treats explicit null as invalid for non-nullable string fields (warns + defaults)", async () => {
    // Per BACKLOG #12.A Parameter 10a: main_provider / main_model /
    // auxiliary_provider / auxiliary_model are nullable, so explicit null
    // is VALID. Non-nullable string fields (default_backend, selected_theme,
    // $schema) still warn on null.
    resetMocks({
      default_backend: null,
      selected_theme: null,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnSpy.mockClear();
    const settings = await loadSettings();
    expect(settings.default_backend).toBe(DEFAULT_SETTINGS.default_backend);
    expect(settings.selected_theme).toBe(DEFAULT_SETTINGS.selected_theme);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("accepts explicit null for nullable provider/model fields (Parameter 10a)", async () => {
    resetMocks({
      main_provider: null,
      main_model: null,
      auxiliary_provider: null,
      auxiliary_model: null,
      openai_compatible_base_url: null,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnSpy.mockClear();
    const settings = await loadSettings();
    expect(settings.main_provider).toBe(null);
    expect(settings.main_model).toBe(null);
    expect(settings.auxiliary_provider).toBe(null);
    expect(settings.auxiliary_model).toBe(null);
    expect(settings.openai_compatible_base_url).toBe(null);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns defaults when the underlying store fails to load (corrupted file path)", async () => {
    loadShouldThrow = new Error("corrupted store");
    resetStoreForTests();
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});
