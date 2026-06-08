import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { bootOptsFor, useSession } from "./use-session";

describe("bootOptsFor", () => {
  it("maps null to empty options (default resume-most-recent)", () => {
    expect(bootOptsFor(null)).toEqual({});
  });
  it("maps a fresh request to freshSession", () => {
    expect(bootOptsFor({ kind: "fresh" })).toEqual({ freshSession: true });
  });
  it("maps a resume request to resumeSessionId", () => {
    expect(bootOptsFor({ kind: "resume", id: "s1" })).toEqual({ resumeSessionId: "s1" });
  });
});

describe("useSession handlers", () => {
  let resetConversation: Mock<() => void>;
  let stopStreaming: Mock<() => void>;
  let clearKeyInput: Mock<() => void>;

  function setup() {
    resetConversation = vi.fn<() => void>();
    stopStreaming = vi.fn<() => void>();
    clearKeyInput = vi.fn<() => void>();
    return renderHook(() => useSession({ resetConversation, stopStreaming, clearKeyInput }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggerReboot wipes conversation + key input + session state and bumps the counter", () => {
    const { result } = setup();
    act(() => {
      result.current.setReady(true);
      result.current.setSessionStartedAt(123);
    });
    const before = result.current.rebootCounter;
    act(() => result.current.triggerReboot());

    expect(resetConversation).toHaveBeenCalledOnce();
    expect(stopStreaming).toHaveBeenCalledOnce();
    expect(clearKeyInput).toHaveBeenCalledOnce();
    expect(result.current.ready).toBe(false);
    expect(result.current.sessionStartedAt).toBeNull();
    expect(result.current.rebootCounter).toBe(before + 1);
  });

  it("startFreshSession sets a fresh resume request and resets without clearing the key input", () => {
    const { result } = setup();
    act(() => {
      result.current.setReady(true);
      result.current.setSessionStartedAt(5);
    });
    const before = result.current.rebootCounter;
    act(() => result.current.startFreshSession());

    expect(result.current.resumeRequest).toEqual({ kind: "fresh" });
    expect(resetConversation).toHaveBeenCalledOnce();
    expect(stopStreaming).toHaveBeenCalledOnce();
    expect(clearKeyInput).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
    expect(result.current.sessionStartedAt).toBeNull();
    expect(result.current.rebootCounter).toBe(before + 1);
  });

  it("switchToSession requests a resume of the target id", () => {
    const { result } = setup();
    const before = result.current.rebootCounter;
    act(() => result.current.switchToSession("s2"));

    expect(result.current.resumeRequest).toEqual({ kind: "resume", id: "s2" });
    expect(resetConversation).toHaveBeenCalledOnce();
    expect(stopStreaming).toHaveBeenCalledOnce();
    expect(result.current.rebootCounter).toBe(before + 1);
  });

  it("switchToSession is a no-op when the id is already active", () => {
    const { result } = setup();
    act(() => result.current.setActiveSessionId("s1"));
    const before = result.current.rebootCounter;
    vi.clearAllMocks();
    act(() => result.current.switchToSession("s1"));

    expect(resetConversation).not.toHaveBeenCalled();
    expect(stopStreaming).not.toHaveBeenCalled();
    expect(result.current.rebootCounter).toBe(before);
    expect(result.current.resumeRequest).toBeNull();
  });

  it("restartSession stops streaming + reboots but does NOT clear items/key input", () => {
    const { result } = setup();
    act(() => result.current.setReady(true));
    const before = result.current.rebootCounter;
    act(() => result.current.restartSession());

    expect(stopStreaming).toHaveBeenCalledOnce();
    expect(resetConversation).not.toHaveBeenCalled();
    expect(clearKeyInput).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
    expect(result.current.rebootCounter).toBe(before + 1);
  });
});
