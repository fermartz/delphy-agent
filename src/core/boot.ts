import { BootError, type BootErrorKind, directApiAdapter } from "./adapters/direct-api";
import { echoAdapter } from "./adapters/echo";
import type { Session } from "./types";

export type ActiveBackend = "anthropic-api" | "echo-fallback";

export interface BootResult {
  session: Session;
  backend: ActiveBackend;
  error?: { kind: BootErrorKind; message: string };
}

export async function startActiveBackend(): Promise<BootResult> {
  try {
    const session = await directApiAdapter.start({});
    return { session, backend: "anthropic-api" };
  } catch (err) {
    const echoSession = await echoAdapter.start({});
    if (err instanceof BootError) {
      return {
        session: echoSession,
        backend: "echo-fallback",
        error: { kind: err.kind, message: err.message },
      };
    }
    return {
      session: echoSession,
      backend: "echo-fallback",
      error: {
        kind: "unknown",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
