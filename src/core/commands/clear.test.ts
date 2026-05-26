import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import clearCommand from "./clear";
import type { CommandContext } from "./types";

function makeCtx(): CommandContext {
  return {
    settings: { ...DEFAULT_SETTINGS },
    triggerReboot: vi.fn(),
    restartSession: vi.fn(),
    openSettings: vi.fn(),
    saveSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    fetchModels: vi.fn(async () => []),
  };
}

describe("/clear command", () => {
  it("invokes ctx.triggerReboot exactly once", async () => {
    const ctx = makeCtx();
    await clearCommand.handler("", ctx);
    expect(ctx.triggerReboot).toHaveBeenCalledTimes(1);
  });

  it("returns a confirmation item", async () => {
    const ctx = makeCtx();
    const result = await clearCommand.handler("", ctx);
    expect(result.items).toEqual([{ text: "Chat cleared." }]);
  });
});
