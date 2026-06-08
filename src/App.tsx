import { invoke } from "@tauri-apps/api/core";
import { Loader2, Send, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BootBanner } from "@/components/boot-banner";
import { BrandLogo } from "@/components/brand-logo";
import { ChatIcon } from "@/components/chat-icon";
import { ChatMessage } from "@/components/chat-message";
import { ColorModeToggle } from "@/components/color-mode-toggle";
import { FirstRunWelcome } from "@/components/first-run-welcome";
import type { ProviderRowState } from "@/components/providers-panel";
import { SessionSidebar } from "@/components/session-sidebar";
import { SettingsModal } from "@/components/settings-modal";
import { StatusBar } from "@/components/status-bar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import type { BootErrorKind } from "./core/adapters/direct-api";
import { type ActiveBackend, startActiveBackend } from "./core/boot";
import { reduceChatItems } from "./core/chat/items-reducer";
import { type ChatItem, projectMessagesToChatItems } from "./core/chat-projection";
import { type CommandContext, dispatchInput } from "./core/commands";
import { getSession, listSessions, type SessionListEntry } from "./core/db/sessions";
import { mcpManager } from "./core/mcp/manager";
import { loadMcpConfigs, saveMcpConfigs } from "./core/mcp/store";
import type { McpServerConfig, McpServerStatus } from "./core/mcp/types";
import { getProvider, listProviders } from "./core/providers";
import { anthropicProfile } from "./core/providers/anthropic";
import {
  fetchDiscovery,
  invalidate as invalidateDiscovery,
} from "./core/providers/discovery-cache";
import { clearRuntimeKey, getRuntimeKey, setRuntimeKey } from "./core/providers/runtime-keys";
import { DEFAULT_SETTINGS } from "./core/settings/defaults";
import { saveSettings } from "./core/settings/settings";
import type { ColorMode, Settings } from "./core/settings/types";
import type { Session } from "./core/types";
import { applyTheme } from "./themes/apply";
import { injectThemeStyles } from "./themes/inject";
import { loadAllThemes } from "./themes/loader";
import type { Theme } from "./themes/types";
import { subscribeToThemeChanges } from "./themes/watcher";

let itemCounter = 0;
function nextItemId(): string {
  itemCounter += 1;
  return `i-${itemCounter}`;
}

async function resolveProviderApiKey(secretKey: string): Promise<string | null> {
  try {
    const stored = await invoke<string | null>("get_secret", { key: secretKey });
    if (stored && stored.length > 0) return stored;
  } catch {
    // SECURE_STORAGE_UNAVAILABLE on bare Linux — fall through to runtime.
  }
  const runtime = getRuntimeKey(secretKey);
  return runtime && runtime.length > 0 ? runtime : null;
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
  const [toast, setToast] = useState<string | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themesLoaded, setThemesLoaded] = useState(false);
  // Bumped by the watcher each time it reloads themes from disk, so the
  // apply effect re-runs and re-asserts data-theme + .dark even when the
  // selected_theme / color_mode haven't changed (e.g., the user edited the
  // currently-active theme's JSON in place).
  const [themesVersion, setThemesVersion] = useState(0);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [mcpConfigs, setMcpConfigs] = useState<McpServerConfig[]>([]);
  const [sessionList, setSessionList] = useState<SessionListEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [resumeRequest, setResumeRequest] = useState<
    { kind: "fresh" } | { kind: "resume"; id: string } | null
  >(null);

  // Profile for the current active provider, derived from boot state. Falls
  // back to Anthropic so legacy code paths (BootBanner, /v1/models fetch)
  // keep working before the user completes First-Run Welcome in CP6.
  const activeProfile =
    (activeProviderId ? getProvider(activeProviderId) : null) ?? anthropicProfile;

  // CP4: Providers panel state + per-session token usage accumulator. The
  // states map is keyed by provider id; entries materialize when the user
  // opens Settings and we probe each profile's keychain entry.
  const [providerStates, setProviderStates] = useState<Record<string, ProviderRowState>>({});
  const [providerEditId, setProviderEditId] = useState<string | null>(null);
  const [providerHighlightId, setProviderHighlightId] = useState<string | null>(null);
  const [providerSaving, setProviderSaving] = useState(false);
  const [sessionTokens, setSessionTokens] = useState<{
    in: number;
    out: number;
    cached: number;
  }>({ in: 0, out: 0, cached: 0 });
  const [contextPercent, setContextPercent] = useState(0);
  // CP6 First-Run Welcome state. Trigger is the single condition
  // `settings.main_provider == null` (Parameter 10).
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [welcomePreselectId, setWelcomePreselectId] = useState<string | null>(null);
  const [welcomeHasAnyKey, setWelcomeHasAnyKey] = useState(false);

  const providerProfiles = listProviders();
  const sessionRef = useRef<Session | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);

  function triggerReboot() {
    setItems([]);
    setReady(false);
    setStreaming(false);
    setKeyInput("");
    setSessionTokens({ in: 0, out: 0, cached: 0 });
    setContextPercent(0);
    setSessionStartedAt(null);
    setRebootCounter((c) => c + 1);
  }

  async function refreshSessionList() {
    try {
      const list = await listSessions();
      setSessionList(list);
    } catch (err) {
      console.warn("listSessions failed", err);
    }
  }

  function startFreshSession() {
    setResumeRequest({ kind: "fresh" });
    setItems([]);
    setReady(false);
    setStreaming(false);
    setSessionTokens({ in: 0, out: 0, cached: 0 });
    setContextPercent(0);
    setSessionStartedAt(null);
    setRebootCounter((c) => c + 1);
  }

  function switchToSession(id: string) {
    if (id === activeSessionId) return;
    setResumeRequest({ kind: "resume", id });
    setItems([]);
    setReady(false);
    setStreaming(false);
    setSessionTokens({ in: 0, out: 0, cached: 0 });
    setContextPercent(0);
    setSessionStartedAt(null);
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
      const bootOpts =
        resumeRequest?.kind === "resume"
          ? { resumeSessionId: resumeRequest.id }
          : resumeRequest?.kind === "fresh"
            ? { freshSession: true }
            : {};
      const result = await startActiveBackend(bootOpts);
      if (!active) {
        await result.session.close();
        return;
      }
      sessionRef.current = result.session;
      setBackend(result.backend);
      setBootError(result.error ?? null);
      setSettings(result.settings);
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

      // CP6 Parameter 10: single trigger for First-Run Welcome —
      // settings.main_provider is null at boot. Keychain state only affects
      // the Welcome content (pre-selection + copy), never the trigger.
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

  // Boot MCP servers in parallel with the chat session + themes loader.
  // Per slice-A plan Parameter 15, failure is non-blocking: each per-server
  // failure is captured as `kind: "failed"` in McpManager state and surfaces
  // in the Settings modal; chat works regardless. Show "connecting…" rows
  // immediately so users see progress while npx warms up on first run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once boot effect; reconcileMcpStatuses only closes over the stable setMcpStatuses setter and must not retrigger this effect.
  useEffect(() => {
    let active = true;
    void loadMcpConfigs()
      .then((configs) => {
        if (!active) return;
        setMcpConfigs(configs);
        setMcpStatuses(
          configs.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.enabled ? ("connecting" as const) : ("disabled" as const),
          })),
        );
        return mcpManager.init(configs);
      })
      .then(() => {
        if (!active) return;
        // Merge (not wholesale-replace) so a user add/edit that started during
        // boot init — including a synthesized failed row the manager doesn't
        // know about — isn't erased by the init-completion snapshot.
        reconcileMcpStatuses(mcpManager.getStatus());
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: items is an effect-trigger — its array identity changes on every text delta via reduceChatItems, which is exactly when auto-scroll should re-run.
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
        const apiKey = await resolveProviderApiKey(activeProfile.secretKey);
        if (!apiKey) throw new Error("No API key set. Set your API key first via the gear icon.");
        if (!activeProfile.fetchModels) {
          throw new Error("Model listing is not available for this provider.");
        }
        return activeProfile.fetchModels(apiKey, settings);
      },
      compactSession: async (focus) => {
        const session = sessionRef.current;
        if (!session) return { error: "No active session." };
        return session.compact(focus);
      },
      getStatus: () => ({
        sessionId: activeSessionId,
        sessionStartedAt,
        mainProviderId: settings.main_provider,
        mainModelId: settings.main_model,
        auxiliaryProviderId: settings.auxiliary_provider,
        auxiliaryModelId: settings.auxiliary_model,
        messageCount: items.filter((it) => it.kind === "user-text" || it.kind === "assistant-text")
          .length,
        usage: sessionRef.current?.getUsageSnapshot?.() ?? null,
        lastCompaction: sessionRef.current?.getLastCompaction?.() ?? null,
        mcpServers: mcpStatuses
          .filter((s) => s.kind === "connected")
          .map((s) => ({ id: s.id, toolCount: s.toolCount ?? 0 })),
      }),
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
      const secretKey = activeProfile.secretKey;
      if (bootError.kind === "secure-storage-unavailable") {
        // Linux fallback: hold key in non-persistent module-level state, keyed by provider.
        setRuntimeKey(secretKey, value);
      } else {
        // macOS / Windows / Linux with Secret Service: persist via Tauri command.
        await invoke("set_secret", { key: secretKey, value });
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
    const secretKey = activeProfile.secretKey;
    try {
      await invoke("delete_secret", { key: secretKey });
    } catch {
      // ignore — the next boot will surface whatever error
    }
    clearRuntimeKey(secretKey);
    triggerReboot();
  }

  async function openSettings() {
    setSettingsOpen(true);
    void probeProviderStates();
  }

  // CP6 Parameter 10 final clause: after the user picks, persist
  // main_provider and deep-link to the Providers panel pre-focused on the
  // chosen provider — unconditionally, so the user confirms which key is
  // wired to which provider even when one already exists. When no key is
  // configured, also open the inline editor; when one already exists, set a
  // visual highlight (ring + scroll-into-view) so the user can see which
  // row their existing key is wired to.
  async function handleWelcomeSelect(providerId: string) {
    const updated = await saveSettings({ main_provider: providerId });
    setSettings(updated);
    setWelcomeOpen(false);
    await probeProviderStates();
    if (welcomeHasAnyKey) {
      setProviderEditId(null);
      setProviderHighlightId(providerId);
      // Fade after a few seconds so the ring doesn't linger on subsequent
      // Settings opens.
      setTimeout(() => setProviderHighlightId(null), 3500);
    } else {
      setProviderEditId(providerId);
      setProviderHighlightId(null);
    }
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  async function handleMainProviderModelChange(providerId: string, modelId: string) {
    if (providerId === settings.main_provider && modelId === settings.main_model) return;
    const updated = await saveSettings({
      main_provider: providerId,
      main_model: modelId,
    });
    setSettings(updated);
    setToast(`Main updated — ${providerId} / ${modelId}. Applies on next session.`);
    setTimeout(() => setToast(null), 3500);
  }

  async function handleAuxiliaryProviderModelChange(providerId: string, modelId: string) {
    if (providerId === settings.auxiliary_provider && modelId === settings.auxiliary_model) return;
    const updated = await saveSettings({
      auxiliary_provider: providerId,
      auxiliary_model: modelId,
    });
    setSettings(updated);
    setToast(`Auxiliary updated — ${providerId} / ${modelId}.`);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleThemeChange(newThemeId: string) {
    if (newThemeId === settings.selected_theme) return;
    const updated = await saveSettings({ selected_theme: newThemeId });
    setSettings(updated);
    setToast(`Theme updated — ${newThemeId}.`);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleColorModeChange(newMode: ColorMode) {
    if (newMode === settings.color_mode) return;
    const updated = await saveSettings({ color_mode: newMode });
    setSettings(updated);
  }

  // CP4: Providers panel handlers. Status is probed lazily — when the modal
  // first opens we read each profile's keychain entry to materialize the
  // initial state. Test/Save/Remove keep the in-memory map in sync.

  function previewKey(key: string): string {
    return `***${key.slice(-4)}`;
  }

  async function probeProviderStates(): Promise<void> {
    const entries = await Promise.all(
      providerProfiles.map(async (p) => {
        const stored = await resolveProviderApiKey(p.secretKey);
        if (stored && stored.length > 0) {
          return [p.id, { status: "configured" as const, preview: previewKey(stored) }] as const;
        }
        return [p.id, { status: "not-configured" as const }] as const;
      }),
    );
    setProviderStates(Object.fromEntries(entries));
  }

  function handleProviderEdit(providerId: string | null) {
    setProviderEditId(providerId);
  }

  async function handleProviderSave(providerId: string, key: string) {
    const profile = getProvider(providerId);
    if (!profile) return;
    setProviderSaving(true);
    try {
      try {
        await invoke("set_secret", { key: profile.secretKey, value: key });
      } catch {
        // Linux SECURE_STORAGE_UNAVAILABLE fallback — hold in process memory.
        setRuntimeKey(profile.secretKey, key);
      }
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: { status: "configured", preview: previewKey(key) },
      }));
      setProviderEditId(null);
    } finally {
      setProviderSaving(false);
    }
  }

  async function handleProviderTest(providerId: string) {
    const profile = getProvider(providerId);
    if (!profile) return;
    const apiKey = await resolveProviderApiKey(profile.secretKey);
    if (!apiKey) {
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: { status: "not-configured" },
      }));
      return;
    }
    setProviderStates((prev) => ({
      ...prev,
      [providerId]: { ...(prev[providerId] ?? { status: "configured" }), status: "testing" },
    }));
    // Force re-discovery on Test so the user gets a true round-trip rather
    // than a cache hit (the cache was just warmed minutes ago).
    invalidateDiscovery(providerId);
    const result = await fetchDiscovery(providerId, apiKey, settings);
    if (result.status === "ok" && result.models.length > 0) {
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: { status: "configured", preview: previewKey(apiKey) },
      }));
    } else if (result.status === "unsupported") {
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: {
          ...(prev[providerId] ?? { status: "not-configured" }),
          status: "invalid",
          testError: "This provider does not support model discovery.",
        },
      }));
    } else {
      setProviderStates((prev) => ({
        ...prev,
        [providerId]: {
          status: "invalid",
          preview: previewKey(apiKey),
          testError: result.error ?? `Test failed (${result.status}).`,
        },
      }));
    }
  }

  async function handleProviderRemove(providerId: string) {
    const profile = getProvider(providerId);
    if (!profile) return;
    try {
      await invoke("delete_secret", { key: profile.secretKey });
    } catch {
      // ignore — runtime-key removal below also covers Linux fallback
    }
    clearRuntimeKey(profile.secretKey);
    setProviderStates((prev) => ({
      ...prev,
      [providerId]: { status: "not-configured" },
    }));
  }

  function mcpToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  // Insert/replace an optimistic "connecting…" row so the user gets immediate
  // feedback while a server spawns + connects (npx cold-start can take many
  // seconds). Mirrors the boot-time placeholder pattern.
  function setMcpConnecting(id: string, name: string) {
    setMcpStatuses((prev) => {
      const row = { id, name, kind: "connecting" as const };
      return prev.some((s) => s.id === id)
        ? prev.map((s) => (s.id === id ? row : s))
        : [...prev, row];
    });
  }

  // Merge the manager's statuses into the visible map WITHOUT dropping rows the
  // manager hasn't recorded yet (other in-flight optimistic "connecting" rows).
  // `force` pins one row — used to synthesize a failed row when a step before
  // bootOne threw (e.g. persistence), so the server never silently vanishes.
  function reconcileMcpStatuses(managed: McpServerStatus[], force?: McpServerStatus) {
    const byId = new Map(managed.map((s) => [s.id, s]));
    setMcpStatuses((prev) => {
      const seen = new Set<string>();
      const next = prev.map((s) => {
        seen.add(s.id);
        if (force && s.id === force.id) return force;
        return byId.get(s.id) ?? s;
      });
      for (const s of managed) if (!seen.has(s.id)) next.push(s);
      if (force && !seen.has(force.id)) next.push(force);
      return next;
    });
  }

  // Run a spawn-bearing MCP action with feedback. `bootOne` never throws on a
  // connect failure — it resolves with kind:"failed" — so after the await we
  // read getStatus() and toast the failed row's error. A pre-bootOne throw
  // (e.g. persistence) means the manager has no entry for the server, so we
  // synthesize a failed row instead of letting it vanish. Statuses are merged,
  // never wholesale-replaced, so a concurrent action's optimistic row survives.
  async function runMcpBoot(config: McpServerConfig, run: () => Promise<void>) {
    setMcpConnecting(config.id, config.name);
    let errMsg: string | null = null;
    try {
      await run();
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }
    const managed = mcpManager.getStatus();
    const known = managed.find((s) => s.id === config.id);
    const force: McpServerStatus | undefined =
      errMsg && !known
        ? { id: config.id, name: config.name, kind: "failed", error: errMsg }
        : undefined;
    reconcileMcpStatuses(managed, force);
    const finalRow = force ?? known;
    if (finalRow?.kind === "failed") {
      mcpToast(`MCP "${config.id}" failed — ${finalRow.error ?? errMsg ?? "could not connect"}`);
    }
  }

  async function handleMcpAdd(config: McpServerConfig) {
    const updated = [...mcpConfigs, config];
    setMcpConfigs(updated);
    await runMcpBoot(config, async () => {
      await saveMcpConfigs(updated);
      await mcpManager.addServer(config);
    });
  }

  async function handleMcpEdit(config: McpServerConfig) {
    const updated = mcpConfigs.map((c) => (c.id === config.id ? config : c));
    setMcpConfigs(updated);
    await runMcpBoot(config, async () => {
      await saveMcpConfigs(updated);
      await mcpManager.restartServer(config);
    });
  }

  async function handleMcpRemove(id: string) {
    const updated = mcpConfigs.filter((c) => c.id !== id);
    setMcpConfigs(updated);
    await saveMcpConfigs(updated);
    await mcpManager.removeServer(id);
    // Drop just this row; the config is gone so it won't render regardless, and
    // we avoid clobbering any other action's in-flight optimistic row.
    setMcpStatuses((prev) => prev.filter((s) => s.id !== id));
  }

  async function handleMcpRestart(id: string) {
    const config = mcpConfigs.find((c) => c.id === id);
    if (!config) return;
    await runMcpBoot(config, () => mcpManager.restartServer(config));
  }

  async function handleMcpToggle(id: string, enabled: boolean) {
    const updated = mcpConfigs.map((c) => (c.id === id ? { ...c, enabled } : c));
    setMcpConfigs(updated);
    const config = updated.find((c) => c.id === id);
    if (!config) return;
    if (enabled) {
      // Enable routes through the same long-running spawn path as Add.
      await runMcpBoot(config, async () => {
        await saveMcpConfigs(updated);
        await mcpManager.addServer(config);
      });
    } else {
      // Disable: stop the server immediately (no spawn). The config stays with
      // enabled:false, so the row renders as "disabled" once its status clears.
      await saveMcpConfigs(updated);
      await mcpManager.removeServer(id);
      setMcpStatuses((prev) => prev.filter((s) => s.id !== id));
    }
  }

  const backendLabel =
    backend === "anthropic-api"
      ? "Anthropic (Claude)"
      : backend === "echo-fallback"
        ? "echo (fallback)"
        : "…";
  const hasPendingApproval = items.some((it) => it.kind === "approval" && it.verdict === undefined);
  const inputDisabled =
    streaming ||
    !ready ||
    hasPendingApproval ||
    (backend === "echo-fallback" && bootError !== null);
  const activityLabel = !ready ? "Connecting…" : streaming ? "Streaming…" : "Ready";
  const COMMAND_HINTS = ["/help", "/status", "/clear", "/model", "/compact"];

  return (
    <main className="flex h-screen bg-background text-foreground">
      <SessionSidebar
        sessions={sessionList}
        activeSessionId={activeSessionId}
        onSelect={switchToSession}
        onNew={startFreshSession}
      />
      <div className="flex min-w-0 flex-1 flex-col">
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
            onOpenProviders={openSettings}
            saving={saving}
            providerLabel={activeProfile.label}
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
                  <div className="flex-1">
                    <ChatMessage
                      item={it}
                      onApproval={handleApproval}
                      onChangeKey={handleChangeKey}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <StatusBar
          brand="delphy-agent"
          model={settings.main_model ?? activeProfile.defaultModel}
          activity={activityLabel}
          commandHints={COMMAND_HINTS}
          tokens={sessionTokens}
          contextPercent={contextPercent}
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
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>

        <FirstRunWelcome
          open={welcomeOpen}
          profiles={providerProfiles}
          preselectId={welcomePreselectId}
          hasAnyKey={welcomeHasAnyKey}
          onSelect={handleWelcomeSelect}
        />

        <SettingsModal
          open={settingsOpen}
          onOpenChange={(open) => (open ? openSettings() : closeSettings())}
          settings={settings}
          currentMainProvider={settings.main_provider}
          currentModel={settings.main_model}
          currentAuxiliaryProvider={settings.auxiliary_provider}
          currentAuxiliaryModel={settings.auxiliary_model}
          themes={themes}
          selectedThemeId={settings.selected_theme}
          colorMode={settings.color_mode}
          mcpStatuses={mcpStatuses}
          mcpConfigs={mcpConfigs}
          providerProfiles={providerProfiles}
          providerStates={providerStates}
          providerEditId={providerEditId}
          providerHighlightId={providerHighlightId}
          providerSaving={providerSaving}
          resolveApiKey={resolveProviderApiKey}
          onProviderEdit={handleProviderEdit}
          onProviderSave={handleProviderSave}
          onProviderTest={handleProviderTest}
          onProviderRemove={handleProviderRemove}
          onMainProviderModelChange={handleMainProviderModelChange}
          onAuxiliaryProviderModelChange={handleAuxiliaryProviderModelChange}
          onThemeChange={handleThemeChange}
          onColorModeChange={handleColorModeChange}
          onMcpAdd={handleMcpAdd}
          onMcpEdit={handleMcpEdit}
          onMcpRemove={handleMcpRemove}
          onMcpRestart={handleMcpRestart}
          onMcpToggle={handleMcpToggle}
        />

        {toast ? (
          <div className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 rounded border border-primary/30 bg-primary px-4 py-2 text-xs text-primary-foreground shadow-lg">
            {toast}
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default App;
