import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./settings/settings", () => ({
  loadSettings: vi.fn(),
}));

vi.mock("./adapters/direct-api", async () => {
  const actual =
    await vi.importActual<typeof import("./adapters/direct-api")>("./adapters/direct-api");
  return {
    ...actual,
    directApiAdapter: {
      id: "anthropic-api",
      kind: "direct-api",
      label: "Anthropic (Claude)",
      start: vi.fn(),
    },
  };
});

vi.mock("./adapters/echo", () => ({
  echoAdapter: {
    id: "echo",
    kind: "direct-api",
    label: "Echo",
    start: vi.fn(async () => ({
      id: "echo-1",
      sendMessage: vi.fn(),
      events: {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      },
      interrupt: vi.fn(),
      close: vi.fn(),
      respondToApproval: vi.fn(),
    })),
  },
}));

import { directApiAdapter } from "./adapters/direct-api";
import { startActiveBackend } from "./boot";
import { DEFAULT_SETTINGS } from "./settings/defaults";
import { loadSettings } from "./settings/settings";

const mockedLoadSettings = vi.mocked(loadSettings);
// biome-ignore lint/suspicious/noExplicitAny: mocked adapter shape
const mockedStart = vi.mocked(directApiAdapter.start) as any;

describe("startActiveBackend → directApiAdapter pass-through", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes settings.main_model through to directApiAdapter.start as modelId", async () => {
    mockedLoadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      main_model: "claude-opus-4-7",
    });
    mockedStart.mockResolvedValue({
      id: "direct-api-1",
      sendMessage: vi.fn(),
      events: {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      },
      interrupt: vi.fn(),
      close: vi.fn(),
      respondToApproval: vi.fn(),
    });

    const result = await startActiveBackend();

    expect(mockedStart).toHaveBeenCalledWith({ modelId: "claude-opus-4-7" });
    expect(result.backend).toBe("anthropic-api");
  });

  it("uses settings.main_model even when it is the default value", async () => {
    mockedLoadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockedStart.mockResolvedValue({
      id: "direct-api-2",
      sendMessage: vi.fn(),
      events: {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      },
      interrupt: vi.fn(),
      close: vi.fn(),
      respondToApproval: vi.fn(),
    });

    await startActiveBackend();

    expect(mockedStart).toHaveBeenCalledWith({ modelId: DEFAULT_SETTINGS.main_model });
  });
});
