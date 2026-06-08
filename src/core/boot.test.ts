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

vi.mock("./codex/adapter", () => ({
  codexAdapter: { id: "codex", kind: "agent-cli", label: "Codex", start: vi.fn() },
}));

vi.mock("./db/memory", () => ({
  loadMemory: vi.fn().mockResolvedValue(""),
  saveMemory: vi.fn().mockResolvedValue({ saved: "", truncated: false }),
  GLOBAL_MEMORY_ID: "global",
  MEMORY_MAX_CHARS: 3000,
}));

vi.mock("./session-manager", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({
    sessionId: "s-test",
    initialMessages: [],
    persister: {
      append: vi.fn().mockResolvedValue(undefined),
      replace: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(undefined),
    },
    resumed: false,
  }),
  createFreshSession: vi.fn().mockResolvedValue({
    sessionId: "s-fresh",
    initialMessages: [],
    persister: {
      append: vi.fn().mockResolvedValue(undefined),
      replace: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(undefined),
    },
    resumed: false,
  }),
  loadSessionContext: vi.fn().mockResolvedValue({
    initialMessages: [],
    persister: {
      append: vi.fn().mockResolvedValue(undefined),
      replace: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

import { directApiAdapter } from "./adapters/direct-api";
import { startActiveBackend } from "./boot";
import { codexAdapter } from "./codex/adapter";
import { CodexConnectError } from "./codex/connect";
import { resolveSessionContext } from "./session-manager";
import { DEFAULT_SETTINGS } from "./settings/defaults";
import { loadSettings } from "./settings/settings";

const mockedLoadSettings = vi.mocked(loadSettings);
// biome-ignore lint/suspicious/noExplicitAny: mocked adapter shape
const mockedCodexStart = vi.mocked(codexAdapter.start) as any;
const fakeSession = () => ({
  id: "x",
  sendMessage: vi.fn(),
  events: {
    [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
  },
  interrupt: vi.fn(),
  close: vi.fn(),
  respondToApproval: vi.fn(),
  compact: vi.fn(),
});
// biome-ignore lint/suspicious/noExplicitAny: mocked adapter shape
const mockedStart = vi.mocked(directApiAdapter.start) as any;

describe("startActiveBackend → directApiAdapter pass-through", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes settings.main_model + settings.auxiliary_model through to directApiAdapter.start", async () => {
    mockedLoadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      main_model: "claude-opus-4-7",
      auxiliary_model: "claude-haiku-4-5",
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
      compact: vi.fn(async () => ({ before: 0, after: 0, tokensSaved: 0 })),
    });

    const result = await startActiveBackend();

    expect(mockedStart).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "claude-opus-4-7",
        auxiliaryModelId: "claude-haiku-4-5",
      }),
    );
    expect(result.backend).toBe("anthropic-api");
  });

  it("uses settings defaults for both main and auxiliary when not overridden", async () => {
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
      compact: vi.fn(async () => ({ before: 0, after: 0, tokensSaved: 0 })),
    });

    await startActiveBackend();

    // Post-BACKLOG #12.A: DEFAULT_SETTINGS.main_model / auxiliary_model are
    // null until First-Run Welcome (Parameter 10) sets them. boot.ts applies
    // a hardcoded Anthropic fallback in CP1 (replaced by the polymorphic
    // resolver in CP3). The test now pins the fallback values.
    expect(mockedStart).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "claude-sonnet-4-6",
        auxiliaryModelId: "claude-haiku-4-5",
      }),
    );
  });

  it("threads a custom auxiliary_model through to directApiAdapter.start (pins R1-1 contract)", async () => {
    mockedLoadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      auxiliary_model: "gemini-2.5-flash",
    });
    mockedStart.mockResolvedValue({
      id: "direct-api-3",
      sendMessage: vi.fn(),
      events: {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      },
      interrupt: vi.fn(),
      close: vi.fn(),
      respondToApproval: vi.fn(),
      compact: vi.fn(async () => ({ before: 0, after: 0, tokensSaved: 0 })),
    });

    await startActiveBackend();

    expect(mockedStart).toHaveBeenCalledWith(
      expect.objectContaining({ auxiliaryModelId: "gemini-2.5-flash" }),
    );
  });
});

describe("startActiveBackend → Codex backend (ephemeral)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts an ephemeral Codex session with the configured cwd, bypassing session resolution", async () => {
    mockedLoadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      default_backend: "codex",
      codex_working_dir: "/work",
    });
    mockedCodexStart.mockResolvedValue(fakeSession());

    const result = await startActiveBackend();

    expect(codexAdapter.start).toHaveBeenCalledWith({ cwd: "/work" });
    expect(result.backend).toBe("codex");
    expect(result.sessionId).toBeNull();
    expect(result.activeProviderId).toBeNull();
    expect(result.error).toBeUndefined();
    // Ephemeral: the direct-API session-resolution path is not touched.
    expect(resolveSessionContext).not.toHaveBeenCalled();
    expect(directApiAdapter.start).not.toHaveBeenCalled();
  });

  it("falls back to echo with codex-no-workdir when no working directory is set", async () => {
    mockedLoadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      default_backend: "codex",
      codex_working_dir: null,
    });

    const result = await startActiveBackend();

    expect(codexAdapter.start).not.toHaveBeenCalled();
    expect(result.backend).toBe("echo-fallback");
    expect(result.error?.kind).toBe("codex-no-workdir");
  });

  it("falls back to echo with codex-missing when the Codex binary is not installed", async () => {
    mockedLoadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      default_backend: "codex",
      codex_working_dir: "/work",
    });
    mockedCodexStart.mockRejectedValue(new CodexConnectError("not-installed", "no codex on PATH"));

    const result = await startActiveBackend();

    expect(result.backend).toBe("echo-fallback");
    expect(result.error?.kind).toBe("codex-missing");
  });
});
