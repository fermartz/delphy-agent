import type { LanguageModel, ModelMessage } from "ai";

export interface ProviderProfile {
  id: string;
  label: string;
  defaultModel: string;
  secretKey: string;
  model: (apiKey: string, modelId: string) => LanguageModel;
  headers?: () => Record<string, string>;
  prepareMessages?: (messages: ModelMessage[]) => ModelMessage[];
  buildExtraBody?: (ctx: { modelId: string; messages: ModelMessage[] }) => Record<string, unknown>;
  fetchModels?: (apiKey: string) => Promise<string[]>;
  fixedTemperature?: number;
  sdkOptions?: Record<string, unknown>;
}
