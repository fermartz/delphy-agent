import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { ProviderProfile } from "./types";

const ANTHROPIC_BETA_HEADER = "prompt-caching-2024-07-31";
const MODELS_ENDPOINT = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";

// Pricing per https://www.anthropic.com/pricing (as of 2026-06-02). Update
// here when Anthropic revises their rate card.
const PRICING = {
  "claude-opus-4-7": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-opus-4-6": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
} as const;

export const anthropicProfile: ProviderProfile = {
  id: "anthropic",
  label: "Anthropic (direct API)",
  defaultModel: "claude-sonnet-4-6",
  defaultAuxiliaryModel: "claude-haiku-4-5",
  secretKey: "anthropic_api_key",

  model: (apiKey: string, modelId: string): LanguageModel => {
    const anthropic = createAnthropic({ apiKey });
    return anthropic(modelId);
  },

  headers: () => ({
    "anthropic-beta": ANTHROPIC_BETA_HEADER,
    // Required by Anthropic's API to permit direct requests from a browser
    // (Tauri webview presents as origin http://localhost:1420 in dev). Anthropic
    // returns the appropriate CORS headers only when this is set. The "dangerous"
    // naming is from Anthropic's own SDK — for a server-side app exposing the
    // key in JS would be unsafe; for a desktop app where the user owns the
    // process and the key lives in their keychain, opting in is correct.
    "anthropic-dangerous-direct-browser-access": "true",
  }),

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await fetch(MODELS_ENDPOINT, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!response.ok) {
      throw new Error(`Anthropic /v1/models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data: Array<{ id: string }> };
    return payload.data.map((m) => m.id);
  },

  curatedModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],

  pricing: PRICING,

  discoveryFingerprint: (apiKey) => apiKey,
};
