import type { Command } from "./types";

const registry = new Map<string, Command>();

export function registerCommand(command: Command): void {
  registry.set(command.name, command);
}

export function getCommand(name: string): Command | undefined {
  return registry.get(name);
}

export function listCommands(): Command[] {
  return Array.from(registry.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function resetRegistryForTests(): void {
  registry.clear();
}
