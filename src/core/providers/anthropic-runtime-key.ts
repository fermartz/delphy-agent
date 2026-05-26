// Runtime-only key holder for the Linux `secure-storage-unavailable` fallback path.
// The key value lives only in this module's JS heap. It is:
//   - Never written to disk.
//   - Never written to localStorage, sessionStorage, or IndexedDB.
//   - Never serialized into React state that could later be persisted.
//   - Cleared on app close (the process dying takes the heap with it).
// On macOS/Windows/Linux-with-Secret-Service this module is never written to;
// the OS keychain via Tauri's set_secret/get_secret commands is used instead.

let runtimeKey: string | null = null;

export function getRuntimeKey(): string | null {
  return runtimeKey;
}

export function setRuntimeKey(value: string): void {
  runtimeKey = value;
}

export function clearRuntimeKey(): void {
  runtimeKey = null;
}
