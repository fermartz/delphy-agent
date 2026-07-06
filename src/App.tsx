import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { BootBanner } from "@/components/boot-banner";
import { ChatStream } from "@/components/chat-stream";
import { Composer } from "@/components/composer";
import { FirstRunWelcome } from "@/components/first-run-welcome";
import { SessionSidebar } from "@/components/session-sidebar";
import { SettingsModal } from "@/components/settings-modal";
import { StatusBar } from "@/components/status-bar";
import { Toast } from "@/components/toast";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { useMcpServers } from "@/hooks/use-mcp-servers";
import { useProviders } from "@/hooks/use-providers";
import { useSession } from "@/hooks/use-session";
import { useThemes } from "@/hooks/use-themes";
import { nextItemId } from "./core/chat/item-id";
import { type CommandContext, dispatchInput } from "./core/commands";
import { seedTrustedImageHosts } from "./core/net/trusted-image-hosts";
import { getProvider, listProviders } from "./core/providers";
import { anthropicProfile } from "./core/providers/anthropic";
import { resolveProviderApiKey } from "./core/providers/resolve-key";
import { clearRuntimeKey, setRuntimeKey } from "./core/providers/runtime-keys";
import { DEFAULT_SETTINGS } from "./core/settings/defaults";
import { saveSettings } from "./core/settings/settings";
import type { ColorMode, Settings } from "./core/settings/types";

// Module-level so the array identity is stable across renders (StatusBar is
// memoized; a fresh array each render would defeat it).
const COMMAND_HINTS = ["/help", "/status", "/clear", "/model", "/compact"];

function App() {
  // App-owned state: boot-banner key input + app-wide config + chrome.
  const [input, setInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Toast + callbacks shared into the hooks below.
  const mcpToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }, []);
  const clearKeyInput = useCallback(() => setKeyInput(""), []);
  const onSettingsLoaded = useCallback((loaded: Settings) => {
    setSettings(loaded);
    seedTrustedImageHosts(loaded.trusted_image_hosts);
  }, []);

  const { themes } = useThemes({
    selectedThemeId: settings.selected_theme,
    colorMode: settings.color_mode,
  });
  const {
    mcpStatuses,
    mcpConfigs,
    handleMcpAdd,
    handleMcpEdit,
    handleMcpRemove,
    handleMcpRestart,
    handleMcpToggle,
    handleMcpToolToggle,
    getMcpServerTools,
  } = useMcpServers({ onToast: mcpToast });
  const {
    providerStates,
    providerEditId,
    setProviderEditId,
    providerHighlightId,
    setProviderHighlightId,
    providerSaving,
    probeProviderStates,
    handleProviderSave,
    handleProviderTest,
    handleProviderRemove,
  } = useProviders({ settings });
  const {
    items,
    setItems,
    streaming,
    setStreaming,
    sessionTokens,
    contextPercent,
    sessionList,
    backend,
    bootError,
    setBootError,
    ready,
    activeSessionId,
    activeProviderId,
    sessionStartedAt,
    sessionRef,
    welcomeOpen,
    setWelcomeOpen,
    welcomePreselectId,
    welcomeHasAnyKey,
    triggerReboot,
    startFreshSession,
    switchToSession,
    restartSession,
  } = useSession({ clearKeyInput, onSettingsLoaded });
  const { scrollRef, onScroll: handleScroll } = useChatScroll(items);

  // Profile for the current active provider, derived from boot state. Falls
  // back to Anthropic so legacy code paths (BootBanner, /v1/models fetch) keep
  // working before the user completes First-Run Welcome.
  const activeProfile =
    (activeProviderId ? getProvider(activeProviderId) : null) ?? anthropicProfile;

  // Memoized: listProviders() returns a fresh array each call, which would
  // defeat memoization of the panels that receive it.
  const providerProfiles = useMemo(() => listProviders(), []);

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

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    void probeProviderStates();
  }, [probeProviderStates]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // Stable onOpenChange for the memoized SettingsModal (an inline arrow would
  // defeat its memoization).
  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      if (open) openSettings();
      else closeSettings();
    },
    [openSettings, closeSettings],
  );

  // After the user picks in First-Run Welcome, persist main_provider and
  // deep-link to the Providers panel pre-focused on the chosen provider —
  // unconditionally, so the user confirms which key is wired to which provider
  // even when one already exists. When no key is configured, also open the
  // inline editor; when one already exists, set a visual highlight (ring +
  // scroll-into-view) so the user can see which row their existing key is on.
  const handleWelcomeSelect = useCallback(
    async (providerId: string) => {
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
    },
    [
      welcomeHasAnyKey,
      probeProviderStates,
      setWelcomeOpen,
      setProviderEditId,
      setProviderHighlightId,
    ],
  );

  const handleMainProviderModelChange = useCallback(
    async (providerId: string, modelId: string) => {
      if (providerId === settings.main_provider && modelId === settings.main_model) return;
      const updated = await saveSettings({ main_provider: providerId, main_model: modelId });
      setSettings(updated);
      setToast(`Main updated — ${providerId} / ${modelId}. Applies on next session.`);
      setTimeout(() => setToast(null), 3500);
    },
    [settings.main_provider, settings.main_model],
  );

  const handleAuxiliaryProviderModelChange = useCallback(
    async (providerId: string, modelId: string) => {
      if (providerId === settings.auxiliary_provider && modelId === settings.auxiliary_model)
        return;
      const updated = await saveSettings({
        auxiliary_provider: providerId,
        auxiliary_model: modelId,
      });
      setSettings(updated);
      setToast(`Auxiliary updated — ${providerId} / ${modelId}.`);
      setTimeout(() => setToast(null), 2500);
    },
    [settings.auxiliary_provider, settings.auxiliary_model],
  );

  const handleThemeChange = useCallback(
    async (newThemeId: string) => {
      if (newThemeId === settings.selected_theme) return;
      const updated = await saveSettings({ selected_theme: newThemeId });
      setSettings(updated);
      setToast(`Theme updated — ${newThemeId}.`);
      setTimeout(() => setToast(null), 2500);
    },
    [settings.selected_theme],
  );

  const handleColorModeChange = useCallback(
    async (newMode: ColorMode) => {
      if (newMode === settings.color_mode) return;
      const updated = await saveSettings({ color_mode: newMode });
      setSettings(updated);
    },
    [settings.color_mode],
  );

  // Switching the backend re-routes boot.ts (direct-API vs Codex), so it
  // restarts the session.
  const handleBackendChange = useCallback(
    async (newBackend: string) => {
      if (newBackend === settings.default_backend) return;
      const updated = await saveSettings({ default_backend: newBackend });
      setSettings(updated);
      triggerReboot();
    },
    [settings.default_backend, triggerReboot],
  );

  // Setting the Codex working directory re-boots so Codex starts (or restarts)
  // against the chosen directory.
  const handleCodexWorkingDirChange = useCallback(
    async (dir: string) => {
      const value = dir.trim() || null;
      if (value === settings.codex_working_dir) return;
      const updated = await saveSettings({ codex_working_dir: value });
      setSettings(updated);
      triggerReboot();
    },
    [settings.codex_working_dir, triggerReboot],
  );

  const backendLabel =
    backend === "anthropic-api"
      ? "Anthropic (Claude)"
      : backend === "codex"
        ? "Codex"
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

  return (
    <main className="flex h-screen bg-background text-foreground">
      {/* The session sidebar reflects persisted direct-API sessions; Codex
          sessions are ephemeral (BACKLOG #7 Slice A). Key off the SELECTED
          backend, not the active result, so a Codex setup-error fallback to
          echo (codex-no-workdir/missing/failed) doesn't re-expose direct-API
          session history/actions while boot still routes through Codex. */}
      {settings.default_backend !== "codex" ? (
        <SessionSidebar
          sessions={sessionList}
          activeSessionId={activeSessionId}
          onSelect={switchToSession}
          onNew={startFreshSession}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          themes={themes}
          selectedThemeId={settings.selected_theme}
          onThemeChange={handleThemeChange}
          colorMode={settings.color_mode}
          onColorModeChange={handleColorModeChange}
          onOpenSettings={openSettings}
        />

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

        <ChatStream
          items={items}
          backend={backend}
          scrollRef={scrollRef}
          onScroll={handleScroll}
          onApproval={handleApproval}
          onChangeKey={handleChangeKey}
        />

        <StatusBar
          brand="delphy-agent"
          model={
            backend === "codex" ? "Codex" : (settings.main_model ?? activeProfile.defaultModel)
          }
          activity={activityLabel}
          commandHints={COMMAND_HINTS}
          tokens={sessionTokens}
          contextPercent={contextPercent}
        />

        <Composer
          input={input}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          disabled={inputDisabled}
          streaming={streaming}
          backendLabel={backendLabel}
        />

        <FirstRunWelcome
          open={welcomeOpen}
          profiles={providerProfiles}
          preselectId={welcomePreselectId}
          hasAnyKey={welcomeHasAnyKey}
          onSelect={handleWelcomeSelect}
        />

        <SettingsModal
          open={settingsOpen}
          onOpenChange={handleSettingsOpenChange}
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
          onProviderEdit={setProviderEditId}
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
          onMcpToolToggle={handleMcpToolToggle}
          getMcpServerTools={getMcpServerTools}
          currentBackend={settings.default_backend}
          onBackendChange={handleBackendChange}
          codexWorkingDir={settings.codex_working_dir}
          onCodexWorkingDirChange={handleCodexWorkingDirChange}
        />

        <Toast message={toast} />
      </div>
    </main>
  );
}

export default App;
