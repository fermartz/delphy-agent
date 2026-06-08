import { codexAdapter } from "../codex/adapter";
import type { BackendAdapter } from "../types";
import { directApiAdapter } from "./direct-api";
import { echoAdapter } from "./echo";

const ADAPTERS: Record<string, BackendAdapter> = {
  echo: echoAdapter,
  "anthropic-api": directApiAdapter,
  codex: codexAdapter,
};

export function getAdapter(id: string): BackendAdapter | undefined {
  return ADAPTERS[id];
}

export function listAdapters(): BackendAdapter[] {
  return Object.values(ADAPTERS);
}
