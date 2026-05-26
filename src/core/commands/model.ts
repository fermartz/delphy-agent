import type { Command, CommandResult } from "./types";

const modelCommand: Command = {
  name: "model",
  description: "View or change the active model",
  argHelp: "[<model-id>]",
  async handler(args, ctx): Promise<CommandResult> {
    if (!args) {
      ctx.openSettings();
      return { items: [{ text: "Opening model picker…" }] };
    }

    let models: string[];
    try {
      models = await ctx.fetchModels();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.saveSettings({ main_model: args });
      ctx.restartSession();
      return {
        items: [
          {
            text: `Could not verify model id (${message}). Saved optimistically; the next message will surface a runtime error if the id is wrong.`,
          },
        ],
      };
    }

    if (!models.includes(args)) {
      return {
        items: [
          {
            text: `Model not found: ${args}. Type /model (no args) to open the picker and see available models.`,
          },
        ],
      };
    }

    await ctx.saveSettings({ main_model: args });
    ctx.restartSession();
    return { items: [{ text: `Switched to ${args}.` }] };
  },
};

export default modelCommand;
