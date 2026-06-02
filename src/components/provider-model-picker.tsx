import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type DiscoveryResult, fetchDiscovery } from "@/core/providers/discovery-cache";
import type { ProviderProfile } from "@/core/providers/types";
import type { Settings } from "@/core/settings/types";

export interface ProviderModelPickerProps {
  label: string;
  profiles: ProviderProfile[];
  providerHasKey: (providerId: string) => boolean;
  resolveApiKey: (secretKey: string) => Promise<string | null>;
  settings: Settings;
  currentProviderId: string | null;
  currentModelId: string | null;
  onChange: (providerId: string, modelId: string) => void;
}

/**
 * Per-tier (Main / Auxiliary) provider + model picker. Provider rows that
 * don't have a configured key render disabled with a tooltip. Model dropdown
 * defaults to the active profile's curatedModels; a "Show all" toggle calls
 * `fetchDiscovery` lazily (results live in the 5-minute discovery cache) and
 * merges them under the curated list.
 */
export function ProviderModelPicker({
  label,
  profiles,
  providerHasKey,
  resolveApiKey,
  settings,
  currentProviderId,
  currentModelId,
  onChange,
}: ProviderModelPickerProps) {
  const activeProfile = profiles.find((p) => p.id === currentProviderId) ?? null;

  const [showAll, setShowAll] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Reset Show All state when provider changes — different providers have
  // different model lists, the toggle should re-open per provider.
  useEffect(() => {
    setShowAll(false);
    setDiscovery(null);
  }, []);

  async function handleShowAll() {
    if (!activeProfile) return;
    setShowAll(true);
    const apiKey = await resolveApiKey(activeProfile.secretKey);
    if (!apiKey) {
      setDiscovery({ status: "no-key", models: [], fetchedAt: Date.now() });
      return;
    }
    setDiscovering(true);
    try {
      const result = await fetchDiscovery(activeProfile.id, apiKey, settings);
      setDiscovery(result);
    } finally {
      setDiscovering(false);
    }
  }

  function handleProviderChange(nextProviderId: string) {
    const nextProfile = profiles.find((p) => p.id === nextProviderId);
    if (!nextProfile) return;
    // Reset model to the provider's curated default. The settings layer will
    // accept null model later (per Parameter 10a) — pickers always pin to a
    // concrete string so the dropdown UI stays controlled.
    const nextModel = nextProfile.defaultModel;
    onChange(nextProviderId, nextModel);
    setShowAll(false);
    setDiscovery(null);
  }

  function handleModelChange(nextModelId: string) {
    if (!activeProfile) return;
    onChange(activeProfile.id, nextModelId);
  }

  const curated = activeProfile?.curatedModels ?? [];
  const liveExtras =
    showAll && discovery?.status === "ok"
      ? discovery.models.filter((m) => !curated.includes(m))
      : [];
  const modelOptions = [...curated, ...liveExtras];
  const includesCurrent = currentModelId !== null && modelOptions.includes(currentModelId);

  return (
    <section className="space-y-2">
      <div className="text-xs font-medium text-foreground">{label}</div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={currentProviderId ?? ""} onValueChange={handleProviderChange}>
          <SelectTrigger aria-label={`${label} provider`} className="w-full sm:w-1/2">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => {
              const hasKey = providerHasKey(p.id);
              return (
                <SelectItem
                  key={p.id}
                  value={p.id}
                  disabled={!hasKey}
                  title={!hasKey ? `Add a key in Providers to use ${p.label}` : undefined}
                >
                  {p.label}
                  {!hasKey ? " (no key)" : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={currentModelId ?? ""}
          onValueChange={handleModelChange}
          disabled={!activeProfile}
        >
          <SelectTrigger aria-label={`${label} model`} className="w-full sm:w-1/2">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {!includesCurrent && currentModelId ? (
              <SelectItem value={currentModelId}>{currentModelId} (saved)</SelectItem>
            ) : null}
            {modelOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
        {!showAll ? (
          <button
            type="button"
            onClick={handleShowAll}
            disabled={!activeProfile}
            className="shrink-0 text-primary hover:underline disabled:opacity-50"
          >
            Show all
          </button>
        ) : discovering ? (
          <span>Discovering…</span>
        ) : discovery?.status === "ok" ? (
          <span>{discovery.models.length} models discovered</span>
        ) : discovery ? (
          <span className="text-destructive">{discovery.error ?? discovery.status}</span>
        ) : null}
      </div>
    </section>
  );
}
