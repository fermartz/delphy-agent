import { generateText } from "ai";
import { getProvider } from "../providers";
import type { ProviderProfile } from "../providers/types";
import type { Settings } from "../settings/types";

export interface AuxiliaryCompleteOptions {
  systemPrompt?: string;
  signal?: AbortSignal;
}

/**
 * Cheap non-streaming client for compaction, title generation, and other
 * helper calls that don't need to feel real-time. Generalized in
 * BACKLOG #12.A CP3 to accept any registered `ProviderProfile` — the
 * compactor + memory-tool paths construct one per call with the resolved
 * auxiliary profile (Parameter 12 of the multi-provider plan).
 */
export class AuxiliaryClient {
  private readonly profile: ProviderProfile;
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly settings?: Settings;

  constructor(input: {
    profile?: ProviderProfile;
    providerId?: string;
    apiKey: string;
    modelId: string;
    settings?: Settings;
  }) {
    const profile = input.profile ?? (input.providerId ? getProvider(input.providerId) : undefined);
    if (!profile) {
      throw new Error(
        `AuxiliaryClient: provider "${input.providerId ?? "<unset>"}" not found in registry`,
      );
    }
    this.profile = profile;
    this.apiKey = input.apiKey;
    this.modelId = input.modelId;
    this.settings = input.settings;
  }

  async complete(prompt: string, opts: AuxiliaryCompleteOptions = {}): Promise<string> {
    const model = this.profile.model(this.apiKey, this.modelId, this.settings);
    const result = await generateText({
      model,
      system: opts.systemPrompt,
      prompt,
      headers: this.profile.headers?.(),
      abortSignal: opts.signal,
    });
    return result.text;
  }
}
