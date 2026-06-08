import { invoke } from "@tauri-apps/api/core";
import { getRuntimeKey } from "./runtime-keys";

/**
 * Resolve a provider's API key: OS keychain first (Tauri `get_secret`), then the
 * in-process runtime fallback used on bare Linux without Secret Service. Returns
 * null when neither holds a non-empty value.
 */
export async function resolveProviderApiKey(secretKey: string): Promise<string | null> {
  try {
    const stored = await invoke<string | null>("get_secret", { key: secretKey });
    if (stored && stored.length > 0) return stored;
  } catch {
    // SECURE_STORAGE_UNAVAILABLE on bare Linux — fall through to runtime.
  }
  const runtime = getRuntimeKey(secretKey);
  return runtime && runtime.length > 0 ? runtime : null;
}
