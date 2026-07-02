import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { proxiedFetch } from "../net/proxied-fetch";
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
    const anthropic = createAnthropic({ apiKey, fetch: proxiedFetch });
    return anthropic(modelId);
  },

  headers: () => ({
    "anthropic-beta": ANTHROPIC_BETA_HEADER,
    // Still required even though egress is Rust-proxied: `@tauri-apps/plugin-http`
    // ALWAYS injects an `Origin` header (tauri://localhost) and lists ORIGIN as a
    // forbidden header we can't strip without the `unsafe-headers` feature. So
    // Anthropic still sees a browser-like request and returns 401 unless we opt
    // in here. Safe for a desktop app: the key lives in the OS keychain and the
    // user owns the process. (Removing this broke Anthropic during CP1 smoke.)
    "anthropic-dangerous-direct-browser-access": "true",
  }),

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await proxiedFetch(MODELS_ENDPOINT, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        // See headers() above — plugin-http injects Origin, so the opt-in stays.
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
