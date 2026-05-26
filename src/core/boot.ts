import { BootError, type BootErrorKind, directApiAdapter } from "./adapters/direct-api";
import { echoAdapter } from "./adapters/echo";
import { loadSettings } from "./settings/settings";
import type { Settings } from "./settings/types";
import type { Session } from "./types";

export type ActiveBackend = "anthropic-api" | "echo-fallback";

export interface BootResult {
  session: Session;
  backend: ActiveBackend;
  settings: Settings;
  error?: { kind: BootErrorKind; message: string };
}

export async function startActiveBackend(): Promise<BootResult> {
  const settings = await loadSettings();
  try {
    const session = await directApiAdapter.start({ modelId: settings.main_model });
    return { session, backend: "anthropic-api", settings };
  } catch (err) {
    const echoSession = await echoAdapter.start({});
    if (err instanceof BootError) {
      return {
        session: echoSession,
        backend: "echo-fallback",
        settings,
        error: { kind: err.kind, message: err.message },
      };
    }
    return {
      session: echoSession,
      backend: "echo-fallback",
      settings,
      error: {
        kind: "unknown",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
