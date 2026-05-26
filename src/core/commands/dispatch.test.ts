import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { dispatchInput } from "./dispatch";
// Import the index module so the built-in commands register themselves.
import "./index";
import type { CommandContext } from "./types";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    settings: { ...DEFAULT_SETTINGS },
    triggerReboot: vi.fn(),
    restartSession: vi.fn(),
    openSettings: vi.fn(),
    saveSettings: vi.fn(async (partial) => ({ ...DEFAULT_SETTINGS, ...partial })),
    fetchModels: vi.fn(async () => ["claude-sonnet-4-6", "claude-haiku-4-5"]),
    ...overrides,
  };
}

describe("dispatchInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("'/help' returns command-result and does not take the message path", async () => {
    const ctx = makeCtx();
    const result = await dispatchInput("/help", ctx);
    expect(result.kind).toBe("command-result");
    if (result.kind === "command-result") {
      expect(result.items[0].text).toMatch(/Available commands/);
    }
  });

  it("'/clear' invokes ctx.triggerReboot via the registered handler", async () => {
    const ctx = makeCtx();
    const result = await dispatchInput("/clear", ctx);
    expect(ctx.triggerReboot).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("command-result");
  });

  it("'/model claude-haiku-4-5' invokes saveSettings + restartSession", async () => {
    const ctx = makeCtx();
    const result = await dispatchInput("/model claude-haiku-4-5", ctx);
    expect(ctx.saveSettings).toHaveBeenCalledWith({ main_model: "claude-haiku-4-5" });
    expect(ctx.restartSession).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("command-result");
  });

  it("plain message text returns kind: 'message' with no ctx callbacks invoked", async () => {
    const ctx = makeCtx();
    const result = await dispatchInput("hello world", ctx);
    expect(result).toEqual({ kind: "message", text: "hello world" });
    expect(ctx.triggerReboot).not.toHaveBeenCalled();
    expect(ctx.restartSession).not.toHaveBeenCalled();
    expect(ctx.openSettings).not.toHaveBeenCalled();
    expect(ctx.saveSettings).not.toHaveBeenCalled();
  });

  it("'/foo' (unknown command) returns command-result with the friendly error", async () => {
    const ctx = makeCtx();
    const result = await dispatchInput("/foo", ctx);
    expect(result.kind).toBe("command-result");
    if (result.kind === "command-result") {
      expect(result.items[0].text).toMatch(/Unknown command: \/foo/);
      expect(result.items[0].text).toMatch(/Type \/help/);
    }
    expect(ctx.triggerReboot).not.toHaveBeenCalled();
    expect(ctx.restartSession).not.toHaveBeenCalled();
  });
});
