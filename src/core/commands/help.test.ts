import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import helpCommand from "./help";
import { registerCommand, resetRegistryForTests } from "./registry";
import type { Command, CommandContext } from "./types";

function makeCtx(): CommandContext {
  return {
    settings: { ...DEFAULT_SETTINGS },
    triggerReboot: vi.fn(),
    restartSession: vi.fn(),
    openSettings: vi.fn(),
    saveSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    fetchModels: vi.fn(async () => []),
    compactSession: vi.fn(async () => ({ before: 0, after: 0, tokensSaved: 0 })),
  };
}

describe("/help command", () => {
  beforeEach(() => {
    resetRegistryForTests();
  });

  it("emits a help item listing every registered command in alpha order", async () => {
    const dummy: Command = {
      name: "zzz-last",
      description: "Z command",
      async handler() {
        return { items: [] };
      },
    };
    registerCommand(helpCommand);
    registerCommand(dummy);

    const result = await helpCommand.handler("", makeCtx());

    expect(result.items).toHaveLength(1);
    const text = result.items[0].text;
    expect(text).toMatch(/Available commands:/);
    expect(text).toMatch(/\/help/);
    expect(text).toMatch(/\/zzz-last/);
    // alpha order: help (h) comes before zzz-last (z)
    expect(text.indexOf("/help")).toBeLessThan(text.indexOf("/zzz-last"));
  });

  it("includes argHelp in the listing when a command defines it", async () => {
    const withArgs: Command = {
      name: "thing",
      description: "Does a thing",
      argHelp: "[<arg>]",
      async handler() {
        return { items: [] };
      },
    };
    registerCommand(withArgs);

    const result = await helpCommand.handler("", makeCtx());
    expect(result.items[0].text).toMatch(/\/thing \[<arg>\] — Does a thing/);
  });
});
