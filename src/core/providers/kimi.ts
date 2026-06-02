import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ProviderProfile } from "./types";

// Moonshot / Kimi — GLOBAL endpoint. The China endpoint (api.moonshot.cn)
// uses a region-specific key and is reachable via the Custom profile (see
// BACKLOG #17). Base URL verified 2026-06-02; see
// memory/reference_openai-compatible-providers.md.
const BASE_URL = "https://api.moonshot.ai/v1";

export const kimiProfile: ProviderProfile = {
  id: "kimi",
  label: "Kimi (Moonshot)",
  defaultModel: "moonshot-v1-32k",
  defaultAuxiliaryModel: "moonshot-v1-8k",
  secretKey: "kimi_api_key",

  model: (apiKey: string, modelId: string): LanguageModel =>
    createOpenAI({ apiKey, baseURL: BASE_URL })(modelId),

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`Kimi /models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data?: Array<{ id: string }> };
    return Array.isArray(payload.data) ? payload.data.map((m) => m.id) : [];
  },

  // Starter set (current as of 2026-06-02); "Show all" surfaces newer kimi-* IDs.
  curatedModels: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],

  pricing: {},

  discoveryFingerprint: (apiKey) => apiKey,
};
