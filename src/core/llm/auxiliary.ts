import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export interface AuxiliaryCompleteOptions {
  systemPrompt?: string;
  signal?: AbortSignal;
}

// Cheap non-streaming client for compaction, title generation, and other
// helper calls that don't need to feel real-time. v1 supports only the
// Anthropic provider; multi-provider auxiliary lands when a second provider
// profile ships (per the 2026-05-25 "Auxiliary model tier in v1" decision).
export class AuxiliaryClient {
  private readonly apiKey: string;
  private readonly modelId: string;

  constructor({ apiKey, modelId }: { apiKey: string; modelId: string }) {
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  async complete(prompt: string, opts: AuxiliaryCompleteOptions = {}): Promise<string> {
    const anthropic = createAnthropic({ apiKey: this.apiKey });
    const model = anthropic(this.modelId);
    const result = await generateText({
      model,
      system: opts.systemPrompt,
      prompt,
      headers: {
        // Required for browser/webview-origin requests — same opt-in as the
        // chat path in anthropicProfile.headers(). Without it, the API
        // rejects CORS preflight.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      abortSignal: opts.signal,
    });
    return result.text;
  }
}
