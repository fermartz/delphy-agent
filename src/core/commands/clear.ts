import type { Command, CommandResult } from "./types";

const clearCommand: Command = {
  name: "clear",
  description: "Clear the chat history and start a fresh session",
  async handler(_args, ctx): Promise<CommandResult> {
    ctx.triggerReboot();
    // The reboot wipes existing items; this confirmation lands in the fresh chat.
    return { items: [{ text: "Chat cleared." }] };
  },
};

export default clearCommand;
