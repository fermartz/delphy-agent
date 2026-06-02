import { anthropicProfile } from "./anthropic";
import { deepseekProfile } from "./deepseek";
import { googleProfile } from "./google";
import { groqProfile } from "./groq";
import { kimiProfile } from "./kimi";
import { openaiProfile } from "./openai";
import { openaiCompatibleProfile } from "./openai-compatible";
import { openrouterProfile } from "./openrouter";
import type { ProviderProfile } from "./types";
import { xaiProfile } from "./xai";

const PROVIDERS: Record<string, ProviderProfile> = {
  [anthropicProfile.id]: anthropicProfile,
  [openaiProfile.id]: openaiProfile,
  [googleProfile.id]: googleProfile,
  [xaiProfile.id]: xaiProfile,
  [openrouterProfile.id]: openrouterProfile,
  [kimiProfile.id]: kimiProfile,
  [deepseekProfile.id]: deepseekProfile,
  [groqProfile.id]: groqProfile,
  [openaiCompatibleProfile.id]: openaiCompatibleProfile,
};

export function getProvider(id: string): ProviderProfile | undefined {
  return PROVIDERS[id];
}

export function listProviders(): ProviderProfile[] {
  return Object.values(PROVIDERS);
}
