import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "./apply";

// jsdom doesn't implement matchMedia by default; provide a controllable stub.
interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _fire: (matches: boolean) => void;
}

let fakeMq: FakeMediaQueryList;

beforeEach(() => {
  document.documentElement.dataset.theme = "";
  document.documentElement.classList.remove("dark");

  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  fakeMq = {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_evt: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.push(cb);
    }),
    removeEventListener: vi.fn((_evt: string, cb: (event: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    _fire(matches: boolean) {
      this.matches = matches;
      for (const cb of listeners) {
        cb({ matches } as MediaQueryListEvent);
      }
    },
  };
  // jsdom doesn't define matchMedia by default; assign directly rather than spying.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => fakeMq as unknown as MediaQueryList),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyTheme", () => {
  it("sets data-theme on <html>", () => {
    applyTheme("perpetuity", "light");
    expect(document.documentElement.dataset.theme).toBe("perpetuity");
  });

  it("mode='light' removes the dark class", () => {
    document.documentElement.classList.add("dark");
    applyTheme("perpetuity", "light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("mode='dark' adds the dark class", () => {
    applyTheme("perpetuity", "dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("mode='system' follows the matchMedia result on initial apply", () => {
    fakeMq.matches = true;
    applyTheme("perpetuity", "system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("mode='system' adds a listener and reacts to OS changes", () => {
    fakeMq.matches = false;
    applyTheme("perpetuity", "system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // OS flips to dark.
    fakeMq._fire(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // OS flips back to light.
    fakeMq._fire(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("cleanup function returned by mode='system' removes the listener", () => {
    fakeMq.matches = false;
    const cleanup = applyTheme("perpetuity", "system");
    expect(fakeMq.addEventListener).toHaveBeenCalledTimes(1);
    cleanup();
    expect(fakeMq.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("mode='light'/'dark' return a no-op cleanup", () => {
    const cleanupLight = applyTheme("perpetuity", "light");
    const cleanupDark = applyTheme("perpetuity", "dark");
    // Should not throw and should not have registered any listener.
    cleanupLight();
    cleanupDark();
    expect(fakeMq.addEventListener).not.toHaveBeenCalled();
  });
});
