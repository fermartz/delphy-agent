import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type { ProviderRowState } from "@/components/providers-panel";
import { getProvider, listProviders } from "@/core/providers";
import {
  fetchDiscovery,
  invalidate as invalidateDiscovery,
} from "@/core/providers/discovery-cache";
import { resolveProviderApiKey } from "@/core/providers/resolve-key";
import { clearRuntimeKey, setRuntimeKey } from "@/core/providers/runtime-keys";
import type { Settings } from "@/core/settings/types";

function previewKey(key: string): string {
  return `***${key.slice(-4)}`;
}

interface UseProvidersOptions {
  /** Current settings — handleProviderTest routes discovery through them. */
  settings: Settings;
}

/**
 * Owns the Providers-panel state (per-provider status map, inline-edit + ring
 * highlight + saving flags) and the probe/save/test/remove handlers. Status is
 * probed lazily — App calls probeProviderStates when the Settings modal opens.
 * Extracted verbatim from App.tsx; the raw setEditId/setHighlightId setters are
 * exposed because the First-Run-Welcome deep-link (in App) drives them too.
 */
export function useProviders({ settings }: UseProvidersOptions) {
  const [providerStates, setProviderStates] = useState<Record<string, ProviderRowState>>({});
  const [providerEditId, setProviderEditId] = useState<string | null>(null);
  const [providerHighlightId, setProviderHighlightId] = useState<string | null>(null);
  const [providerSaving, setProviderSaving] = useState(false);

  const probeProviderStates = useCallback(async (): Promise<void> => {
    const entries = await Promise.all(
      listProviders().map(async (p) => {
        const stored = await resolveProviderApiKey(p.secretKey);
        if (stored && stored.length > 0) {
          return [p.id, { status: "configured" as const, preview: previewKey(stored) }] as const;
        }
        return [p.id, { status: "not-configured" as const }] as const;
      }),
    );
    setProviderStates(Object.fromEntries(entries));
  }, []);

  const handleProviderSave = useCallback(async (providerId: string, key: string) => {
    const profile = getProvider(providerId);
    if (!profile) return;
    setProviderSaving(true);
    try {
      try {
        await invoke("set_secret", { key: profile.secretKey, value: key });
      } catch {
        // Linux SECURE_STORAGE_UNAVAILABLE fallback — hold in process memory.
        setRuntimeKey(profile.secretKey, key);
      }
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: { status: "configured", preview: previewKey(key) },
      }));
      setProviderEditId(null);
    } finally {
      setProviderSaving(false);
    }
  }, []);

  const handleProviderTest = useCallback(
    async (providerId: string) => {
      const profile = getProvider(providerId);
      if (!profile) return;
      const apiKey = await resolveProviderApiKey(profile.secretKey);
      if (!apiKey) {
        setProviderStates((prev) => ({ ...prev, [providerId]: { status: "not-configured" } }));
        return;
      }
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: { ...(prev[providerId] ?? { status: "configured" }), status: "testing" },
      }));
      // Force re-discovery on Test so the user gets a true round-trip rather
      // than a cache hit (the cache was just warmed minutes ago).
      invalidateDiscovery(providerId);
      const result = await fetchDiscovery(providerId, apiKey, settings);
      if (result.status === "ok" && result.models.length > 0) {
        setProviderStates((prev) => ({
          ...prev,
          [providerId]: { status: "configured", preview: previewKey(apiKey) },
        }));
      } else if (result.status === "unsupported") {
        setProviderStates((prev) => ({
          ...prev,
          [providerId]: {
            ...(prev[providerId] ?? { status: "not-configured" }),
            status: "invalid",
            testError: "This provider does not support model discovery.",
          },
        }));
      } else {
        setProviderStates((prev) => ({
          ...prev,
          [providerId]: {
            status: "invalid",
            preview: previewKey(apiKey),
            testError: result.error ?? `Test failed (${result.status}).`,
          },
        }));
      }
    },
    [settings],
  );

  const handleProviderRemove = useCallback(async (providerId: string) => {
    const profile = getProvider(providerId);
    if (!profile) return;
    try {
      await invoke("delete_secret", { key: profile.secretKey });
    } catch {
      // ignore — runtime-key removal below also covers Linux fallback
    }
    clearRuntimeKey(profile.secretKey);
    setProviderStates((prev) => ({ ...prev, [providerId]: { status: "not-configured" } }));
  }, []);

  return {
    providerStates,
    providerEditId,
    setProviderEditId,
    providerHighlightId,
    setProviderHighlightId,
    providerSaving,
    probeProviderStates,
    handleProviderSave,
    handleProviderTest,
    handleProviderRemove,
  };
}
