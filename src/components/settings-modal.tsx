import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type McpConfigValidationError, validateMcpConfig } from "@/core/mcp/store";
import type { McpServerConfig, McpServerStatus } from "@/core/mcp/types";
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
}

const COLOR_MODES: readonly ColorMode[] = ["light", "dark", "system"];

export function SettingsModal({
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
}: SettingsModalProps) {
  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [mcpEditId, setMcpEditId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure model, theme, and color mode.
          </DialogDescription>
        </DialogHeader>

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
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-foreground">MCP servers</div>
            <Button type="button" variant="outline" size="sm" onClick={handleMcpAdd}>
              Add server
            </Button>
          </div>
          {mcpStatuses.length === 0 ? (
            <div className="text-xs text-muted-foreground">No MCP servers configured.</div>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {mcpStatuses.map((s) => {
                const config = mcpConfigs.find((c) => c.id === s.id);
                const isStdio = config?.transport === "stdio";
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => config && onMcpToggle(s.id, !config.enabled)}
                      className={`h-3 w-3 shrink-0 rounded-full border ${config?.enabled ? "border-primary bg-primary" : "border-muted-foreground bg-transparent"}`}
                      title={config?.enabled ? "Disable" : "Enable"}
                      aria-label={config?.enabled ? `Disable ${s.name}` : `Enable ${s.name}`}
                    />
                    <span className="font-mono text-foreground">{s.id}</span>
                    <McpStatusBadge status={s} />
                    {s.kind === "connected" && typeof s.toolCount === "number" ? (
                      <span className="text-muted-foreground">
                        ({s.toolCount} {s.toolCount === 1 ? "tool" : "tools"})
                      </span>
                    ) : null}
                    {s.kind === "failed" && s.error ? (
                      <span className="max-w-[120px] truncate text-destructive" title={s.error}>
                        {s.error}
                      </span>
                    ) : null}
                    <span className="ml-auto flex shrink-0 gap-1">
                      {isStdio ? (
                        <button
                          type="button"
                          onClick={() => handleMcpEdit(s.id)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          edit
                        </button>
                      ) : null}
                      {isStdio && config?.enabled ? (
                        <button
                          type="button"
                          onClick={() => onMcpRestart(s.id)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Restart"
                        >
                          restart
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(s.id)}
                        className="text-destructive/70 hover:text-destructive"
                        title="Remove"
                      >
                        remove
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {confirmRemoveId ? (
            <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              <span>Remove "{confirmRemoveId}"?</span>
              <Button type="button" variant="destructive" size="sm" onClick={handleConfirmRemove}>
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
        </section>

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
      </DialogContent>
    </Dialog>
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
  const [command, setCommand] = useState(editConfig?.command ?? "");
  const [args, setArgs] = useState(editConfig?.args?.join(" ") ?? "");
  const [envText, setEnvText] = useState(
    editConfig?.env
      ? Object.entries(editConfig.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
  );
  const [errors, setErrors] = useState<McpConfigValidationError[]>([]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const env: Record<string, string> = {};
      for (const line of envText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
      }
      const config: McpServerConfig = {
        id: id.trim(),
        name: name.trim(),
        enabled,
        transport: "stdio",
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
      };
      const validationErrors = validateMcpConfig(config, existingIds, editConfig?.id);
      if (validationErrors.length > 0) {
        setErrors(validationErrors);
        return;
      }
      onSave(config);
    },
    [id, name, enabled, command, args, envText, existingIds, editConfig, onSave],
  );

  const fieldError = (field: string) => errors.find((e) => e.field === field)?.message;

  return (
    <section className="space-y-2 rounded border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium">{editConfig ? "Edit server" : "Add MCP server"}</div>
      <form onSubmit={handleSubmit} className="space-y-2 text-xs">
        <div>
          <label htmlFor="mcp-id" className="text-muted-foreground">
            ID (lowercase, hyphens)
          </label>
          <input
            id="mcp-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!editConfig}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-foreground disabled:opacity-50"
          />
          {fieldError("id") ? <div className="text-destructive">{fieldError("id")}</div> : null}
        </div>
        <div>
          <label htmlFor="mcp-name" className="text-muted-foreground">
            Name
          </label>
          <input
            id="mcp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-foreground"
          />
          {fieldError("name") ? <div className="text-destructive">{fieldError("name")}</div> : null}
        </div>
        <div>
          <label htmlFor="mcp-command" className="text-muted-foreground">
            Command
          </label>
          <input
            id="mcp-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. npx"
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-foreground"
          />
          {fieldError("command") ? (
            <div className="text-destructive">{fieldError("command")}</div>
          ) : null}
        </div>
        <div>
          <label htmlFor="mcp-args" className="text-muted-foreground">
            Args (space-separated)
          </label>
          <input
            id="mcp-args"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="e.g. -y @modelcontextprotocol/server-github"
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-foreground"
          />
        </div>
        <div>
          <label htmlFor="mcp-env" className="text-muted-foreground">
            Environment (KEY=value, one per line)
          </label>
          <textarea
            id="mcp-env"
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder text
            placeholder={"GITHUB_TOKEN=${secret:github_pat}"}
            rows={2}
            className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-foreground"
          />
          {errors
            .filter((e) => e.field.startsWith("env."))
            .map((e) => (
              <div key={e.field} className="text-destructive">
                {e.message}
              </div>
            ))}
        </div>
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
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

function McpStatusBadge({ status }: { status: McpServerStatus }) {
  switch (status.kind) {
    case "connecting":
      return (
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">connecting…</span>
      );
    case "connected":
      return <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary">connected</span>;
    case "failed":
      return (
        <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-destructive">failed</span>
      );
    case "disabled":
      return (
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">disabled</span>
      );
  }
}
