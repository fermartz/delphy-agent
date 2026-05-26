import type { Command, CommandResult } from "./types";

const compactCommand: Command = {
  name: "compact",
  description: "Compress the middle of the conversation to free token budget",
  argHelp: "[<focus>]",
  async handler(args, ctx): Promise<CommandResult> {
    const focus = args.trim() || undefined;
    const result = await ctx.compactSession(focus);
    if ("error" in result) {
      return { items: [{ text: result.error }] };
    }
    if (result.before === result.after) {
      return {
        items: [{ text: "Nothing to compact — conversation is too short." }],
      };
    }
    return {
      items: [
        {
          text: `Compacted: ${result.before} → ${result.after} messages, ~${result.tokensSaved.toLocaleString()} tokens saved.`,
        },
      ],
    };
  },
};

export default compactCommand;
