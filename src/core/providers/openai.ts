import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { proxiedFetch } from "../net/proxied-fetch";
import type { ProviderProfile } from "./types";

const MODELS_ENDPOINT = "https://api.openai.com/v1/models";

// Pricing per https://platform.openai.com/docs/pricing (as of 2026-06-02).
// Update here when OpenAI revises their rate card.
const PRICING = {
  "gpt-5": { inputPerMTok: 2.5, outputPerMTok: 10, cachedInputPerMTok: 0.25 },
  "gpt-5-mini": { inputPerMTok: 0.25, outputPerMTok: 2 },
  "gpt-5-nano": { inputPerMTok: 0.05, outputPerMTok: 0.4 },
  "o4-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4, cachedInputPerMTok: 0.275 },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 },
} as const;

export const openaiProfile: ProviderProfile = {
  id: "openai",
  label: "OpenAI",
  defaultModel: "gpt-5",
  defaultAuxiliaryModel: "gpt-5-nano",
  secretKey: "openai_api_key",

  model: (apiKey: string, modelId: string): LanguageModel => {
    const openai = createOpenAI({ apiKey, fetch: proxiedFetch });
    return openai(modelId);
  },

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await proxiedFetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`OpenAI /v1/models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data: Array<{ id: string }> };
    return payload.data.map((m) => m.id);
  },

  curatedModels: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "o4-mini", "gpt-4.1"],

  pricing: PRICING,

  discoveryFingerprint: (apiKey) => apiKey,
};
