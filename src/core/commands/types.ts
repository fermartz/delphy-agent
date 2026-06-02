import type { Settings } from "../settings/types";
import type { UsageSnapshot } from "../types";

export interface CompactionSnapshot {
  before: number;
  after: number;
  tokensSaved: number;
  at: number; // Date.now() of the compaction event
}

export interface StatusSnapshot {
  sessionId: string | null;
  sessionStartedAt: number | null;
  mainProviderId: string | null;
  mainModelId: string | null;
  auxiliaryProviderId: string | null;
  auxiliaryModelId: string | null;
  messageCount: number;
  usage: UsageSnapshot | null;
  lastCompaction: CompactionSnapshot | null;
  mcpServers: Array<{ id: string; toolCount: number }>;
}

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
  getStatus: () => StatusSnapshot;
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
