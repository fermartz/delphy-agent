import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => {
    return vi.fn((modelId: string) => ({ modelId, __fakeProvider: true }));
  }),
}));

import { generateText } from "ai";
import { AuxiliaryClient } from "./auxiliary";

const mockedGenerateText = vi.mocked(generateText);

describe("AuxiliaryClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns text on a successful complete() call", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock factory ergonomics
    mockedGenerateText.mockResolvedValueOnce({ text: "summarized output" } as any);
    const client = new AuxiliaryClient({
      providerId: "anthropic",
      apiKey: "sk-ant-test",
      modelId: "claude-haiku-4-5",
    });
    const result = await client.complete("summarize this");
    expect(result).toBe("summarized output");
  });

  it("throws when generateText fails", async () => {
    mockedGenerateText.mockRejectedValueOnce(new Error("upstream failure"));
    const client = new AuxiliaryClient({
      providerId: "anthropic",
      apiKey: "sk-ant-test",
      modelId: "claude-haiku-4-5",
    });
    await expect(client.complete("summarize this")).rejects.toThrow("upstream failure");
  });

  it("passes systemPrompt and the profile-supplied headers to generateText", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock factory ergonomics
    mockedGenerateText.mockResolvedValueOnce({ text: "ok" } as any);
    const client = new AuxiliaryClient({
      providerId: "anthropic",
      apiKey: "sk-ant-test",
      modelId: "claude-haiku-4-5",
    });
    await client.complete("user prompt", { systemPrompt: "you are a summarizer" });

    const callArgs = mockedGenerateText.mock.calls[0][0];
    expect(callArgs.system).toBe("you are a summarizer");
    expect(callArgs.prompt).toBe("user prompt");
    expect(callArgs.headers).toMatchObject({
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("throws when the provided providerId is not registered", () => {
    expect(
      () =>
        new AuxiliaryClient({
          providerId: "nonexistent",
          apiKey: "k",
          modelId: "m",
        }),
    ).toThrow(/not found in registry/);
  });
});
