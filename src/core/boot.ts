import type { ModelMessage } from "ai";
import { BootError, type BootErrorKind, directApiAdapter } from "./adapters/direct-api";
import { echoAdapter } from "./adapters/echo";
import { loadMemory } from "./db/memory";
import { createFreshSession, loadSessionContext, resolveSessionContext } from "./session-manager";
import { loadSettings } from "./settings/settings";
import type { Settings } from "./settings/types";
import type { Session } from "./types";

export type ActiveBackend = "anthropic-api" | "echo-fallback";

export interface BootResult {
  session: Session;
  backend: ActiveBackend;
  settings: Settings;
  initialMessages: ModelMessage[];
  sessionId: string | null;
  resumed: boolean;
  error?: { kind: BootErrorKind; message: string };
}

export interface StartBackendOptions {
  // When set, skips most-recent lookup and resumes this exact DB session id.
  resumeSessionId?: string;
  // When true, forces a fresh DB session row even if a matching recent one exists.
  freshSession?: boolean;
}

export async function startActiveBackend(opts: StartBackendOptions = {}): Promise<BootResult> {
  const settings = await loadSettings();

  let sessionId: string | null = null;
  let initialMessages: ModelMessage[] = [];
  let resumed = false;
  let persister: Awaited<ReturnType<typeof resolveSessionContext>>["persister"] | undefined;
  let initialMemory = "";

  try {
    initialMemory = await loadMemory();
  } catch (err) {
    console.warn("[boot] loadMemory failed", err);
  }

  try {
    if (opts.resumeSessionId) {
      const ctx = await loadSessionContext(opts.resumeSessionId);
      sessionId = opts.resumeSessionId;
      initialMessages = ctx.initialMessages;
      persister = ctx.persister;
      resumed = true;
    } else if (opts.freshSession) {
      const ctx = await createFreshSession({
        backendId: "anthropic-api",
        mainModel: settings.main_model,
      });
      sessionId = ctx.sessionId;
      persister = ctx.persister;
    } else {
      const ctx = await resolveSessionContext({
        backendId: "anthropic-api",
        mainModel: settings.main_model,
      });
      sessionId = ctx.sessionId;
      initialMessages = ctx.initialMessages;
      persister = ctx.persister;
      resumed = ctx.resumed;
    }
  } catch (err) {
    console.warn("[boot] session context unavailable, running ephemeral", err);
  }

  try {
    const session = await directApiAdapter.start({
      modelId: settings.main_model,
      auxiliaryModelId: settings.auxiliary_model,
      sessionId: sessionId ?? undefined,
      initialMessages,
      initialMemory,
      persister,
    });
    return {
      session,
      backend: "anthropic-api",
      settings,
      initialMessages,
      sessionId,
      resumed,
    };
  } catch (err) {
    const echoSession = await echoAdapter.start({});
    const errorPayload =
      err instanceof BootError
        ? { kind: err.kind, message: err.message }
        : {
            kind: "unknown" as const,
            message: err instanceof Error ? err.message : String(err),
          };
    return {
      session: echoSession,
      backend: "echo-fallback",
      settings,
      initialMessages: [],
      sessionId,
      resumed: false,
      error: errorPayload,
    };
  }
}
