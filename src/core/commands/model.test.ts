import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import modelCommand from "./model";
import type { CommandContext } from "./types";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    settings: { ...DEFAULT_SETTINGS },
    triggerReboot: vi.fn(),
    restartSession: vi.fn(),
    openSettings: vi.fn(),
    saveSettings: vi.fn(async (partial) => ({ ...DEFAULT_SETTINGS, ...partial })),
    fetchModels: vi.fn(async () => ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-7"]),
    compactSession: vi.fn(async () => ({ before: 0, after: 0, tokensSaved: 0 })),
    ...overrides,
  };
}

describe("/model command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("with no args, opens the settings picker and does not save or restart", async () => {
    const ctx = makeCtx();
    const result = await modelCommand.handler("", ctx);
    expect(ctx.openSettings).toHaveBeenCalledTimes(1);
    expect(ctx.saveSettings).not.toHaveBeenCalled();
    expect(ctx.restartSession).not.toHaveBeenCalled();
    expect(result.items[0].text).toMatch(/Opening model picker/);
  });

  it("with a valid arg, saves the new main_model and restarts the session", async () => {
    const ctx = makeCtx();
    const result = await modelCommand.handler("claude-opus-4-7", ctx);
    expect(ctx.saveSettings).toHaveBeenCalledWith({ main_model: "claude-opus-4-7" });
    expect(ctx.restartSession).toHaveBeenCalledTimes(1);
    expect(result.items[0].text).toMatch(/Switched to claude-opus-4-7/);
  });

  it("with an invalid arg, surfaces a 'not found' error and does not save or restart", async () => {
    const ctx = makeCtx();
    const result = await modelCommand.handler("bogus-model", ctx);
    expect(ctx.saveSettings).not.toHaveBeenCalled();
    expect(ctx.restartSession).not.toHaveBeenCalled();
    expect(result.items[0].text).toMatch(/Model not found: bogus-model/);
    expect(result.items[0].text).toMatch(/\/model \(no args\)/);
  });

  it("on fetchModels failure, saves optimistically + restarts + warns the user", async () => {
    const ctx = makeCtx({
      fetchModels: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const result = await modelCommand.handler("some-untested-model", ctx);
    expect(ctx.saveSettings).toHaveBeenCalledWith({ main_model: "some-untested-model" });
    expect(ctx.restartSession).toHaveBeenCalledTimes(1);
    expect(result.items[0].text).toMatch(/Could not verify model id/);
    expect(result.items[0].text).toMatch(/network down/);
  });
});
