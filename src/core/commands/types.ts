import type { Settings } from "../settings/types";

export type ParsedInput =
  | { kind: "command"; name: string; args: string }
  | { kind: "message"; text: string };

export interface CommandContext {
  settings: Settings;
  triggerReboot: () => void;
  restartSession: () => void;
  openSettings: () => void;
  saveSettings: (partial: Partial<Settings>) => Promise<Settings>;
  fetchModels: () => Promise<string[]>;
  compactSession: (
    focus?: string,
  ) => Promise<{ before: number; after: number; tokensSaved: number } | { error: string }>;
}

export interface CommandResultItem {
  text: string;
  intent?: "info" | "error";
}

export interface CommandResult {
  items: CommandResultItem[];
}

export type DispatchResult =
  | { kind: "message"; text: string }
  | { kind: "command-result"; items: CommandResultItem[] };

export interface Command {
  name: string;
  description: string;
  argHelp?: string;
  handler(args: string, ctx: CommandContext): Promise<CommandResult>;
}
