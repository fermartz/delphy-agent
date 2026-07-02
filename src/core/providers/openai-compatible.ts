import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { proxiedFetch } from "../net/proxied-fetch";
import type { Settings } from "../settings/types";
import type { ProviderProfile } from "./types";

/**
 * Custom OpenAI-compatible endpoint — user supplies a base URL. Covers
 * Kimi/Moonshot (api.moonshot.cn/v1), DeepSeek (api.deepseek.com),
 * OpenRouter (openrouter.ai/api/v1), Together (api.together.xyz/v1),
 * Groq (api.groq.com/openai/v1), Ollama OpenAI-compat
 * (http://localhost:11434/v1), LM Studio (http://localhost:1234/v1), etc.
 *
 * Pricing is empty by default — the operator sets the rate card for
 * whatever endpoint they're pointing at. `/status` shows `—` for cost.
 *
 * Cache fingerprint includes `baseUrl` so changing the URL invalidates
 * the model-discovery cache (Risk 3 of the multi-provider plan).
 */
export const openaiCompatibleProfile: ProviderProfile = {
  id: "openai-compatible",
  label: "Custom (OpenAI-compatible)",
  defaultModel: "",
  secretKey: "openai_compatible_api_key",

  model: (apiKey: string, modelId: string, settings?: Settings): LanguageModel => {
    const baseURL = settings?.openai_compatible_base_url ?? "";
    if (!baseURL.trim()) {
      throw new Error(
        "openai-compatible: no base URL configured. Set Settings → Providers → Custom (OpenAI-compatible) → Base URL.",
      );
    }
    // NOTE: baseURL is user-controlled — it must pass the shared egress guard
    // (validateProxiedEgressUrl, CP3) before use. Wired here once that lands.
    const compat = createOpenAI({ apiKey, baseURL, fetch: proxiedFetch });
    return compat(modelId);
  },

  fetchModels: async (apiKey: string, settings?: Settings): Promise<string[]> => {
    const baseURL = settings?.openai_compatible_base_url ?? "";
    if (!baseURL.trim()) {
      throw new Error("openai-compatible: no base URL configured");
    }
    const url = `${baseURL.replace(/\/+$/, "")}/models`;
    const response = await proxiedFetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(
        `openai-compatible /models failed: ${response.status} ${response.statusText}`,
      );
    }
    const payload = (await response.json()) as { data?: Array<{ id: string }> };
    if (!Array.isArray(payload.data)) return [];
    return payload.data.map((m) => m.id);
  },

  curatedModels: [],

  pricing: {},

  discoveryFingerprint: (apiKey, settings) => {
    const baseURL = settings.openai_compatible_base_url ?? "";
    return `${apiKey}@${baseURL}`;
  },
};
