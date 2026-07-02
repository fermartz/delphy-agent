import { saveSettings } from "../settings/settings";

/**
 * Trusted-image-host registry. Remote images in rendered markdown are blocked
 * by default (CSP `img-src 'self' data: blob:`); the user can load an image
 * once or "always trust" its host. Trusted hosts auto-load (still through the
 * proxied fetch + strict SSRF guard). Source of truth is `settings
 * .trusted_image_hosts`; this module is seeded from it at boot and persists on
 * change. Hosts are stored lowercase.
 *
 * Exposed as an external store so leaf `MarkdownImage` components react (via
 * useSyncExternalStore) when a host becomes trusted, auto-loading other pending
 * images from the same host.
 */

let trusted = new Set<string>();
let snapshot: readonly string[] = [];
const listeners = new Set<() => void>();

function recompute(): void {
  snapshot = [...trusted].sort();
  for (const listener of listeners) listener();
}

/** Seed from persisted settings at boot. */
export function seedTrustedImageHosts(hosts: readonly string[]): void {
  trusted = new Set(hosts.map((h) => h.toLowerCase()));
  recompute();
}

export function subscribeTrustedImageHosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTrustedImageHostsSnapshot(): readonly string[] {
  return snapshot;
}

export function isImageHostTrusted(host: string): boolean {
  return trusted.has(host.toLowerCase());
}

/** Add a host to the trusted set and persist it. No-op if already trusted. */
export async function trustImageHost(host: string): Promise<void> {
  const h = host.toLowerCase();
  if (trusted.has(h)) return;
  trusted.add(h);
  recompute();
  await saveSettings({ trusted_image_hosts: [...trusted] });
}

/** Test-only: reset in-memory state. */
export function resetTrustedImageHostsForTests(): void {
  trusted = new Set();
  snapshot = [];
  listeners.clear();
}
