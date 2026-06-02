import type { ModelMessage } from "ai";
import { BootError, type BootErrorKind, directApiAdapter } from "./adapters/direct-api";
import { echoAdapter } from "./adapters/echo";
import { loadMemory } from "./db/memory";
import { getProvider } from "./providers";
import { createFreshSession, loadSessionContext, resolveSessionContext } from "./session-manager";
import { migrateProviderBootstrap } from "./settings/migrate";
import { loadSettings } from "./settings/settings";
import type { Settings } from "./settings/types";
import type { Session } from "./types";

/**
 * Active backend identifier surfaced to the UI. Today it's either the
 * direct-API adapter (potentially fronting any registered provider via
 * Parameter 11 of the multi-provider plan) or the echo fallback. Keeping
 * this as a discriminated string lets the UI branch on "real backend vs
 * fallback" without caring which provider is behind direct-API.
 */
export type ActiveBackend = "anthropic-api" | "echo-fallback";

export interface BootResult {
  session: Session;
  backend: ActiveBackend;
  settings: Settings;
  initialMessages: ModelMessage[];
  sessionId: string | null;
  resumed: boolean;
  /**
   * The provider id the session was started against (null when fallback
   * to echo). Surfaced so the UI can label the bootscreen correctly per
   * Parameter 9 of the multi-provider plan.
   */
  activeProviderId: string | null;
  error?: { kind: BootErrorKind; message: string };
}

export interface StartBackendOptions {
  resumeSessionId?: string;
  freshSession?: boolean;
}

export async function startActiveBackend(opts: StartBackendOptions = {}): Promise<BootResult> {
  try {
    await migrateProviderBootstrap();
  } catch (err) {
    console.warn("[boot] migrateProviderBootstrap failed", err);
  }
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

  // Resolve the active provider + model. Per Parameter 10a, null settings
  // mean "use defaults": main_provider=null → defer to First-Run Welcome
  // (CP6); for now we fall back to anthropic so the boot path stays
  // functional in dev. main_model=null → use the resolved profile's
  // defaultModel.
  const mainProviderId = settings.main_provider ?? "anthropic";
  const mainProfile = getProvider(mainProviderId);
  const mainModel = settings.main_model ?? mainProfile?.defaultModel ?? "claude-sonnet-4-6";
  const auxProviderId = settings.auxiliary_provider ?? mainProviderId;
  const auxProfile = getProvider(auxProviderId);
  const auxModel =
    settings.auxiliary_model ??
    auxProfile?.defaultAuxiliaryModel ??
    auxProfile?.defaultModel ??
    "claude-haiku-4-5";

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
        mainProvider: mainProviderId,
        mainModel,
      });
      sessionId = ctx.sessionId;
      persister = ctx.persister;
    } else {
      const ctx = await resolveSessionContext({
        backendId: "anthropic-api",
        mainProvider: mainProviderId,
        mainModel,
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
      providerId: mainProviderId,
      modelId: mainModel,
      auxiliaryProviderId: auxProviderId,
      auxiliaryModelId: auxModel,
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
      activeProviderId: mainProviderId,
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
      activeProviderId: null,
      error: errorPayload,
    };
  }
}
