import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { listen } from "@tauri-apps/api/event";
import { subscribeToThemeChanges } from "./watcher";

const mockedListen = vi.mocked(listen);

describe("subscribeToThemeChanges", () => {
  // biome-ignore lint/suspicious/noExplicitAny: event-handler type from Tauri's listen()
  let capturedHandler: any;
  let unlistenSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    unlistenSpy = vi.fn();
    mockedListen.mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: vi.mocked typing struggles with UnlistenFn
      (async (_event: string, handler: any) => {
        capturedHandler = handler;
        return unlistenSpy as unknown as () => void;
        // biome-ignore lint/suspicious/noExplicitAny: outer cast also needed to satisfy listen's overloaded signature
      }) as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("invokes handler once after the debounce window when called once", async () => {
    const handler = vi.fn();
    await subscribeToThemeChanges(handler);
    // Simulate the Tauri event firing.
    // biome-ignore lint/suspicious/noExplicitAny: event payload type
    capturedHandler({ payload: null } as any);
    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(handler).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple rapid events within 200ms into a single handler call", async () => {
    const handler = vi.fn();
    await subscribeToThemeChanges(handler);
    // 5 rapid events spaced 30ms apart — all fall in one debounce window.
    for (let i = 0; i < 5; i++) {
      // biome-ignore lint/suspicious/noExplicitAny: event payload type
      capturedHandler({ payload: null } as any);
      vi.advanceTimersByTime(30);
    }
    // Now advance past the debounce.
    vi.advanceTimersByTime(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires the handler twice when events are spaced >=200ms apart", async () => {
    const handler = vi.fn();
    await subscribeToThemeChanges(handler);
    // biome-ignore lint/suspicious/noExplicitAny: event payload type
    capturedHandler({ payload: null } as any);
    vi.advanceTimersByTime(250);
    expect(handler).toHaveBeenCalledTimes(1);
    // biome-ignore lint/suspicious/noExplicitAny: event payload type
    capturedHandler({ payload: null } as any);
    vi.advanceTimersByTime(250);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("returned unlisten cancels both the Tauri subscription and any pending debounce timer", async () => {
    const handler = vi.fn();
    const unlisten = await subscribeToThemeChanges(handler);
    // biome-ignore lint/suspicious/noExplicitAny: event payload type
    capturedHandler({ payload: null } as any);
    // Pending timer scheduled. Cancel before it fires.
    unlisten();
    vi.advanceTimersByTime(300);
    expect(handler).not.toHaveBeenCalled();
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });
});
