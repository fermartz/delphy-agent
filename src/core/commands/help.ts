import { listCommands } from "./registry";
import type { Command, CommandResult } from "./types";

const helpCommand: Command = {
  name: "help",
  description: "List available commands",
  async handler(_args, _ctx): Promise<CommandResult> {
    const lines: string[] = ["Available commands:"];
    for (const cmd of listCommands()) {
      const arg = cmd.argHelp ? ` ${cmd.argHelp}` : "";
      lines.push(`  /${cmd.name}${arg} — ${cmd.description}`);
    }
    return { items: [{ text: lines.join("\n") }] };
  },
};

export default helpCommand;
