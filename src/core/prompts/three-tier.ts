export interface SystemPromptSlices {
  stable: string;
  context: string;
  volatile: string;
}

export const DEFAULT_STABLE_PROMPT =
  "You are Delphy Agent, a desktop AI assistant. Be concise and helpful.";

export function defaultSystemPromptSlices(): SystemPromptSlices {
  return {
    stable: DEFAULT_STABLE_PROMPT,
    context: "",
    volatile: "",
  };
}

export function buildSystemPrompt(slices: SystemPromptSlices): string {
  return [slices.stable, slices.context, slices.volatile]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}
