import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { BootErrorKind } from "./core/adapters/direct-api";
import { type ActiveBackend, startActiveBackend } from "./core/boot";
import { clearRuntimeKey, setRuntimeKey } from "./core/providers/anthropic-runtime-key";
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
  | { kind: "runtime-error"; id: string; errorKind: RuntimeErrorKind; message: string };

let itemCounter = 0;
function nextItemId(): string {
  itemCounter += 1;
  return `i-${itemCounter}`;
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
  const sessionRef = useRef<Session | null>(null);

  function triggerReboot() {
    setItems([]);
    setReady(false);
    setStreaming(false);
    setKeyInput("");
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
    const session = sessionRef.current;
    const trimmed = input.trim();
    if (!session || !trimmed || streaming) return;

    setItems((prev) => [...prev, { kind: "user-text", id: nextItemId(), text: trimmed }]);
    setInput("");
    setStreaming(true);
    await session.sendMessage(trimmed);
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

  const backendLabel =
    backend === "anthropic-api"
      ? "Anthropic (Claude)"
      : backend === "echo-fallback"
        ? "echo (fallback)"
        : "…";
  const inputDisabled = streaming || !ready || (backend === "echo-fallback" && bootError !== null);

  return (
    <main className="flex h-screen flex-col bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 px-4 py-3 text-sm font-medium">
        Delphy Agent
        <span className="ml-2 text-neutral-500">— {backendLabel}</span>
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
    </main>
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
