// Per-provider runtime-only key holder for the Linux
// `secure-storage-unavailable` fallback path. Keyed by the provider's
// `secretKey` (e.g. "anthropic_api_key", "openai_api_key"). Values live
// only in this module's JS heap. They are:
//   - Never written to disk.
//   - Never written to localStorage, sessionStorage, or IndexedDB.
//   - Never serialized into React state that could later be persisted.
//   - Cleared on app close (the process dying takes the heap with it).
// On macOS/Windows/Linux-with-Secret-Service this module is never written
// to; the OS keychain via Tauri's set_secret/get_secret commands is used
// instead.

const runtimeKeys = new Map<string, string>();

export function getRuntimeKey(secretKey: string): string | null {
  return runtimeKeys.get(secretKey) ?? null;
}

export function setRuntimeKey(secretKey: string, value: string): void {
  runtimeKeys.set(secretKey, value);
}

export function clearRuntimeKey(secretKey: string): void {
  runtimeKeys.delete(secretKey);
}

export function clearAllRuntimeKeys(): void {
  runtimeKeys.clear();
}
