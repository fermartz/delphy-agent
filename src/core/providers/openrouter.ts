import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ProviderProfile } from "./types";

// OpenAI-compatible aggregator — one key, hundreds of models (namespaced
// vendor/model). Base URL verified 2026-06-02; see
// memory/reference_openai-compatible-providers.md.
const BASE_URL = "https://openrouter.ai/api/v1";

export const openrouterProfile: ProviderProfile = {
  id: "openrouter",
  label: "OpenRouter",
  defaultModel: "openai/gpt-4o-mini",
  defaultAuxiliaryModel: "openai/gpt-4o-mini",
  secretKey: "openrouter_api_key",

  model: (apiKey: string, modelId: string): LanguageModel =>
    createOpenAI({ apiKey, baseURL: BASE_URL })(modelId),

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`OpenRouter /models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data?: Array<{ id: string }> };
    return Array.isArray(payload.data) ? payload.data.map((m) => m.id) : [];
  },

  // Starter set (current as of 2026-06-02); "Show all" discovery surfaces the
  // full catalog. Model IDs are namespaced vendor/model.
  curatedModels: [
    "moonshotai/kimi-k2.6:free",
    "openai/gpt-4o-mini",
    "anthropic/claude-3.5-sonnet",
    "google/gemini-2.0-flash-exp",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct",
  ],

  // Pricing is per-model and vast for OpenRouter — left empty; /status shows —.
  pricing: {},

  discoveryFingerprint: (apiKey) => apiKey,
};
