import { anthropicProfile } from "./anthropic";
import type { ProviderProfile } from "./types";

const PROVIDERS: Record<string, ProviderProfile> = {
  [anthropicProfile.id]: anthropicProfile,
};

export function getProvider(id: string): ProviderProfile | undefined {
  return PROVIDERS[id];
}

export function listProviders(): ProviderProfile[] {
  return Object.values(PROVIDERS);
}
