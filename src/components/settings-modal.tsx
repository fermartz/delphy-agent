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
import type { ColorMode } from "@/core/settings/types";
import type { Theme } from "@/themes/types";

export interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentModel: string;
  availableModels: string[] | null;
  modelsLoading: boolean;
  modelsError: string | null;
  themes: Theme[];
  selectedThemeId: string;
  colorMode: ColorMode;
  onSelectModel: (model: string) => void;
  onThemeChange: (themeId: string) => void;
  onColorModeChange: (mode: ColorMode) => void;
  onRetry: () => void;
}

const COLOR_MODES: readonly ColorMode[] = ["light", "dark", "system"];

export function SettingsModal({
  open,
  onOpenChange,
  currentModel,
  availableModels,
  modelsLoading,
  modelsError,
  themes,
  selectedThemeId,
  colorMode,
  onSelectModel,
  onThemeChange,
  onColorModeChange,
  onRetry,
}: SettingsModalProps) {
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
  const showSavedModelOption = availableModels !== null && !availableModels.includes(currentModel);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure model, theme, and color mode.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <div className="text-xs font-medium text-foreground">Model</div>
          <div className="text-xs text-muted-foreground">
            Current: <span className="font-mono text-foreground">{currentModel}</span>
          </div>

          {modelsLoading ? (
            <div className="text-xs text-muted-foreground">Loading models…</div>
          ) : modelsError ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <div>{modelsError}</div>
              <Button type="button" variant="destructive" size="sm" onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : availableModels ? (
            <>
              <Select value={currentModel} onValueChange={onSelectModel}>
                <SelectTrigger aria-label="Model" className="w-full">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {showSavedModelOption ? (
                    <SelectItem value={currentModel}>{currentModel} (saved)</SelectItem>
                  ) : null}
                  {availableModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Changes apply when you start a new chat — your current conversation keeps its model.
              </p>
            </>
          ) : null}
        </section>

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
      </DialogContent>
    </Dialog>
  );
}
