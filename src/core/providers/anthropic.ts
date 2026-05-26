import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { ProviderProfile } from "./types";

const ANTHROPIC_BETA_HEADER = "prompt-caching-2024-07-31";
const MODELS_ENDPOINT = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";

export const anthropicProfile: ProviderProfile = {
  id: "anthropic",
  label: "Anthropic (direct API)",
  defaultModel: "claude-sonnet-4-6",
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
        // Required for browser/webview-origin requests — same opt-in as the chat
        // path's headers(). Without it Anthropic's CORS preflight fails with HTTP 400
        // and the fetch surfaces as a generic "Load failed".
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!response.ok) {
      throw new Error(`Anthropic /v1/models failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as { data: Array<{ id: string }> };
    return payload.data.map((m) => m.id);
  },
};
