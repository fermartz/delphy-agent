import type { Settings } from "../settings/types";
import { getProvider } from "./index";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per Parameter 5

export type DiscoveryStatus = "ok" | "no-key" | "invalid" | "unsupported" | "unknown-host";

export interface DiscoveryResult {
  status: DiscoveryStatus;
  models: string[];
  error?: string;
  fetchedAt: number;
}

interface CacheEntry {
  fingerprint: string;
  result: DiscoveryResult;
}

// Keyed by providerId; entry value carries the fingerprint that produced it
// so a change in (apiKey, settings) invalidates the cached models naturally.
const cache = new Map<string, CacheEntry>();

export function resetDiscoveryCacheForTests(): void {
  cache.clear();
}

export function getCachedDiscovery(
  providerId: string,
  apiKey: string,
  settings: Settings,
): DiscoveryResult | null {
  const profile = getProvider(providerId);
  if (!profile) return null;
  const fp = profile.discoveryFingerprint(apiKey, settings);
  const entry = cache.get(providerId);
  if (!entry) return null;
  if (entry.fingerprint !== fp) return null;
  if (Date.now() - entry.result.fetchedAt > CACHE_TTL_MS) return null;
  return entry.result;
}

/**
 * Fetch and cache the model list for a provider. Returns the cached entry
 * when fresh + the fingerprint matches; otherwise calls
 * `profile.fetchModels` and caches the result. Errors are also cached as
 * `status: "invalid"` so the UI doesn't hammer the endpoint on retry — the
 * caller should explicitly call `invalidate(providerId)` to retry after
 * fixing the key.
 */
export async function fetchDiscovery(
  providerId: string,
  apiKey: string,
  settings: Settings,
): Promise<DiscoveryResult> {
  const profile = getProvider(providerId);
  if (!profile) {
    return { status: "unsupported", models: [], fetchedAt: Date.now() };
  }
  const fp = profile.discoveryFingerprint(apiKey, settings);
  const existing = cache.get(providerId);
  if (
    existing &&
    existing.fingerprint === fp &&
    Date.now() - existing.result.fetchedAt < CACHE_TTL_MS
  ) {
    return existing.result;
  }

  if (!profile.fetchModels) {
    const result: DiscoveryResult = {
      status: "unsupported",
      models: [],
      fetchedAt: Date.now(),
    };
    cache.set(providerId, { fingerprint: fp, result });
    return result;
  }

  if (!apiKey) {
    const result: DiscoveryResult = {
      status: "no-key",
      models: [],
      fetchedAt: Date.now(),
    };
    cache.set(providerId, { fingerprint: fp, result });
    return result;
  }

  try {
    const models = await profile.fetchModels(apiKey, settings);
    const result: DiscoveryResult = {
      status: "ok",
      models,
      fetchedAt: Date.now(),
    };
    cache.set(providerId, { fingerprint: fp, result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status: DiscoveryStatus = message.includes("401")
      ? "invalid"
      : message.includes("fetch") || message.includes("network")
        ? "unknown-host"
        : "invalid";
    const result: DiscoveryResult = {
      status,
      models: [],
      error: message,
      fetchedAt: Date.now(),
    };
    cache.set(providerId, { fingerprint: fp, result });
    return result;
  }
}

export function invalidate(providerId: string): void {
  cache.delete(providerId);
}
