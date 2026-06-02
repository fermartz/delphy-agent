// Back-compat shim for the pre-multi-provider runtime-key API. New code
// should import from `./runtime-keys` and pass the provider's secretKey.
// This module hard-codes the Anthropic secret key so existing call sites
// keep working until they migrate.

import {
  clearRuntimeKey as clearKey,
  getRuntimeKey as getKey,
  setRuntimeKey as setKey,
} from "./runtime-keys";

const ANTHROPIC_SECRET_KEY = "anthropic_api_key";

export function getRuntimeKey(): string | null {
  return getKey(ANTHROPIC_SECRET_KEY);
}

export function setRuntimeKey(value: string): void {
  setKey(ANTHROPIC_SECRET_KEY, value);
}

export function clearRuntimeKey(): void {
  clearKey(ANTHROPIC_SECRET_KEY);
}
