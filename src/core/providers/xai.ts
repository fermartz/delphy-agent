import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import type { ProviderProfile } from "./types";

const MODELS_ENDPOINT = "https://api.x.ai/v1/models";

// Pricing per https://docs.x.ai/docs/models (as of 2026-06-02).
const PRICING = {
  "grok-4": { inputPerMTok: 5, outputPerMTok: 15 },
  "grok-4-fast": { inputPerMTok: 0.2, outputPerMTok: 0.5 },
  "grok-3": { inputPerMTok: 3, outputPerMTok: 15 },
  "grok-3-mini": { inputPerMTok: 0.3, outputPerMTok: 0.5 },
} as const;

export const xaiProfile: ProviderProfile = {
  id: "xai",
  label: "xAI (Grok)",
  defaultModel: "grok-4-fast",
  defaultAuxiliaryModel: "grok-3-mini",
  secretKey: "xai_api_key",

  model: (apiKey: string, modelId: string): LanguageModel => {
    const xai = createXai({ apiKey });
    return xai(modelId);
  },

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`xAI /v1/models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data: Array<{ id: string }> };
    return payload.data.map((m) => m.id);
  },

  curatedModels: ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini"],

  pricing: PRICING,

  discoveryFingerprint: (apiKey) => apiKey,
};
