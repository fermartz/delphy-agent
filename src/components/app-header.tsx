import { Settings as SettingsIcon } from "lucide-react";
import { memo } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { ColorModeToggle } from "@/components/color-mode-toggle";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import type { ColorMode } from "@/core/settings/types";
import type { Theme } from "@/themes/types";

interface AppHeaderProps {
  themes: Theme[];
  selectedThemeId: string;
  onThemeChange: (themeId: string) => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  onOpenSettings: () => void;
}

/** Top chrome: brand + theme switcher + color-mode toggle + settings gear. */
export const AppHeader = memo(function AppHeader({
  themes,
  selectedThemeId,
  onThemeChange,
  colorMode,
  onColorModeChange,
  onOpenSettings,
}: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <BrandLogo size={40} />
        <h1 className="shrink-0 text-lg font-semibold tracking-tight">Delphy Agent</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ThemeSwitcher
          themes={themes}
          selectedThemeId={selectedThemeId}
          onThemeChange={onThemeChange}
        />
        <ColorModeToggle mode={colorMode} onChange={onColorModeChange} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label="Open settings"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <SettingsIcon className="h-3 w-3" />
        </Button>
      </div>
    </header>
  );
});
