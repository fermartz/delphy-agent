import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { BootErrorKind } from "./core/adapters/direct-api";
import { type ActiveBackend, startActiveBackend } from "./core/boot";
import { type CommandContext, dispatchInput } from "./core/commands";
import { anthropicProfile } from "./core/providers/anthropic";
import {
  clearRuntimeKey,
  getRuntimeKey,
  setRuntimeKey,
} from "./core/providers/anthropic-runtime-key";
import { DEFAULT_SETTINGS } from "./core/settings/defaults";
import { saveSettings } from "./core/settings/settings";
import type { Settings } from "./core/settings/types";
import type { RuntimeErrorKind, Session } from "./core/types";

const ANTHROPIC_SECRET_KEY = "anthropic_api_key";

type ChatItem =
  | { kind: "user-text"; id: string; text: string }
  | {
      kind: "assistant-text";
      id: string;
      text: string;
      status: "streaming" | "complete" | "error";
    }
  | {
      kind: "approval";
      id: string;
      action: string;
      payload: unknown;
      verdict?: "allowed" | "denied";
    }
  | { kind: "tool-call"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; id: string; output: unknown; isError?: boolean }
  | { kind: "runtime-error"; id: string; errorKind: RuntimeErrorKind; message: string }
  | { kind: "system"; id: string; text: string };

let itemCounter = 0;
function nextItemId(): string {
  itemCounter += 1;
  return `i-${itemCounter}`;
}

async function resolveAnthropicApiKey(): Promise<string | null> {
  try {
    const stored = await invoke<string | null>("get_secret", { key: ANTHROPIC_SECRET_KEY });
    if (stored && stored.length > 0) return stored;
  } catch {
    // SECURE_STORAGE_UNAVAILABLE on bare Linux — fall through to runtime.
  }
  const runtime = getRuntimeKey();
  return runtime && runtime.length > 0 ? runtime : null;
}

function appendTextToInFlight(items: ChatItem[], delta: string): ChatItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "assistant-text" && last.status === "streaming") {
    return items.map((it, idx) =>
      idx === items.length - 1 && it.kind === "assistant-text"
        ? { ...it, text: it.text + delta }
        : it,
    );
  }
  return [...items, { kind: "assistant-text", id: nextItemId(), text: delta, status: "streaming" }];
}

function finalizeInFlight(items: ChatItem[], status: "complete" | "error"): ChatItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "assistant-text" && last.status === "streaming") {
    return items.map((it, idx) =>
      idx === items.length - 1 && it.kind === "assistant-text" ? { ...it, status } : it,
    );
  }
  return items;
}

function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState<ActiveBackend | null>(null);
  const [bootError, setBootError] = useState<{ kind: BootErrorKind; message: string } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [rebootCounter, setRebootCounter] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);

  function triggerReboot() {
    setItems([]);
    setReady(false);
    setStreaming(false);
    setKeyInput("");
    setRebootCounter((c) => c + 1);
  }

  // Restart the session WITHOUT clearing items. Used by /model <id> so a
  // model change takes effect on the next message without wiping the user's
  // visible chat history. Distinct from triggerReboot() which wipes.
  function restartSession() {
    setReady(false);
    setStreaming(false);
    setRebootCounter((c) => c + 1);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebootCounter is an effect-trigger; its value isn't read inside the effect, but bumping it re-runs the boot flow (used after Save + Change API key).
  useEffect(() => {
    let active = true;

    (async () => {
      const result = await startActiveBackend();
      if (!active) {
        await result.session.close();
        return;
      }
      sessionRef.current = result.session;
      setBackend(result.backend);
      setBootError(result.error ?? null);
      setSettings(result.settings);
      setReady(true);

      for await (const event of result.session.events) {
        if (!active) break;

        switch (event.type) {
          case "text":
            setItems((prev) => appendTextToInFlight(prev, event.delta));
            break;

          case "approval_request":
            setItems((prev) => [
              ...finalizeInFlight(prev, "complete"),
              {
                kind: "approval",
                id: event.id,
                action: event.action,
                payload: event.payload,
              },
            ]);
            break;

          case "tool_call":
            setItems((prev) => [
              ...finalizeInFlight(prev, "complete"),
              { kind: "tool-call", id: event.id, name: event.name, input: event.input },
            ]);
            break;

          case "tool_result":
            setItems((prev) => [
              ...finalizeInFlight(prev, "complete"),
              {
                kind: "tool-result",
                id: event.id,
                output: event.output,
                isError: event.isError,
              },
            ]);
            break;

          case "done":
            setItems((prev) =>
              finalizeInFlight(prev, event.reason === "complete" ? "complete" : "error"),
            );
            setStreaming(false);
            break;

          case "error":
            setItems((prev) => [
              ...finalizeInFlight(prev, "error"),
              {
                kind: "runtime-error",
                id: nextItemId(),
                errorKind: event.kind ?? "unknown",
                message: event.error.message,
              },
            ]);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    setInput("");

    const ctx: CommandContext = {
      settings,
      triggerReboot,
      restartSession,
      openSettings,
      saveSettings: async (partial) => {
        const updated = await saveSettings(partial);
        setSettings(updated);
        return updated;
      },
      fetchModels: async () => {
        const apiKey = await resolveAnthropicApiKey();
        if (!apiKey) throw new Error("No API key set. Set your API key first via the gear icon.");
        if (!anthropicProfile.fetchModels) {
          throw new Error("Model listing is not available for this provider.");
        }
        return anthropicProfile.fetchModels(apiKey);
      },
      compactSession: async (focus) => {
        const session = sessionRef.current;
        if (!session) return { error: "No active session." };
        return session.compact(focus);
      },
    };

    const result = await dispatchInput(trimmed, ctx);

    if (result.kind === "command-result") {
      setItems((prev) => [
        ...prev,
        ...result.items.map((it) => ({
          kind: "system" as const,
          id: nextItemId(),
          text: it.text,
        })),
      ]);
      return;
    }

    const session = sessionRef.current;
    if (!session) return;

    setItems((prev) => [...prev, { kind: "user-text", id: nextItemId(), text: result.text }]);
    setStreaming(true);
    await session.sendMessage(result.text);
  }

  async function handleApproval(approvalId: string, allowed: boolean) {
    const session = sessionRef.current;
    if (!session) return;
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "approval" && it.id === approvalId
          ? { ...it, verdict: allowed ? "allowed" : "denied" }
          : it,
      ),
    );
    await session.respondToApproval(approvalId, allowed);
  }

  async function handleSaveKey() {
    const value = keyInput.trim();
    if (!value || !bootError) return;
    setSaving(true);
    try {
      if (bootError.kind === "secure-storage-unavailable") {
        // Linux fallback: hold key in non-persistent module-level state.
        setRuntimeKey(value);
      } else {
        // macOS / Windows / Linux with Secret Service: persist via Tauri command.
        await invoke("set_secret", { key: ANTHROPIC_SECRET_KEY, value });
      }
      triggerReboot();
    } catch (err) {
      // Save itself failed (rare) — surface inline.
      setBootError({
        kind: "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeKey() {
    try {
      await invoke("delete_secret", { key: ANTHROPIC_SECRET_KEY });
    } catch {
      // ignore — the next boot will surface whatever error
    }
    clearRuntimeKey();
    triggerReboot();
  }

  async function openSettings() {
    setSettingsOpen(true);
    setAvailableModels(null);
    setModelsError(null);
    if (backend !== "anthropic-api") {
      setModelsError("Set your API key first to fetch available models.");
      return;
    }
    if (!anthropicProfile.fetchModels) {
      setModelsError("Model listing is not available for this provider.");
      return;
    }
    setModelsLoading(true);
    try {
      const apiKey = await resolveAnthropicApiKey();
      if (!apiKey) {
        setModelsError("Set your API key first to fetch available models.");
        return;
      }
      const models = await anthropicProfile.fetchModels(apiKey);
      setAvailableModels(models);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelsLoading(false);
    }
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  async function handleModelChange(newModel: string) {
    if (newModel === settings.main_model) {
      closeSettings();
      return;
    }
    const updated = await saveSettings({ main_model: newModel });
    setSettings(updated);
    closeSettings();
    setToast("Model updated — applies on next session.");
    setTimeout(() => setToast(null), 3500);
  }

  const backendLabel =
    backend === "anthropic-api"
      ? "Anthropic (Claude)"
      : backend === "echo-fallback"
        ? "echo (fallback)"
        : "…";
  const inputDisabled = streaming || !ready || (backend === "echo-fallback" && bootError !== null);

  return (
    <main className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 text-sm font-medium">
        <span>
          Delphy Agent
          <span className="ml-2 text-neutral-500">— {backendLabel}</span>
        </span>
        <button
          type="button"
          onClick={openSettings}
          aria-label="Open settings"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <title>Settings</title>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {backend === "echo-fallback" && bootError ? (
        <BootBanner
          errorKind={bootError.kind}
          errorMessage={bootError.message}
          keyInput={keyInput}
          setKeyInput={setKeyInput}
          onSave={handleSaveKey}
          onRetry={triggerReboot}
          saving={saving}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {backend === "anthropic-api"
              ? "Type a message to chat with Claude."
              : "Type a message to see the echo adapter stream."}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id} className="flex gap-3">
                <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-neutral-500">
                  {labelFor(it)}
                </span>
                <div className="flex-1">{renderItem(it, handleApproval, handleChangeKey)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-neutral-200 px-4 py-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder={`Message ${backendLabel}...`}
          disabled={inputDisabled}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none disabled:opacity-50"
        />
      </form>

      {settingsOpen ? (
        <SettingsModal
          currentModel={settings.main_model}
          availableModels={availableModels}
          modelsLoading={modelsLoading}
          modelsError={modelsError}
          onSelect={handleModelChange}
          onClose={closeSettings}
          onRetry={openSettings}
        />
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded bg-neutral-900 px-4 py-2 text-xs text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function SettingsModal({
  currentModel,
  availableModels,
  modelsLoading,
  modelsError,
  onSelect,
  onClose,
  onRetry,
}: {
  currentModel: string;
  availableModels: string[] | null;
  modelsLoading: boolean;
  modelsError: string | null;
  onSelect: (model: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: overlay backdrop click-outside-to-close + Escape — standard modal pattern; dialog content has its own role + close button
    <div
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ×
          </button>
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-neutral-700">Model</div>
          <div className="mt-1 text-xs text-neutral-500">
            Current: <span className="font-mono text-neutral-900">{currentModel}</span>
          </div>

          {modelsLoading ? (
            <div className="mt-3 text-xs text-neutral-500">Loading models…</div>
          ) : modelsError ? (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <div>{modelsError}</div>
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          ) : availableModels ? (
            <>
              <select
                value={currentModel}
                onChange={(e) => onSelect(e.currentTarget.value)}
                className="mt-3 w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-500 focus:outline-none"
              >
                {/* If the current model isn't in the fetched list (e.g., older saved choice), still show it as an option. */}
                {availableModels.includes(currentModel) ? null : (
                  <option value={currentModel}>{currentModel} (saved)</option>
                )}
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-neutral-500">
                Changes apply when you start a new chat — your current conversation keeps its model.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BootBanner({
  errorKind,
  errorMessage,
  keyInput,
  setKeyInput,
  onSave,
  onRetry,
  saving,
}: {
  errorKind: BootErrorKind;
  errorMessage: string;
  keyInput: string;
  setKeyInput: (v: string) => void;
  onSave: () => void;
  onRetry: () => void;
  saving: boolean;
}) {
  if (errorKind === "unknown") {
    return (
      <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <div className="font-medium">Backend failed to start.</div>
        <div className="mt-1 text-xs text-red-800">{errorMessage}</div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  const isLinuxFallback = errorKind === "secure-storage-unavailable";

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-medium">
        {isLinuxFallback
          ? "Secure storage unavailable — session-only key required"
          : "Anthropic API key needed"}
      </div>
      <div className="mt-1 text-xs text-amber-800">
        {isLinuxFallback ? (
          <>
            No Secret Service daemon (GNOME Keyring / KWallet) is running on this Linux system. The
            key you enter will live only in memory for this session and won't be saved. To enable
            persistent storage, install GNOME Keyring or KWallet, then reload.
          </>
        ) : (
          <>
            Get a key at{" "}
            <a
              href="https://console.anthropic.com/"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              console.anthropic.com
            </a>
            . It's stored in your OS keychain (macOS Keychain / Windows Credential Manager / Linux
            Secret Service).
          </>
        )}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          spellCheck="false"
          value={keyInput}
          onChange={(e) => setKeyInput(e.currentTarget.value)}
          placeholder="sk-ant-..."
          disabled={saving}
          className="flex-1 rounded border border-amber-300 bg-white px-3 py-1 text-xs text-neutral-900 focus:border-amber-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={saving || keyInput.trim().length === 0}
          className="rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : isLinuxFallback ? "Use for session" : "Save"}
        </button>
      </form>
    </div>
  );
}

function labelFor(it: ChatItem): string {
  switch (it.kind) {
    case "user-text":
      return "user";
    case "assistant-text":
      return "assistant";
    case "approval":
      return "approval";
    case "tool-call":
      return "tool";
    case "tool-result":
      return "result";
    case "runtime-error":
      return "error";
    case "system":
      return "system";
  }
}

function renderItem(
  it: ChatItem,
  onApproval: (id: string, allowed: boolean) => void,
  onChangeKey: () => void,
): React.ReactNode {
  switch (it.kind) {
    case "user-text":
      return <span>{it.text}</span>;
    case "assistant-text":
      return (
        <span className={it.status === "error" ? "text-red-600" : ""}>
          {it.text}
          {it.status === "streaming" ? <span className="opacity-50">▍</span> : null}
        </span>
      );
    case "approval":
      return (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
          <div className="font-medium text-amber-900">
            {it.verdict
              ? `Approval ${it.verdict} — ${it.action}`
              : `Agent wants to use ${it.action}`}
          </div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-amber-800">
            {previewPayload(it.payload)}
          </pre>
          {!it.verdict ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onApproval(it.id, true)}
                className="rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onApproval(it.id, false)}
                className="rounded border border-amber-400 px-3 py-1 text-xs text-amber-900 hover:bg-amber-100"
              >
                Deny
              </button>
            </div>
          ) : null}
        </div>
      );
    case "tool-call":
      return (
        <div className="font-mono text-xs text-neutral-600">
          → {it.name}({previewPayload(it.input)})
        </div>
      );
    case "tool-result":
      return (
        <pre
          className={`font-mono text-xs whitespace-pre-wrap ${
            it.isError ? "text-red-600" : "text-neutral-700"
          }`}
        >
          {previewPayload(it.output)}
        </pre>
      );
    case "runtime-error":
      return (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs">
          <div className="font-medium text-red-900">{runtimeErrorTitle(it.errorKind)}</div>
          <div className="mt-1 text-red-800">{it.message}</div>
          {it.errorKind === "invalid-key" ? (
            <button
              type="button"
              onClick={onChangeKey}
              className="mt-2 rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
            >
              Change API key
            </button>
          ) : null}
        </div>
      );
    case "system":
      return (
        <pre className="font-mono text-xs whitespace-pre-wrap text-neutral-500 italic">
          {it.text}
        </pre>
      );
  }
}

function runtimeErrorTitle(kind: RuntimeErrorKind): string {
  switch (kind) {
    case "invalid-key":
      return "API key rejected";
    case "rate-limited":
      return "Rate limited";
    case "network":
      return "Network error";
    case "model-deprecated":
      return "Model unavailable";
    case "unknown":
      return "Unexpected error";
  }
}

function previewPayload(payload: unknown): string {
  if (typeof payload === "string")
    return payload.length > 400 ? `${payload.slice(0, 400)}…` : payload;
  try {
    const json = JSON.stringify(payload, null, 2);
    return json.length > 400 ? `${json.slice(0, 400)}…` : json;
  } catch {
    return String(payload);
  }
}

export default App;
