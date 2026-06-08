import { memo, useCallback, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type McpConfigValidationError, validateMcpConfig } from "@/core/mcp/store";
import type { McpServerConfig, McpServerStatus, McpTransport } from "@/core/mcp/types";
import type { ProviderProfile } from "@/core/providers/types";
import type { ColorMode, Settings } from "@/core/settings/types";
import type { Theme } from "@/themes/types";
import { ProviderModelPicker } from "./provider-model-picker";
import { type ProviderRowState, ProvidersPanel } from "./providers-panel";

export interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  currentMainProvider: string | null;
  currentModel: string | null;
  currentAuxiliaryProvider: string | null;
  currentAuxiliaryModel: string | null;
  themes: Theme[];
  selectedThemeId: string;
  colorMode: ColorMode;
  mcpStatuses: McpServerStatus[];
  mcpConfigs: McpServerConfig[];
  providerProfiles: ProviderProfile[];
  providerStates: Record<string, ProviderRowState>;
  providerEditId: string | null;
  providerHighlightId?: string | null;
  providerSaving: boolean;
  resolveApiKey: (secretKey: string) => Promise<string | null>;
  onProviderEdit: (providerId: string | null) => void;
  onProviderSave: (providerId: string, key: string) => void | Promise<void>;
  onProviderTest: (providerId: string) => void | Promise<void>;
  onProviderRemove: (providerId: string) => void | Promise<void>;
  onMainProviderModelChange: (providerId: string, modelId: string) => void;
  onAuxiliaryProviderModelChange: (providerId: string, modelId: string) => void;
  onThemeChange: (themeId: string) => void;
  onColorModeChange: (mode: ColorMode) => void;
  onMcpAdd: (config: McpServerConfig) => void;
  onMcpEdit: (config: McpServerConfig) => void;
  onMcpRemove: (id: string) => void;
  onMcpRestart: (id: string) => void;
  onMcpToggle: (id: string, enabled: boolean) => void;
  currentBackend: string;
  onBackendChange: (backend: string) => void;
  codexWorkingDir: string | null;
  onCodexWorkingDirChange: (dir: string) => void;
}

const COLOR_MODES: readonly ColorMode[] = ["light", "dark", "system"];

function SettingsModalInner({
  open,
  onOpenChange,
  settings,
  currentMainProvider,
  currentModel,
  currentAuxiliaryProvider,
  currentAuxiliaryModel,
  themes,
  selectedThemeId,
  colorMode,
  mcpStatuses,
  mcpConfigs,
  providerProfiles,
  providerStates,
  providerEditId,
  providerHighlightId,
  providerSaving,
  resolveApiKey,
  onProviderEdit,
  onProviderSave,
  onProviderTest,
  onProviderRemove,
  onMainProviderModelChange,
  onAuxiliaryProviderModelChange,
  onThemeChange,
  onColorModeChange,
  onMcpAdd,
  onMcpEdit,
  onMcpRemove,
  onMcpRestart,
  onMcpToggle,
  currentBackend,
  onBackendChange,
  codexWorkingDir,
  onCodexWorkingDirChange,
}: SettingsModalProps) {
  const isCodex = currentBackend === "codex";
  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [mcpEditId, setMcpEditId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Status lookup by id; the MCP list renders from `mcpConfigs` and decorates
  // each row with its live status (if the manager has reported one).
  const statusById = new Map(mcpStatuses.map((s) => [s.id, s]));

  const handleMcpAdd = useCallback(() => {
    setMcpEditId(null);
    setMcpFormOpen(true);
  }, []);

  const handleMcpEdit = useCallback((id: string) => {
    setMcpEditId(id);
    setMcpFormOpen(true);
  }, []);

  const handleMcpFormSave = useCallback(
    (config: McpServerConfig) => {
      if (mcpEditId) {
        onMcpEdit(config);
      } else {
        onMcpAdd(config);
      }
      setMcpFormOpen(false);
      setMcpEditId(null);
    },
    [mcpEditId, onMcpAdd, onMcpEdit],
  );

  const handleConfirmRemove = useCallback(() => {
    if (confirmRemoveId) {
      onMcpRemove(confirmRemoveId);
      setConfirmRemoveId(null);
    }
  }, [confirmRemoveId, onMcpRemove]);

  // The Select is controlled by `selectedThemeId`. If the active theme is no
  // longer in the registry (e.g., the user deleted a custom theme file while
  // the watcher reloaded), prepend a synthetic "(unavailable)" option so the
  // controlled value still matches an item — otherwise Radix Select renders
  // an empty trigger. Covers both the no-themes-loaded case and the
  // theme-disappeared-after-load case.
  const hasSelectedTheme = themes.some((t) => t.id === selectedThemeId);
  const themeOptions: Theme[] = hasSelectedTheme
    ? themes
    : [
        // biome-ignore lint/suspicious/noExplicitAny: synthetic placeholder; only the Select reads id + label
        { id: selectedThemeId, label: `${selectedThemeId} (unavailable)` } as any,
        ...themes,
      ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure providers, models, plugins, and appearance.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={isCodex ? "backend" : "providers"} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="backend">Backend</TabsTrigger>
            {!isCodex ? <TabsTrigger value="providers">Providers</TabsTrigger> : null}
            {!isCodex ? <TabsTrigger value="models">Models</TabsTrigger> : null}
            <TabsTrigger value="plugins">Plugins</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <TabsContent value="backend" className="mt-3 space-y-4">
            <section className="space-y-2">
              <div className="text-xs font-medium text-foreground">Backend</div>
              <RadioGroup
                value={isCodex ? "codex" : "anthropic-api"}
                onValueChange={onBackendChange}
                className="flex flex-col gap-2 text-xs text-foreground"
              >
                <label htmlFor="backend-direct" className="flex items-center gap-1.5">
                  <RadioGroupItem id="backend-direct" value="anthropic-api" />
                  Direct API (cloud providers — Anthropic, OpenAI, …)
                </label>
                <label htmlFor="backend-codex" className="flex items-center gap-1.5">
                  <RadioGroupItem id="backend-codex" value="codex" />
                  Codex (local agent CLI)
                </label>
              </RadioGroup>
              <div className="text-xs text-muted-foreground">
                Switching the backend restarts the session.
              </div>
            </section>
            {isCodex ? (
              <CodexBackendPanel
                workingDir={codexWorkingDir}
                onWorkingDirChange={onCodexWorkingDirChange}
              />
            ) : null}
          </TabsContent>

          <TabsContent value="providers" className="mt-3">
            <ProvidersPanel
              profiles={providerProfiles}
              states={providerStates}
              editingId={providerEditId}
              highlightId={providerHighlightId}
              saving={providerSaving}
              onEdit={onProviderEdit}
              onSave={onProviderSave}
              onTest={onProviderTest}
              onRemove={onProviderRemove}
            />
          </TabsContent>

          <TabsContent value="models" className="mt-3 space-y-3">
            <ProviderModelPicker
              label="Main"
              profiles={providerProfiles}
              providerHasKey={(id) => providerStates[id]?.status === "configured"}
              resolveApiKey={resolveApiKey}
              settings={settings}
              currentProviderId={currentMainProvider}
              currentModelId={currentModel}
              onChange={onMainProviderModelChange}
            />

            <ProviderModelPicker
              label="Auxiliary"
              profiles={providerProfiles}
              providerHasKey={(id) => providerStates[id]?.status === "configured"}
              resolveApiKey={resolveApiKey}
              settings={settings}
              currentProviderId={currentAuxiliaryProvider}
              currentModelId={currentAuxiliaryModel}
              onChange={onAuxiliaryProviderModelChange}
            />

            <p className="text-[11px] text-muted-foreground">
              Curated list shown — click "Show all" on a picker to discover every model. Auxiliary
              runs cheap helper calls (compaction, titles).
            </p>
          </TabsContent>

          <TabsContent value="plugins" className="mt-3">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-foreground">MCP servers</div>
                <Button type="button" variant="outline" size="sm" onClick={handleMcpAdd}>
                  Add server
                </Button>
              </div>
              {mcpConfigs.length === 0 ? (
                <div className="text-xs text-muted-foreground">No MCP servers configured.</div>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                  {mcpConfigs.map((config) => {
                    // Rows are anchored to the persisted configs (source of truth
                    // for what exists); status is decoration looked up by id. A
                    // configured server therefore never vanishes even if the
                    // manager hasn't recorded a status for it yet.
                    const status = statusById.get(config.id);
                    const kind = status?.kind ?? (config.enabled ? "connecting" : "disabled");
                    const isStdio = config.transport === "stdio";
                    return (
                      <li key={config.id} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={config.enabled}
                            onCheckedChange={(v) => onMcpToggle(config.id, v)}
                            aria-label={
                              config.enabled ? `Disable ${config.name}` : `Enable ${config.name}`
                            }
                          />
                          <span className="font-mono text-foreground">{config.id}</span>
                          <StatusBadge kind={kind} />
                          {kind === "connected" && typeof status?.toolCount === "number" ? (
                            <span className="text-muted-foreground">
                              ({status.toolCount} {status.toolCount === 1 ? "tool" : "tools"})
                            </span>
                          ) : null}
                          <span className="ml-auto flex shrink-0 gap-1">
                            {isStdio ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs"
                                title="Edit"
                                onClick={() => handleMcpEdit(config.id)}
                              >
                                Edit
                              </Button>
                            ) : null}
                            {isStdio && config.enabled ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs"
                                title="Restart"
                                onClick={() => onMcpRestart(config.id)}
                              >
                                Restart
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-xs text-destructive"
                              title="Remove"
                              onClick={() => setConfirmRemoveId(config.id)}
                            >
                              Remove
                            </Button>
                          </span>
                        </div>
                        {kind === "failed" && status?.error ? (
                          <p className="break-words pl-9 text-[11px] text-destructive">
                            {status.error}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {confirmRemoveId ? (
                <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                  <span>Remove "{confirmRemoveId}"?</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleConfirmRemove}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmRemoveId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}

              {mcpFormOpen ? (
                <McpServerForm
                  editConfig={mcpEditId ? mcpConfigs.find((c) => c.id === mcpEditId) : undefined}
                  existingIds={mcpConfigs.map((c) => c.id)}
                  onSave={handleMcpFormSave}
                  onCancel={() => {
                    setMcpFormOpen(false);
                    setMcpEditId(null);
                  }}
                />
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="appearance" className="mt-3 space-y-4">
            <section className="space-y-2">
              <div className="text-xs font-medium text-foreground">Theme</div>
              <Select
                value={selectedThemeId}
                onValueChange={onThemeChange}
                disabled={themes.length === 0}
              >
                <SelectTrigger aria-label="Theme" className="w-full">
                  <SelectValue placeholder="Select a theme" />
                </SelectTrigger>
                <SelectContent>
                  {themeOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section className="space-y-2">
              <div className="text-xs font-medium text-foreground">Color mode</div>
              <RadioGroup
                value={colorMode}
                onValueChange={(value) => onColorModeChange(value as ColorMode)}
                className="flex gap-4 text-xs text-foreground"
              >
                {COLOR_MODES.map((mode) => {
                  const id = `color-mode-${mode}`;
                  return (
                    <label key={mode} htmlFor={id} className="flex items-center gap-1.5 capitalize">
                      <RadioGroupItem id={id} value={mode} />
                      {mode}
                    </label>
                  );
                })}
              </RadioGroup>
            </section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** A "broad" directory (home or filesystem root) Codex shouldn't get blanket
 *  read access to without an explicit confirm. */
function isBroadDir(p: string): boolean {
  const normalized = p.replace(/\/$/, "");
  if (
    normalized === "" ||
    normalized === "/Users" ||
    normalized === "/home" ||
    normalized === "/root"
  ) {
    return true;
  }
  // The home directory itself (/Users/<name> or /home/<name>).
  return /^\/(Users|home)\/[^/]+$/.test(normalized);
}

function CodexBackendPanel({
  workingDir,
  onWorkingDirChange,
}: {
  workingDir: string | null;
  onWorkingDirChange: (dir: string) => void;
}) {
  const [dir, setDir] = useState(workingDir ?? "");
  const [confirmedBroad, setConfirmedBroad] = useState(false);
  const trimmed = dir.trim();
  const isAbsolute = trimmed.startsWith("/");
  const broad = isBroadDir(trimmed);
  const error =
    trimmed.length > 0 && !isAbsolute ? "Enter an absolute path (starting with /)." : null;
  const valid = trimmed.length > 0 && isAbsolute && (!broad || confirmedBroad);
  const unchanged = trimmed === (workingDir ?? "");

  return (
    <section className="space-y-2">
      <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
        <span className="font-medium">Codex can read your files.</span> It may autonomously read
        files under the directory you choose and send relevant content to OpenAI. Pick a specific
        project directory — not your home folder. Codex runs read-only in this slice.
      </div>
      <Label htmlFor="codex-cwd" className="text-xs font-medium">
        Working directory
      </Label>
      <div className="flex gap-2">
        <Input
          id="codex-cwd"
          value={dir}
          onChange={(e) => setDir(e.currentTarget.value)}
          placeholder="/Users/you/project"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button
          type="button"
          size="sm"
          disabled={!valid || unchanged}
          onClick={() => onWorkingDirChange(trimmed)}
        >
          Set
        </Button>
      </div>
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      {broad && isAbsolute ? (
        <label className="flex items-start gap-2 text-xs text-destructive">
          <input
            type="checkbox"
            checked={confirmedBroad}
            onChange={(e) => setConfirmedBroad(e.currentTarget.checked)}
            className="mt-0.5"
          />
          This is a broad directory (home or root). I understand Codex can read everything under it.
        </label>
      ) : null}
      <div className="text-xs text-muted-foreground">
        Codex authenticates via your <code>codex login</code> session; no key is stored here.
      </div>
    </section>
  );
}

function McpServerForm({
  editConfig,
  existingIds,
  onSave,
  onCancel,
}: {
  editConfig?: McpServerConfig;
  existingIds: string[];
  onSave: (config: McpServerConfig) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(editConfig?.id ?? "");
  const [name, setName] = useState(editConfig?.name ?? "");
  const [enabled, setEnabled] = useState(editConfig?.enabled ?? true);
  const [transport, setTransport] = useState<McpTransport>(editConfig?.transport ?? "stdio");
  const [command, setCommand] = useState(editConfig?.command ?? "");
  const [args, setArgs] = useState(editConfig?.args?.join(" ") ?? "");
  const [envText, setEnvText] = useState(linesFromRecord(editConfig?.env));
  const [url, setUrl] = useState(editConfig?.url ?? "");
  const [headersText, setHeadersText] = useState(linesFromRecord(editConfig?.headers));
  const [errors, setErrors] = useState<McpConfigValidationError[]>([]);

  const isRemote = transport === "http" || transport === "sse";

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const env = recordFromLines(envText);
      const headers = recordFromLines(headersText);
      const config: McpServerConfig = {
        id: id.trim(),
        name: name.trim(),
        enabled,
        transport,
        ...(transport === "stdio"
          ? {
              command: command.trim(),
              args: args.trim() ? args.trim().split(/\s+/) : undefined,
              env: Object.keys(env).length > 0 ? env : undefined,
            }
          : {
              url: url.trim(),
              headers: Object.keys(headers).length > 0 ? headers : undefined,
            }),
      };
      const validationErrors = validateMcpConfig(config, existingIds, editConfig?.id);
      if (validationErrors.length > 0) {
        setErrors(validationErrors);
        return;
      }
      onSave(config);
    },
    [
      id,
      name,
      enabled,
      transport,
      command,
      args,
      envText,
      url,
      headersText,
      existingIds,
      editConfig,
      onSave,
    ],
  );

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;

  return (
    <section className="space-y-2 rounded border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium">{editConfig ? "Edit server" : "Add MCP server"}</div>
      <form onSubmit={handleSubmit} className="space-y-2 text-xs">
        <div className="space-y-1">
          <Label htmlFor="mcp-id" className="text-muted-foreground">
            ID (lowercase, hyphens)
          </Label>
          <Input
            id="mcp-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!editConfig}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
          />
          {fieldError("id") ? <div className="text-destructive">{fieldError("id")}</div> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="mcp-name" className="text-muted-foreground">
            Name
          </Label>
          <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} />
          {fieldError("name") ? <div className="text-destructive">{fieldError("name")}</div> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="mcp-transport" className="text-muted-foreground">
            Transport
          </Label>
          <Select value={transport} onValueChange={(v) => setTransport(v as McpTransport)}>
            <SelectTrigger id="mcp-transport" aria-label="Transport" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio (local command)</SelectItem>
              <SelectItem value="http">http (remote)</SelectItem>
              <SelectItem value="sse">sse (remote)</SelectItem>
            </SelectContent>
          </Select>
          {isRemote ? (
            <div className="text-[11px] text-muted-foreground">
              Remote transports are not yet connectable — the server will be saved but show as
              failed until HTTP/SSE support lands.
            </div>
          ) : null}
        </div>

        {transport === "stdio" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="mcp-command" className="text-muted-foreground">
                Command
              </Label>
              <Input
                id="mcp-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. npx"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
              />
              {fieldError("command") ? (
                <div className="text-destructive">{fieldError("command")}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="mcp-args" className="text-muted-foreground">
                Args (space-separated)
              </Label>
              <Input
                id="mcp-args"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="e.g. -y delphy-mcp"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mcp-env" className="text-muted-foreground">
                Environment (KEY=value, one per line)
              </Label>
              <Textarea
                id="mcp-env"
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder text
                placeholder={"GITHUB_TOKEN=${secret:github_pat}"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                rows={2}
                className="font-mono"
              />
              {errors
                .filter((e) => e.field.startsWith("env."))
                .map((e) => (
                  <div key={e.field} className="text-destructive">
                    {e.message}
                  </div>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="mcp-url" className="text-muted-foreground">
                URL
              </Label>
              <Input
                id="mcp-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
              />
              {fieldError("url") ? (
                <div className="text-destructive">{fieldError("url")}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="mcp-headers" className="text-muted-foreground">
                Headers (KEY=value, one per line)
              </Label>
              <Textarea
                id="mcp-headers"
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder text
                placeholder={"Authorization=Bearer ${secret:delphy_token}"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                rows={2}
                className="font-mono"
              />
              {errors
                .filter((e) => e.field.startsWith("headers."))
                .map((e) => (
                  <div key={e.field} className="text-destructive">
                    {e.message}
                  </div>
                ))}
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <Switch id="mcp-enabled" checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor="mcp-enabled" className="text-muted-foreground">
            Enabled
          </Label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {editConfig ? "Save" : "Add"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}

function linesFromRecord(record?: Record<string, string>): string {
  return record
    ? Object.entries(record)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")
    : "";
}

function recordFromLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      out[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return out;
}

export const SettingsModal = memo(SettingsModalInner);
