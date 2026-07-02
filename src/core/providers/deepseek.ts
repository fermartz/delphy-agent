import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { proxiedFetch } from "../net/proxied-fetch";
import type { ProviderProfile } from "./types";

// DeepSeek — base URL has no /v1 (both forms route the same). Verified
// 2026-06-02; see memory/reference_openai-compatible-providers.md.
const BASE_URL = "https://api.deepseek.com";

export const deepseekProfile: ProviderProfile = {
  id: "deepseek",
  label: "DeepSeek",
  defaultModel: "deepseek-chat",
  defaultAuxiliaryModel: "deepseek-chat",
  secretKey: "deepseek_api_key",

  model: (apiKey: string, modelId: string): LanguageModel =>
    createOpenAI({ apiKey, baseURL: BASE_URL, fetch: proxiedFetch })(modelId),

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await proxiedFetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`DeepSeek /models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data?: Array<{ id: string }> };
    return Array.isArray(payload.data) ? payload.data.map((m) => m.id) : [];
  },

  // deepseek-chat / deepseek-reasoner are evergreen aliases (point to latest).
  curatedModels: ["deepseek-chat", "deepseek-reasoner"],

  pricing: {},

  discoveryFingerprint: (apiKey) => apiKey,
};
