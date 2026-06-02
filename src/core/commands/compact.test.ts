import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import compactCommand from "./compact";
import type { CommandContext } from "./types";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    settings: { ...DEFAULT_SETTINGS },
    triggerReboot: vi.fn(),
    restartSession: vi.fn(),
    openSettings: vi.fn(),
    saveSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    fetchModels: vi.fn(async () => []),
    compactSession: vi.fn(async () => ({ before: 30, after: 9, tokensSaved: 14000 })),
    getStatus: vi.fn(() => ({
      sessionId: null,
      sessionStartedAt: null,
      mainProviderId: null,
      mainModelId: null,
      auxiliaryProviderId: null,
      auxiliaryModelId: null,
      messageCount: 0,
      usage: null,
      lastCompaction: null,
      mcpServers: [],
    })),
    ...overrides,
  };
}

describe("/compact command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("on success, returns a metrics line", async () => {
    const ctx = makeCtx();
    const result = await compactCommand.handler("", ctx);
    expect(ctx.compactSession).toHaveBeenCalledWith(undefined);
    expect(result.items[0].text).toMatch(/Compacted: 30 → 9 messages/);
    expect(result.items[0].text).toMatch(/14,000 tokens saved/);
  });

  it("passes a focus argument through to ctx.compactSession", async () => {
    const ctx = makeCtx();
    await compactCommand.handler("the deploy pipeline", ctx);
    expect(ctx.compactSession).toHaveBeenCalledWith("the deploy pipeline");
  });

  it("surfaces an error message when ctx.compactSession returns { error }", async () => {
    const ctx = makeCtx({
      compactSession: vi.fn(async () => ({
        error: "Compact is not supported by the echo adapter.",
      })),
    });
    const result = await compactCommand.handler("", ctx);
    expect(result.items[0].text).toMatch(/Compact is not supported/);
  });

  it("when before === after (nothing changed), emits 'Nothing to compact'", async () => {
    const ctx = makeCtx({
      compactSession: vi.fn(async () => ({ before: 5, after: 5, tokensSaved: 0 })),
    });
    const result = await compactCommand.handler("", ctx);
    expect(result.items[0].text).toMatch(/Nothing to compact/);
  });
});
