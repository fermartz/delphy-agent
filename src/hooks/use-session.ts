import { useCallback, useEffect, useRef, useState } from "react";
import type { BootErrorKind } from "@/core/adapters/direct-api";
import { type ActiveBackend, type StartBackendOptions, startActiveBackend } from "@/core/boot";
import { nextItemId } from "@/core/chat/item-id";
import { reduceChatItems } from "@/core/chat/items-reducer";
import { type ChatItem, projectMessagesToChatItems } from "@/core/chat-projection";
import { getSession, listSessions, type SessionListEntry } from "@/core/db/sessions";
import { listProviders } from "@/core/providers";
import { resolveProviderApiKey } from "@/core/providers/resolve-key";
import type { Settings } from "@/core/settings/types";
import type { Session } from "@/core/types";

export type ResumeRequest = { kind: "fresh" } | { kind: "resume"; id: string } | null;

/** Map a pending resume request to the options startActiveBackend expects. */
export function bootOptsFor(resumeRequest: ResumeRequest): StartBackendOptions {
  if (resumeRequest?.kind === "resume") return { resumeSessionId: resumeRequest.id };
  if (resumeRequest?.kind === "fresh") return { freshSession: true };
  return {};
}

interface UseSessionOptions {
  /** Clear the boot-banner API-key input (full reboot only — App owns it). */
  clearKeyInput: () => void;
  /** Hydrate App's settings from the booted backend's loaded settings. */
  onSettingsLoaded: (settings: Settings) => void;
}

/**
 * Owns the live agent session: the conversation (items), streaming/turn state,
 * token + context usage, the session list, the lifecycle state (backend, boot
 * error, ready, active session/provider ids, session age), the First-Run
 * Welcome trigger state, and the live Session ref. Drives the boot flow + event
 * loop on each rebootCounter bump.
 *
 * App keeps only the boot-banner key input + app-wide settings, injected as
 * clearKeyInput + onSettingsLoaded.
 */
export function useSession({ clearKeyInput, onSettingsLoaded }: UseSessionOptions) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionTokens, setSessionTokens] = useState<{ in: number; out: number; cached: number }>({
    in: 0,
    out: 0,
    cached: 0,
  });
  const [contextPercent, setContextPercent] = useState(0);
  const [sessionList, setSessionList] = useState<SessionListEntry[]>([]);
  const [backend, setBackend] = useState<ActiveBackend | null>(null);
  const [bootError, setBootError] = useState<{ kind: BootErrorKind; message: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [rebootCounter, setRebootCounter] = useState(0);
  const [resumeRequest, setResumeRequest] = useState<ResumeRequest>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [welcomePreselectId, setWelcomePreselectId] = useState<string | null>(null);
  const [welcomeHasAnyKey, setWelcomeHasAnyKey] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  const resetConversation = useCallback(() => {
    setItems([]);
    setSessionTokens({ in: 0, out: 0, cached: 0 });
    setContextPercent(0);
  }, []);

  const refreshSessionList = useCallback(async () => {
    try {
      setSessionList(await listSessions());
    } catch (err) {
      console.warn("listSessions failed", err);
    }
  }, []);

  // Full reboot: wipe the conversation + key input, then re-run the boot flow.
  const triggerReboot = useCallback(() => {
    resetConversation();
    setStreaming(false);
    clearKeyInput();
    setReady(false);
    setSessionStartedAt(null);
    setRebootCounter((c) => c + 1);
  }, [resetConversation, clearKeyInput]);

  const startFreshSession = useCallback(() => {
    setResumeRequest({ kind: "fresh" });
    resetConversation();
    setStreaming(false);
    setReady(false);
    setSessionStartedAt(null);
    setRebootCounter((c) => c + 1);
  }, [resetConversation]);

  const switchToSession = useCallback(
    (id: string) => {
      if (id === activeSessionId) return;
      setResumeRequest({ kind: "resume", id });
      resetConversation();
      setStreaming(false);
      setReady(false);
      setSessionStartedAt(null);
      setRebootCounter((c) => c + 1);
    },
    [activeSessionId, resetConversation],
  );

  // Restart the session WITHOUT clearing items. Used by /model <id> so a model
  // change takes effect on the next message without wiping visible history.
  const restartSession = useCallback(() => {
    setStreaming(false);
    setReady(false);
    setRebootCounter((c) => c + 1);
  }, []);

  // Boot (or re-boot) the backend on each rebootCounter bump, then consume the
  // session's event stream. Failure is non-blocking — startActiveBackend falls
  // back to the echo adapter and surfaces a boot error.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebootCounter is an effect-trigger; its value isn't read inside the effect, but bumping it re-runs the boot flow (used after Save + Change API key).
  useEffect(() => {
    let active = true;

    (async () => {
      const result = await startActiveBackend(bootOptsFor(resumeRequest));
      if (!active) {
        await result.session.close();
        return;
      }
      sessionRef.current = result.session;
      setBackend(result.backend);
      setBootError(result.error ?? null);
      onSettingsLoaded(result.settings);
      setActiveSessionId(result.sessionId);
      setActiveProviderId(result.activeProviderId);
      // Resolve created_at for the session row (resumed sessions have a row
      // already; fresh sessions get a row created lazily on first persist).
      if (result.sessionId) {
        try {
          const row = await getSession(result.sessionId);
          if (active) setSessionStartedAt(row?.created_at ?? null);
        } catch {
          /* boot continues without session-age */
        }
      } else {
        setSessionStartedAt(null);
      }
      if (result.initialMessages.length > 0) {
        setItems(projectMessagesToChatItems(result.initialMessages));
      }
      void refreshSessionList();
      setReady(true);
      setResumeRequest(null);

      // Single trigger for First-Run Welcome — settings.main_provider is null at
      // boot. Keychain state only affects the Welcome content (pre-selection +
      // copy), never the trigger.
      if (result.settings.main_provider === null) {
        const probed = await Promise.all(
          listProviders().map(async (p) => {
            const stored = await resolveProviderApiKey(p.secretKey);
            return stored && stored.length > 0 ? p.id : null;
          }),
        );
        const firstConfigured = probed.find((id) => id !== null) ?? null;
        if (!active) return;
        setWelcomePreselectId(firstConfigured);
        setWelcomeHasAnyKey(firstConfigured !== null);
        setWelcomeOpen(true);
      }

      for await (const event of result.session.events) {
        if (!active) break;

        // Items projection is a pure reducer (core/chat/items-reducer). Events
        // that don't touch items return the same reference, so this is a no-op
        // render for usage/context_usage/thinking.
        setItems((prev) => reduceChatItems(prev, event, nextItemId));

        // Side effects that lived alongside the item cases stay here.
        switch (event.type) {
          case "done":
            setStreaming(false);
            void refreshSessionList();
            break;
          case "usage":
            setSessionTokens((prev) => ({
              in: prev.in + event.inputTokens,
              out: prev.out + event.outputTokens,
              cached: prev.cached + (event.cachedInputTokens ?? 0),
            }));
            break;
          case "context_usage":
            setContextPercent(event.percent);
            break;
          case "error":
            setStreaming(false);
            break;
          default:
            break;
        }
      }
    })();

    return () => {
      active = false;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [rebootCounter]);

  return {
    items,
    setItems,
    streaming,
    setStreaming,
    sessionTokens,
    contextPercent,
    sessionList,
    backend,
    bootError,
    setBootError,
    ready,
    activeSessionId,
    activeProviderId,
    sessionStartedAt,
    sessionRef,
    welcomeOpen,
    setWelcomeOpen,
    welcomePreselectId,
    welcomeHasAnyKey,
    triggerReboot,
    startFreshSession,
    switchToSession,
    restartSession,
  };
}
