import { parseInput } from "./parser";
import { getCommand } from "./registry";
import type { CommandContext, DispatchResult } from "./types";

export async function dispatchInput(text: string, ctx: CommandContext): Promise<DispatchResult> {
  const parsed = parseInput(text);
  if (parsed.kind === "message") {
    return { kind: "message", text: parsed.text };
  }
  const command = getCommand(parsed.name);
  if (!command) {
    return {
      kind: "command-result",
      items: [
        {
          text: `Unknown command: /${parsed.name}. Type /help for available commands.`,
        },
      ],
    };
  }
  const result = await command.handler(parsed.args, ctx);
  return { kind: "command-result", items: result.items };
}
