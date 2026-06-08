import { act, renderHook, waitFor } from "@testing-library/react";
import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootResult } from "@/core/boot";
import { DEFAULT_SETTINGS } from "@/core/settings/defaults";
import type { AgentEvent, Session } from "@/core/types";

vi.mock("@/core/boot", () => ({ startActiveBackend: vi.fn() }));
vi.mock("@/core/db/sessions", () => ({ getSession: vi.fn(), listSessions: vi.fn() }));
vi.mock("@/core/providers", () => ({ listProviders: vi.fn(() => []) }));
vi.mock("@/core/providers/resolve-key", () => ({ resolveProviderApiKey: vi.fn() }));

import { startActiveBackend } from "@/core/boot";
import { getSession, listSessions } from "@/core/db/sessions";
import { listProviders } from "@/core/providers";
import { resolveProviderApiKey } from "@/core/providers/resolve-key";
import { bootOptsFor, useSession } from "./use-session";

function fakeSession(events: AgentEvent[] = []) {
  const close = vi.fn(async () => {});
  async function* stream() {
    for (const e of events) yield e;
  }
  const session = {
    id: "sess",
    events: stream(),
    close,
    sendMessage: vi.fn(),
    interrupt: vi.fn(),
    respondToApproval: vi.fn(),
    compact: vi.fn(),
  } as unknown as Session;
  return { session, close };
}

function bootResult(overrides: Partial<BootResult> = {}): BootResult {
  return {
    session: fakeSession().session,
    backend: "anthropic-api",
    settings: { ...DEFAULT_SETTINGS, main_provider: "anthropic" },
    initialMessages: [],
    sessionId: "sess-1",
    resumed: false,
    activeProviderId: "anthropic",
    ...overrides,
  };
}

function setup() {
  const clearKeyInput = vi.fn();
  const onSettingsLoaded = vi.fn();
  const view = renderHook(() => useSession({ clearKeyInput, onSettingsLoaded }));
  return { ...view, clearKeyInput, onSettingsLoaded };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listSessions).mockResolvedValue([]);
  vi.mocked(getSession).mockResolvedValue({ created_at: 100 } as never);
  vi.mocked(listProviders).mockReturnValue([]);
  vi.mocked(startActiveBackend).mockResolvedValue(bootResult());
});

describe("bootOptsFor", () => {
  it("maps null/fresh/resume", () => {
    expect(bootOptsFor(null)).toEqual({});
    expect(bootOptsFor({ kind: "fresh" })).toEqual({ freshSession: true });
    expect(bootOptsFor({ kind: "resume", id: "s1" })).toEqual({ resumeSessionId: "s1" });
  });
});

describe("useSession boot", () => {
  it("boots on mount: ready + backend + settings hydration + session list refresh", async () => {
    const { result, onSettingsLoaded } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(startActiveBackend).toHaveBeenCalledWith({});
    expect(result.current.backend).toBe("anthropic-api");
    expect(result.current.activeSessionId).toBe("sess-1");
    expect(result.current.sessionStartedAt).toBe(100);
    expect(onSettingsLoaded).toHaveBeenCalledOnce();
    expect(listSessions).toHaveBeenCalled();
  });

  it("projects initial messages into items", async () => {
    const initialMessages: ModelMessage[] = [{ role: "user", content: "hello there" }];
    vi.mocked(startActiveBackend).mockResolvedValue(bootResult({ initialMessages }));
    const { result } = setup();
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    expect(result.current.items[0]).toMatchObject({ kind: "user-text", text: "hello there" });
  });

  it("triggers First-Run Welcome + preselects a configured provider when main_provider is null", async () => {
    vi.mocked(startActiveBackend).mockResolvedValue(
      bootResult({ settings: { ...DEFAULT_SETTINGS, main_provider: null } }),
    );
    vi.mocked(listProviders).mockReturnValue([
      { id: "anthropic", secretKey: "anthropic_api_key" },
    ] as never);
    vi.mocked(resolveProviderApiKey).mockResolvedValue("sk-123");

    const { result } = setup();
    await waitFor(() => expect(result.current.welcomeOpen).toBe(true));
    expect(result.current.welcomePreselectId).toBe("anthropic");
    expect(result.current.welcomeHasAnyKey).toBe(true);
  });

  it("does NOT trigger Welcome when main_provider is set", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.welcomeOpen).toBe(false);
  });

  it("consumes the event stream: items + usage + context", async () => {
    const events: AgentEvent[] = [
      { type: "text", delta: "hi" },
      { type: "usage", inputTokens: 5, outputTokens: 3 },
      { type: "context_usage", tokensUsed: 1, limit: 2, percent: 42 },
      { type: "done", reason: "complete" },
    ];
    vi.mocked(startActiveBackend).mockResolvedValue(
      bootResult({ session: fakeSession(events).session }),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.contextPercent).toBe(42));
    expect(result.current.items.at(-1)).toMatchObject({ kind: "assistant-text", text: "hi" });
    expect(result.current.sessionTokens).toEqual({ in: 5, out: 3, cached: 0 });
  });

  it("closes the previous session and re-boots on triggerReboot", async () => {
    const a = fakeSession();
    const b = fakeSession();
    vi.mocked(startActiveBackend)
      .mockResolvedValueOnce(bootResult({ session: a.session }))
      .mockResolvedValueOnce(bootResult({ session: b.session }));
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.triggerReboot());
    await waitFor(() => expect(a.close).toHaveBeenCalled());
    expect(startActiveBackend).toHaveBeenCalledTimes(2);
  });

  it("clears the resume request after a fresh boot (next reboot resumes-most-recent)", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.startFreshSession());
    await waitFor(() => expect(startActiveBackend).toHaveBeenCalledWith({ freshSession: true }));

    vi.mocked(startActiveBackend).mockClear();
    act(() => result.current.triggerReboot());
    await waitFor(() => expect(startActiveBackend).toHaveBeenCalledWith({}));
  });

  it("switchToSession boots with the target resumeSessionId", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.switchToSession("other"));
    await waitFor(() =>
      expect(startActiveBackend).toHaveBeenCalledWith({ resumeSessionId: "other" }),
    );
  });

  it("closes the live session on unmount (active-guard teardown)", async () => {
    const s = fakeSession();
    vi.mocked(startActiveBackend).mockResolvedValue(bootResult({ session: s.session }));
    const { result, unmount } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    unmount();
    expect(s.close).toHaveBeenCalled();
  });
});
