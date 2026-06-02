import { invoke } from "@tauri-apps/api/core";
import { loadSettings, saveSettings } from "./settings";

const ANTHROPIC_KEYCHAIN_KEY = "anthropic_api_key";

/**
 * One-time provider-bootstrap migration for users upgrading from the
 * Anthropic-only build. Per Parameter 10a of the multi-provider plan:
 * if `main_provider` is missing from the settings store AND
 * `anthropic_api_key` exists in the OS keychain, set
 * `main_provider = "anthropic"` so the existing user skips First-Run
 * Welcome and keeps using their configured key. Otherwise leave
 * `main_provider` null so Welcome handles the case.
 *
 * Idempotent: subsequent calls see a non-null `main_provider` and skip.
 * Safe to call on every boot.
 */
export async function migrateProviderBootstrap(): Promise<void> {
  const settings = await loadSettings();
  if (settings.main_provider !== null) return;

  let hasAnthropicKey = false;
  try {
    const stored = await invoke<string | null>("get_secret", {
      key: ANTHROPIC_KEYCHAIN_KEY,
    });
    hasAnthropicKey = typeof stored === "string" && stored.length > 0;
  } catch {
    // SECURE_STORAGE_UNAVAILABLE or other keychain error → treat as
    // "no key present" and leave main_provider null. First-Run Welcome
    // will handle the user from here.
    return;
  }

  if (!hasAnthropicKey) return;

  await saveSettings({ main_provider: "anthropic" });
}
