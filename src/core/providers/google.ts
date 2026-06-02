import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ProviderProfile } from "./types";

const MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// Pricing per https://ai.google.dev/gemini-api/docs/pricing (as of 2026-06-02).
// Gemini 2.5 has free tier + paid tier; values here are paid-tier rates.
const PRICING = {
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-2.5-flash-lite": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
} as const;

export const googleProfile: ProviderProfile = {
  id: "google",
  label: "Google (Gemini)",
  defaultModel: "gemini-2.5-flash",
  defaultAuxiliaryModel: "gemini-2.5-flash-lite",
  secretKey: "google_api_key",

  model: (apiKey: string, modelId: string): LanguageModel => {
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  },

  fetchModels: async (apiKey: string): Promise<string[]> => {
    // Google's models endpoint uses ?key= query param rather than a bearer header.
    const response = await fetch(`${MODELS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) {
      throw new Error(`Google /v1beta/models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { models?: Array<{ name: string }> };
    // Names come as "models/gemini-2.5-flash" — strip the prefix to match what
    // the model factory expects.
    return (payload.models ?? []).map((m) => m.name.replace(/^models\//, ""));
  },

  curatedModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],

  pricing: PRICING,

  discoveryFingerprint: (apiKey) => apiKey,
};
