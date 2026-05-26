import clearCommand from "./clear";
import compactCommand from "./compact";
import helpCommand from "./help";
import modelCommand from "./model";
import { registerCommand } from "./registry";

export { dispatchInput } from "./dispatch";
export { parseInput } from "./parser";
export { getCommand, listCommands } from "./registry";
export type {
  Command,
  CommandContext,
  CommandResult,
  CommandResultItem,
  DispatchResult,
  ParsedInput,
} from "./types";

// Register built-in commands at module load.
registerCommand(helpCommand);
registerCommand(clearCommand);
registerCommand(modelCommand);
registerCommand(compactCommand);
