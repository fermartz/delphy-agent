import type { LanguageModel, ModelMessage } from "ai";
import type { Settings } from "../settings/types";

/**
 * Pricing per million tokens, in USD. Used by `/status` (Parameter 17 of
 * the multi-provider plan) to estimate session cost. Update each profile's
 * pricing block as vendors revise their rate cards.
 */
export interface ProviderPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /**
   * Optional cached-input rate (used when the provider exposes a discount
   * for prompt-cached reads). Falls back to `inputPerMTok * 0.1` when
   * unset (Anthropic's typical 90% discount).
   */
  cachedInputPerMTok?: number;
}

export interface ProviderProfile {
  id: string;
  label: string;
  defaultModel: string;
  /**
   * Suggested default for the auxiliary tier (compaction, title-gen). When
   * unset, falls back to `defaultModel`. Profiles should pick the cheapest
   * capable model from their lineup.
   */
  defaultAuxiliaryModel?: string;
  secretKey: string;
  model: (apiKey: string, modelId: string, settings?: Settings) => LanguageModel;
  headers?: () => Record<string, string>;
  prepareMessages?: (messages: ModelMessage[]) => ModelMessage[];
  buildExtraBody?: (ctx: { modelId: string; messages: ModelMessage[] }) => Record<string, unknown>;
  fetchModels?: (apiKey: string, settings?: Settings) => Promise<string[]>;
  fixedTemperature?: number;
  sdkOptions?: Record<string, unknown>;

  /**
   * Hand-curated list of model IDs shown as defaults in the model picker.
   * `fetchModels` results surface under a "Show all" expander.
   */
  curatedModels: string[];

  /**
   * Per-million-token pricing table, keyed by model ID. Used by `/status`
   * for cost estimation. Models without an entry render `—` for cost.
   * Set to an empty object on profiles where pricing varies by user
   * (OpenAI-compatible custom endpoints — operator sets the rate).
   */
  pricing: Record<string, ProviderPricing>;

  /**
   * Returns a string that uniquely identifies the model-discovery target.
   * Most profiles return `apiKey`; per-instance profiles (Custom
   * OpenAI-compatible) also include their base URL or other config so
   * changing it invalidates the discovery cache. Per Parameter 5.
   */
  discoveryFingerprint: (apiKey: string, settings: Settings) => string;
}
