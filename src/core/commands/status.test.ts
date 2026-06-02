import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import statusCommand from "./status";
import type { CommandContext, StatusSnapshot } from "./types";

function makeCtx(snapshot: StatusSnapshot): CommandContext {
  return {
    settings: { ...DEFAULT_SETTINGS },
    triggerReboot: vi.fn(),
    restartSession: vi.fn(),
    openSettings: vi.fn(),
    saveSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    fetchModels: vi.fn(async () => []),
    compactSession: vi.fn(async () => ({ before: 0, after: 0, tokensSaved: 0 })),
    getStatus: () => snapshot,
  };
}

describe("/status command", () => {
  it("renders all snapshot fields in a system message", async () => {
    const ctx = makeCtx({
      sessionId: "s-1780000000-42",
      sessionStartedAt: null,
      mainProviderId: "anthropic",
      mainModelId: "claude-sonnet-4-6",
      auxiliaryProviderId: null,
      auxiliaryModelId: null,
      messageCount: 7,
      usage: {
        inputTokens: 12345,
        outputTokens: 4567,
        cachedInputTokens: 1500,
        turns: 3,
        contextTokens: 18412,
        contextLimit: 200_000,
        contextPercent: 0.092,
      },
      lastCompaction: null,
      mcpServers: [{ id: "fetch", toolCount: 1 }],
    });

    const result = await statusCommand.handler("", ctx);
    const text = result.items[0].text;

    expect(text).toContain("Session: s-1780000000");
    expect(text).toContain("Main: anthropic / claude-sonnet-4-6");
    expect(text).toContain("Auxiliary: (= main)");
    expect(text).toContain("Messages: 7");
    // Token line carries the in/out/cached breakdown plus a total (Parameter 17).
    expect(text).toContain("12,345 in / 4,567 out / 1,500 cached / 18,412 total");
    expect(text).toContain("9%");
    expect(text).toContain("Turns: 3");
    expect(text).toContain("MCP: fetch (1 tools)");
    // Cost should be present (Sonnet pricing in the profile + non-zero tokens).
    expect(text).toMatch(/Estimated cost: \$[\d.]+/);
  });

  it("renders session age + last-compaction summary when present", async () => {
    const now = Date.now();
    const ctx = makeCtx({
      sessionId: "s-abc-123",
      sessionStartedAt: now - 3 * 60 * 1000, // 3 minutes ago
      mainProviderId: "anthropic",
      mainModelId: "claude-sonnet-4-6",
      auxiliaryProviderId: null,
      auxiliaryModelId: null,
      messageCount: 2,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        turns: 1,
        contextTokens: 150,
        contextLimit: 200_000,
        contextPercent: 0.00075,
      },
      lastCompaction: {
        before: 18_000,
        after: 9_000,
        tokensSaved: 9_000,
        at: now - 60 * 1000, // 1 minute ago
      },
      mcpServers: [],
    });

    const result = await statusCommand.handler("", ctx);
    const text = result.items[0].text;

    expect(text).toContain("Session: s-abc-123 · 3m");
    expect(text).toContain("Last compaction: 18,000 → 9,000 tokens (saved 9,000, 1m ago)");
    // No cached tokens this session — total is in + out.
    expect(text).toContain("100 in / 50 out / 150 total");
  });

  it("flags excluded auxiliary cost when aux provider differs and a compaction ran", async () => {
    const now = Date.now();
    const ctx = makeCtx({
      sessionId: "s-mixed-1",
      sessionStartedAt: now - 5 * 60 * 1000,
      mainProviderId: "anthropic",
      mainModelId: "claude-sonnet-4-6",
      auxiliaryProviderId: "openai",
      auxiliaryModelId: "gpt-4o-mini",
      messageCount: 4,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 0,
        turns: 2,
        contextTokens: 1500,
        contextLimit: 200_000,
        contextPercent: 0.0075,
      },
      lastCompaction: { before: 50_000, after: 20_000, tokensSaved: 30_000, at: now - 30 * 1000 },
      mcpServers: [],
    });

    const result = await statusCommand.handler("", ctx);
    expect(result.items[0].text).toMatch(
      /Estimated cost: \$[\d.]+ \(excludes auxiliary compaction cost\)/,
    );
  });

  it("renders '—' for cost when model has no pricing", async () => {
    const ctx = makeCtx({
      sessionId: null,
      sessionStartedAt: null,
      mainProviderId: "anthropic",
      mainModelId: "claude-vapor-9999", // not in the pricing table
      auxiliaryProviderId: null,
      auxiliaryModelId: null,
      messageCount: 0,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        turns: 1,
        contextTokens: 100,
        contextLimit: 200_000,
        contextPercent: 0.0005,
      },
      lastCompaction: null,
      mcpServers: [],
    });

    const result = await statusCommand.handler("", ctx);
    expect(result.items[0].text).toContain("Estimated cost: —");
  });

  it("renders '—' for tokens when no usage yet", async () => {
    const ctx = makeCtx({
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
    });

    const result = await statusCommand.handler("", ctx);
    const text = result.items[0].text;
    expect(text).toContain("Tokens: — (no usage events yet)");
    expect(text).toContain("MCP: (no connected servers)");
  });
});
