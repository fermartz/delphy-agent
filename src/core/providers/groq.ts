import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { proxiedFetch } from "../net/proxied-fetch";
import type { ProviderProfile } from "./types";

// Groq — note the path is /openai/v1 (NOT /v1). Verified 2026-06-02; see
// memory/reference_openai-compatible-providers.md.
const BASE_URL = "https://api.groq.com/openai/v1";

export const groqProfile: ProviderProfile = {
  id: "groq",
  label: "Groq",
  defaultModel: "llama-3.3-70b-versatile",
  defaultAuxiliaryModel: "llama-3.1-8b-instant",
  secretKey: "groq_api_key",

  model: (apiKey: string, modelId: string): LanguageModel =>
    createOpenAI({ apiKey, baseURL: BASE_URL, fetch: proxiedFetch })(modelId),

  fetchModels: async (apiKey: string): Promise<string[]> => {
    const response = await proxiedFetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`Groq /models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data?: Array<{ id: string }> };
    return Array.isArray(payload.data) ? payload.data.map((m) => m.id) : [];
  },

  // Starter set (current as of 2026-06-02); "Show all" surfaces the live list.
  curatedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],

  pricing: {},

  discoveryFingerprint: (apiKey) => apiKey,
};
