import { useCallback, useRef, useState } from "react";
import type { BootErrorKind } from "@/core/adapters/direct-api";
import type { ActiveBackend, StartBackendOptions } from "@/core/boot";
import type { Session } from "@/core/types";

export type ResumeRequest = { kind: "fresh" } | { kind: "resume"; id: string } | null;

/** Map a pending resume request to the options startActiveBackend expects. */
export function bootOptsFor(resumeRequest: ResumeRequest): StartBackendOptions {
  if (resumeRequest?.kind === "resume") return { resumeSessionId: resumeRequest.id };
  if (resumeRequest?.kind === "fresh") return { freshSession: true };
  return {};
}

interface UseSessionOptions {
  /** Clear the conversation view: items + token/context counters. */
  resetConversation: () => void;
  /** Stop any in-flight streaming turn. */
  stopStreaming: () => void;
  /** Clear the boot-banner API-key input (full reboot only). */
  clearKeyInput: () => void;
}

/**
 * Owns the session-lifecycle state (backend, boot error, ready flag, resume
 * request, active session/provider ids, session age, reboot counter, and the
 * live Session ref) plus the four imperative lifecycle handlers.
 *
 * CP7 (this slice) keeps the async boot effect in App.tsx — it interleaves
 * App-owned settings/items/welcome/event-loop writes — so the relevant setters
 * are returned here for the effect to drive. CP8 moves that effect into this
 * hook, at which point most of these setters become internal.
 *
 * The reboot/fresh/switch handlers also reset App-owned chat state, injected as
 * the resetConversation / stopStreaming / clearKeyInput callbacks.
 */
export function useSession({ resetConversation, stopStreaming, clearKeyInput }: UseSessionOptions) {
  const [backend, setBackend] = useState<ActiveBackend | null>(null);
  const [bootError, setBootError] = useState<{ kind: BootErrorKind; message: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [rebootCounter, setRebootCounter] = useState(0);
  const [resumeRequest, setResumeRequest] = useState<ResumeRequest>(null);
  const sessionRef = useRef<Session | null>(null);

  // Full reboot: wipe the conversation + key input, then re-run the boot flow.
  const triggerReboot = useCallback(() => {
    resetConversation();
    stopStreaming();
    clearKeyInput();
    setReady(false);
    setSessionStartedAt(null);
    setRebootCounter((c) => c + 1);
  }, [resetConversation, stopStreaming, clearKeyInput]);

  const startFreshSession = useCallback(() => {
    setResumeRequest({ kind: "fresh" });
    resetConversation();
    stopStreaming();
    setReady(false);
    setSessionStartedAt(null);
    setRebootCounter((c) => c + 1);
  }, [resetConversation, stopStreaming]);

  const switchToSession = useCallback(
    (id: string) => {
      if (id === activeSessionId) return;
      setResumeRequest({ kind: "resume", id });
      resetConversation();
      stopStreaming();
      setReady(false);
      setSessionStartedAt(null);
      setRebootCounter((c) => c + 1);
    },
    [activeSessionId, resetConversation, stopStreaming],
  );

  // Restart the session WITHOUT clearing items. Used by /model <id> so a model
  // change takes effect on the next message without wiping visible history.
  const restartSession = useCallback(() => {
    stopStreaming();
    setReady(false);
    setRebootCounter((c) => c + 1);
  }, [stopStreaming]);

  return {
    backend,
    setBackend,
    bootError,
    setBootError,
    ready,
    setReady,
    activeSessionId,
    setActiveSessionId,
    sessionStartedAt,
    setSessionStartedAt,
    activeProviderId,
    setActiveProviderId,
    resumeRequest,
    setResumeRequest,
    rebootCounter,
    sessionRef,
    triggerReboot,
    startFreshSession,
    switchToSession,
    restartSession,
  };
}
