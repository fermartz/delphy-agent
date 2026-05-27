import { invoke } from "@tauri-apps/api/core";
import { Loader2, Send, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { ChatIcon } from "@/components/chat-icon";
import { ColorModeToggle } from "@/components/color-mode-toggle";
import MarkdownText from "@/components/markdown-text";
import { SettingsModal } from "@/components/settings-modal";
import { StatusBar } from "@/components/status-bar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import type { BootErrorKind } from "./core/adapters/direct-api";
import { type ActiveBackend, startActiveBackend } from "./core/boot";
import { type CommandContext, dispatchInput } from "./core/commands";
import { BUILTIN_MCP_CONFIGS } from "./core/mcp/configs";
import { mcpManager } from "./core/mcp/manager";
import type { McpServerStatus } from "./core/mcp/types";
import { anthropicProfile } from "./core/providers/anthropic";
import {
  clearRuntimeKey,
  getRuntimeKey,
  setRuntimeKey,
} from "./core/providers/anthropic-runtime-key";
import { DEFAULT_SETTINGS } from "./core/settings/defaults";
import { saveSettings } from "./core/settings/settings";
import type { ColorMode, Settings } from "./core/settings/types";
import type { RuntimeErrorKind, Session } from "./core/types";
import { applyTheme } from "./themes/apply";
import { injectThemeStyles } from "./themes/inject";
import { loadAllThemes } from "./themes/loader";
import type { Theme } from "./themes/types";
import { subscribeToThemeChanges } from "./themes/watcher";

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
  | { kind: "system"; id: string; text: string; intent?: "info" | "error" };

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
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  // Bumped by the watcher each time it reloads themes from disk, so the
  // apply effect re-runs and re-asserts data-theme + .dark even when the
  // selected_theme / color_mode haven't changed (e.g., the user edited the
  // currently-active theme's JSON in place).
  const [themesVersion, setThemesVersion] = useState(0);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const sessionRef = useRef<Session | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);

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

          case "system_message":
            // Finalize any in-flight streaming assistant message first, so the
            // system item lands cleanly between turns. A subsequent text event
            // (e.g., the actual model reply after auto-compaction) will start
            // a fresh streaming assistant bubble.
            setItems((prev) => [
              ...finalizeInFlight(prev, "complete"),
              { kind: "system", id: nextItemId(), text: event.text, intent: event.intent },
            ]);
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

  // Boot MCP servers in parallel with the chat session + themes loader.
  // Per slice-A plan Parameter 15, failure is non-blocking: each per-server
  // failure is captured as `kind: "failed"` in McpManager state and surfaces
  // in the Settings modal; chat works regardless. Show "connecting…" rows
  // immediately so users see progress while npx warms up on first run.
  useEffect(() => {
    let active = true;
    setMcpStatuses(
      BUILTIN_MCP_CONFIGS.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.enabled ? ("connecting" as const) : ("disabled" as const),
      })),
    );
    void mcpManager.init().then(() => {
      if (!active) return;
      setMcpStatuses(mcpManager.getStatus());
    });
    return () => {
      active = false;
    };
  }, []);

  // Load themes on mount, inject the <style> rules, then subscribe to live
  // changes from the user-themes directory. Each watcher event re-loads,
  // re-injects, and re-applies the current theme.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    (async () => {
      const loaded = await loadAllThemes();
      if (!active) return;
      injectThemeStyles(loaded);
      setThemes(loaded);
      setThemesLoaded(true);

      try {
        unlisten = await subscribeToThemeChanges(async () => {
          const updated = await loadAllThemes();
          if (!active) return;
          injectThemeStyles(updated);
          setThemes(updated);
          setThemesVersion((v) => v + 1);
        });
      } catch (err) {
        // Watcher unavailable (non-Tauri environment, permission denied, etc.) —
        // themes still work, just no live reload.
        console.warn("themes: subscribeToThemeChanges failed", err);
      }
    })();

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  // Apply the selected theme + color mode whenever either changes (or after
  // themes finish loading on boot, or after the watcher reloads themes from
  // disk). themesVersion is a deliberate effect-trigger — bumping it on a
  // watcher reload re-runs applyTheme even when selected_theme + color_mode
  // are unchanged. Returns a cleanup for the "system" mode's matchMedia
  // listener.
  // biome-ignore lint/correctness/useExhaustiveDependencies: themesVersion is an effect-trigger (its value isn't read inside the effect, but bumping it must re-assert data-theme + .dark)
  useEffect(() => {
    if (!themesLoaded) return;
    const cleanup = applyTheme(settings.selected_theme, settings.color_mode);
    return cleanup;
  }, [themesLoaded, themesVersion, settings.selected_theme, settings.color_mode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items is an effect-trigger — its array identity changes on every text delta via appendTextToInFlight, which is exactly when auto-scroll should re-run.
  useEffect(() => {
    if (!stickyBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyBottomRef.current = distFromBottom < 32;
  }

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
          intent: it.intent,
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

  async function handleThemeChange(newThemeId: string) {
    if (newThemeId === settings.selected_theme) return;
    const updated = await saveSettings({ selected_theme: newThemeId });
    setSettings(updated);
    setToast(`Theme updated — ${newThemeId}.`);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleAuxiliaryModelChange(newModel: string) {
    if (newModel === settings.auxiliary_model) return;
    const updated = await saveSettings({ auxiliary_model: newModel });
    setSettings(updated);
    setToast(`Auxiliary model updated — ${newModel}.`);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleColorModeChange(newMode: ColorMode) {
    if (newMode === settings.color_mode) return;
    const updated = await saveSettings({ color_mode: newMode });
    setSettings(updated);
  }

  const backendLabel =
    backend === "anthropic-api"
      ? "Anthropic (Claude)"
      : backend === "echo-fallback"
        ? "echo (fallback)"
        : "…";
  const inputDisabled = streaming || !ready || (backend === "echo-fallback" && bootError !== null);
  const activityLabel = !ready ? "Connecting…" : streaming ? "Streaming…" : "Ready";
  const COMMAND_HINTS = ["/help", "/clear", "/model", "/compact"];

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo size={40} />
          <h1 className="shrink-0 text-lg font-semibold tracking-tight">Delphy Agent</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeSwitcher
            themes={themes}
            selectedThemeId={settings.selected_theme}
            onThemeChange={handleThemeChange}
          />
          <ColorModeToggle mode={settings.color_mode} onChange={handleColorModeChange} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={openSettings}
            aria-label="Open settings"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <SettingsIcon className="h-3 w-3" />
          </Button>
        </div>
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

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {backend === "anthropic-api"
              ? "Type a message to chat with Claude."
              : "Type a message to see the echo adapter stream."}
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id} className="flex gap-2">
                <ChatIcon item={it} />
                <div className="flex-1">{renderItem(it, handleApproval, handleChangeKey)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <StatusBar
        brand="delphy-agent"
        model={settings.main_model}
        activity={activityLabel}
        commandHints={COMMAND_HINTS}
      />

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-border px-4 py-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder={`Message ${backendLabel}...`}
          disabled={inputDisabled}
          className="flex-1 rounded-lg border-none bg-muted px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          disabled={inputDisabled || input.trim().length === 0}
          aria-label="Send message"
          className="mb-0.5 shrink-0"
        >
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={(open) => (open ? openSettings() : closeSettings())}
        currentModel={settings.main_model}
        currentAuxiliaryModel={settings.auxiliary_model}
        availableModels={availableModels}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        themes={themes}
        selectedThemeId={settings.selected_theme}
        colorMode={settings.color_mode}
        mcpStatuses={mcpStatuses}
        onSelectModel={handleModelChange}
        onSelectAuxiliaryModel={handleAuxiliaryModelChange}
        onThemeChange={handleThemeChange}
        onColorModeChange={handleColorModeChange}
        onRetry={openSettings}
      />

      {toast ? (
        <div className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 rounded bg-foreground px-4 py-2 text-xs text-background shadow-lg">
          {toast}
        </div>
      ) : null}
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
        <Button type="button" variant="destructive" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
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
        <Button
          type="submit"
          size="sm"
          disabled={saving || keyInput.trim().length === 0}
          className="bg-amber-600 text-white hover:bg-amber-700"
        >
          {saving ? "Saving..." : isLinuxFallback ? "Use for session" : "Save"}
        </Button>
      </form>
    </div>
  );
}

function renderItem(
  it: ChatItem,
  onApproval: (id: string, allowed: boolean) => void,
  onChangeKey: () => void,
): React.ReactNode {
  switch (it.kind) {
    case "user-text":
      return (
        <span className="inline-block rounded-md bg-muted px-3 py-1.5 text-sm text-foreground whitespace-pre-wrap">
          {it.text}
        </span>
      );
    case "assistant-text":
      return (
        <div className={`text-sm ${it.status === "error" ? "text-red-600" : ""}`}>
          <MarkdownText>{it.text}</MarkdownText>
        </div>
      );
    case "approval":
      return (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
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
              <Button
                type="button"
                size="sm"
                onClick={() => onApproval(it.id, true)}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onApproval(it.id, false)}
                className="border-amber-400 text-amber-900 hover:bg-amber-100"
              >
                Deny
              </Button>
            </div>
          ) : null}
        </div>
      );
    case "tool-call":
      return (
        <div className="font-mono text-sm text-muted-foreground">
          → {it.name}({previewPayload(it.input)})
        </div>
      );
    case "tool-result":
      return (
        <pre
          className={`font-mono text-sm whitespace-pre-wrap ${
            it.isError ? "text-red-600" : "text-foreground"
          }`}
        >
          {previewPayload(it.output)}
        </pre>
      );
    case "runtime-error":
      return (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm">
          <div className="font-medium text-red-900">{runtimeErrorTitle(it.errorKind)}</div>
          <div className="mt-1 text-red-800">{it.message}</div>
          {it.errorKind === "invalid-key" ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onChangeKey}
              className="mt-2"
            >
              Change API key
            </Button>
          ) : null}
        </div>
      );
    case "system":
      return (
        <pre className="font-mono text-sm whitespace-pre-wrap text-muted-foreground italic">
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
