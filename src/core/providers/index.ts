import { anthropicProfile } from "./anthropic";
import { googleProfile } from "./google";
import { openaiProfile } from "./openai";
import { openaiCompatibleProfile } from "./openai-compatible";
import type { ProviderProfile } from "./types";
import { xaiProfile } from "./xai";

const PROVIDERS: Record<string, ProviderProfile> = {
  [anthropicProfile.id]: anthropicProfile,
  [openaiProfile.id]: openaiProfile,
  [googleProfile.id]: googleProfile,
  [xaiProfile.id]: xaiProfile,
  [openaiCompatibleProfile.id]: openaiCompatibleProfile,
};

export function getProvider(id: string): ProviderProfile | undefined {
  return PROVIDERS[id];
}

export function listProviders(): ProviderProfile[] {
  return Object.values(PROVIDERS);
}
